import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { AuthRequest } from "../auth";
import {
  type BBPRChange,
  getFileContent as getBitbucketFileContent,
  getPRChanges,
  getPullRequest,
  getPRActivities,
  getMergedPRReviewSignals,
  postPRComment as postBitbucketPRComment,
  getRepos,
  getPullRequestsPage,
  searchPullRequestsPage,
} from "../services/bitbucket-server";
import { getIssueDetail, getLinkedPullRequests } from "../services/jira";
import { reviewPR, reviewPRStrictJson, PRFile, PRReviewResult, ExistingPRComment } from "../services/pr-review";
import type { StrictReviewOutput } from "../services/review-output-schema";
import {
  buildBehavioralPatternContext,
  HistoricalReviewSignal,
} from "../services/behavioral-pattern-engine";
import {
  addManualPattern,
  deletePattern,
  getAllPatterns,
  getBatchRunHistory,
  getCachedSignals,
  getEnabledPatterns,
  getLastBatchRun,
  getSignalCount,
  updatePattern,
} from "../services/behavioral-pattern-store";
import { runBatchForRepo } from "../services/bpe-batch-runner";
import { computeAuthorPatternInsights } from "../services/author-pattern-insights";
import {
  SUPPRESSION_REASON_CODES,
  computeFindingFingerprint,
  createSuppression,
  expireSuppression,
  listSuppressions,
  type SuppressionReasonCode,
} from "../services/review-suppression-store";
import {
  createReviewRun,
  getReviewFeedbackSignals,
  getReviewMetricsSummary,
  upsertFindingFeedback,
} from "../services/review-governance-store";
import { extractJiraKeys, getKnowledgeContextForJiraKeys } from "../services/knowledge-warehouse";
import { formatPRReviewSummaryHTML, sendEmail } from "../services/email";
import { getLatestSnapshot } from "../services/pr-readiness";
import type { PRReadinessSnapshot } from "../services/pr-readiness";
import { getCachedReview, setCachedReview } from "../services/review-cache-store";
import db from "../db";

const router = Router();

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function envFlagEnabled(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (typeof raw === "undefined") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

const STRICT_MAX_ISSUES = Math.max(1, Number(process.env.STRICT_MAX_ISSUES || 25));

function formatStrictReviewComment(review: StrictReviewOutput, maxIssues = STRICT_MAX_ISSUES): string {
  const header = [
    "## GroomPilot Automated Review",
    "",
    `Risk: **${review.risk.toUpperCase()}**`,
    "",
    review.summary,
  ];

  if (!review.issues.length) {
    return [...header, "", "No material issues detected in changed code."].join("\n");
  }

  const issueLines = review.issues.slice(0, maxIssues).map((issue, idx) => {
    const lineLabel = issue.line ? `:${issue.line}` : "";
    return [
      `${idx + 1}. **${issue.severity.toUpperCase()} ${issue.type}** - ${issue.file}${lineLabel}`,
      `   - ${issue.title}`,
      `   - ${issue.description}`,
      `   - Fix: ${issue.fix}`,
      `   - Human review: ${issue.needsHumanReview ? "required" : "not required"}`,
    ].join("\n");
  });

  const truncatedNote = review.issues.length > maxIssues
    ? [``, `Showing ${maxIssues} of ${review.issues.length} issues.`]
    : [];

  return [
    ...header,
    "",
    "### Findings",
    ...issueLines,
    ...truncatedNote,
  ].join("\n");
}

function isJiraKey(text: string): boolean {
  return /^[A-Z][A-Z0-9]+-\d+$/i.test(text.trim());
}

function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[_/\\\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .trim();
}

function jiraKeyVariants(input: string): string[] {
  const base = input.trim().toUpperCase().replace(/[\u2010-\u2015]/g, "-");
  const m = base.match(/^([A-Z][A-Z0-9]+)[-\s_]*(\d+)$/);
  if (!m) return [normalizeForSearch(base)];

  const project = m[1];
  const id = m[2];
  const variants = [
    `${project}-${id}`,
    `${project}_${id}`,
    `${project} ${id}`,
    `${project}${id}`,
  ];
  return Array.from(new Set(variants.map(normalizeForSearch).filter(Boolean)));
}

async function getAllPullRequestsForRepo(repoSlug: string, state: string, maxPages = 5, projectKey?: string): Promise<any[]> {
  const limit = 100;
  let start = 0;
  let pageCount = 0;
  const all: any[] = [];

  while (pageCount < maxPages) {
    const page = await getPullRequestsPage(repoSlug, state, limit, start, projectKey);
    all.push(...(page.values || []));
    if (page.isLastPage || !(page.values || []).length) break;
    const nextStart = page.start + page.limit;
    if (!Number.isFinite(nextStart) || nextStart <= start || page.limit <= 0) break;
    start = nextStart;
    pageCount += 1;
  }

  return all;
}

async function getFilteredPullRequestsForRepo(
  repoSlug: string,
  state: string,
  query: string,
  maxPages = 3,
  projectKey?: string,
): Promise<any[]> {
  const limit = 100;
  let start = 0;
  let pageCount = 0;
  const all: any[] = [];

  while (pageCount < maxPages) {
    const page = await searchPullRequestsPage(repoSlug, query, state, limit, start, projectKey);
    all.push(...(page.values || []));
    if (page.isLastPage || !(page.values || []).length) break;
    const nextStart = page.start + page.limit;
    if (!Number.isFinite(nextStart) || nextStart <= start || page.limit <= 0) break;
    start = nextStart;
    pageCount += 1;
  }

  return all;
}

// Search Bitbucket PRs by JIRA key or free-text description/title
router.get("/search", async (req: AuthRequest, res: Response) => {
  try {
    const query = String(req.query.q || "").trim();
    const stateParam = String(req.query.state || "ALL").toUpperCase();
    const stateList = stateParam === "ALL"
      ? ["OPEN", "MERGED", "DECLINED"]
      : [stateParam];

    if (!query) {
      res.status(400).json({ error: "q (query) is required" });
      return;
    }

    const repos = await getRepos();
    const q = normalizeForSearch(query);
    const tokens = tokenizeSearchQuery(query);
    const jiraMode = isJiraKey(query);
    const jiraVariants = jiraMode ? jiraKeyVariants(query) : [];

    if (jiraMode) {
      const filteredLists = await Promise.all(
        repos.map(async (repo) => {
          try {
            const statePages = await Promise.all(
              stateList.map((state) => getFilteredPullRequestsForRepo(repo.slug, state, query, 2, repo.project?.key).catch(() => []))
            );
            const prs = statePages.flat();
            return prs.map((pr) => ({ repoSlug: repo.slug, projectKey: repo.project?.key || process.env.BITBUCKET_PROJECT || "BMN", pr }));
          } catch {
            return [] as Array<{ repoSlug: string; projectKey: string; pr: any }>;
          }
        })
      );

      const dedup = new Map<string, { repoSlug: string; projectKey: string; pr: any }>();
      for (const item of filteredLists.flat()) {
        const key = `${item.projectKey}:${item.repoSlug}:${item.pr.id}`;
        if (!dedup.has(key)) dedup.set(key, item);
      }

      const jiraMatches = Array.from(dedup.values())
        .filter(({ pr }) => {
          const blob = normalizeForSearch([
            String(pr.id || ""),
            String(pr.title || ""),
            String(pr.description || ""),
            String(pr.fromRef?.displayId || ""),
            String(pr.toRef?.displayId || ""),
            String(pr.author?.user?.displayName || ""),
            String((pr.reviewers || []).map((r: any) => r?.user?.displayName || "").join(" ")),
            String(pr.links?.self?.[0]?.href || ""),
          ].join(" "));
          return jiraVariants.some((v) => blob.includes(v)) || blob.includes(q);
        })
        .sort((a, b) => (b.pr.updatedDate || 0) - (a.pr.updatedDate || 0));

      if (jiraMatches.length > 0) {
        const results = jiraMatches
          .slice(0, 40)
          .map(({ repoSlug, projectKey, pr }) => ({
            id: pr.id,
            repoSlug,
            projectKey,
            title: pr.title,
            description: pr.description || "",
            author: pr.author?.user?.displayName || "unknown",
            sourceBranch: pr.fromRef?.displayId || "",
            targetBranch: pr.toRef?.displayId || "",
            state: pr.state,
            url: pr.links?.self?.[0]?.href ||
              `${process.env.BITBUCKET_URL}/projects/${projectKey || process.env.BITBUCKET_PROJECT || "BMN"}/repos/${repoSlug}/pull-requests/${pr.id}`,
          }));

        res.json({ query, state: stateParam, count: jiraMatches.length, returned: results.length, results });
        return;
      }

      try {
        const linked = await getLinkedPullRequests(query.toUpperCase());
        if (linked.length > 0) {
          const results = linked.slice(0, 40).map((pr, index) => ({
            id: pr.id || `jira-linked-${index + 1}`,
            repoSlug: pr.repo || "",
            projectKey: pr.project || process.env.BITBUCKET_PROJECT || "BMN",
            title: pr.title || query.toUpperCase(),
            description: "Linked from Jira development metadata",
            author: pr.author || "unknown",
            sourceBranch: pr.sourceBranch || "",
            targetBranch: pr.targetBranch || "",
            state: pr.status || "UNKNOWN",
            url: pr.url || "",
          }));

          res.json({ query, state: stateParam, count: linked.length, returned: results.length, results, source: "jira-linked" });
          return;
        }
      } catch {
        // If linked-PR lookup fails, continue to issue detail fallback.
      }

      try {
        const issue = await getIssueDetail(query.toUpperCase());
        res.json({
          query,
          state: stateParam,
          count: 0,
          returned: 0,
          results: [],
          jiraIssue: {
            key: issue.key,
            summary: issue.fields?.summary || "",
            status: issue.fields?.status?.name || "",
            url: `${process.env.JIRA_URL}/browse/${issue.key}`,
          },
          hint: "No Bitbucket PR matched this Jira key in scanned title/description/branch metadata.",
        });
        return;
      } catch {
        // If Jira lookup fails, fall back to normal empty response.
      }

      res.json({ query, state: stateParam, count: 0, returned: 0, results: [] });
      return;
    }

    const prLists = await Promise.all(
      repos.map(async (repo) => {
        try {
          const statePages = await Promise.all(
            stateList.map((state) => getAllPullRequestsForRepo(repo.slug, state, 5, repo.project?.key).catch(() => []))
          );
          const prs = statePages.flat();
          return prs.map((pr) => ({ repoSlug: repo.slug, projectKey: repo.project?.key || process.env.BITBUCKET_PROJECT || "BMN", pr }));
        } catch {
          return [] as Array<{ repoSlug: string; projectKey: string; pr: any }>;
        }
      })
    );

    const matches = prLists
      .flat()
      .filter(({ pr }) => {
        const blob = normalizeForSearch([
          String(pr.id || ""),
          String(pr.title || ""),
          String(pr.description || ""),
          String(pr.fromRef?.displayId || ""),
          String(pr.toRef?.displayId || ""),
          String(pr.author?.user?.displayName || ""),
          String((pr.reviewers || []).map((r: any) => r?.user?.displayName || "").join(" ")),
          String(pr.links?.self?.[0]?.href || ""),
        ].join(" "));

        const tokenMatches = tokens
          .map(normalizeForSearch)
          .filter((t) => t && blob.includes(t)).length;
        return tokenMatches >= Math.max(1, Math.ceil(tokens.length / 2));
      })
      .sort((a, b) => (b.pr.updatedDate || 0) - (a.pr.updatedDate || 0));

    const results = matches
      .slice(0, 40)
      .map(({ repoSlug, projectKey, pr }) => ({
        id: pr.id,
        repoSlug,
        projectKey,
        title: pr.title,
        description: pr.description || "",
        author: pr.author?.user?.displayName || "unknown",
        sourceBranch: pr.fromRef?.displayId || "",
        targetBranch: pr.toRef?.displayId || "",
        state: pr.state,
        url: pr.links?.self?.[0]?.href ||
          `${process.env.BITBUCKET_URL}/projects/${projectKey || process.env.BITBUCKET_PROJECT || "BMN"}/repos/${repoSlug}/pull-requests/${pr.id}`,
      }));

    res.json({ query, state: stateParam, count: matches.length, returned: results.length, results });
  } catch (err) {
    console.error("PR search error:", err);
    res.status(500).json({ error: "Failed to search pull requests" });
  }
});

// Parse a Bitbucket PR URL:
// https://bitbucket.example.com/projects/PRJ/repos/my-repo/pull-requests/123
function parseBitbucketPRUrl(url: string): { project: string; repo: string; prId: number } | null {
  const match = url.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/);
  if (!match) return null;
  return { project: match[1], repo: match[2], prId: parseInt(match[3]) };
}

