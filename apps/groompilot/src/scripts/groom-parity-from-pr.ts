#!/usr/bin/env tsx
/**
 * Groom parity harness: compare grooming generated from Jira-only context vs
 * grooming generated from Jira + historical PR backtracked context.
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/groom-parity-from-pr.ts replay-fixtures/groom-parity-sample.json
 *
 * Optional: set createJiraTicket=true in fixture to create a Jira follow-up issue.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { getIssueDetail, descriptionToString, commentBodyToString } from "../services/jira";
import { getPRActivities, getPRChanges } from "../services/bitbucket-server";
import { expandStory, type GroomingInput, type GroomingResult } from "../services/grooming";

type Fixture = {
  jiraKey: string;
  repoSlug: string;
  prUrl?: string;
  prNumber?: number;
  additionalContext?: string;
  baselineStructuredDoc?: string;
  prInputMatchThresholds?: {
    jiraCoverageMin?: number;
    historicalPrCoverageMin?: number;
  };
  createJiraTicket?: boolean;
  jiraTicket?: {
    projectKey?: string;
    issueType?: string;
    summaryPrefix?: string;
    labels?: string[];
  };
};

type ParityReport = {
  generatedAt: string;
  jiraKey: string;
  repoSlug: string;
  prNumber: number;
  comparison: {
    acceptanceCriteria: {
      jiraOnlyCount: number;
      backtrackedCount: number;
      overlapCount: number;
      overlapRatio: number;
      missingFromJiraOnly: string[];
      newInJiraOnly: string[];
    };
    scenarios: {
      jiraOnlyCount: number;
      backtrackedCount: number;
      overlapCount: number;
      overlapRatio: number;
      missingFromJiraOnly: string[];
      newInJiraOnly: string[];
    };
    subtasks: {
      jiraOnlyCount: number;
      backtrackedCount: number;
      overlapCount: number;
      overlapRatio: number;
      missingFromJiraOnly: string[];
      newInJiraOnly: string[];
    };
  };
  prInputValidation: {
    generatedTitle: string;
    generatedDescription: string;
    againstJiraStory: {
      tokenJaccard: number;
      referenceCoverage: number;
      candidateCoverage: number;
      missingReferenceKeywords: string[];
      pass: boolean;
      threshold: number;
    };
    againstHistoricalPrDescription: {
      tokenJaccard: number;
      referenceCoverage: number;
      candidateCoverage: number;
      missingReferenceKeywords: string[];
      pass: boolean;
      threshold: number;
    };
  };
  jiraTicketDraft: {
    projectKey: string;
    issueType: string;
    summary: string;
    description: string;
    labels: string[];
  };
  jiraTicketCreated?: {
    key: string;
    id: string;
    self: string;
  };
};

type BacktrackedContext = {
  context: string;
  prTitle: string;
  prDescription: string;
};

function loadFixture(filePath: string): Fixture {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Fixture not found: ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Fixture;
}

function parsePrNumber(prUrl?: string, prNumber?: number): number {
  if (typeof prNumber === "number" && Number.isFinite(prNumber) && prNumber > 0) {
    return prNumber;
  }
  if (!prUrl) throw new Error("Either prNumber or prUrl is required");
  const m = prUrl.match(/\/pull-requests\/(\d+)/i);
  if (!m) throw new Error(`Could not parse PR number from URL: ${prUrl}`);
  return Number(m[1]);
}

function normalizeItem(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardDelta(a: string[], b: string[]) {
  const aMap = new Map(a.map((item) => [normalizeItem(item), item]));
  const bMap = new Map(b.map((item) => [normalizeItem(item), item]));

  const aKeys = new Set(aMap.keys());
  const bKeys = new Set(bMap.keys());

  const overlap: string[] = [];
  const missingFromA: string[] = [];
  const newInA: string[] = [];

  for (const key of bKeys) {
    if (aKeys.has(key)) overlap.push(key);
    else missingFromA.push(bMap.get(key) || key);
  }
  for (const key of aKeys) {
    if (!bKeys.has(key)) newInA.push(aMap.get(key) || key);
  }

  const unionSize = new Set([...aKeys, ...bKeys]).size;
  const overlapRatio = unionSize === 0 ? 1 : Number((overlap.length / unionSize).toFixed(3));

  return {
    aCount: a.length,
    bCount: b.length,
    overlapCount: overlap.length,
    overlapRatio,
    missingFromA,
    newInA,
  };
}

function compactPatch(patch: string, maxLines = 30): string {
  const lines = String(patch || "")
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .slice(0, maxLines);
  return lines.join("\n");
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "then", "when", "given", "should", "must",
  "are", "was", "were", "has", "have", "had", "but", "not", "you", "your", "our", "their", "its", "via",
  "api", "service", "user", "users", "data", "request", "response", "story", "jira", "pr",
]);

function tokenize(text: string): Set<string> {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

function compareText(candidate: string, reference: string) {
  const c = tokenize(candidate);
  const r = tokenize(reference);

  const overlap: string[] = [];
  for (const token of r) {
    if (c.has(token)) overlap.push(token);
  }

  const union = new Set([...c, ...r]).size;
  const tokenJaccard = union === 0 ? 1 : Number((overlap.length / union).toFixed(3));
  const referenceCoverage = r.size === 0 ? 1 : Number((overlap.length / r.size).toFixed(3));
  const candidateCoverage = c.size === 0 ? 1 : Number((overlap.length / c.size).toFixed(3));
  const missingReferenceKeywords = Array.from(r).filter((t) => !c.has(t)).slice(0, 20);

  return {
    tokenJaccard,
    referenceCoverage,
    candidateCoverage,
    missingReferenceKeywords,
  };
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v || "")).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function extractConstraintSentences(text: string, maxItems = 8): string[] {
  const parts = String(text || "")
    .split(/[\n\.\!\?]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 25 && p.length <= 220);

  const priority = [
    "validate",
    "query",
    "odata",
    "filter",
    "sql injection",
    "xss",
    "null byte",
    "crlf",
    "error",
    "rollback",
    "idempotent",
    "audit",
    "mask",
    "pii",
    "log",
    "performance",
  ];

  const scored = parts
    .map((line) => {
      const lower = line.toLowerCase();
      const score = priority.reduce((acc, token) => acc + (lower.includes(token) ? 1 : 0), 0);
      return { line, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.line.length - b.line.length)
    .slice(0, maxItems)
    .map((x) => x.line);

  return scored;
}

function buildGeneratedPrInput(
  storyTitle: string,
  jiraKey: string,
  result: GroomingResult,
  historicalPrDescription: string,
) {
  const title = `feat: ${storyTitle} (${jiraKey})`;
  const ac = (result.acceptanceCriteria || []).slice(0, 8).map((x) => `- ${x}`);
  const scenarios = (result.scenarios || []).slice(0, 6).map((s) => `- ${s.name}: Given ${s.given}; When ${s.when}; Then ${s.then}`);
  const subtasks = (result.subtasks || []).slice(0, 8).map((s) => `- ${s.title}`);
  const expectedBehavior = toStringList((result as any).expectedBehavior).slice(0, 8).map((x) => `- ${x}`);
  const constraints = extractConstraintSentences(historicalPrDescription).map((x) => `- ${x}`);

  const description = [
    `Story: ${jiraKey}`,
    "",
    "Summary",
    String(result.understanding || "").trim(),
    "",
    "Acceptance Criteria",
    ...(ac.length ? ac : ["- (none)"]),
    "",
    "Scenarios",
    ...(scenarios.length ? scenarios : ["- (none)"]),
    "",
    "Expected Behavior",
    ...(expectedBehavior.length ? expectedBehavior : ["- (none)"]),
    "",
    "Historical PR Constraints",
    ...(constraints.length ? constraints : ["- (none captured from historical PR description)"]),
    "",
    "Implementation Plan",
    ...(subtasks.length ? subtasks : ["- (none)"]),
  ].join("\n");

  return { title, description };
}

async function buildBacktrackedContext(repoSlug: string, prNumber: number): Promise<BacktrackedContext> {
  const [{ pr, files }, activities] = await Promise.all([
    getPRChanges(repoSlug, prNumber),
    getPRActivities(repoSlug, prNumber),
  ]);

  const fileLines = files
    .slice(0, 12)
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");

  const snippets = files
    .slice(0, 6)
    .map((f) => {
      const sample = compactPatch(f.patch, 18);
      if (!sample) return "";
      return `\n## ${f.filename}\n\n\`\`\`diff\n${sample}\n\`\`\``;
    })
    .filter(Boolean)
    .join("\n");

  const commentLines = activities
    .slice(0, 15)
    .map((c) => `- [${c.author}] ${c.text}`)
    .join("\n");

  const context = [
    "Historical PR Backtracked Context",
    `PR #${pr.id}: ${pr.title}`,
    pr.description ? `Description: ${pr.description}` : "Description: (none)",
    `Source Branch: ${pr.fromRef.displayId}`,
    `Target Branch: ${pr.toRef.displayId}`,
    "",
    "Changed Files:",
    fileLines || "- (none)",
    "",
    "Existing Reviewer Comments:",
    commentLines || "- (none)",
    "",
    "Patch Snippets:",
    snippets || "(no patch snippets)",
  ].join("\n");

  return {
    context,
    prTitle: String(pr.title || ""),
    prDescription: String(pr.description || ""),
  };
}

function buildComparisonReport(
  fixture: Fixture,
  storyTitle: string,
  storyBody: string,
  prNumber: number,
  historicalPrDescription: string,
  jiraOnly: GroomingResult,
  backtracked: GroomingResult,
): ParityReport {
  const ac = jaccardDelta(
    jiraOnly.acceptanceCriteria || [],
    backtracked.acceptanceCriteria || [],
  );
  const scenarios = jaccardDelta(
    (jiraOnly.scenarios || []).map((s) => `${s.name} | ${s.given} | ${s.when} | ${s.then}`),
    (backtracked.scenarios || []).map((s) => `${s.name} | ${s.given} | ${s.when} | ${s.then}`),
  );
  const subtasks = jaccardDelta(
    (jiraOnly.subtasks || []).map((s) => `${s.title} | ${s.description}`),
    (backtracked.subtasks || []).map((s) => `${s.title} | ${s.description}`),
  );

  const projectKey = fixture.jiraTicket?.projectKey || process.env.JIRA_PROJECT || "EPP";
  const issueType = fixture.jiraTicket?.issueType || "Task";
  const summaryPrefix = fixture.jiraTicket?.summaryPrefix || "Grooming Parity";
  const summary = `${summaryPrefix}: ${fixture.jiraKey} vs historical PR #${prNumber}`;

  const generatedPrInput = buildGeneratedPrInput(
    storyTitle,
    fixture.jiraKey,
    backtracked,
    historicalPrDescription,
  );
  const jiraMatchRaw = compareText(generatedPrInput.description, `${storyTitle}\n${storyBody}`);
  const historicalMatchRaw = compareText(generatedPrInput.description, historicalPrDescription);

  const jiraThreshold = Number(fixture.prInputMatchThresholds?.jiraCoverageMin ?? 0.35);
  const historicalThreshold = Number(fixture.prInputMatchThresholds?.historicalPrCoverageMin ?? 0.25);

  const description = [
    `Generated by GroomPilot parity harness on ${new Date().toISOString()}.`,
    `Source story: ${fixture.jiraKey}`,
    `Compared against historical PR: #${prNumber} (${fixture.repoSlug})`,
    "",
    "Acceptance Criteria Parity",
    `- overlap ratio: ${ac.overlapRatio}`,
    `- in backtracked but missing from Jira-only: ${ac.missingFromA.length}`,
    ...ac.missingFromA.slice(0, 10).map((x) => `  - ${x}`),
    "",
    "Scenario Parity",
    `- overlap ratio: ${scenarios.overlapRatio}`,
    `- in backtracked but missing from Jira-only: ${scenarios.missingFromA.length}`,
    ...scenarios.missingFromA.slice(0, 10).map((x) => `  - ${x}`),
    "",
    "Subtask Parity",
    `- overlap ratio: ${subtasks.overlapRatio}`,
    `- in backtracked but missing from Jira-only: ${subtasks.missingFromA.length}`,
    ...subtasks.missingFromA.slice(0, 10).map((x) => `  - ${x}`),
    "",
    "Recommended actions:",
    "- Update Jira acceptance criteria to include missing implementation details from historical code and review comments.",
    "- Re-run GroomPilot and verify parity ratios improve.",
  ].join("\n");

  return {
    generatedAt: new Date().toISOString(),
    jiraKey: fixture.jiraKey,
    repoSlug: fixture.repoSlug,
    prNumber,
    comparison: {
      acceptanceCriteria: {
        jiraOnlyCount: ac.aCount,
        backtrackedCount: ac.bCount,
        overlapCount: ac.overlapCount,
        overlapRatio: ac.overlapRatio,
        missingFromJiraOnly: ac.missingFromA,
        newInJiraOnly: ac.newInA,
      },
      scenarios: {
        jiraOnlyCount: scenarios.aCount,
        backtrackedCount: scenarios.bCount,
        overlapCount: scenarios.overlapCount,
        overlapRatio: scenarios.overlapRatio,
        missingFromJiraOnly: scenarios.missingFromA,
        newInJiraOnly: scenarios.newInA,
      },
      subtasks: {
        jiraOnlyCount: subtasks.aCount,
        backtrackedCount: subtasks.bCount,
        overlapCount: subtasks.overlapCount,
        overlapRatio: subtasks.overlapRatio,
        missingFromJiraOnly: subtasks.missingFromA,
        newInJiraOnly: subtasks.newInA,
      },
    },
    prInputValidation: {
      generatedTitle: generatedPrInput.title,
      generatedDescription: generatedPrInput.description,
      againstJiraStory: {
        ...jiraMatchRaw,
        pass: jiraMatchRaw.referenceCoverage >= jiraThreshold,
        threshold: jiraThreshold,
      },
      againstHistoricalPrDescription: {
        ...historicalMatchRaw,
        pass: historicalMatchRaw.referenceCoverage >= historicalThreshold,
        threshold: historicalThreshold,
      },
    },
    jiraTicketDraft: {
      projectKey,
      issueType,
      summary,
      description,
      labels: fixture.jiraTicket?.labels || ["grooming-parity", "quality-gate"],
    },
  };
}

async function createJiraTicket(draft: ParityReport["jiraTicketDraft"]) {
  const jiraUrl = process.env.JIRA_URL || "";
  const jiraToken = process.env.JIRA_TOKEN || "";
  if (!jiraUrl || !jiraToken) {
    throw new Error("JIRA_URL and JIRA_TOKEN are required to create a Jira ticket");
  }

  const res = await fetch(`${jiraUrl}/rest/api/2/issue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jiraToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: draft.projectKey },
        issuetype: { name: draft.issueType },
        summary: draft.summary,
        description: draft.description,
        labels: draft.labels,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to create Jira ticket: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ key: string; id: string; self: string }>;
}

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error("Usage: tsx src/scripts/groom-parity-from-pr.ts <fixture.json>");
    process.exit(1);
  }

  const fixture = loadFixture(fixturePath);
  if (!fixture.jiraKey || !fixture.repoSlug) {
    throw new Error("Fixture must include jiraKey and repoSlug");
  }

  const prNumber = parsePrNumber(fixture.prUrl, fixture.prNumber);

  console.log("═".repeat(80));
  console.log(`  GROOM PARITY HARNESS: ${fixture.jiraKey} vs PR #${prNumber}`);
  console.log("═".repeat(80));

  const issue = await getIssueDetail(fixture.jiraKey);
  const comments = issue.fields.comment?.comments?.map((c) => commentBodyToString(c.body)) || [];

  const baseInput: GroomingInput = {
    storyTitle: issue.fields.summary || fixture.jiraKey,
    storyBody: descriptionToString(issue.fields.description),
    storyLabels: issue.fields.labels || [],
    comments,
    jiraKey: fixture.jiraKey,
    repoSlug: fixture.repoSlug,
  };
  const storyTitle = issue.fields.summary || fixture.jiraKey;
  const storyBody = descriptionToString(issue.fields.description);

  console.log("\n1) Generating Jira-only grooming...");
  const jiraOnly = await expandStory({
    ...baseInput,
    repoContext: fixture.additionalContext || "",
  });

  console.log("2) Backtracking historical PR context...");
  const backtrackedContext = await buildBacktrackedContext(fixture.repoSlug, prNumber);
  const mergedContext = [
    fixture.additionalContext || "",
    fixture.baselineStructuredDoc || "",
    backtrackedContext.context,
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log("3) Generating Jira + PR-backtracked grooming...");
  const backtracked = await expandStory({
    ...baseInput,
    repoContext: mergedContext,
  });

  const report = buildComparisonReport(
    fixture,
    storyTitle,
    storyBody,
    prNumber,
    backtrackedContext.prDescription,
    jiraOnly,
    backtracked,
  );

  if (fixture.createJiraTicket) {
    console.log("4) Creating Jira ticket from parity draft...");
    report.jiraTicketCreated = await createJiraTicket(report.jiraTicketDraft);
  }

  const outDir = path.resolve(__dirname, "../../batch-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `groom-parity_${fixture.jiraKey}_${prNumber}_${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log("\nSummary");
  console.log(`- AC overlap: ${report.comparison.acceptanceCriteria.overlapRatio}`);
  console.log(`- Scenario overlap: ${report.comparison.scenarios.overlapRatio}`);
  console.log(`- Subtask overlap: ${report.comparison.subtasks.overlapRatio}`);
  console.log(`- PR input vs Jira coverage: ${report.prInputValidation.againstJiraStory.referenceCoverage} (pass=${report.prInputValidation.againstJiraStory.pass})`);
  console.log(`- PR input vs historical PR coverage: ${report.prInputValidation.againstHistoricalPrDescription.referenceCoverage} (pass=${report.prInputValidation.againstHistoricalPrDescription.pass})`);
  console.log(`- Report: ${outFile}`);
  if (report.jiraTicketCreated) {
    console.log(`- Jira ticket created: ${report.jiraTicketCreated.key}`);
  } else {
    console.log("- Jira ticket not created (draft is in report)");
  }
}

main().catch((err) => {
  console.error("Harness failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
