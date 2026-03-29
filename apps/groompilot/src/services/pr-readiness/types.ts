/**
 * PR Readiness Snapshot — Internal Domain Model
 *
 * Shared types for the event-driven readiness pipeline.
 * Bitbucket-first. No GitHub provider types.
 */

import type { StrictReviewOutput } from "../review-output-schema";

// ─── Webhook / Event ────────────────────────────────────────────────────────

export type PREventType =
  | "pr:opened"
  | "pr:modified"
  | "pr:from_ref_updated"
  | "pr:reopened"
  | "pr:reviewer:updated"
  | "manual_refresh";

export interface WebhookDelivery {
  id: string;
  provider: "bitbucket";
  projectKey: string;
  repoSlug: string;
  prId: number;
  deliveryId: string;
  eventType: string;
  payloadHash: string;
  receivedAt: string;
  verified: boolean;
  status: "accepted" | "rejected" | "duplicate";
  error?: string;
}

// ─── Readiness Request ──────────────────────────────────────────────────────

export interface PRReadinessRequest {
  provider: "bitbucket";
  projectKey: string;
  repoSlug: string;
  prId: number;
  prUrl: string;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  latestCommitSha: string;
  eventType: PREventType;
  eventTimestamp: string;
  linkedJiraKeys: string[];
  dryRun: boolean;
  reasonForEvaluation: string;
}

// ─── Job Queue ──────────────────────────────────────────────────────────────

export type ReadinessJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";

export interface PRReadinessJob {
  id: string;
  provider: "bitbucket";
  projectKey: string;
  repoSlug: string;
  prId: number;
  commitSha: string;
  jiraFingerprint: string;
  reason: string;
  status: ReadinessJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  requestJson: string;
}

// ─── Readiness Snapshot ─────────────────────────────────────────────────────

export type ReadinessState =
  | "ready"
  | "ready_with_warnings"
  | "blocked"
  | "stale"
  | "error";

export type OverallRisk = "low" | "medium" | "high" | "critical";

export type LLMStatus =
  | "not_requested"
  | "queued"
  | "running"
  | "completed"
  | "skipped"
  | "failed";

export type ContextMode = "ast" | "fallback" | "mixed";

export interface DeterministicFinding {
  id: string;
  file: string;
  line?: number;
  endLine?: number;
  type: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  title: string;
  description: string;
  whyItMatters: string;
  fix: string;
  ruleRefs?: string[];
  source: "policy-pack" | "planner" | "behavioral" | "rcie" | "heuristic";
  needsHumanReview: boolean;
  classification:
    | "blocker"
    | "important"
    | "follow-up"
    | "informational";
}

export interface LLMFinding {
  id: string;
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  classification: "blocker" | "important" | "follow-up" | "informational";
  source: "llm-refinement";
}

export interface LinkedJiraSummary {
  key: string;
  summary: string;
  status?: string;
  acceptanceCriteria?: string;
  businessRules?: string;
  available: boolean;
}

export interface PRReadinessSnapshot {
  id: string;
  provider: "bitbucket";
  projectKey: string;
  repoSlug: string;
  prId: number;
  prTitle: string;
  prAuthor: string;
  latestCommitSha: string;
  diffFingerprint: string;
  jiraFingerprint: string;
  readinessState: ReadinessState;
  overallRisk: OverallRisk;
  deterministicFindings: DeterministicFinding[];
  llmFindings: LLMFinding[];
  finalMergedFindings: (DeterministicFinding | LLMFinding)[];
  appliedPolicyPacks: string[];
  appliedGovernanceProfile: string;
  linkedJiraSummary: LinkedJiraSummary[];
  acceptanceCriteriaSummary: string;
  historicalReviewerSignals: number;
  contextMode: ContextMode;
  parserLanguagesAvailable: string[];
  modelUsed: string;
  llmStatus: LLMStatus;
  staleReason?: string;
  blockerCount: number;
  importantCount: number;
  followUpCount: number;
  createdAt: string;
  updatedAt: string;
  /** Strict JSON output from the deterministic stage if available */
  strictOutput?: StrictReviewOutput;
}

