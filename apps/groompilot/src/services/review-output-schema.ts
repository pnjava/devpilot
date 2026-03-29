import Ajv from "ajv";
import type { Finding, PRReviewResult } from "./pr-review";
import type { StrictIssueType } from "./review-policy-packs";

export interface StrictReviewIssue {
  id: string;
  file: string;
  line?: number;
  endLine?: number;
  type: StrictIssueType;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  title: string;
  description: string;
  whyItMatters: string;
  fix: string;
  codeSuggestion?: string;
  ruleRefs?: string[];
  needsHumanReview: boolean;
}

export interface StrictReviewOutput {
  summary: string;
  risk: "low" | "medium" | "high" | "critical";
  issues: StrictReviewIssue[];
}

const ajv = new Ajv({ allErrors: true, strict: false });

const strictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risk", "issues"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 500 },
    risk: { type: "string", enum: ["low", "medium", "high", "critical"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id", "file", "type", "severity", "confidence", "title", "description", "whyItMatters", "fix", "needsHumanReview",
        ],
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
  },
} as const;

const validate = ajv.compile(strictSchema);

function mapIssueType(f: Finding): StrictIssueType {
  const category = (f.category || "").toLowerCase();
  const dim = (f.dimension || "").toLowerCase();
  const text = `${category} ${f.title || ""} ${f.message || ""}`.toLowerCase();

  if (/pci|compliance|regulatory/.test(text) || dim === "compliance") return "COMPLIANCE";
  if (/owasp/.test(text)) return "OWASP";
  if (/injection|cwe-89|sql/.test(text)) return "INJECTION";
  if (/auth|authorization|privilege/.test(text)) return "SECURITY";
  if (/race|lock|deadlock|concurrency/.test(text) || dim === "reliability") return "LOCKING";
  if (/memory|resource|leak/.test(text)) return "MEMORY";
  if (/perf|latency|n\+1|slow/.test(text) || dim === "performance") return "PERF";
  if (/solid/.test(text)) return "SOLID";
  if (/clean code|style/.test(text)) return "CLEAN_CODE";
  if (/business|workflow|idempotency|money|ledger/.test(text) || dim === "business-domain") return "BUSINESS_LOGIC";
  if (dim === "maintainability") return "MAINTAINABILITY";
  if (dim === "security") return "SECURITY";
  return "BUG";
}

function mapSeverity(f: Finding): StrictReviewIssue["severity"] {
  if (f.severity === "critical") return "critical";
  if (f.severity === "error") return "high";
  if (f.severity === "warning") return "medium";
  if (f.severity === "suggestion") return "low";
  return "info";
}

function normalizedIssue(issue: StrictReviewIssue): StrictReviewIssue {
  return {
    ...issue,
    id: String(issue.id).trim().slice(0, 120),
    file: String(issue.file).trim().slice(0, 1000),
    line: issue.line && issue.line > 0 ? Math.floor(issue.line) : undefined,
    endLine: issue.endLine && issue.endLine > 0 ? Math.floor(issue.endLine) : undefined,
    title: String(issue.title).trim().slice(0, 200),
    description: String(issue.description).trim().slice(0, 2000),
    whyItMatters: String(issue.whyItMatters).trim().slice(0, 1200),
    fix: String(issue.fix).trim().slice(0, 1200),
    codeSuggestion: issue.codeSuggestion ? String(issue.codeSuggestion).trim().slice(0, 2500) : undefined,
    ruleRefs: issue.ruleRefs ? issue.ruleRefs.map((r) => String(r).trim().slice(0, 120)).filter(Boolean).slice(0, 10) : undefined,
  };
}

export function convertFindingsToStrictIssues(findings: Finding[]): StrictReviewIssue[] {
  return findings.map((f, idx) => normalizedIssue({
    id: f.id || `issue-${idx + 1}`,
    file: f.file || "unknown",
    line: f.line,
    endLine: f.endLine || f.lineEnd,
    type: mapIssueType(f),
    severity: mapSeverity(f),
    confidence: f.confidence,
    title: f.title || "Issue",
    description: f.message || "Issue detected",
    whyItMatters: f.whyItMatters || f.message || "Potential impact detected.",
    fix: f.suggestedFix || "Review and remediate the issue based on the evidence.",
    codeSuggestion: f.evidence,
    ruleRefs: f.relevantRuleOrPolicyRefs,
    needsHumanReview: Boolean(f.needsHumanConfirmation || f.action === "require-human-review" || f.action === "block"),
  }));
}

export function buildStrictReviewOutput(result: PRReviewResult): StrictReviewOutput {
  const issues = convertFindingsToStrictIssues(result.findings);
  const topDim = result.dimensionScores
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((d) => d.dimension)
    .join(", ");

  const summary = result.findings.length === 0
    ? "No material issues were detected in changed code. Review confidence is bounded by diff and context availability."
    : `Detected ${result.findings.length} issue(s) with emphasis on ${topDim || "correctness and security"}. Prioritize high-severity and human-review flagged findings before merge.`;

  return {
    summary,
    risk: result.riskProfile.label,
    issues,
  };
}

export function validateStrictReviewOutput(payload: unknown): { valid: boolean; errors: string[] } {
  const valid = validate(payload);
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors || []).map((e) => `${e.instancePath || "/"} ${e.message || "invalid"}`);
  return { valid: false, errors };
}

export function ensureValidStrictReviewOutput(payload: StrictReviewOutput): StrictReviewOutput {
  const normalized: StrictReviewOutput = {
    summary: String(payload.summary || "Review completed.").slice(0, 500),
    risk: ["low", "medium", "high", "critical"].includes(payload.risk) ? payload.risk : "medium",
    issues: Array.isArray(payload.issues) ? payload.issues.map(normalizedIssue) : [],
  };

  const validation = validateStrictReviewOutput(normalized);
  if (validation.valid) return normalized;

  // Deterministic repair pass.
  const repaired: StrictReviewOutput = {
    summary: normalized.summary || "Review completed.",
    risk: normalized.risk,
    issues: normalized.issues.filter((i) => Boolean(i.id && i.file && i.title && i.description && i.fix)),
  };

  const repairedValidation = validateStrictReviewOutput(repaired);
  if (repairedValidation.valid) return repaired;

  // Fallback to safe empty contract if still invalid.
  return {
    summary: "Review completed with schema fallback.",
    risk: "medium",
    issues: [],
  };
}

export function parseAndValidateStrictReviewOutput(raw: string): StrictReviewOutput | null {
  try {
    const parsed = JSON.parse(raw);
    const validation = validateStrictReviewOutput(parsed);
    if (!validation.valid) return null;
    return parsed as StrictReviewOutput;
  } catch {
    return null;
  }
}
