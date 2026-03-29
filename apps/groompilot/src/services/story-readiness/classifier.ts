// ─────────────────────────────────────────────────────────────
// Story Readiness — Deterministic Story Type Classifier
// ─────────────────────────────────────────────────────────────
import type { StoryType } from "./types";

interface ClassificationSignal {
  type: StoryType;
  weight: number;
  matchedTerms: string[];
}

// ── Keyword / Phrase Banks ─────────────────────────────────

const KEYWORD_BANKS: Record<StoryType, string[]> = {
  BACKEND_API_CHANGE: [
    "api", "endpoint", "rest", "graphql", "request", "response",
    "http", "post", "get", "put", "delete", "patch",
    "controller", "handler", "route", "middleware",
    "payload", "request body", "response body",
    "status code", "header", "authorization",
    "swagger", "openapi", "api spec", "api contract",
  ],
  BACKEND_VALIDATION_RULE_CHANGE: [
    "validation", "validate", "rule", "business rule",
    "constraint", "check", "verify", "format",
    "regex", "pattern", "min", "max", "length",
    "required", "optional", "mandatory",
    "reject", "accept", "allow", "deny",
    "error message", "error code",
  ],
  INTEGRATION_CHANGE: [
    "integration", "downstream", "upstream",
    "third party", "external", "vendor", "partner",
    "kafka", "mq", "queue", "message", "event",
    "webhook", "callback", "notification",
    "service call", "client", "adapter",
    "timeout", "retry", "circuit breaker",
    "soap", "wsdl", "sftp", "ftp",
  ],
  DATA_MAPPING_OR_TRANSFORMATION: [
    "mapping", "transform", "conversion", "translate",
    "field mapping", "data mapping", "format",
    "iso", "iso8583", "iso20022", "swift",
    "parse", "serialize", "deserialize",
    "bcd", "hex", "bitmap", "tlv",
    "schema", "field", "element", "data element",
  ],
  CONFIG_OR_ENVIRONMENT_CHANGE: [
    "config", "configuration", "property", "properties",
    "environment", "env", "variable", "flag", "feature flag",
    "toggle", "setting", "parameter",
    "deployment", "infra", "infrastructure",
    "helm", "k8s", "kubernetes", "docker",
    "secret", "vault", "certificate", "cert",
  ],
  BUG_FIX: [
    "bug", "fix", "defect", "issue", "error",
    "crash", "failure", "broken", "incorrect",
    "regression", "hotfix", "patch",
    "null pointer", "exception", "stack trace",
    "reproduce", "repro", "steps to reproduce",
  ],
  REFACTOR: [
    "refactor", "cleanup", "clean up", "tech debt",
    "technical debt", "modernize", "migrate",
    "upgrade", "deprecate", "remove",
    "simplify", "consolidate", "extract",
    "rename", "restructure", "reorganize",
  ],
  UNKNOWN: [],
};

// ── Label Signals ──────────────────────────────────────────

const LABEL_SIGNALS: Record<string, StoryType> = {
  api: "BACKEND_API_CHANGE",
  endpoint: "BACKEND_API_CHANGE",
  rest: "BACKEND_API_CHANGE",
  validation: "BACKEND_VALIDATION_RULE_CHANGE",
  "business-rule": "BACKEND_VALIDATION_RULE_CHANGE",
  integration: "INTEGRATION_CHANGE",
  mapping: "DATA_MAPPING_OR_TRANSFORMATION",
  iso8583: "DATA_MAPPING_OR_TRANSFORMATION",
  config: "CONFIG_OR_ENVIRONMENT_CHANGE",
  infra: "CONFIG_OR_ENVIRONMENT_CHANGE",
  devops: "CONFIG_OR_ENVIRONMENT_CHANGE",
  bug: "BUG_FIX",
  defect: "BUG_FIX",
  hotfix: "BUG_FIX",
  refactor: "REFACTOR",
  "tech-debt": "REFACTOR",
  cleanup: "REFACTOR",
};

// ── Classify ───────────────────────────────────────────────

export interface ClassificationResult {
  storyType: StoryType;
  confidence: "high" | "medium" | "low";
  signals: ClassificationSignal[];
}

/**
 * Deterministic story type classification.
 * Scans title, description, AC, componentTags, and labels for keyword matches.
 * Returns the type with the highest weighted signal count.
 */
export function classifyStory(input: {
  title: string;
  description: string;
  acceptanceCriteria: string;
  labels: string[];
  componentTags: string[];
  issueType?: string;
}): ClassificationResult {
  const corpus = [
    input.title,
    input.description,
    input.acceptanceCriteria,
  ]
    .join(" ")
    .toLowerCase();

  const signals: ClassificationSignal[] = [];

  // Scan keywords
  for (const [type, keywords] of Object.entries(KEYWORD_BANKS) as [StoryType, string[]][]) {
    if (type === "UNKNOWN") continue;
    const matched: string[] = [];
    for (const kw of keywords) {
      if (corpus.includes(kw)) {
        matched.push(kw);
      }
    }
    if (matched.length > 0) {
      // Title matches weighted 3×, description+AC 1×
      const titleHits = matched.filter((kw) => input.title.toLowerCase().includes(kw)).length;
      const bodyHits = matched.length - titleHits;
      const weight = titleHits * 3 + bodyHits;
      signals.push({ type, weight, matchedTerms: matched });
    }
  }

  // Label signals (weight 5 each)
  for (const label of [...input.labels, ...input.componentTags]) {
    const norm = label.toLowerCase().replace(/\s+/g, "-");
    const sig = LABEL_SIGNALS[norm];
    if (sig) {
      const existing = signals.find((s) => s.type === sig);
      if (existing) {
        existing.weight += 5;
        existing.matchedTerms.push(`label:${label}`);
      } else {
        signals.push({ type: sig, weight: 5, matchedTerms: [`label:${label}`] });
      }
    }
  }

  // Issue type "Bug" → direct signal
  if (input.issueType?.toLowerCase() === "bug") {
    const existing = signals.find((s) => s.type === "BUG_FIX");
    if (existing) {
      existing.weight += 10;
    } else {
      signals.push({ type: "BUG_FIX", weight: 10, matchedTerms: ["issueType:Bug"] });
    }
  }

  // Sort by weight descending
  signals.sort((a, b) => b.weight - a.weight);

  if (signals.length === 0) {
    return { storyType: "UNKNOWN", confidence: "low", signals: [] };
  }

  const top = signals[0];
  const secondWeight = signals.length > 1 ? signals[1].weight : 0;
  const gap = top.weight - secondWeight;

  let confidence: "high" | "medium" | "low";
  if (top.weight >= 10 && gap >= 5) {
    confidence = "high";
  } else if (top.weight >= 5) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { storyType: top.type, confidence, signals };
}
