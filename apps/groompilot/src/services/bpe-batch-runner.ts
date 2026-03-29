import { complete, isAIEnabled } from "./ai-provider";
import { getMergedPRReviewSignals } from "./bitbucket-server";
import {
  completeBatchRun,
  failBatchRun,
  getCachedSignals,
  getLatestKnownPrId,
  isBatchRunning,
  startBatchRun,
  upsertDerivedPatterns,
  upsertSignals,
} from "./behavioral-pattern-store";

const VALID_DIMENSIONS = [
  "correctness",
  "security",
  "reliability",
  "performance",
  "maintainability",
  "test-quality",
  "api-contract",
  "observability",
  "compliance",
  "business-domain",
] as const;

const VALID_SEVERITIES = ["critical", "error", "warning", "info"] as const;

interface BatchPattern {
  patternName: string;
  guidance: string;
  appliesTo: string[];
  severitySignal: string;
  confidence: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const codeBlock = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {
      // continue
    }
  }

  const start = trimmed.search(/[[\{]/);
  if (start >= 0) {
    const bracket = trimmed[start];
    const end = bracket === "[" ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");
    if (end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // continue
      }
    }
  }

  return fallback;
}

function normalizePattern(raw: any): BatchPattern | null {
  if (!raw || typeof raw !== "object") return null;

  const patternName = String(raw.patternName || "").trim().slice(0, 120);
  const guidance = String(raw.guidance || "").trim().slice(0, 700);
  if (!patternName || !guidance) return null;

  const appliesTo = Array.isArray(raw.appliesTo)
    ? raw.appliesTo.map(String).filter((d: string) => VALID_DIMENSIONS.includes(d as any)).slice(0, 5)
    : [];

  const severitySignal = VALID_SEVERITIES.includes(raw.severitySignal)
    ? raw.severitySignal
    : "warning";

  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.7;

  return {
    patternName,
    guidance,
    appliesTo: appliesTo.length > 0 ? appliesTo : ["correctness"],
    severitySignal,
    confidence,
  };
}

async function aiExtractPatterns(repoSlug: string): Promise<BatchPattern[]> {
  const signalWindowDays = Math.max(1, Number(process.env.BPE_BATCH_WINDOW_DAYS || 90));
  const signals = getCachedSignals(repoSlug, signalWindowDays, 500);
  if (signals.length === 0 || !isAIEnabled()) return [];

  const samples = signals
    .flatMap((s) => s.commentSamples || [])
    .filter(Boolean)
    .slice(0, 500)
    .map((text, idx) => `${idx + 1}. ${text}`)
    .join("\n");

  const hotspotCounts = new Map<string, number>();
  for (const signal of signals) {
    for (const path of signal.topPaths || []) {
      hotspotCounts.set(path, (hotspotCounts.get(path) || 0) + 1);
    }
  }

  const hotspots = Array.from(hotspotCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([path, count]) => `${path} (${count})`)
    .join(", ");

  const avgBlockers = signals.reduce((sum, s) => sum + s.blockerCount, 0) / signals.length;
  const avgNeedsWork = signals.reduce((sum, s) => sum + s.needsWorkCount, 0) / signals.length;

  const prompt = `You are deriving reviewer behavior patterns for repository "${repoSlug}".

Recent merged PR signal summary:
- Signals analyzed: ${signals.length}
- Avg blockers per PR: ${avgBlockers.toFixed(2)}
- Avg needs-work per PR: ${avgNeedsWork.toFixed(2)}
- Frequent path hotspots: ${hotspots || "none"}

Reviewer comment samples:
${samples || "none"}

Task:
Identify 5-8 recurring reviewer concern patterns that appear repeatedly.
Each pattern must provide concrete guidance for future PR reviews.
Avoid one-off observations.

Return JSON array only:
[
  {
    "patternName": "short title",
    "guidance": "specific review rule based on repeated behavior",
    "appliesTo": ["one or more of: ${VALID_DIMENSIONS.join(", ")}"],
    "severitySignal": "one of: ${VALID_SEVERITIES.join(", ")}",
    "confidence": 0.0
  }
]
`;

  const resp = await complete({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.25,
    maxTokens: 2200,
  });

  const parsed = parseJson<any[]>(resp.content, []);
  if (!Array.isArray(parsed)) return [];

  const normalized = parsed
    .map((p) => normalizePattern(p))
    .filter((p): p is BatchPattern => !!p)
    .slice(0, 12);

  return normalized;
}

