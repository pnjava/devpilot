// ─────────────────────────────────────────────────────────────
// Story Readiness — Clarification Question Generator
// ─────────────────────────────────────────────────────────────
import type {
  ClarificationQuestion,
  QuestionCategory,
  QuestionSeverity,
  StoryType,
  StoryReadinessRequest,
  ReadinessDimension,
  SuggestedOwner,
} from "./types";

// ── Template Definition ────────────────────────────────────

interface QuestionTemplate {
  category: QuestionCategory;
  questionText: string;
  whyThisMatters: string;
  severity: QuestionSeverity;
  suggestedOwner: SuggestedOwner;
  /** Only emit if one of these story types matched (empty = always) */
  applicableTypes: StoryType[];
  /** Only emit if the corpus does NOT contain these terms — i.e. this is missing */
  missingSignals: string[];
  /** Only emit if the dimension score is below this threshold (0–100) */
  dimensionGate?: { key: string; maxScore: number };
}

// ── Template Packs ─────────────────────────────────────────

const TEMPLATES: QuestionTemplate[] = [
  // ─── Business Rules ────────────────────────────────────
  {
    category: "Business Rules",
    questionText: "What is the business goal or user outcome this story delivers?",
    whyThisMatters: "Without a clear goal, dev effort may solve the wrong problem.",
    severity: "blocker",
    suggestedOwner: "product",
    applicableTypes: [],
    missingSignals: ["business", "goal", "purpose", "outcome", "value", "benefit"],
    dimensionGate: { key: "business_clarity", maxScore: 30 },
  },
  {
    category: "Business Rules",
    questionText: "Are there specific business rules or conditions that govern the behavior?",
    whyThisMatters: "Implicit rules lead to incorrect implementations and re-work.",
    severity: "important",
    suggestedOwner: "product",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE", "BACKEND_API_CHANGE", "DATA_MAPPING_OR_TRANSFORMATION"],
    missingSignals: ["rule", "condition", "if", "when", "unless", "must", "shall"],
  },
  {
    category: "Business Rules",
    questionText: "Who are the primary users or consumers of this change?",
    whyThisMatters: "Knowing the audience shapes error messages, response format, and priority.",
    severity: "optional",
    suggestedOwner: "product",
    applicableTypes: [],
    missingSignals: ["user", "consumer", "client", "caller", "channel"],
    dimensionGate: { key: "business_clarity", maxScore: 50 },
  },

  // ─── API / Contract ────────────────────────────────────
  {
    category: "API / Contract",
    questionText: "What is the exact endpoint path, HTTP method, and expected request/response schema?",
    whyThisMatters: "Missing contract details causes integration breakage and rework.",
    severity: "blocker",
    suggestedOwner: "architect",
    applicableTypes: ["BACKEND_API_CHANGE"],
    missingSignals: ["endpoint", "path", "method", "schema", "payload"],
    dimensionGate: { key: "api_contract_clarity", maxScore: 30 },
  },
  {
    category: "API / Contract",
    questionText: "Are there any breaking changes to existing API consumers?",
    whyThisMatters: "Breaking changes need versioning strategy and consumer migration plan.",
    severity: "important",
    suggestedOwner: "architect",
    applicableTypes: ["BACKEND_API_CHANGE", "INTEGRATION_CHANGE"],
    missingSignals: ["breaking", "backward", "compatibility", "version", "deprecat"],
  },
  {
    category: "API / Contract",
    questionText: "What message format, encoding, or protocol does the integration use?",
    whyThisMatters: "ISO8583, JSON, SOAP — each has different parsing and error paths.",
    severity: "important",
    suggestedOwner: "architect",
    applicableTypes: ["INTEGRATION_CHANGE", "DATA_MAPPING_OR_TRANSFORMATION"],
    missingSignals: ["format", "encoding", "protocol", "iso", "json", "xml", "soap"],
  },

  // ─── Data / Validation ─────────────────────────────────
  {
    category: "Data / Validation",
    questionText: "What are the exact validation rules (type, length, format, allowed values)?",
    whyThisMatters: "Ambiguous rules produce inconsistent validation across environments.",
    severity: "blocker",
    suggestedOwner: "product",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE", "DATA_MAPPING_OR_TRANSFORMATION"],
    missingSignals: ["length", "format", "allowed", "range", "min", "max", "regex"],
    dimensionGate: { key: "data_validation_clarity", maxScore: 30 },
  },
  {
    category: "Data / Validation",
    questionText: "What happens when validation fails — rejection, default value, or partial acceptance?",
    whyThisMatters: "Error behavior needs to be explicitly defined to avoid silent data corruption.",
    severity: "important",
    suggestedOwner: "product",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE", "DATA_MAPPING_OR_TRANSFORMATION", "BACKEND_API_CHANGE"],
    missingSignals: ["reject", "default", "fallback", "error response", "error code"],
  },
  {
    category: "Data / Validation",
    questionText: "What is the source-to-target field mapping for this transformation?",
    whyThisMatters: "Missing mappings cause data loss or misinterpretation.",
    severity: "blocker",
    suggestedOwner: "architect",
    applicableTypes: ["DATA_MAPPING_OR_TRANSFORMATION"],
    missingSignals: ["source", "target", "mapping", "field map"],
    dimensionGate: { key: "data_validation_clarity", maxScore: 40 },
  },

  // ─── Dependency / Ownership ────────────────────────────
  {
    category: "Dependency / Ownership",
    questionText: "Are there upstream or downstream services that must change in sync?",
    whyThisMatters: "Cross-service dependencies need coordinated releases.",
    severity: "important",
    suggestedOwner: "lead",
    applicableTypes: ["INTEGRATION_CHANGE", "BACKEND_API_CHANGE"],
    missingSignals: ["upstream", "downstream", "service", "depend", "sync", "coordinate"],
    dimensionGate: { key: "dependency_visibility", maxScore: 50 },
  },
  {
    category: "Dependency / Ownership",
    questionText: "Which team or service owns the downstream dependency?",
    whyThisMatters: "Unknown ownership causes delays during integration testing.",
    severity: "optional",
    suggestedOwner: "lead",
    applicableTypes: ["INTEGRATION_CHANGE"],
    missingSignals: ["owner", "team", "responsible", "contact"],
  },

  // ─── Testing ───────────────────────────────────────────
  {
    category: "Testing",
    questionText: "What test scenarios (positive, negative, edge) are expected?",
    whyThisMatters: "Untested paths escape to production as defects.",
    severity: "important",
    suggestedOwner: "developer",
    applicableTypes: [],
    missingSignals: ["test", "scenario", "positive", "negative", "edge"],
    dimensionGate: { key: "testing_readiness", maxScore: 50 },
  },
  {
    category: "Testing",
    questionText: "Are there mock/simulator endpoints available for integration testing?",
    whyThisMatters: "Without mocks, integration tests are blocked by external system availability.",
    severity: "optional",
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE"],
    missingSignals: ["mock", "simulator", "stub", "sandbox", "test environment"],
  },

  // ─── Environment / Rollout ─────────────────────────────
  {
    category: "Environment / Rollout",
    questionText: "Are there new environment variables, secrets, or config entries needed?",
    whyThisMatters: "Missing config at deploy time causes runtime failures.",
    severity: "important",
    suggestedOwner: "devops",
    applicableTypes: ["CONFIG_OR_ENVIRONMENT_CHANGE", "INTEGRATION_CHANGE"],
    missingSignals: ["config", "env", "secret", "property", "variable", "vault"],
    dimensionGate: { key: "environment_devops_readiness", maxScore: 50 },
  },
  {
    category: "Environment / Rollout",
    questionText: "Is a feature flag or phased rollout needed for this change?",
    whyThisMatters: "Risky changes without rollout controls can impact all users at once.",
    severity: "optional",
    suggestedOwner: "lead",
    applicableTypes: ["BACKEND_API_CHANGE", "INTEGRATION_CHANGE", "CONFIG_OR_ENVIRONMENT_CHANGE"],
    missingSignals: ["feature flag", "toggle", "rollout", "canary", "phased"],
  },

  // ─── Observability / Logging ───────────────────────────
  {
    category: "Observability / Logging",
    questionText: "What logging, metrics, or alerts should be added for this change?",
    whyThisMatters: "Without observability, production issues are invisible.",
    severity: "optional",
    suggestedOwner: "developer",
    applicableTypes: [],
    missingSignals: ["log", "metric", "alert", "monitor", "trace", "observ"],
    dimensionGate: { key: "environment_devops_readiness", maxScore: 60 },
  },

  // ─── Failure / Edge Cases ──────────────────────────────
  {
    category: "Failure / Edge Cases",
    questionText: "What should happen on timeout, network failure, or downstream unavailability?",
    whyThisMatters: "Unhandled failures cascade into customer-facing outages.",
    severity: "important",
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE", "BACKEND_API_CHANGE"],
    missingSignals: ["timeout", "retry", "circuit", "fallback", "unavailable", "failure"],
  },
  {
    category: "Failure / Edge Cases",
    questionText: "Are there known edge cases or data anomalies that affect this logic?",
    whyThisMatters: "Edge cases found in production are much more expensive to fix.",
    severity: "optional",
    suggestedOwner: "product",
    applicableTypes: [],
    missingSignals: ["edge case", "corner case", "anomal", "special case", "exception"],
    dimensionGate: { key: "acceptance_criteria_clarity", maxScore: 50 },
  },
];

