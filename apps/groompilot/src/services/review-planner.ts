/**
 * GroomPilot Review Planner
 *
 * A deterministic "control plane" that runs before any expensive AI or context-
 * building steps. It consumes existing triage signals, RCIE delta data, and
 * initial policy findings to produce a per-file ReviewPlan that gates every
 * downstream stage (Tree-sitter, RCIE delta resolution, policy scan, AI review).
 *
 * Decision tiers (highest priority wins):
 *   HUMAN_ESCALATION – run scans + AI summary; require qualified human sign-off or block-on-policy.
 *   FULL_REVIEW       – run full pipeline (context, policy packs, AI, strict JSON verification).
 *   SCAN_ONLY         – run deterministic checks only (policy packs, heuristics, secrets); no LLM review.
 *   SKIP              – do not analyse; record as "unreviewed by design".
 */

import type {
  PRFile,
  PRTriage,
  FileChangeClassification,
} from "./pr-review";
import type { DeltaResolution } from "./repo-code-delta-resolver";
import type { PolicyFinding } from "./review-policy-packs";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ReviewDecision = "SKIP" | "SCAN_ONLY" | "FULL_REVIEW" | "HUMAN_ESCALATION";

export interface FileReviewPlan {
  /** Relative path of the file inside the repository */
  file: string;
  /** The decided review tier for this file */
  decision: ReviewDecision;
  /** Human-readable reasons explaining the decision */
  reasons: string[];
  /** Derived capability flags used to gate downstream stages */
  eligible: {
    /** Whether this file should be included in an LLM-based analysis pass */
    aiReview: boolean;
    /** Whether deterministic policy packs / heuristics should run on this file */
    policyScan: boolean;
    /** Whether Tree-sitter AST context should be built for this file */
    treeSitter: boolean;
    /** Whether RCIE delta resolution should be fetched for this file */
    rcieDelta: boolean;
  };
}

export interface ReviewPlan {
  /** Per-file decisions */
  files: FileReviewPlan[];
  /** Files assigned to each tier (convenient lists for callers) */
  skipped: string[];
  scanOnly: string[];
  fullReview: string[];
  humanEscalation: string[];
  /** One-line human-readable summary (suitable for PR comment or log line) */
  summary: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** File extensions that are never source code (binary/media/archive blobs). */
const BINARY_BLOB_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".tiff",
  ".pdf", ".docx", ".xlsx", ".pptx", ".odt",
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".jar", ".war", ".ear", ".class",
  ".so", ".dylib", ".dll", ".exe", ".bin",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".ttf", ".otf", ".woff", ".woff2",
  ".lock",   // package-lock / yarn.lock
]);

function isBinaryBlob(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Special-case lock files: they are not binary but should be skipped for review
  if (lower.endsWith(".lock") || lower.endsWith("-lock.json")) return true;
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx < 0) return false;
  return BINARY_BLOB_EXTENSIONS.has(lower.slice(dotIdx));
}

/** Test/spec file detection (mirrors the heuristic in pr-review.ts). */
function isTestFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.includes("/src/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/test/") ||
    /(test|spec|it)\.[a-z0-9]+$/.test(lower)
  );
}

/**
 * Returns the count of incoming reverse-dependencies from RCIE delta for the
 * given file, or 0 when RCIE is not indexed.
 */
function incomingDepCount(filename: string, delta: DeltaResolution | undefined): number {
  if (!delta?.indexed) return 0;
  const ctx = delta.fileContexts.get(filename);
  return ctx?.incomingDependencies.length ?? 0;
}

/**
 * Returns true if any initial policy finding for this file is critical/high or
 * requires human review.
 */
function hasCriticalPolicySignal(filename: string, policyFindings: PolicyFinding[]): boolean {
  return policyFindings.some(
    (f) =>
      f.file === filename &&
      (f.severity === "critical" || f.severity === "high" || f.needsHumanReview),
  );
}

/** Active policy finding count for a file (any severity). */
function policyFindingCount(filename: string, policyFindings: PolicyFinding[]): number {
  return policyFindings.filter((f) => f.file === filename).length;
}

// ─── Decision logic ───────────────────────────────────────────────────────────