type DurationSampleRow = { duration_ms: number };

const reviewDurationSamplesStmt = db.prepare(`
  SELECT duration_ms
  FROM review_runs
  WHERE repo_slug = ?
    AND duration_ms > 0
    AND duration_ms <= 600000
  ORDER BY completed_at DESC
  LIMIT 250
`);

const reviewDurationSamplesByTypeStmt = db.prepare(`
  SELECT duration_ms
  FROM review_runs
  WHERE repo_slug = ?
    AND change_type = ?
    AND duration_ms > 0
    AND duration_ms <= 600000
  ORDER BY completed_at DESC
  LIMIT 150
`);

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantile(sortedValues: number[], q: number): number {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = clamp(0, q, 1) * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function predictChangeTypeFromFiles(files: BBPRChange[]): string {
  if (!files.length) return "mixed";

  const configOrInfra = files.filter((f) => /(^|\/)(dockerfile|helm|k8s|terraform|infra|charts|deploy)(\/|$)|\.(ya?ml|json|toml|ini|conf|properties|gradle|pom)$/i.test(f.filename)).length;
  const tests = files.filter((f) => /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./i.test(f.filename)).length;
  const securitySensitive = files.some((f) => /(auth|oauth|jwt|token|crypto|encrypt|decrypt|secret|payment|bank|pci)/i.test(f.filename));

  if (securitySensitive) return "security-sensitive";
  if (configOrInfra / files.length >= 0.6) return "config-only";
  if (configOrInfra / files.length >= 0.25) return "infra-platform";
  if (tests / files.length >= 0.6) return "refactor";
  return "feature";
}

function estimateReviewDurationSeconds(repoSlug: string, files: BBPRChange[], targetBranch = ""): {
  estimatedSeconds: number;
  confidence: "low" | "medium" | "high";
  factors: {
    predictedChangeType: string;
    targetBranch: string;
    changedFiles: number;
    churn: number;
    fileFactor: number;
    churnFactor: number;
    branchFactor: number;
    repoSampleSize: number;
    typeSampleSize: number;
  };
} {
  const changedFiles = files.length;
  const churn = files.reduce((sum, f) => sum + (f.additions || 0) + (f.deletions || 0), 0);
  const predictedChangeType = predictChangeTypeFromFiles(files);

  const repoSamples = (reviewDurationSamplesStmt.all(repoSlug) as DurationSampleRow[])
    .map((r) => Number(r.duration_ms || 0) / 1000)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const typeSamples = (reviewDurationSamplesByTypeStmt.all(repoSlug, predictedChangeType) as DurationSampleRow[])
    .map((r) => Number(r.duration_ms || 0) / 1000)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const repoMedian = repoSamples.length ? quantile(repoSamples, 0.5) : 45;
  const typeMedian = typeSamples.length ? quantile(typeSamples, 0.5) : repoMedian;

  // Weight towards type-specific history when enough samples exist.
  const typeWeight = typeSamples.length >= 10 ? 0.65 : typeSamples.length >= 5 ? 0.45 : 0.25;
  let estimate = (repoMedian * (1 - typeWeight)) + (typeMedian * typeWeight);

  // Diff-size adjustment from pre-review available signals.
  const fileFactor = changedFiles <= 2 ? 0.85 : changedFiles <= 8 ? 1 : changedFiles <= 20 ? 1.25 : 1.55;
  const churnFactor = churn <= 120 ? 0.9 : churn <= 600 ? 1 : churn <= 1800 ? 1.3 : 1.75;

  // Branch-aware smoothing: release/mainline targets typically require broader context checks.
  const normalizedBranch = String(targetBranch || "").toLowerCase();
  const branchFactor = /(^|\/)(main|master|release|milestone|milestones|hotfix|prod|production)(\/|$)/.test(normalizedBranch)
    ? 1.15
    : /(^|\/)(develop|dev|feature|sandbox)(\/|$)/.test(normalizedBranch)
      ? 0.95
      : 1.0;

  estimate *= fileFactor * churnFactor * branchFactor;

  // Use historical p75 as soft ceiling for stable UX, with reasonable global bounds.
  const p75 = repoSamples.length ? quantile(repoSamples, 0.75) : 90;
  estimate = clamp(12, Math.round(Math.min(estimate, p75 * 1.35)), 360);

  const confidence: "low" | "medium" | "high" = repoSamples.length >= 60
    ? "high"
    : repoSamples.length >= 20
      ? "medium"
      : "low";

  return {
    estimatedSeconds: estimate,
    confidence,
    factors: {
      predictedChangeType,
      targetBranch,
      changedFiles,
      churn,
      fileFactor,
      churnFactor,
      branchFactor,
      repoSampleSize: repoSamples.length,
      typeSampleSize: typeSamples.length,
    },
  };
}

router.post("/review-estimate", async (req: AuthRequest, res: Response) => {
  try {
    const { prUrl, forceRefresh } = req.body || {};
    const forceRefreshRequested = forceRefresh === true || String(forceRefresh).toLowerCase() === "true";
    if (!prUrl) {
      res.status(400).json({ error: "prUrl is required" });
      return;
    }

    if (!forceRefreshRequested) {
      const cached = getCachedReview(String(prUrl));
      if (cached) {
        res.json({
          estimatedSeconds: 3,
          confidence: "high",
          source: "cache-hit",
          factors: {
            predictedChangeType: "cached",
            targetBranch: String((cached as any)?.prMeta?.target || ""),
            changedFiles: Number((cached as any)?.prMeta?.changedFiles || 0),
            churn: 0,
            fileFactor: 1,
            churnFactor: 1,
            branchFactor: 1,
            repoSampleSize: 0,
            typeSampleSize: 0,
          },
        });
        return;
      }
    }

    const parsed = parseBitbucketPRUrl(String(prUrl));
    if (!parsed) {
      res.status(400).json({ error: "Invalid PR URL" });
      return;
    }

    const { pr, files } = await getPRChanges(parsed.repo, parsed.prId);
    const targetBranch = String(pr?.toRef?.displayId || "");
    const estimate = estimateReviewDurationSeconds(parsed.repo, files, targetBranch);
    res.json({
      ...estimate,
      source: "historical-signals",
    });
  } catch (err) {
    console.error("PR review estimate error:", err);
    res.status(500).json({ error: "Failed to estimate review duration" });
  }
});

function readinessToReviewSeverity(severity: string): "critical" | "error" | "warning" | "info" | "suggestion" {
  const s = String(severity || "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "error";
  if (s === "medium") return "warning";
  if (s === "low" || s === "info") return "info";
  return "suggestion";
}

function readinessClassificationToAction(classification: string): "block" | "warning" | "suggestion" | "informational" {
  const c = String(classification || "").toLowerCase();
  if (c === "blocker") return "block";
  if (c === "important") return "warning";
  if (c === "follow-up") return "suggestion";
  return "informational";
}

function riskLabelToDimensionGrade(risk: string): "excellent" | "good" | "fair" | "poor" | "critical" {
  const r = String(risk || "").toLowerCase();
  if (r === "low") return "excellent";
  if (r === "medium") return "good";
  if (r === "high") return "fair";
  if (r === "critical") return "critical";
  return "poor";
}

function riskLabelToScore(risk: string): number {
  const r = String(risk || "").toLowerCase();
  if (r === "low") return 18;
  if (r === "medium") return 42;
  if (r === "high") return 71;
  if (r === "critical") return 90;
  return 50;
}

function buildCachedReviewFromSnapshot(snapshot: PRReadinessSnapshot, repoSlug: string): PRReviewResult {
  const sourceFindings =
    (snapshot.finalMergedFindings && snapshot.finalMergedFindings.length > 0
      ? snapshot.finalMergedFindings
      : snapshot.deterministicFindings) || [];

  const findings = sourceFindings.map((f: any, idx: number) => ({
    id: f.id || `cached-${snapshot.prId}-${idx + 1}`,
    file: String(f.file || "unknown"),
    line: typeof f.line === "number" ? f.line : undefined,
    severity: readinessToReviewSeverity(f.severity),
    confidence: f.confidence === "high" || f.confidence === "low" ? f.confidence : "medium",
    dimension: "correctness" as const,
    category: String(f.type || f.source || "readiness"),
    title: String(f.title || "Readiness finding"),
    message: String(f.description || "Potential issue detected by readiness checks."),
    whyItMatters: typeof f.whyItMatters === "string" ? f.whyItMatters : undefined,
    evidence: typeof f.whyItMatters === "string" ? f.whyItMatters : undefined,
    suggestedFix: typeof f.fix === "string" ? f.fix : undefined,
    action: readinessClassificationToAction(f.classification),
    needsHumanConfirmation: !!f.needsHumanReview,
    reviewStatus: "actionable" as const,
    verificationStatus: "confirmed" as const,
  }));

  if (findings.length === 0 && snapshot.strictOutput?.issues?.length) {
    snapshot.strictOutput.issues.forEach((issue: any, idx: number) => {
      findings.push({
        id: issue.id || `cached-strict-${snapshot.prId}-${idx + 1}`,
        file: String(issue.file || "unknown"),
        line: typeof issue.line === "number" ? issue.line : undefined,
        severity: readinessToReviewSeverity(issue.severity),
        confidence: issue.confidence === "high" || issue.confidence === "low" ? issue.confidence : "medium",
        dimension: "correctness",
        category: String(issue.type || "readiness"),
        title: String(issue.title || "Cached strict issue"),
        message: String(issue.description || "Issue from cached strict output."),
        whyItMatters: String(issue.whyItMatters || "Derived from cached strict output."),
        evidence: String(issue.whyItMatters || "Strict output evidence"),
        suggestedFix: String(issue.fix || "Address this issue and re-run analysis."),
        action: issue.needsHumanReview ? "block" : readinessClassificationToAction("important"),
        needsHumanConfirmation: !!issue.needsHumanReview,
        reviewStatus: "actionable",
        verificationStatus: "confirmed",
      } as any);
    });
  }

  // If snapshot has aggregate counts but no serialized findings, synthesize placeholders
  // so the cached payload remains internally consistent for the UI.
  if (findings.length === 0) {
    for (let i = 0; i < Math.max(0, snapshot.blockerCount || 0); i += 1) {
      findings.push({
        id: `cached-blocker-${snapshot.prId}-${i + 1}`,
        file: "unknown",
        line: undefined,
        severity: "error",
        confidence: "medium",
        dimension: "correctness",
        category: "readiness",
        title: `Readiness blocker ${i + 1}`,
        message: "Blocker detected in cached readiness snapshot.",
        whyItMatters: "Cached snapshot indicates a blocker-level risk.",
        evidence: "Readiness snapshot aggregate blocker count",
        suggestedFix: "Run Force Fresh Analysis for full root-cause details.",
        action: "block",
        needsHumanConfirmation: true,
        reviewStatus: "actionable",
        verificationStatus: "confirmed",
      } as any);
    }
    for (let i = 0; i < Math.max(0, snapshot.importantCount || 0); i += 1) {
      findings.push({
        id: `cached-important-${snapshot.prId}-${i + 1}`,
        file: "unknown",
        line: undefined,
        severity: "warning",
        confidence: "medium",
        dimension: "correctness",
        category: "readiness",
        title: `Readiness warning ${i + 1}`,
        message: "Important issue detected in cached readiness snapshot.",
        whyItMatters: "Cached snapshot indicates warning-level risk.",
        evidence: "Readiness snapshot aggregate important count",
        suggestedFix: "Run Force Fresh Analysis for detailed remediation.",
        action: "warning",
        needsHumanConfirmation: false,
        reviewStatus: "actionable",
        verificationStatus: "confirmed",
      } as any);
    }
    for (let i = 0; i < Math.max(0, snapshot.followUpCount || 0); i += 1) {
      findings.push({
        id: `cached-followup-${snapshot.prId}-${i + 1}`,
        file: "unknown",
        line: undefined,
        severity: "info",
        confidence: "medium",
        dimension: "correctness",
        category: "readiness",
        title: `Readiness follow-up ${i + 1}`,
        message: "Follow-up item detected in cached readiness snapshot.",
        whyItMatters: "Cached snapshot indicates deferred improvements.",
        evidence: "Readiness snapshot aggregate follow-up count",
        suggestedFix: "Review in a later pass or run fresh analysis.",
        action: "suggestion",
        needsHumanConfirmation: false,
        reviewStatus: "actionable",
        verificationStatus: "confirmed",
      } as any);
    }
  }

  const blockers = findings.filter((f: any) => f.action === "block").length;
  const warnings = findings.filter((f: any) => f.action === "warning").length;
  const suggestions = findings.filter((f: any) => f.action === "suggestion").length;
  const informational = findings.filter((f: any) => f.action === "informational").length;
  const topRisks = findings.filter((f: any) => f.action === "block").slice(0, 3).map((f: any) => f.title);
  const complianceScore = Math.max(0, 100 - blockers * 30 - warnings * 10 - suggestions * 4);
  const riskScore = riskLabelToScore(snapshot.overallRisk);

  const verdict: "block" | "warning" | "auto-approve" = blockers > 0 || snapshot.readinessState === "blocked"
    ? "block"
    : (warnings > 0 || snapshot.readinessState === "ready_with_warnings")
      ? "warning"
      : "auto-approve";

  const recommendation: "APPROVE" | "APPROVE WITH CONDITIONS" | "REJECT" = verdict === "block"
    ? "REJECT"
    : verdict === "warning"
      ? "APPROVE WITH CONDITIONS"
      : "APPROVE";

  const blockingIssues = findings
    .filter((f: any) => f.action === "block")
    .map((f: any) => ({
      title: f.title,
      description: f.message,
      file: f.file,
      line: f.line,
      severity: f.severity,
      suggestedFix: f.suggestedFix,
    }));

  const nonBlockingIssues = findings
    .filter((f: any) => f.action !== "block")
    .slice(0, 15)
    .map((f: any) => ({
      title: f.title,
      description: f.message,
      file: f.file,
      line: f.line,
      severity: f.severity,
      suggestedFix: f.suggestedFix,
    }));

  return {
    summary: {
      headline: `Cached readiness snapshot (${snapshot.readinessState}) from ${new Date(snapshot.updatedAt).toLocaleString()}`,
      changeType: "mixed",
      totalFindings: findings.length,
      blockers,
      warnings,
      suggestions,
      informational,
      topRisks,
      strengths: blockers === 0 ? ["No blocker-level readiness findings in cached snapshot"] : [],
      verdict,
      riskSummary: `Readiness state: ${snapshot.readinessState}; overall risk: ${snapshot.overallRisk}`,
    },
    riskProfile: {
      overallScore: riskScore,
      label: snapshot.overallRisk,
      factors: [
        {
          factor: "readiness_snapshot",
          weight: Math.max(1, Math.round(riskScore / 10)),
          detail: `Derived from deterministic readiness analysis (${snapshot.readinessState})`,
        },
      ],
      changeType: "mixed",
      recommendation: verdict === "auto-approve" ? "auto-approve" : verdict,
    },
    triage: {
      files: [],
      subsystem: [repoSlug],
      sensitivity: blockers > 0 ? ["security-or-correctness"] : [],
      blastRadius: blockers > 0 ? "high" : warnings > 0 ? "medium" : "low",
      highRiskCategories: topRisks,
    },
    contextBundle: {
      files: [],
      selectedPolicyPacks: snapshot.appliedPolicyPacks || [],
      relevantPrecedents: [],
      ownershipMetadataPresent: false,
    },
    dimensionScores: [
      {
        dimension: "correctness",
        score: complianceScore,
        label: riskLabelToDimensionGrade(snapshot.overallRisk),
        findingCount: findings.length,
        blockerCount: blockers,
        summary: `Snapshot risk ${snapshot.overallRisk} (${snapshot.readinessState})`,
      },
    ],
    findings,
    specsAlignment: [],
    knowledgeContext: [],
    complianceScore,
    reviewerRouting: blockers > 0 ? ["backend-owner", "security-reviewer"] : ["backend-owner"],
    autoApprovalEligible: blockers === 0 && warnings === 0,
    governance: {
      schemaAdjusted: 0,
      suppressedCount: 0,
      suppressedFindings: [],
    },
    report: {
      recommendation,
      blockingIssues,
      nonBlockingIssues,
      positiveObservations: blockers === 0 ? ["No blocker-level findings in cached snapshot"] : [],
      followUpActions: nonBlockingIssues.slice(0, 5).map((i: any) => i.title),
      existingFeedbackSummary: "Loaded from cached readiness snapshot.",
    },
    audit: {
      traceId: `cached-${snapshot.id}`,
      provider: "readiness-cache",
      model: snapshot.modelUsed || "deterministic",
      reviewMode: "hybrid_balanced",
      startedAt: snapshot.updatedAt,
      completedAt: snapshot.updatedAt,
      durationMs: 0,
      promptInjectionGuardsApplied: true,
      secretRedactionsApplied: 0,
      structuredOutputValidated: true,
      evidenceCaptureComplete: true,
    },
    metrics: {
      duplicateFindingCount: 0,
      suppressedFindingCount: 0,
      schemaAdjustmentCount: 0,
      reviewedFileCount: 0,
      precedentCount: 0,
      batchFailures: [],
      dismissedFindingCount: 0,
      downgradedFindingCount: 0,
      verificationSkippedCount: 0,
    },
    behavioralPattern: {
      enabled: false,
      historySignalsUsed: Number(snapshot.historicalReviewerSignals || 0),
      contextHash: `snapshot:${snapshot.id}`,
      highlights: [],
    },
    astContext: {
      enabled: true,
      parserLanguagesAvailable: snapshot.parserLanguagesAvailable || [],
      parsedFiles: 0,
      failures: [],
      selectedPolicyPacks: snapshot.appliedPolicyPacks || [],
    },
    reviewPlan: {
      planVersion: "cached-v1",
      summary: "Cached readiness snapshot used",
      filesPlanned: 0,
      batches: [],
      plannerNotes: [
        "Returned cached readiness-derived review for fast response.",
        `Snapshot updated at ${snapshot.updatedAt}`,
      ],
    } as any,
    strictOutput: {
      summary: `Cached readiness snapshot (${snapshot.readinessState})`,
      risk: snapshot.overallRisk,
      issues: findings.slice(0, 25).map((f: any) => ({
        id: f.id,
        type: "BUG",
        severity:
          f.severity === "critical"
            ? "critical"
            : f.severity === "error"
              ? "high"
              : f.severity === "warning"
                ? "medium"
                : f.severity === "suggestion"
                  ? "low"
                  : "info",
        confidence: f.confidence,
        file: f.file,
        line: f.line,
        title: f.title,
        description: f.message,
        whyItMatters: f.whyItMatters || "Derived from cached readiness analysis.",
        fix: f.suggestedFix || "Review and address as needed.",
        codeSuggestion: undefined,
        ruleRefs: undefined,
        needsHumanReview: f.action === "block",
      })),
    },
  };
}

function buildSpecsFromSessionData(data: string): string {
  try {
    const parsed = JSON.parse(data);
    const result = parsed?.result;
    if (!result) return "";

    const parts: string[] = [];
    if (result.acceptanceCriteria?.length) {
      parts.push("ACCEPTANCE CRITERIA:");
      result.acceptanceCriteria.forEach((ac: string, i: number) => parts.push(`  ${i + 1}. ${ac}`));
    }
    if (result.scenarios?.length) {
      parts.push("\nSCENARIOS:");
      result.scenarios.forEach((s: any) => {
        parts.push(`  - ${s.name}`);
        if (s.given) parts.push(`    Given: ${s.given}`);
        if (s.when) parts.push(`    When: ${s.when}`);
        if (s.then) parts.push(`    Then: ${s.then}`);
      });
    }
    if (result.expectedBehavior?.length) {
      parts.push("\nEXPECTED BEHAVIOR:");
      result.expectedBehavior.forEach((eb: string) => parts.push(`  - ${eb}`));
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

function loadSpecsForSession(sessionId: string, userId: string): string {
  const session = db.prepare("SELECT data FROM sessions WHERE id = ? AND created_by = ?").get(sessionId, userId) as
    | { data: string }
    | undefined;
  if (!session) return "";
  return buildSpecsFromSessionData(session.data);
}

function findLinkedSessionIdForPR(
  provider: "bitbucket",
  projectKey: string,
  repoSlug: string,
  prNumber: number,
  userId: string,
): string | undefined {
  const row = db.prepare(`
    SELECT l.session_id
    FROM pr_groom_links l
    JOIN sessions s ON s.id = l.session_id
    WHERE l.provider = ?
      AND l.project_key = ?
      AND l.repo_slug = ?
      AND l.pr_number = ?
      AND l.linked_by = ?
      AND s.created_by = ?
    ORDER BY l.created_at DESC
    LIMIT 1
  `).get(provider, projectKey, repoSlug, prNumber, userId, userId) as { session_id: string } | undefined;

  return row?.session_id;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

async function hydrateBitbucketFileContents(repoSlug: string, ref: string | undefined, files: PRFile[]): Promise<PRFile[]> {
  const candidates = files
    .filter((file) => file.status !== "removed" && file.patch)
    .slice(0, 12);

  await Promise.all(candidates.map(async (file) => {
    try {
      const content = await getBitbucketFileContent(repoSlug, file.filename, ref);
      file.fullContent = content;
    } catch {
      // Best effort only.
    }
  }));

  return files;
}

type ReviewExecutionResult = {
  prMeta: Record<string, any>;
  provider: "bitbucket";
  repoSlug: string;
  projectKey?: string;
  prNumber: number;
  bitbucket?: { project: string; repo: string; prId: number };
  strictOutput?: StrictReviewOutput;
  review?: PRReviewResult;
  reviewRunId?: string;
  usedSessionId?: string;
  specsSource?: "request" | "session" | "linked-session" | "none";
};

async function executeReview(
  req: AuthRequest,
  input: { prUrl: string; specs?: string; sessionId?: string; outputMode?: string; userId?: string },
): Promise<ReviewExecutionResult> {
  const outputMode = String(input.outputMode || "").toLowerCase();
  const strictJsonOnly = outputMode === "strict-json" || outputMode === "strict";

  let resolvedSpecs = input.specs || "";
  let usedSessionId: string | undefined;
  let specsSource: ReviewExecutionResult["specsSource"] = input.specs ? "request" : "none";

  const bbParsed = parseBitbucketPRUrl(input.prUrl);
  if (!bbParsed) {
    throw new Error(
      "Invalid PR URL. Bitbucket URL format expected:\n" +
      "  https://bitbucket.example.com/projects/PRJ/repos/my-repo/pull-requests/123",
    );
  }

  // Load specs precedence:
  // 1) explicit request specs
  // 2) explicit sessionId
  // 3) linked session for this PR
  if (!resolvedSpecs && input.userId) {
    const selectedSessionId = input.sessionId
      || findLinkedSessionIdForPR("bitbucket", bbParsed.project, bbParsed.repo, bbParsed.prId, input.userId);

    if (selectedSessionId) {
      resolvedSpecs = loadSpecsForSession(selectedSessionId, input.userId);
      if (resolvedSpecs) {
        usedSessionId = selectedSessionId;
        specsSource = input.sessionId ? "session" : "linked-session";
      }
    }
  }

  const historyLimit = Math.max(0, Math.min(Number(process.env.BPE_HISTORY_LIMIT || 12), 30));
  const shouldLoadHistory = (process.env.BPE_ENABLED || "true").toLowerCase() !== "false";
  const dbPatterns = shouldLoadHistory ? getEnabledPatterns(bbParsed.repo) : [];
  const precomputedBehavioralRefs = dbPatterns.length > 0 ? dbPatterns : undefined;
  const shouldLoadMergedSignals = shouldLoadHistory && dbPatterns.length === 0 && historyLimit > 0;

  const [{ pr, files }, activities, mergedSignals] = await Promise.all([
    getPRChanges(bbParsed.repo, bbParsed.prId),
    getPRActivities(bbParsed.repo, bbParsed.prId).catch(() => []),
    shouldLoadMergedSignals
      ? getMergedPRReviewSignals(bbParsed.repo, historyLimit).catch(() => [])
      : Promise.resolve([]),
  ]);

  const existingComments: ExistingPRComment[] = activities.map((a) => ({
    author: a.author,
    text: a.text,
    severity: a.severity,
    state: a.state,
    filePath: a.filePath,
    lineNumber: a.lineNumber,
  }));
  const historicalSignals: HistoricalReviewSignal[] = mergedSignals;
  const feedbackSignals = getReviewFeedbackSignals(bbParsed.repo);

  const prTitle = pr.title;
  const prBody = pr.description || "";
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  const prFiles: PRFile[] = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
    previousFilename: f.previousFilename,
  }));
  await hydrateBitbucketFileContents(bbParsed.repo, pr.fromRef?.displayId, prFiles);

  // If PR text contains Jira keys, append warehouse context to specs used by review.
  const jiraKeys = extractJiraKeys(`${prTitle}\n${prBody}`);
  if (jiraKeys.length > 0) {
    try {
      const knowledge = getKnowledgeContextForJiraKeys(jiraKeys, 12);
      if (knowledge.contextText) {
        const prefix = resolvedSpecs ? `${resolvedSpecs}\n\n` : "";
        resolvedSpecs = `${prefix}Knowledge Warehouse Context\n${knowledge.contextText}`;
      }
    } catch (err) {
      console.warn("Knowledge context append skipped:", err);
    }
  }

  const prMeta = {
    title: pr.title,
    url: pr.links?.self?.[0]?.href || input.prUrl,
    author: pr.author?.user?.displayName || "unknown",
    state: pr.state,
    additions: totalAdd,
    deletions: totalDel,
    changedFiles: files.length,
    sourceBranch: pr.fromRef?.displayId || "",
    sourceCommit: (pr as any)?.fromRef?.latestCommit || "",
    branch: pr.fromRef?.displayId || "",
    target: pr.toRef?.displayId || "",
    targetBranch: pr.toRef?.displayId || "",
    head: pr.fromRef?.displayId || "",
    updatedDate: (pr as any)?.updatedDate || 0,
  };

  const reviewInput = {
    prTitle,
    prBody,
    files: prFiles,
    specs: resolvedSpecs || undefined,
    repoSlug: bbParsed.repo,
    baseBranch: prMeta.target,
    sourceBranch: prMeta.branch || prMeta.head,
    author: prMeta.author,
    existingComments: existingComments.length > 0 ? existingComments : undefined,
    historicalSignals: historicalSignals.length > 0 ? historicalSignals : undefined,
    precomputedBehavioralRefs,
    feedbackSignals,
  };

  if (strictJsonOnly) {
    const strictOutput = await reviewPRStrictJson(reviewInput);
    return {
      prMeta,
      provider: "bitbucket",
      repoSlug: bbParsed.repo,
      projectKey: bbParsed.project,
      prNumber: bbParsed.prId,
      bitbucket: bbParsed,
      strictOutput,
      usedSessionId,
      specsSource,
    };
  }

  const result = await reviewPR(reviewInput);
  const reviewRunId = createReviewRun({
    repoSlug: bbParsed.repo,
    prUrl: input.prUrl,
    prTitle,
    provider: result.audit.provider,
    model: result.audit.model,
    changeType: result.summary.changeType,
    riskLabel: result.riskProfile.label,
    riskScore: result.riskProfile.overallScore,
    verdict: result.summary.verdict,
    blockers: result.summary.blockers,
    warnings: result.summary.warnings,
    suggestions: result.summary.suggestions,
    informational: result.summary.informational,
    totalFindings: result.summary.totalFindings,
    duplicateFindings: result.metrics.duplicateFindingCount,
    suppressedFindings: result.metrics.suppressedFindingCount,
    schemaAdjusted: result.metrics.schemaAdjustmentCount,
    highRiskCategories: result.triage.highRiskCategories,
    subsystems: result.triage.subsystem,
    sensitivity: result.triage.sensitivity,
    blastRadius: result.triage.blastRadius,
    auditTraceComplete: result.audit.evidenceCaptureComplete && result.audit.structuredOutputValidated,
    promptInjectionGuardsApplied: result.audit.promptInjectionGuardsApplied,
    secretRedactionsApplied: result.audit.secretRedactionsApplied,
    startedAt: result.audit.startedAt,
    completedAt: result.audit.completedAt,
    durationMs: result.audit.durationMs,
    summaryJson: JSON.stringify(result.summary),
    findingsJson: JSON.stringify(result.findings),
    createdBy: input.userId,
  });

  return {
    prMeta,
    provider: "bitbucket",
    repoSlug: bbParsed.repo,
    projectKey: bbParsed.project,
    prNumber: bbParsed.prId,
    bitbucket: bbParsed,
    review: result,
    reviewRunId,
    usedSessionId,
    specsSource,
  };
}

function getLeadUsernames(): Set<string> {
  const raw = process.env.BPE_LEAD_USERNAMES || "";
  return new Set(
    raw
      .split(",")
      .map((s) => normalizeUsername(s))
      .filter(Boolean)
  );
}

function canAccessAuthorInsights(requestedAuthor: string, req: AuthRequest): boolean {
  const username = normalizeUsername(req.user?.username || "");
  if (!username) return false;
  if (normalizeUsername(requestedAuthor) === username) return true;
  return getLeadUsernames().has(username);
}

// Behavioral diagnostics for a Bitbucket PR.
// Returns learned hotspots/patterns + context hash without running full AI review.
router.post("/behavioral-diagnostics", async (req: AuthRequest, res: Response) => {
  try {
    const { prUrl } = req.body;
    if (!prUrl) {
      res.status(400).json({ error: "prUrl is required" });
      return;
    }

    const bbParsed = parseBitbucketPRUrl(prUrl);
    if (!bbParsed) {
      res.status(400).json({
        error: "Behavioral diagnostics currently supports Bitbucket PR URLs only",
      });
      return;
    }

    const historyLimitRaw = Number(req.body.historyLimit ?? req.query.historyLimit ?? process.env.BPE_HISTORY_LIMIT ?? 12);
    const historyLimit = Math.max(0, Math.min(Number.isFinite(historyLimitRaw) ? historyLimitRaw : 12, 30));

    const [{ pr, files }, historicalSignals] = await Promise.all([
      getPRChanges(bbParsed.repo, bbParsed.prId),
      historyLimit > 0 ? getMergedPRReviewSignals(bbParsed.repo, historyLimit).catch(() => []) : Promise.resolve([]),
    ]);

    const prFiles: PRFile[] = files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    const behavioral = buildBehavioralPatternContext({
      prTitle: pr.title || "",
      prBody: pr.description || "",
      files: prFiles,
      historicalSignals,
    });

    res.json({
      pr: {
        id: pr.id,
        title: pr.title,
        repoSlug: bbParsed.repo,
        state: pr.state,
        sourceBranch: pr.fromRef?.displayId || "",
        targetBranch: pr.toRef?.displayId || "",
        changedFiles: files.length,
      },
      behavioral: {
        enabled: behavioral.enabled,
        contextHash: behavioral.contextHash,
        highlights: behavioral.highlights,
        historySignalsUsed: behavioral.historySignalsUsed,
        knowledgeReferences: behavioral.knowledgeReferences,
      },
      history: {
        requestedLimit: historyLimit,
        sampled: historicalSignals.length,
        signals: historicalSignals,
      },
    });
  } catch (err) {
    console.error("Behavioral diagnostics error:", err);
    res.status(500).json({ error: "Failed to generate behavioral diagnostics" });
  }
});

// Review a PR — supports Bitbucket URLs
// Optional sessionId: auto-loads grooming specs from a prior grooming session
router.post("/link-groom", async (req: AuthRequest, res: Response) => {
  try {
    const { prUrl, sessionId, notes } = req.body || {};
    if (!prUrl || !sessionId) {
      res.status(400).json({ error: "prUrl and sessionId are required" });
      return;
    }

    const bbParsed = parseBitbucketPRUrl(String(prUrl));
    if (!bbParsed) {
      res.status(400).json({ error: "Invalid Bitbucket PR URL" });
      return;
    }

    const session = db.prepare("SELECT id, title, story_id, created_by FROM sessions WHERE id = ?")
      .get(String(sessionId)) as { id: string; title: string; story_id?: string; created_by: string } | undefined;
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.created_by !== req.user?.id) {
      res.status(403).json({ error: "You can only link your own grooming sessions" });
      return;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT OR IGNORE INTO pr_groom_links
        (id, provider, project_key, repo_slug, pr_number, session_id, linked_by, notes)
      VALUES
        (?, 'bitbucket', ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      bbParsed.project,
      bbParsed.repo,
      bbParsed.prId,
      session.id,
      req.user?.id,
      notes ? String(notes) : null,
    );

    const link = db.prepare(`
      SELECT
        l.id,
        l.provider,
        l.project_key AS projectKey,
        l.repo_slug AS repoSlug,
        l.pr_number AS prNumber,
        l.session_id AS sessionId,
        l.notes,
        l.created_at AS createdAt,
        s.title AS sessionTitle,
        s.story_id AS storyId
      FROM pr_groom_links l
      JOIN sessions s ON s.id = l.session_id
      WHERE l.provider = 'bitbucket'
        AND l.project_key = ?
        AND l.repo_slug = ?
        AND l.pr_number = ?
        AND l.session_id = ?
      ORDER BY l.created_at DESC
      LIMIT 1
    `).get(bbParsed.project, bbParsed.repo, bbParsed.prId, session.id);

    res.json({ linked: true, link });
  } catch (err) {
    console.error("PR groom link error:", err);
    res.status(500).json({ error: "Failed to link grooming session to PR" });
  }
});

router.get("/groom-links", async (req: AuthRequest, res: Response) => {
  try {
    const prUrl = String(req.query.prUrl || "").trim();
    if (!prUrl) {
      res.status(400).json({ error: "prUrl query parameter is required" });
      return;
    }

    const bbParsed = parseBitbucketPRUrl(prUrl);
    if (!bbParsed) {
      res.status(400).json({ error: "Invalid Bitbucket PR URL" });
      return;
    }

    const links = db.prepare(`
      SELECT
        l.id,
        l.provider,
        l.project_key AS projectKey,
        l.repo_slug AS repoSlug,
        l.pr_number AS prNumber,
        l.session_id AS sessionId,
        l.notes,
        l.created_at AS createdAt,
        s.title AS sessionTitle,
        s.story_id AS storyId,
        s.created_at AS sessionCreatedAt
      FROM pr_groom_links l
      JOIN sessions s ON s.id = l.session_id
      WHERE l.provider = 'bitbucket'
        AND l.project_key = ?
        AND l.repo_slug = ?
        AND l.pr_number = ?
        AND l.linked_by = ?
      ORDER BY l.created_at DESC
      LIMIT 20
    `).all(bbParsed.project, bbParsed.repo, bbParsed.prId, req.user?.id);

    res.json({
      pr: {
        project: bbParsed.project,
        repo: bbParsed.repo,
        prId: bbParsed.prId,
      },
      links,
    });
  } catch (err) {
    console.error("List PR groom links error:", err);
    res.status(500).json({ error: "Failed to list PR groom links" });
  }
});

router.delete("/link-groom/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "link id is required" });
      return;
    }

    const existing = db.prepare("SELECT id, linked_by FROM pr_groom_links WHERE id = ?").get(id) as
      | { id: string; linked_by: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: "Link not found" });
      return;
    }
    if (existing.linked_by !== req.user?.id) {
      res.status(403).json({ error: "You can only unlink your own links" });
      return;
    }

    db.prepare("DELETE FROM pr_groom_links WHERE id = ?").run(id);
    res.json({ deleted: true, id });
  } catch (err) {
    console.error("Delete PR groom link error:", err);
    res.status(500).json({ error: "Failed to delete PR groom link" });
  }
});