// ─── Watch State ────────────────────────────────────────────────────────────

export interface PRWatchState {
  provider: "bitbucket";
  projectKey: string;
  repoSlug: string;
  prId: number;
  latestSeenCommitSha: string;
  latestJiraFingerprint: string;
  lastSnapshotId?: string;
  lastRefreshAt: string;
}

// ─── Jenkins / API Response ─────────────────────────────────────────────────

export interface ReadinessSummaryResponse {
  readinessState: ReadinessState;
  overallRisk: OverallRisk;
  blockerCount: number;
  importantCount: number;
  followUpCount: number;
  commitShaReviewed: string;
  snapshotAge: string;
  isStale: boolean;
  staleReason?: string;
  llmStatus: LLMStatus;
  contextMode: ContextMode;
  appliedPolicyPacks: string[];
  summary: string;
  updatedAt: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ReadinessConfig {
  webhookSecret: string;
  webhookAuthMode: "hmac" | "header-token" | "disabled";
  enableWebhookDevBypass: boolean;
  webhookReplayTtlSeconds: number;
  webhookRateLimitPerRepo: number;
  webhookRateLimitGlobal: number;
  workerConcurrency: number;
  jobRetryLimit: number;
  staleTtlMinutes: number;
  enableLlmRefinement: boolean;
  llmProvider: string;
  llmModel: string;
  llmMaxConcurrency: number;
  llmTimeoutMs: number;
  llmMinRiskToRun: OverallRisk;
  enableJiraEnrichment: boolean;
  jiraRefreshTtlMinutes: number;
}

export function loadReadinessConfig(): ReadinessConfig {
  const env = (name: string, fallback: string) =>
    (process.env[name] || "").trim() || fallback;
  const envBool = (name: string, fallback: boolean) => {
    const v = (process.env[name] || "").trim().toLowerCase();
    if (!v) return fallback;
    return ["1", "true", "yes", "on"].includes(v);
  };
  const envInt = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    webhookSecret: env("BITBUCKET_WEBHOOK_SECRET", ""),
    webhookAuthMode: (() => {
      const mode = env("WEBHOOK_AUTH_MODE", "hmac") as string;
      if (mode === "header-token" || mode === "disabled") return mode;
      return "hmac";
    })(),
    enableWebhookDevBypass: envBool("ENABLE_WEBHOOK_DEV_BYPASS", false),
    webhookReplayTtlSeconds: envInt("WEBHOOK_REPLAY_TTL_SECONDS", 3600),
    webhookRateLimitPerRepo: envInt("WEBHOOK_RATE_LIMIT_PER_REPO", 10),
    webhookRateLimitGlobal: envInt("WEBHOOK_RATE_LIMIT_GLOBAL", 100),
    workerConcurrency: envInt("READINESS_WORKER_CONCURRENCY", 2),
    jobRetryLimit: envInt("READINESS_JOB_RETRY_LIMIT", 3),
    staleTtlMinutes: envInt("READINESS_STALE_TTL_MINUTES", 1440),
    enableLlmRefinement: envBool("ENABLE_LLM_REFINEMENT", false),
    llmProvider: env("LLM_PROVIDER", "ollama"),
    llmModel: env("LLM_MODEL", "llama3.1:8b"),
    llmMaxConcurrency: envInt("LLM_MAX_CONCURRENCY", 1),
    llmTimeoutMs: envInt("LLM_TIMEOUT_MS", 30000),
    llmMinRiskToRun: (() => {
      const r = env("LLM_MIN_RISK_TO_RUN", "medium").toLowerCase();
      if (r === "low" || r === "high" || r === "critical") return r;
      return "medium" as OverallRisk;
    })(),
    enableJiraEnrichment: envBool("ENABLE_JIRA_ENRICHMENT", true),
    jiraRefreshTtlMinutes: envInt("JIRA_REFRESH_TTL_MINUTES", 30),
  };
}