function decideFile(
  file: PRFile,
  meta: FileChangeClassification,
  delta: DeltaResolution | undefined,
  policyFindings: PolicyFinding[],
): { decision: ReviewDecision; reasons: string[] } {
  const reasons: string[] = [];

  // ── SKIP tier ──────────────────────────────────────────────────────────────
  if (meta.generated) {
    reasons.push("generated/auto-produced file — not hand-written source code");
    return { decision: "SKIP", reasons };
  }
  if (isBinaryBlob(file.filename)) {
    reasons.push("binary or data blob — not reviewable source");
    return { decision: "SKIP", reasons };
  }

  // ── Gather promotion signals upfront ──────────────────────────────────────
  const churn = file.additions + file.deletions;
  const hasSensitiveAuth = meta.sensitivity.includes("auth");
  const hasSensitiveMoney = meta.sensitivity.includes("money-movement");
  const hasSensitiveCrypto = meta.sensitivity.includes("crypto");
  const hasSensitiveMigration = meta.sensitivity.includes("migrations");
  const hasSensitivePii = meta.sensitivity.includes("pii");
  const incomingDeps = incomingDepCount(file.filename, delta);
  const criticalPolicy = hasCriticalPolicySignal(file.filename, policyFindings);
  const anyPolicy = policyFindingCount(file.filename, policyFindings) > 0;
  const highBlast = meta.blastRadius === "high";
  const authSubsystem = meta.subsystem === "auth";
  const paymentsSubsystem = meta.subsystem === "payments";
  const dataSubsystem = meta.subsystem === "data";
  const impactedFileCount = delta?.indexed ? delta.impactedFiles.length : 0;

  // ── HUMAN_ESCALATION tier ─────────────────────────────────────────────────
  // Money-movement + auth together = highest risk combination
  if (hasSensitiveMoney && hasSensitiveAuth) {
    reasons.push("touches both money-movement and auth sensitivity domains");
  }
  // Money-movement + migrations (schema-driven fund movement logic)
  if (hasSensitiveMoney && hasSensitiveMigration) {
    reasons.push("money-movement logic combined with schema/migration changes");
  }
  // A critical or human-review-required policy finding was already detected
  if (criticalPolicy) {
    reasons.push("critical or human-review-level policy finding already detected");
  }
  // Very large cross-service blast radius from RCIE
  if (impactedFileCount > 10) {
    reasons.push(`RCIE reports ${impactedFileCount} transitively impacted files — wide blast radius`);
  }
  if (reasons.length > 0) {
    return { decision: "HUMAN_ESCALATION", reasons };
  }

  // ── FULL_REVIEW tier ──────────────────────────────────────────────────────
  // Sensitive subsystems
  if (authSubsystem || hasSensitiveAuth) {
    reasons.push("auth/security subsystem or sensitivity");
  }
  if (paymentsSubsystem || hasSensitiveMoney) {
    reasons.push("payments/money-movement subsystem or sensitivity");
  }
  if (dataSubsystem || hasSensitiveMigration) {
    reasons.push("data/migrations subsystem or sensitivity");
  }
  if (hasSensitiveCrypto) {
    reasons.push("cryptographic operations detected");
  }
  if (hasSensitivePii) {
    reasons.push("PII-handling code");
  }
  // Significant churn
  if (churn >= 200) {
    reasons.push(`large change (${churn} lines changed)`);
  }
  // RCIE: many reverse dependencies
  if (incomingDeps >= 5) {
    reasons.push(`RCIE: ${incomingDeps} files depend on this file`);
  }
  // Policy findings (non-critical) were already detected → promote from SCAN_ONLY
  if (anyPolicy) {
    reasons.push("policy scan already found findings for this file");
  }
  // High blast radius overall
  if (highBlast && reasons.length === 0) {
    reasons.push("blast radius classified as high");
  }
  if (reasons.length > 0) {
    return { decision: "FULL_REVIEW", reasons };
  }

  // ── SCAN_ONLY tier ────────────────────────────────────────────────────────
  // Infrastructure / config files: run policy packs + config checks, no deep LLM
  if (meta.infraConfig) {
    reasons.push("infrastructure or configuration file — deterministic checks only");
    return { decision: "SCAN_ONLY", reasons };
  }
  // Test files: review for test adequacy, not deep logic
  if (isTestFile(file.filename)) {
    reasons.push("test/spec file — scanned for coverage and quality signals");
    return { decision: "SCAN_ONLY", reasons };
  }
  // Pure interface / type surface with limited blast radius
  if (meta.pureInterface && !highBlast) {
    reasons.push("pure interface or type declaration with limited blast radius");
    return { decision: "SCAN_ONLY", reasons };
  }

  // ── Default: FULL_REVIEW ─────────────────────────────────────────────────
  // Any hand-written application source that didn't fall into the above
  reasons.push("hand-written application source — full review required");
  return { decision: "FULL_REVIEW", reasons };
}

// ─── Capability flags ─────────────────────────────────────────────────────────