router.get("/groom-link-index", async (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.query.repoSlug || "").trim();
    const projectKey = String(req.query.projectKey || process.env.BITBUCKET_PROJECT || "BMN").trim();
    if (!repoSlug) {
      res.status(400).json({ error: "repoSlug query parameter is required" });
      return;
    }

    const rows = db.prepare(`
      SELECT
        pr_number AS prNumber,
        COUNT(*) AS linkCount,
        MAX(created_at) AS latestLinkedAt
      FROM pr_groom_links
      WHERE provider = 'bitbucket'
        AND project_key = ?
        AND repo_slug = ?
        AND linked_by = ?
      GROUP BY pr_number
      ORDER BY latestLinkedAt DESC
    `).all(projectKey, repoSlug, req.user?.id);

    res.json({
      provider: "bitbucket",
      projectKey,
      repoSlug,
      count: rows.length,
      links: rows,
    });
  } catch (err) {
    console.error("PR groom link index error:", err);
    res.status(500).json({ error: "Failed to get PR groom link index" });
  }
});

router.post("/review", async (req: AuthRequest, res: Response) => {
  try {
    const { prUrl, specs, sessionId, forceRefresh } = req.body;
    const outputMode = String(req.body?.outputMode || req.query.outputMode || "").toLowerCase();
    const forceRefreshRequested = forceRefresh === true || String(forceRefresh).toLowerCase() === "true";
    if (!prUrl) {
      res.status(400).json({ error: "prUrl is required" });
      return;
    }

    // Fast lane: return cached full review output when available unless forceRefresh=true.
    if (!forceRefreshRequested) {
      const cached = getCachedReview(prUrl);
      if (cached) {
        // Check whether the PR has been updated since the last review (new commits, force-push, etc.)
        let staleness: "fresh" | "stale" | "check-failed" = "fresh";
        let currentCommit: string | undefined;
        let currentUpdatedAt: number | undefined;
        const bbParsedCache = parseBitbucketPRUrl(prUrl);
        if (bbParsedCache) {
          try {
            const livepr = await getPullRequest(bbParsedCache.repo, bbParsedCache.prId);
            currentCommit = (livepr as any)?.fromRef?.latestCommit || undefined;
            currentUpdatedAt = (livepr as any)?.updatedDate || undefined;
            const commitChanged = cached.sourceCommit && currentCommit && cached.sourceCommit !== currentCommit;
            const updatedAtChanged = cached.prUpdatedAt && currentUpdatedAt && cached.prUpdatedAt !== currentUpdatedAt;
            if (commitChanged || updatedAtChanged) {
              staleness = "stale";
              console.log(`[pr-review] Cache stale for ${prUrl}: commit ${cached.sourceCommit} → ${currentCommit}`);
            }
          } catch (err) {
            staleness = "check-failed";
            console.warn("[pr-review] Could not verify cache freshness, returning cached:", (err as Error).message);
          }
        }
        if (staleness !== "stale") {
          res.json({
            pr: cached.prMeta,
            reviewRunId: cached.reviewRunId,
            groomingContext: {
              usedSessionId: sessionId,
              specsSource: sessionId ? "session" : specs ? "request" : "none",
            },
            review: cached.review,
            cache: {
              hit: true,
              source: "full-review",
              cachedAt: cached.updatedAt,
              sourceCommit: cached.sourceCommit,
              stalenessCheck: staleness,
            },
          });
          return;
        }
        // Stale: fall through to fresh review
        console.log(`[pr-review] Running fresh review for ${prUrl} due to PR update`);
      }
    }

    if (forceRefreshRequested) {
      console.log("[pr-review] Force refresh requested - skipping any cached results");
    }

    const executed = await executeReview(req, {
      prUrl,
      specs,
      sessionId,
      outputMode,
      userId: req.user?.id,
    });

    if (executed.strictOutput) {
      res.json(executed.strictOutput);
      return;
    }

    // Persist full review output for cache fast-path on next non-forced request.
    if (executed.review) {
      try {
        const commitHash = String((executed.prMeta as any)?.sourceCommit || "") || undefined;
        const updatedAt = Number((executed.prMeta as any)?.updatedDate || 0) || undefined;
        setCachedReview(prUrl, executed.review, executed.prMeta, executed.reviewRunId, commitHash, updatedAt);
      } catch (cacheErr) {
        console.warn("[pr-review] Failed to cache review output:", cacheErr);
      }
    }

    res.json({
      pr: executed.prMeta,
      reviewRunId: executed.reviewRunId,
      groomingContext: {
        usedSessionId: executed.usedSessionId,
        specsSource: executed.specsSource,
      },
      review: executed.review,
    });
  } catch (err) {
    console.error("PR review error:", err);
    const message = err instanceof Error ? err.message : "Failed to review PR";
    res.status(500).json({ error: message });
  }
});

