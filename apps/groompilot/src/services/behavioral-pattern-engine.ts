import { createHash } from "crypto";
import type { ReviewFeedbackSignals } from "./review-governance-store";

export interface BehavioralPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface HistoricalReviewSignal {
  prId: number;
  title: string;
  author: string;
  state: string;
  approvalCount: number;
  needsWorkCount: number;
  commentCount: number;
  blockerCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  topPaths: string[];
  commentSamples: string[];
}

export interface BehavioralKnowledgeReference {
  source: string;
  title: string;
  guidance: string;
  appliesTo: string[];
}

export interface BehavioralPatternContext {
  enabled: boolean;
  knowledgeReferences: BehavioralKnowledgeReference[];
  highlights: string[];
  contextHash: string;
  historySignalsUsed: number;
}

export interface BehavioralEngineInput {
  prTitle: string;
  prBody: string;
  files: BehavioralPRFile[];
  historicalSignals?: HistoricalReviewSignal[];
  feedbackSignals?: ReviewFeedbackSignals;
}

export interface RankedHistoricalPrecedent {
  precedentId: string;
  prId: number;
  title: string;
  score: number;
  rationale: string[];
  topPaths: string[];
  outcome: "accepted" | "mixed" | "needs-attention";
  reviewerWeight: number;
  incidentLinked: boolean;
  revertLinked: boolean;
}

