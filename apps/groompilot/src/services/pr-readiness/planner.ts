/**
 * Readiness Planner — Deterministic readiness snapshot builder.
 *
 * Orchestrates: PR diff fetch → triage → review plan → policy scan →
 * tree-sitter → RCIE delta → behavioral signals → Jira enrichment →
 * produce PRReadinessSnapshot.
 *
 * LLM is NOT involved here — that happens in llm-refinement.ts.
 */

import crypto from "node:crypto";
import {
  getPRChanges,
  getPullRequest,
  type BBPullRequest,
} from "../bitbucket-server";
import { classifyChangedFiles } from "../pr-review";
import type { PRFile } from "../pr-review";
import { buildReviewPlan } from "../review-planner";
import {
  selectPolicyPacks,
  derivePolicyFindingsFromDiff,
  type PolicyFinding,
} from "../review-policy-packs";
import { buildTreeSitterContextSubgraph } from "../tree-sitter-context";
import { resolveDelta } from "../repo-code-delta-resolver";
import {
  buildBehavioralPatternContext,
  rankHistoricalPrecedents,
} from "../behavioral-pattern-engine";
import { getIssueDetail, descriptionToString } from "../jira";
import { getMergedPRReviewSignals } from "../bitbucket-server";

import type {
  PRReadinessRequest,
  PRReadinessSnapshot,
  DeterministicFinding,
  LinkedJiraSummary,
  ReadinessState,
  OverallRisk,
  ContextMode,
} from "./types";

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function buildReadinessSnapshot(
  req: PRReadinessRequest,
): Promise<PRReadinessSnapshot> {
  const snapshotId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Step 1: Fetch PR and diff from Bitbucket
  const { pr, files } = await fetchPRData(req);

  // Step 2: Classify changes → triage
  const triage = classifyChangedFiles(files);

  // Step 3: Tree-sitter AST context (conditional)
  const astResult = await buildTreeSitterContextSubgraph(files);
  const contextMode: ContextMode = astResult.enabled
    ? astResult.failures.length > 0 ? "mixed" : "ast"
    : "fallback";

  // Step 4: Select policy packs
  const packs = selectPolicyPacks(triage, astResult.fileContexts);

  // Step 5: RCIE delta resolution (conditional on indexing)
  const delta = resolveDelta(req.repoSlug, files.map((f) => ({
    filename: f.filename,
    patch: f.patch,
    additions: f.additions,
    deletions: f.deletions,
  })));

  // Step 6: Build review plan
  const plan = buildReviewPlan({
    files,
    triage,
    initialPolicyFindings: [], // populated next
    deltaResolution: delta,
    treeSitterAvailable: astResult.enabled,
  });

  // Step 7: Derive policy findings deterministically
  const policyFindings = derivePolicyFindingsFromDiff(files, triage, packs);

  // Step 8: Behavioral signals (sync)
  const behavioralFiles = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));

  const behavioralCtx = buildBehavioralPatternContext({
    prTitle: req.title,
    prBody: req.description,
    files: behavioralFiles,
  });

  const precedents = rankHistoricalPrecedents({
    prTitle: req.title,
    prBody: req.description,
    files: behavioralFiles,
  });

  // Step 9: Historical reviewer signals from Bitbucket
  let historicalReviewerSignals = 0;
  try {
    const signals = await getMergedPRReviewSignals(req.repoSlug);
    historicalReviewerSignals = Array.isArray(signals) ? signals.length : 0;
  } catch {
    // Non-critical, continue
  }

  // Step 10: Jira enrichment
  const linkedJiraSummary = await enrichJiraKeys(req.linkedJiraKeys);

  // Step 11: Build deterministic findings
  const deterministicFindings = mapPolicyFindings(policyFindings);

  // Step 12: Compute readiness metrics
  const blockerCount = deterministicFindings.filter(
    (f) => f.classification === "blocker",
  ).length;
  const importantCount = deterministicFindings.filter(
    (f) => f.classification === "important",
  ).length;
  const followUpCount = deterministicFindings.filter(
    (f) => f.classification === "follow-up",
  ).length;

  const overallRisk = computeOverallRisk(deterministicFindings, triage, plan);
  const readinessState = computeReadinessState(
    blockerCount,
    importantCount,
    overallRisk,
  );

  // Compute diff fingerprint for staleness detection
  const diffFingerprint = crypto
    .createHash("sha256")
    .update(files.map((f) => `${f.filename}:${f.additions}:${f.deletions}`).join("|"))
    .digest("hex")
    .slice(0, 16);

  const jiraFingerprint = req.linkedJiraKeys.slice().sort().join(",");

  // Build acceptance criteria summary
  const acceptanceCriteriaSummary = buildAcceptanceCriteriaSummary(
    linkedJiraSummary,
  );

  return {
    id: snapshotId,
    provider: "bitbucket",
    projectKey: req.projectKey,
    repoSlug: req.repoSlug,
    prId: req.prId,
    prTitle: req.title,
    prAuthor: req.author,
    latestCommitSha: req.latestCommitSha,
    diffFingerprint,
    jiraFingerprint,
    readinessState,
    overallRisk,
    deterministicFindings,
    llmFindings: [],
    finalMergedFindings: deterministicFindings, // LLM will merge later
    appliedPolicyPacks: packs,
    appliedGovernanceProfile: "default",
    linkedJiraSummary,
    acceptanceCriteriaSummary,
    historicalReviewerSignals,
    contextMode,
    parserLanguagesAvailable: astResult.parserLanguagesAvailable,
    modelUsed: "",
    llmStatus: "not_requested",
    blockerCount,
    importantCount,
    followUpCount,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchPRData(
  req: PRReadinessRequest,
): Promise<{ pr: BBPullRequest; files: PRFile[] }> {
  const { pr, files: bbFiles } = await getPRChanges(
    req.repoSlug,
    req.prId,
  );

  const files: PRFile[] = (bbFiles || []).map((f: any) => ({
    filename: f.path?.toString || f.path || f.filename || "",
    status: mapChangeType(f.type),
    additions: f.linesAdded || f.additions || 0,
    deletions: f.linesRemoved || f.deletions || 0,
    patch: f.patch || f.diff || undefined,
    fullContent: undefined,
  }));

  return { pr, files };
}

function mapChangeType(bbType: string): string {
  switch ((bbType || "").toUpperCase()) {
    case "ADD": return "added";
    case "MODIFY": return "modified";
    case "DELETE": return "removed";
    case "MOVE": return "renamed";
    case "COPY": return "added";
    default: return "modified";
  }
}

function mapPolicyFindings(
  policyFindings: PolicyFinding[],
): DeterministicFinding[] {
  return policyFindings.map((pf) => ({
    id: pf.id,
    file: pf.file,
    line: pf.line,
    endLine: pf.endLine,
    type: pf.type,
    severity: pf.severity,
    confidence: pf.confidence,
    title: pf.title,
    description: pf.description,
    whyItMatters: pf.whyItMatters,
    fix: pf.fix,
    ruleRefs: pf.ruleRefs,
    source: "policy-pack" as const,
    needsHumanReview: pf.needsHumanReview,
    classification: severityToClassification(pf.severity, pf.needsHumanReview),
  }));
}

function severityToClassification(
  severity: string,
  needsHumanReview: boolean,
): "blocker" | "important" | "follow-up" | "informational" {
  if (needsHumanReview || severity === "critical") return "blocker";
  if (severity === "high") return "important";
  if (severity === "medium") return "follow-up";
  return "informational";
}

function computeOverallRisk(
  findings: DeterministicFinding[],
  triage: ReturnType<typeof classifyChangedFiles>,
  plan: ReturnType<typeof buildReviewPlan>,
): OverallRisk {
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasHighSeverity = findings.some((f) => f.severity === "high");
  const blockerCount = findings.filter(
    (f) => f.classification === "blocker",
  ).length;
  const hasHumanEscalation = plan.humanEscalation.length > 0;

  if (hasCritical || blockerCount >= 3 || hasHumanEscalation) return "critical";
  if (hasHighSeverity || blockerCount >= 1) return "high";
  if (triage.blastRadius === "high" || findings.length > 10) return "medium";
  return "low";
}

function computeReadinessState(
  blockerCount: number,
  importantCount: number,
  overallRisk: OverallRisk,
): ReadinessState {
  if (blockerCount > 0 || overallRisk === "critical") return "blocked";
  if (importantCount > 0 || overallRisk === "high") return "ready_with_warnings";
  return "ready";
}

async function enrichJiraKeys(
  jiraKeys: string[],
): Promise<LinkedJiraSummary[]> {
  const results: LinkedJiraSummary[] = [];
  for (const key of jiraKeys) {
    try {
      const issue = await getIssueDetail(key);
      const desc = descriptionToString(issue.fields?.description);
      // Extract acceptance criteria from description (common patterns)
      const acMatch = desc.match(
        /(?:acceptance\s*criteria|AC)[\s:]*\n?([\s\S]*?)(?=\n(?:##|\*\*|$))/i,
      );
      results.push({
        key: issue.key,
        summary: issue.fields?.summary || "",
        status: issue.fields?.status?.name,
        acceptanceCriteria: acMatch?.[1]?.trim() || undefined,
        businessRules: undefined,
        available: true,
      });
    } catch {
      results.push({
        key,
        summary: "",
        available: false,
      });
    }
  }
  return results;
}

function buildAcceptanceCriteriaSummary(
  jiraSummaries: LinkedJiraSummary[],
): string {
  const withAC = jiraSummaries.filter((j) => j.acceptanceCriteria);
  if (withAC.length === 0) return "";
  return withAC
    .map((j) => `[${j.key}] ${j.acceptanceCriteria}`)
    .join("\n\n");
}