// Webhook-style ingestion endpoint for PR events.
router.post("/webhook", async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body || {};
    const actionRaw = String(body.action || body.eventAction || body.eventKey || "").toLowerCase();
    const action = actionRaw === "pr:from_ref_updated" ? "synchronize" : actionRaw;
    if (!["opened", "reopened", "synchronize", "updated", "pr:opened"].includes(action)) {
      res.json({ accepted: true, ignored: true, reason: `unsupported action: ${action || "unknown"}` });
      return;
    }

    const candidateUrl = String(
      body.prUrl ||
      body.pullRequest?.links?.self?.[0]?.href ||
      "",
    );

    if (!candidateUrl) {
      res.status(400).json({ error: "Webhook payload missing PR URL" });
      return;
    }

    const autoReviewEnabled = envFlagEnabled("PR_WEBHOOK_AUTO_REVIEW", false);
    const publishCommentsEnabled = envFlagEnabled("PR_REVIEW_PUBLISH_COMMENTS", false);

    if (!autoReviewEnabled) {
      res.json({
        accepted: true,
        action,
        autoReviewEnabled: false,
        normalizedRequest: {
          prUrl: candidateUrl,
          specs: typeof body.specs === "string" ? body.specs : undefined,
          outputMode: "strict-json",
        },
      });
      return;
    }

    const executed = await executeReview(req, {
      prUrl: candidateUrl,
      specs: typeof body.specs === "string" ? body.specs : undefined,
      outputMode: "strict-json",
      userId: req.user?.id,
    });

    const strictReview = executed.strictOutput || {
      summary: "Review completed.",
      risk: "medium" as const,
      issues: [],
    };

    const publishResult: {
      attempted: boolean;
      success: boolean;
      provider?: "bitbucket";
      error?: string;
    } = {
      attempted: false,
      success: false,
    };

    if (publishCommentsEnabled) {
      const commentBody = formatStrictReviewComment(strictReview);
      publishResult.attempted = true;
      publishResult.provider = "bitbucket";

      try {
        if (executed.provider === "bitbucket" && executed.bitbucket) {
          await postBitbucketPRComment(
            executed.bitbucket.repo,
            executed.bitbucket.prId,
            commentBody,
            executed.bitbucket.project,
          );
          publishResult.success = true;
        } else {
          publishResult.error = "Bitbucket publish target unavailable";
        }
      } catch (publishErr) {
        publishResult.error = publishErr instanceof Error ? publishErr.message : "Comment publish failed";
      }
    }

    res.json({
      accepted: true,
      action,
      autoReviewEnabled: true,
      review: strictReview,
      publish: publishResult,
    });
  } catch (err) {
    console.error("PR webhook error:", err);
    const message = err instanceof Error ? err.message : "Failed to process webhook";
    res.status(500).json({ error: message });
  }
});