function toIsoFromSignal(mergedAt: string | undefined): string {
  if (!mergedAt) return new Date().toISOString();
  const parsed = new Date(mergedAt);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export async function runBatchForRepo(repoSlug: string): Promise<{
  status: "completed" | "failed" | "skipped";
  signalsFetched: number;
  patternsDerived: number;
  error?: string;
}> {
  if (!repoSlug) {
    return { status: "failed", signalsFetched: 0, patternsDerived: 0, error: "repoSlug is required" };
  }

  if (isBatchRunning(repoSlug)) {
    return { status: "skipped", signalsFetched: 0, patternsDerived: 0 };
  }

  const runId = startBatchRun(repoSlug);

  try {
    const lastKnownPrId = getLatestKnownPrId(repoSlug);
    const fetchLimit = Math.max(1, Math.min(Number(process.env.BPE_BATCH_FETCH_LIMIT || 120), 500));
    const mergedSignals = await getMergedPRReviewSignals(repoSlug, fetchLimit);

    const incrementalSignals =
      lastKnownPrId === null
        ? mergedSignals
        : mergedSignals.filter((s) => s.prId > lastKnownPrId);

    upsertSignals(
      repoSlug,
      incrementalSignals.map((s) => ({
        prId: s.prId,
        prTitle: s.title,
        author: s.author,
        mergedAt: toIsoFromSignal(s.mergedAt),
        approvalCount: s.approvalCount,
        needsWorkCount: s.needsWorkCount,
        commentCount: s.commentCount,
        blockerCount: s.blockerCount,
        additions: s.additions,
        deletions: s.deletions,
        changedFiles: s.changedFiles,
        topPaths: s.topPaths,
        commentSamples: s.commentSamples,
      })),
    );

    const minSignals = Math.max(3, Number(process.env.BPE_MIN_SIGNALS || 8));
    const cachedForAnalysis = getCachedSignals(repoSlug, Number(process.env.BPE_BATCH_WINDOW_DAYS || 90), 500);

    let patterns: BatchPattern[] = [];
    if (cachedForAnalysis.length >= minSignals) {
      patterns = await aiExtractPatterns(repoSlug);
      upsertDerivedPatterns(repoSlug, patterns, runId);
    }

    completeBatchRun(runId, incrementalSignals.length, patterns.length);
    return {
      status: "completed",
      signalsFetched: incrementalSignals.length,
      patternsDerived: patterns.length,
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    failBatchRun(runId, message);
    return { status: "failed", signalsFetched: 0, patternsDerived: 0, error: message };
  }
}

export function scheduleBatchRunner(): void {
  const enabled = (process.env.BPE_BATCH_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const repos = (process.env.BPE_BATCH_REPOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (repos.length === 0) return;

  const intervalHours = Math.max(1, Number(process.env.BPE_BATCH_INTERVAL_HOURS || 24));
  const intervalMs = intervalHours * 60 * 60 * 1000;

  const runAll = async () => {
    for (const repo of repos) {
      try {
        const result = await runBatchForRepo(repo);
        console.log(
          `[BPE batch] repo=${repo} status=${result.status} signals=${result.signalsFetched} patterns=${result.patternsDerived}`,
        );
      } catch (err) {
        console.error(`[BPE batch] scheduler error repo=${repo}`, err);
      }
    }
  };

  setTimeout(runAll, 2 * 60 * 1000);
  setInterval(runAll, intervalMs);
}
