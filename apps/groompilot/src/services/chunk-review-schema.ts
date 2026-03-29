/**
 * GroomPilot Chunk Review Output Schema
 *
 * Defines the per-chunk AI review output structure and its AJV validator.
 * Reuses StrictReviewIssue from review-output-schema.ts.
 */

import Ajv from "ajv";
import type { StrictReviewIssue, StrictReviewOutput } from "./review-output-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewPass = "security" | "correctness" | "perf";

export interface ChunkReviewOutput {
  summary: string;
  risk: "low" | "medium" | "high" | "critical";
  issues: StrictReviewIssue[];
  meta: {
    filePath: string;
    chunkId: string;
    pass: ReviewPass;
    model: string;
  };
}

// ─── AJV Schema ───────────────────────────────────────────────────────────────

const chunkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risk", "issues", "meta"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 500 },
    risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
    issues: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "file", "type", "severity", "confidence", "title", "description", "whyItMatters", "fix", "needsHumanReview"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          file: { type: "string", minLength: 1, maxLength: 1000 },
          line: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
          type: {
            type: "string",
            enum: ["BUG", "SECURITY", "OWASP", "INJECTION", "PERF", "MEMORY", "LOCKING", "MAINTAINABILITY", "SOLID", "CLEAN_CODE", "BUSINESS_LOGIC", "COMPLIANCE"],
          },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", minLength: 1, maxLength: 2000 },
          whyItMatters: { type: "string", minLength: 1, maxLength: 1200 },
          fix: { type: "string", minLength: 1, maxLength: 1200 },
          codeSuggestion: { type: "string", maxLength: 2500 },
          ruleRefs: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 10 },
          needsHumanReview: { type: "boolean" },
        },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["filePath", "chunkId", "pass", "model"],
      properties: {
        filePath: { type: "string", minLength: 1 },
        chunkId: { type: "string", minLength: 1 },
        pass: { type: "string", enum: ["security", "correctness", "perf"] },
        model: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateChunkOutput = ajv.compile(chunkSchema);

/**
 * Validate and repair a ChunkReviewOutput. Returns the validated output
 * or throws if repair is not possible.
 */
export function validateChunkReview(raw: unknown): ChunkReviewOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("ChunkReviewOutput must be an object");
  }

  const obj = raw as Record<string, unknown>;

  // Apply safe defaults for missing fields
  if (!obj.summary) obj.summary = "No summary provided";
  if (!obj.risk) obj.risk = "low";
  if (!Array.isArray(obj.issues)) obj.issues = [];
  if (!obj.meta || typeof obj.meta !== "object") {
    obj.meta = { filePath: "unknown", chunkId: "unknown", pass: "security", model: "unknown" };
  }

  // Repair each issue
  if (Array.isArray(obj.issues)) {
    obj.issues = (obj.issues as any[]).filter((issue) => {
      if (typeof issue !== "object" || !issue) return false;
      if (!issue.id) issue.id = `auto-${Math.random().toString(36).slice(2, 10)}`;
      if (!issue.file) issue.file = (obj.meta as any)?.filePath || "unknown";
      if (!issue.type) issue.type = "SECURITY";
      if (!issue.severity) issue.severity = "medium";
      if (!issue.confidence) issue.confidence = "medium";
      if (!issue.title) return false; // title is mandatory
      if (!issue.description) issue.description = issue.title;
      if (!issue.whyItMatters) issue.whyItMatters = issue.description;
      if (!issue.fix) issue.fix = "Review and address this finding.";
      if (typeof issue.needsHumanReview !== "boolean") issue.needsHumanReview = false;
      return true;
    });
  }

  if (validateChunkOutput(obj)) {
    return obj as unknown as ChunkReviewOutput;
  }

  // If still invalid after repair, throw with error details
  const errors = validateChunkOutput.errors?.map((e) => `${e.instancePath}: ${e.message}`).join("; ");
  throw new Error(`ChunkReviewOutput validation failed: ${errors}`);
}

/**
 * Export the raw JSON schema for use with Ollama structured output.
 */
export function getChunkReviewJsonSchema(): object {
  return chunkSchema;
}

/**
 * Merge multiple ChunkReviewOutputs into a single StrictReviewOutput.
 * Deduplicates by (file + line + title).
 */
export function mergeChunkReviews(chunks: ChunkReviewOutput[]): StrictReviewOutput {
  const seen = new Set<string>();
  const allIssues: StrictReviewIssue[] = [];

  // Determine overall risk (highest wins)
  const riskOrder: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
  let maxRisk: "low" | "medium" | "high" | "critical" = "low";

  for (const chunk of chunks) {
    if ((riskOrder[chunk.risk] || 0) > (riskOrder[maxRisk] || 0)) {
      maxRisk = chunk.risk;
    }

    for (const issue of chunk.issues) {
      const key = `${issue.file}:${issue.line || 0}:${issue.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allIssues.push(issue);
    }
  }

  const summaries = chunks.map((c) => c.summary).filter(Boolean);
  const summary = summaries.length > 0
    ? summaries.join(" | ").slice(0, 500)
    : "No findings from chunked review.";

  return { summary, risk: maxRisk, issues: allIssues };
}