router.get("/suppression-reasons", (_req: AuthRequest, res: Response) => {
  res.json({ reasonCodes: SUPPRESSION_REASON_CODES });
});

router.get("/suppressions/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug || "").trim();
    if (!repoSlug) {
      res.status(400).json({ error: "repoSlug is required" });
      return;
    }

    const includeInactive = String(req.query.includeInactive || "false").toLowerCase() === "true";
    const suppressions = listSuppressions(repoSlug, includeInactive);
    res.json({ repoSlug, includeInactive, count: suppressions.length, suppressions });
  } catch (err) {
    console.error("Suppression list error:", err);
    res.status(500).json({ error: "Failed to load suppressions" });
  }
});

router.post("/suppressions/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug || "").trim();
    if (!repoSlug) {
      res.status(400).json({ error: "repoSlug is required" });
      return;
    }

    const owner = String(req.body?.owner || req.user?.username || "unknown").trim();
    const reasonCode = String(req.body?.reasonCode || "").trim();
    const reasonDetail = req.body?.reasonDetail ? String(req.body.reasonDetail) : undefined;
    const expiresAt = req.body?.expiresAt ? String(req.body.expiresAt) : undefined;

    if (!reasonCode) {
      res.status(400).json({ error: "reasonCode is required" });
      return;
    }

    const fingerprint = req.body?.fingerprint
      ? String(req.body.fingerprint).trim()
      : req.body?.finding
        ? computeFindingFingerprint({
            file: String(req.body.finding.file || "unknown"),
            title: String(req.body.finding.title || "Finding"),
            category: String(req.body.finding.category || "general"),
            dimension: req.body.finding.dimension || "correctness",
            line: typeof req.body.finding.line === "number" ? req.body.finding.line : undefined,
          })
        : "";

    if (!fingerprint) {
      res.status(400).json({ error: "fingerprint or finding payload is required" });
      return;
    }

    const suppression = createSuppression({
      repoSlug,
      fingerprint,
      reasonCode: reasonCode as SuppressionReasonCode,
      reasonDetail,
      owner,
      actor: req.user?.username || "unknown",
      expiresAt,
    });

    res.status(201).json(suppression);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create suppression";
    res.status(400).json({ error: message });
  }
});

