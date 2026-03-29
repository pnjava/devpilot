/**
 * GroomPilot Review Planner — AJV Schema Validator
 *
 * Mirrors the strict-output approach used by review-output-schema.ts.
 * Validates ReviewPlan objects at the boundary between planning and execution,
 * and provides a repair pass that ensures safe defaults rather than crashes.
 */

import Ajv from "ajv";
import type { ReviewPlan, FileReviewPlan, ReviewDecision } from "./review-planner";

// ─── Schema ───────────────────────────────────────────────────────────────────

const VALID_DECISIONS: ReviewDecision[] = [
  "SKIP",
  "SCAN_ONLY",
  "FULL_REVIEW",
  "HUMAN_ESCALATION",
];

const ajv = new Ajv({ allErrors: true, strict: false });

const reviewPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["files", "skipped", "scanOnly", "fullReview", "humanEscalation", "summary"],
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "decision", "reasons", "eligible"],
        properties: {
          file: { type: "string", minLength: 1, maxLength: 1000 },
          decision: { type: "string", enum: VALID_DECISIONS },
          reasons: {
            type: "array",
            items: { type: "string", maxLength: 500 },
            minItems: 1,
            maxItems: 20,
          },
          eligible: {
            type: "object",
            additionalProperties: false,
            required: ["aiReview", "policyScan", "treeSitter", "rcieDelta"],
            properties: {
              aiReview: { type: "boolean" },
              policyScan: { type: "boolean" },
              treeSitter: { type: "boolean" },
              rcieDelta: { type: "boolean" },
            },
          },
        },
      },
    },
    skipped: { type: "array", items: { type: "string" } },
    scanOnly: { type: "array", items: { type: "string" } },
    fullReview: { type: "array", items: { type: "string" } },
    humanEscalation: { type: "array", items: { type: "string" } },
    summary: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

const validate = ajv.compile(reviewPlanSchema);

// ─── Repair helpers ───────────────────────────────────────────────────────────

function repairFilePlan(raw: unknown): FileReviewPlan {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      file: "unknown",
      decision: "FULL_REVIEW",
      reasons: ["schema repair: malformed file plan"],
      eligible: { aiReview: true, policyScan: true, treeSitter: false, rcieDelta: false },
    };
  }
  const r = raw as Record<string, unknown>;
  const decision: ReviewDecision =
    VALID_DECISIONS.includes(r.decision as ReviewDecision)
      ? (r.decision as ReviewDecision)
      : "FULL_REVIEW";

  return {
    file: typeof r.file === "string" && r.file.length > 0 ? r.file : "unknown",
    decision,
    reasons:
      Array.isArray(r.reasons) && r.reasons.length > 0
        ? (r.reasons as string[])
        : ["schema repair: no reasons provided"],
    eligible:
      typeof r.eligible === "object" && r.eligible !== null
        ? {
            aiReview: Boolean((r.eligible as Record<string, unknown>).aiReview),
            policyScan: Boolean((r.eligible as Record<string, unknown>).policyScan),
            treeSitter: Boolean((r.eligible as Record<string, unknown>).treeSitter),
            rcieDelta: Boolean((r.eligible as Record<string, unknown>).rcieDelta),
          }
        : { aiReview: decision !== "SKIP", policyScan: true, treeSitter: false, rcieDelta: false },
  };
}

// ─── Public validators ────────────────────────────────────────────────────────

/**
 * Validate a ReviewPlan. Returns `{ valid: true }` or `{ valid: false, errors }`.
 */
export function validateReviewPlan(plan: unknown): { valid: boolean; errors: string[] } {
  const ok = validate(plan);
  if (ok) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "validation error"}`,
  );
  return { valid: false, errors };
}

/**
 * Ensure the plan meets schema, repairing any malformed entries rather than
 * throwing. Safe to call unconditionally before handing the plan to downstream
 * stages.
 */
export function ensureValidReviewPlan(plan: ReviewPlan): ReviewPlan {
  const result = validateReviewPlan(plan);
  if (result.valid) return plan;

  console.warn(
    `[ReviewPlannerSchema] plan invalid (${result.errors.length} error(s)); applying repair pass`,
    result.errors,
  );

  const repairedFiles: FileReviewPlan[] = Array.isArray(plan.files)
    ? plan.files.map(repairFilePlan)
    : [];

  const skipped = repairedFiles.filter((p) => p.decision === "SKIP").map((p) => p.file);
  const scanOnly = repairedFiles.filter((p) => p.decision === "SCAN_ONLY").map((p) => p.file);
  const fullReview = repairedFiles.filter((p) => p.decision === "FULL_REVIEW").map((p) => p.file);
  const humanEscalation = repairedFiles
    .filter((p) => p.decision === "HUMAN_ESCALATION")
    .map((p) => p.file);

  const summary =
    typeof plan.summary === "string" && plan.summary.length > 0
      ? plan.summary
      : `ReviewPlan (repaired): ${fullReview.length} FULL_REVIEW`;

  return { files: repairedFiles, skipped, scanOnly, fullReview, humanEscalation, summary };
}