// ── Generator ──────────────────────────────────────────────

export function generateQuestions(
  req: StoryReadinessRequest,
  storyType: StoryType,
  dimensions: ReadinessDimension[],
): ClarificationQuestion[] {
  const corpus = [req.title, req.description, req.acceptanceCriteria].join(" ").toLowerCase();
  const dimScores = new Map(dimensions.map((d) => [d.key as string, d.score]));
  const questions: ClarificationQuestion[] = [];
  let counter = 0;

  for (const tpl of TEMPLATES) {
    // Story type filter
    if (tpl.applicableTypes.length > 0 && !tpl.applicableTypes.includes(storyType)) {
      continue;
    }

    // Dimension gate: only ask if the dimension is below threshold
    if (tpl.dimensionGate) {
      const dimScore = dimScores.get(tpl.dimensionGate.key) ?? 100;
      if (dimScore > tpl.dimensionGate.maxScore) continue;
    }

    // Missing signal check: at least one should be absent from the corpus
    if (tpl.missingSignals.length > 0) {
      const anyPresent = tpl.missingSignals.some((sig) => corpus.includes(sig));
      if (anyPresent) continue; // signal is present — question not needed
    }

    counter++;
    questions.push({
      id: `q-${counter}`,
      category: tpl.category,
      questionText: tpl.questionText,
      whyThisMatters: tpl.whyThisMatters,
      severity: tpl.severity,
      triggeredBy: `Missing: ${tpl.missingSignals.slice(0, 3).join(", ")}`,
      confidence: tpl.severity === "blocker" ? "high" : tpl.severity === "important" ? "medium" : "low",
      suggestedOwner: tpl.suggestedOwner,
    });
  }

  // Sort: blockers first, then important, then optional
  const severityOrder: Record<QuestionSeverity, number> = { blocker: 0, important: 1, optional: 2 };
  questions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return questions;
}