router.delete("/suppressions/:repoSlug/:id", (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid suppression id" });
      return;
    }

    const notes = req.body?.notes ? String(req.body.notes) : undefined;
    const expired = expireSuppression({
      id,
      actor: req.user?.username || "unknown",
      notes,
    });

    if (!expired) {
      res.status(404).json({ error: "Suppression not found or already inactive" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("Suppression expiry error:", err);
    res.status(500).json({ error: "Failed to expire suppression" });
  }
});

router.get("/bpe-patterns/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const patterns = getAllPatterns(repoSlug);
    const signalCount = getSignalCount(repoSlug);
    const lastRun = getLastBatchRun(repoSlug);
    const history = getBatchRunHistory(repoSlug, 10);

    res.json({ repoSlug, signalCount, lastRun, history, patterns });
  } catch (err) {
    console.error("BPE patterns list error:", err);
    res.status(500).json({ error: "Failed to load BPE patterns" });
  }
});

router.post("/bpe-patterns/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const { patternName, guidance, appliesTo, severitySignal } = req.body || {};
    if (!patternName || !guidance) {
      res.status(400).json({ error: "patternName and guidance are required" });
      return;
    }

    const created = addManualPattern(repoSlug, {
      patternName: String(patternName),
      guidance: String(guidance),
      appliesTo: Array.isArray(appliesTo) ? appliesTo.map(String) : [],
      severitySignal: String(severitySignal || "warning"),
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("BPE pattern create error:", err);
    res.status(500).json({ error: "Failed to create BPE pattern" });
  }
});