function toPathBucket(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function topBuckets(files: BehavioralPRFile[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const bucket = toPathBucket(file.filename.toLowerCase());
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([bucket, count]) => `${bucket} (${count})`);
}

function aggregateHistoricalHotspots(signals: HistoricalReviewSignal[], n = 6): string[] {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    for (const p of signal.topPaths || []) {
      counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([path, count]) => `${path} (${count})`);
}

function aggregateKeywordPatterns(signals: HistoricalReviewSignal[]): string[] {
  const buckets: Array<{ label: string; score: number }> = [
    { label: "tests-and-coverage", score: 0 },
    { label: "null-safety-and-validation", score: 0 },
    { label: "api-contract-and-backward-compatibility", score: 0 },
    { label: "security-and-secrets-handling", score: 0 },
    { label: "logging-metrics-observability", score: 0 },
  ];

  for (const signal of signals) {
    const blob = (signal.commentSamples || []).join(" ").toLowerCase();
    if (!blob) continue;

    if (blob.includes("test") || blob.includes("coverage") || blob.includes("unit")) buckets[0].score += 1;
    if (blob.includes("null") || blob.includes("npe") || blob.includes("valid") || blob.includes("@notnull")) buckets[1].score += 1;
    if (blob.includes("contract") || blob.includes("breaking") || blob.includes("backward") || blob.includes("schema")) buckets[2].score += 1;
    if (blob.includes("secret") || blob.includes("token") || blob.includes("auth") || blob.includes("injection")) buckets[3].score += 1;
    if (blob.includes("log") || blob.includes("metric") || blob.includes("trace") || blob.includes("telemetry")) buckets[4].score += 1;
  }

  return buckets
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((b) => `${b.label} (${b.score})`)
    .slice(0, 4);
}

function buildContextHash(input: BehavioralEngineInput, hotspots: string[], patterns: string[]): string {
  const payload = JSON.stringify({
    title: input.prTitle,
    files: input.files.map((f) => [f.filename, f.status, f.additions, f.deletions]),
    hotspots,
    patterns,
    historyCount: input.historicalSignals?.length || 0,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  );
}

function computeRecencyWeight(mergedAt: string, halfLifeDays = 90): number {
  const mergedTs = new Date(mergedAt).getTime();
  if (!Number.isFinite(mergedTs)) return 0.75;
  const ageDays = Math.max(0, (Date.now() - mergedTs) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
}

function overlapRatio<T>(left: Set<T>, right: Set<T>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let matches = 0;
  for (const item of left) {
    if (right.has(item)) matches += 1;
  }
  return matches / Math.max(left.size, right.size);
}

export function rankHistoricalPrecedents(input: BehavioralEngineInput, limit = 5): RankedHistoricalPrecedent[] {
  const signals = input.historicalSignals || [];
  const feedback = input.feedbackSignals;
  const currentBuckets = new Set(input.files.map((file) => toPathBucket(file.filename.toLowerCase())));
  const currentLexical = tokenize(`${input.prTitle} ${input.prBody}`);
  const reviewerWeights = Object.values(feedback?.reviewerWeights || {});
  const baselineReviewerWeight = reviewerWeights.length > 0
    ? reviewerWeights.reduce((sum, weight) => sum + weight, 0) / reviewerWeights.length
    : 1;
  const falsePositivePenalty = feedback ? Math.min(0.25, feedback.falsePositiveCount / Math.max(10, feedback.acceptedCount + feedback.rejectedCount + feedback.falsePositiveCount)) : 0;

  return signals
    .map((signal) => {
      const precedentBuckets = new Set((signal.topPaths || []).map((path) => path.toLowerCase()));
      const lexical = tokenize(`${signal.title} ${(signal.commentSamples || []).join(" ")}`);
      const pathScore = overlapRatio(currentBuckets, precedentBuckets);
      const lexicalScore = overlapRatio(currentLexical, lexical);
      const recencyWeight = computeRecencyWeight((signal as unknown as { mergedAt?: string }).mergedAt || "1970-01-01T00:00:00Z");
      const outcomeDelta = signal.approvalCount - signal.needsWorkCount - (signal.blockerCount * 0.5);
      const outcomeScore = signal.approvalCount + signal.needsWorkCount + signal.blockerCount === 0
        ? 0.5
        : Math.max(0.1, Math.min(1.3, 0.7 + (outcomeDelta / Math.max(1, signal.approvalCount + signal.needsWorkCount + signal.blockerCount))));
      const incidentLinked = (signal.commentSamples || []).some((sample) => /incident|sev\d|outage|production issue/i.test(sample));
      const revertLinked = (signal.commentSamples || []).some((sample) => /revert|rollback|rolled back/i.test(sample));
      const riskBoost = incidentLinked ? 0.12 : 0;
      const revertBoost = revertLinked ? 0.08 : 0;
      const reviewerWeight = baselineReviewerWeight;
      const score = Math.max(0, Math.min(1.75,
        (pathScore * 0.34) +
        (lexicalScore * 0.22) +
        (recencyWeight * 0.16) +
        (outcomeScore * 0.14) +
        (reviewerWeight * 0.08) +
        riskBoost +
        revertBoost -
        falsePositivePenalty
      ));

      const rationale: string[] = [];
      if (pathScore > 0) rationale.push(`path-overlap:${pathScore.toFixed(2)}`);
      if (lexicalScore > 0) rationale.push(`lexical-overlap:${lexicalScore.toFixed(2)}`);
      rationale.push(`recency:${recencyWeight.toFixed(2)}`);
      rationale.push(`outcome:${outcomeScore.toFixed(2)}`);
      rationale.push(`reviewer-weight:${reviewerWeight.toFixed(2)}`);
      if (incidentLinked) rationale.push("incident-linked");
      if (revertLinked) rationale.push("revert-linked");
      if (falsePositivePenalty > 0) rationale.push(`false-positive-penalty:${falsePositivePenalty.toFixed(2)}`);

      return {
        precedentId: `PR-${signal.prId}`,
        prId: signal.prId,
        title: signal.title,
        score: Number(score.toFixed(4)),
        rationale,
        topPaths: signal.topPaths || [],
        outcome: signal.blockerCount > 0 || signal.needsWorkCount > signal.approvalCount
          ? "needs-attention"
          : signal.approvalCount > 0
            ? "accepted"
            : "mixed",
        reviewerWeight: Number(reviewerWeight.toFixed(4)),
        incidentLinked,
        revertLinked,
      } satisfies RankedHistoricalPrecedent;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

export function buildBehavioralPatternContext(input: BehavioralEngineInput): BehavioralPatternContext {
  const enabled = (process.env.BPE_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    return {
      enabled: false,
      knowledgeReferences: [],
      highlights: [],
      contextHash: "disabled",
      historySignalsUsed: 0,
    };
  }

  const historicalSignals = input.historicalSignals || [];
  const currentBuckets = topBuckets(input.files, 6);
  const historicalHotspots = aggregateHistoricalHotspots(historicalSignals, 6);
  const keywordPatterns = aggregateKeywordPatterns(historicalSignals);

  const avgBlockers = historicalSignals.length > 0
    ? historicalSignals.reduce((sum, s) => sum + s.blockerCount, 0) / historicalSignals.length
    : 0;
  const avgNeedsWork = historicalSignals.length > 0
    ? historicalSignals.reduce((sum, s) => sum + s.needsWorkCount, 0) / historicalSignals.length
    : 0;
  const acceptedCount = input.feedbackSignals?.acceptedCount || 0;
  const rejectedCount = input.feedbackSignals?.rejectedCount || 0;
  const falsePositiveCount = input.feedbackSignals?.falsePositiveCount || 0;

  const references: BehavioralKnowledgeReference[] = [];

  if (currentBuckets.length > 0) {
    references.push({
      source: "behavioral-pattern-engine",
      title: "Current PR hotspot paths",
      guidance:
        `Prioritize review depth in these path buckets: ${currentBuckets.join(", ")}. ` +
        "When these areas are touched, reviewers historically expect stronger evidence for tests, defensive checks, and backward compatibility.",
      appliesTo: ["maintainability", "correctness", "test-quality"],
    });
  }

  if (historicalHotspots.length > 0) {
    references.push({
      source: "behavioral-pattern-engine",
      title: "Historical hotspot paths from merged PRs",
      guidance:
        `Merged PR history shows repeated review attention in: ${historicalHotspots.join(", ")}. ` +
        "Flag regressions more aggressively in these zones and require concrete evidence in diffs/tests.",
      appliesTo: ["correctness", "reliability", "maintainability"],
    });
  }

  if (keywordPatterns.length > 0) {
    references.push({
      source: "behavioral-pattern-engine",
      title: "Common reviewer concern patterns",
      guidance:
        `Frequent historical concern areas: ${keywordPatterns.join(", ")}. ` +
        "Use these as calibration priors when assigning severity and confidence.",
      appliesTo: ["security", "correctness", "test-quality", "api-contract", "observability"],
    });
  }

  references.push({
    source: "behavioral-pattern-engine",
    title: "Severity calibration from review outcomes",
    guidance:
      `Historical merged PR baseline: avg blockers=${avgBlockers.toFixed(2)}, avg needs-work=${avgNeedsWork.toFixed(2)}. ` +
      `Accepted feedback=${acceptedCount}, rejected feedback=${rejectedCount}, false positives=${falsePositiveCount}. ` +
      "If a finding mirrors previously rejected patterns (needs-work/blocker language), increase confidence and keep severity >= warning. " +
      "If a finding conflicts with repeatedly approved patterns, downgrade unless strong counter-evidence exists. " +
      "Repeated false-positive patterns should reduce confidence rather than suppress novel evidence.",
    appliesTo: ["correctness", "security", "reliability"],
  });

  const highlights: string[] = [];
  if (historicalSignals.length > 0) highlights.push(`History signals used: ${historicalSignals.length}`);
  if (historicalHotspots.length > 0) highlights.push(`Top historical hotspots: ${historicalHotspots.slice(0, 3).join(", ")}`);
  if (keywordPatterns.length > 0) highlights.push(`Common concern themes: ${keywordPatterns.slice(0, 3).join(", ")}`);

  const contextHash = buildContextHash(input, historicalHotspots, keywordPatterns);

  return {
    enabled: true,
    knowledgeReferences: references,
    highlights,
    contextHash,
    historySignalsUsed: historicalSignals.length,
  };
}