function buildEligibility(
  decision: ReviewDecision,
  treeSitterAvailable: boolean,
): FileReviewPlan["eligible"] {
  switch (decision) {
    case "SKIP":
      return { aiReview: false, policyScan: false, treeSitter: false, rcieDelta: false };
    case "SCAN_ONLY":
      return { aiReview: false, policyScan: true, treeSitter: false, rcieDelta: false };
    case "FULL_REVIEW":
      return {
        aiReview: true,
        policyScan: true,
        treeSitter: treeSitterAvailable,
        rcieDelta: true,
      };
    case "HUMAN_ESCALATION":
      return {
        aiReview: true,
        policyScan: true,
        treeSitter: treeSitterAvailable,
        rcieDelta: true,
      };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ReviewPlannerInput {
  /** All files in scope (already filtered to reviewable extensions) */
  files: PRFile[];
  /** Triage metadata from classifyChangedFiles() */
  triage: PRTriage;
  /** Optional initial policy findings (run before planning) */
  initialPolicyFindings?: PolicyFinding[];
  /** Optional RCIE delta resolution for reverse-dep and baseline context */
  deltaResolution?: DeltaResolution;
  /** Whether Tree-sitter parsers are available at runtime */
  treeSitterAvailable?: boolean;
}

/**
 * Build a ReviewPlan that determines what each file should receive.
 *
 * The plan is deterministic, fully explainable, and designed to gate
 * downstream expensive operations (LLM calls, Tree-sitter, RCIE delta) to
 * only the files that genuinely need them.
 */
export function buildReviewPlan(input: ReviewPlannerInput): ReviewPlan {
  const {
    files,
    triage,
    initialPolicyFindings = [],
    deltaResolution,
    treeSitterAvailable = false,
  } = input;

  // Build a fast lookup from filename → triage metadata
  const metaByFile = new Map<string, FileChangeClassification>(
    triage.files.map((m) => [m.file, m]),
  );

  const filePlans: FileReviewPlan[] = files.map((file) => {
    const meta = metaByFile.get(file.filename);

    // If triage metadata is somehow missing, default to FULL_REVIEW (safe side)
    if (!meta) {
      return {
        file: file.filename,
        decision: "FULL_REVIEW",
        reasons: ["no triage metadata available — defaulting to full review"],
        eligible: buildEligibility("FULL_REVIEW", treeSitterAvailable),
      };
    }

    const { decision, reasons } = decideFile(file, meta, deltaResolution, initialPolicyFindings);
    return {
      file: file.filename,
      decision,
      reasons,
      eligible: buildEligibility(decision, treeSitterAvailable),
    };
  });

  const skipped = filePlans.filter((p) => p.decision === "SKIP").map((p) => p.file);
  const scanOnly = filePlans.filter((p) => p.decision === "SCAN_ONLY").map((p) => p.file);
  const fullReview = filePlans.filter((p) => p.decision === "FULL_REVIEW").map((p) => p.file);
  const humanEscalation = filePlans.filter((p) => p.decision === "HUMAN_ESCALATION").map((p) => p.file);

  const summary = [
    `ReviewPlan: ${fullReview.length} FULL_REVIEW`,
    humanEscalation.length ? `${humanEscalation.length} HUMAN_ESCALATION` : null,
    scanOnly.length ? `${scanOnly.length} SCAN_ONLY` : null,
    skipped.length ? `${skipped.length} SKIP` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return { files: filePlans, skipped, scanOnly, fullReview, humanEscalation, summary };
}

/**
 * Filter a list of files to only those eligible for AI-based review.
 */
export function filterAIEligibleFiles(plan: ReviewPlan, files: PRFile[]): PRFile[] {
  const eligible = new Set(
    plan.files.filter((p) => p.eligible.aiReview).map((p) => p.file),
  );
  return files.filter((f) => eligible.has(f.filename));
}

/**
 * Filter a list of files to only those eligible for policy/heuristic scans.
 */
export function filterPolicyScanFiles(plan: ReviewPlan, files: PRFile[]): PRFile[] {
  const eligible = new Set(
    plan.files.filter((p) => p.eligible.policyScan).map((p) => p.file),
  );
  return files.filter((f) => eligible.has(f.filename));
}

/**
 * Produce a short markdown section listing reviewed, skipped, and escalated
 * files, suitable for insertion into the PR comment that GroomPilot posts.
 */
export function formatReviewPlanComment(plan: ReviewPlan): string {
  const lines: string[] = ["### GroomPilot Review Coverage"];
  if (plan.humanEscalation.length) {
    lines.push("", "⚠️ **Requires human sign-off:**");
    plan.humanEscalation.forEach((f) => lines.push(`- \`${f}\``));
  }
  if (plan.fullReview.length) {
    lines.push("", "✅ **Fully reviewed:**");
    plan.fullReview.forEach((f) => lines.push(`- \`${f}\``));
  }
  if (plan.scanOnly.length) {
    lines.push("", "🔍 **Scanned (deterministic checks only):**");
    plan.scanOnly.forEach((f) => lines.push(`- \`${f}\``));
  }
  if (plan.skipped.length) {
    lines.push("", "⏭️ **Skipped (generated/binary/unreviewed by design):**");
    plan.skipped.forEach((f) => lines.push(`- \`${f}\``));
  }
  return lines.join("\n");
}