router.patch("/bpe-patterns/:repoSlug/:id", (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid pattern id" });
      return;
    }

    const updated = updatePattern(id, {
      patternName: req.body?.patternName,
      guidance: req.body?.guidance,
      appliesTo: Array.isArray(req.body?.appliesTo) ? req.body.appliesTo.map(String) : undefined,
      severitySignal: req.body?.severitySignal,
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
      confidence: typeof req.body?.confidence === "number" ? req.body.confidence : undefined,
    });

    if (!updated) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    console.error("BPE pattern update error:", err);
    res.status(500).json({ error: "Failed to update BPE pattern" });
  }
});

router.delete("/bpe-patterns/:repoSlug/:id", (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid pattern id" });
      return;
    }

    const deleted = deletePattern(id);
    if (!deleted) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error("BPE pattern delete error:", err);
    res.status(500).json({ error: "Failed to delete BPE pattern" });
  }
});

router.get("/bpe-batch/:repoSlug/status", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const signalCount = getSignalCount(repoSlug);
    const lastRun = getLastBatchRun(repoSlug);
    const history = getBatchRunHistory(repoSlug, 10);
    res.json({ repoSlug, signalCount, lastRun, history });
  } catch (err) {
    console.error("BPE batch status error:", err);
    res.status(500).json({ error: "Failed to load BPE batch status" });
  }
});

router.post("/bpe-batch/:repoSlug/trigger", (req: AuthRequest, res: Response) => {
  const repoSlug = String(req.params.repoSlug);
  res.json({ status: "accepted", repoSlug, message: "Batch run started" });

  runBatchForRepo(repoSlug).catch((err) => {
    console.error(`BPE manual batch trigger failed for ${repoSlug}:`, err);
  });
});

router.get("/bpe-author-insights/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug);
    const requestedAuthor = String(req.query.author || req.user?.username || "").trim();
    if (!requestedAuthor) {
      res.status(400).json({ error: "author is required" });
      return;
    }

    if (!canAccessAuthorInsights(requestedAuthor, req)) {
      res.status(403).json({
        error: "Author-level insights are private by default and visible only to the author or configured leads",
      });
      return;
    }

    const windowDays = Math.max(7, Number(req.query.windowDays || process.env.BPE_BATCH_WINDOW_DAYS || 90));
    const maxSignals = Math.max(20, Math.min(Number(req.query.maxSignals || 500), 1500));
    const minSamples = Math.max(1, Number(req.query.minSamples || process.env.BPE_AUTHOR_MIN_SAMPLES || 8));
    const halfLifeDays = Math.max(1, Number(req.query.halfLifeDays || process.env.BPE_AUTHOR_DECAY_HALF_LIFE_DAYS || 45));

    const signals = getCachedSignals(repoSlug, windowDays, maxSignals);
    const result = computeAuthorPatternInsights({
      repoSlug,
      author: requestedAuthor,
      allSignals: signals,
      minSampleThreshold: minSamples,
      halfLifeDays,
      maxInsights: 5,
    });

    res.json({
      ...result,
      controls: {
        minSamples,
        halfLifeDays,
        windowDays,
        baseline: "team-delta",
        languageMode: "guidance-not-judgment",
      },
    });
  } catch (err) {
    console.error("BPE author insights error:", err);
    res.status(500).json({ error: "Failed to load author insights" });
  }
});

router.post("/review-feedback/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug || "").trim();
    const reviewRunId = String(req.body?.reviewRunId || "").trim();
    const findingId = String(req.body?.findingId || "").trim();
    const outcome = String(req.body?.outcome || "").trim() as "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved";

    if (!repoSlug || !reviewRunId || !findingId || !outcome) {
      res.status(400).json({ error: "repoSlug, reviewRunId, findingId, and outcome are required" });
      return;
    }

    if (!["accepted", "rejected", "false_positive", "duplicate", "resolved"].includes(outcome)) {
      res.status(400).json({ error: "Invalid outcome" });
      return;
    }

    upsertFindingFeedback({
      repoSlug,
      reviewRunId,
      findingId,
      reviewer: req.user?.username || "unknown",
      outcome,
      subsystem: req.body?.subsystem ? String(req.body.subsystem) : undefined,
      severity: req.body?.severity ? String(req.body.severity) : undefined,
      incidentLinked: Boolean(req.body?.incidentLinked),
      revertLinked: Boolean(req.body?.revertLinked),
      notes: req.body?.notes ? String(req.body.notes) : undefined,
    });

    res.status(202).json({ status: "accepted", repoSlug, reviewRunId, findingId, outcome });
  } catch (err) {
    console.error("Review feedback error:", err);
    res.status(500).json({ error: "Failed to persist review feedback" });
  }
});

router.post("/review-email", async (req: AuthRequest, res: Response) => {
  try {
    const reviewRunId = String(req.body?.reviewRunId || "").trim();
    const recipients = Array.isArray(req.body?.recipients)
      ? req.body.recipients.map((x: unknown) => String(x || "").trim()).filter(Boolean)
      : [];

    if (!reviewRunId || recipients.length === 0) {
      res.status(400).json({ error: "reviewRunId and recipients[] are required" });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const email of recipients) {
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: `Invalid email: ${email}` });
        return;
      }
    }

    const run = db.prepare(`
      SELECT id, repo_slug, pr_url, pr_title, verdict, blockers, warnings, total_findings, risk_label, risk_score,
             summary_json, findings_json, created_by, completed_at
      FROM review_runs
      WHERE id = ?
      LIMIT 1
    `).get(reviewRunId) as {
      id: string;
      repo_slug: string;
      pr_url: string | null;
      pr_title: string;
      verdict: string;
      blockers: number;
      warnings: number;
      total_findings: number;
      risk_label: string;
      risk_score: number;
      summary_json: string;
      findings_json: string;
      created_by: string | null;
      completed_at: string;
    } | undefined;

    if (!run) {
      res.status(404).json({ error: "Review run not found" });
      return;
    }

    if (run.created_by && req.user?.id && run.created_by !== req.user.id) {
      res.status(403).json({ error: "You are not allowed to email this review run" });
      return;
    }

    const parsedSummary = (() => {
      try {
        return JSON.parse(run.summary_json || "{}");
      } catch {
        return {} as Record<string, unknown>;
      }
    })();
    const parsedFindings = (() => {
      try {
        const raw = JSON.parse(run.findings_json || "[]");
        return Array.isArray(raw) ? raw : [];
      } catch {
        return [] as Array<Record<string, unknown>>;
      }
    })();

    const html = formatPRReviewSummaryHTML({
      prTitle: run.pr_title,
      prUrl: run.pr_url || "#",
      verdict: String((parsedSummary as Record<string, unknown>).verdict || run.verdict || "unknown"),
      complianceScore: typeof (req.body?.complianceScore) === "number" ? Number(req.body.complianceScore) : undefined,
      totalFindings: Number((parsedSummary as Record<string, unknown>).totalFindings || run.total_findings || 0),
      blockers: Number((parsedSummary as Record<string, unknown>).blockers || run.blockers || 0),
      warnings: Number((parsedSummary as Record<string, unknown>).warnings || run.warnings || 0),
      riskLabel: run.risk_label || undefined,
      findings: parsedFindings.map((f) => ({
        title: String(f.title || ""),
        severity: String(f.severity || ""),
        action: String(f.action || ""),
        category: String(f.category || ""),
        dimension: String(f.dimension || ""),
        file: String(f.file || ""),
        line: typeof f.line === "number" ? f.line : undefined,
        message: String(f.message || ""),
        suggestedFix: String(f.suggestedFix || ""),
      })),
    });

    const sent = await sendEmail({
      to: recipients,
      subject: `[GroomPilot] Peer Review Summary: ${run.pr_title}`,
      html,
      text: `Peer review summary for ${run.pr_title}. Verdict: ${run.verdict}. Total findings: ${run.total_findings}. Blockers: ${run.blockers}.`,
    });

    res.json({
      sent,
      message: sent ? "Email sent" : "SMTP not configured - email not sent",
      reviewRunId,
      repoSlug: run.repo_slug,
      recipients,
      completedAt: run.completed_at,
    });
  } catch (err) {
    console.error("Review email error:", err);
    res.status(500).json({ error: "Failed to send review email" });
  }
});

router.get("/metrics/:repoSlug", (req: AuthRequest, res: Response) => {
  try {
    const repoSlug = String(req.params.repoSlug || "").trim();
    if (!repoSlug) {
      res.status(400).json({ error: "repoSlug is required" });
      return;
    }

    const windowDays = Math.max(7, Number(req.query.windowDays || 180));
    const summary = getReviewMetricsSummary(repoSlug, windowDays);
    res.json({ repoSlug, windowDays, summary });
  } catch (err) {
    console.error("Review metrics error:", err);
    res.status(500).json({ error: "Failed to load review metrics" });
  }
});

export default router;
