// ─────────────────────────────────────────────────────────────
// Story Readiness — Subtask Generator (Template-Based)
// ─────────────────────────────────────────────────────────────
import type {
  SuggestedSubtask,
  SubtaskCategory,
  StoryType,
  StoryReadinessRequest,
  ReadinessDimension,
  SuggestedOwner,
} from "./types";

// ── Template Definition ────────────────────────────────────

interface SubtaskTemplate {
  category: SubtaskCategory;
  titleTemplate: string;
  descriptionTemplate: string;
  whyNeeded: string;
  dependencyHints: string[];
  suggestedOwner?: SuggestedOwner;
  applicableTypes: StoryType[];
  /** Only emit if corpus contains at least one of these terms */
  presenceSignals?: string[];
  /** Only emit if a dimension score is below threshold */
  dimensionGate?: { key: string; maxScore: number };
}

// ── Template Packs ─────────────────────────────────────────

const TEMPLATES: SubtaskTemplate[] = [
  // ─── BACKEND_API_CHANGE ────────────────────────────────
  {
    category: "Contract / Interface",
    titleTemplate: "Define API contract for {title}",
    descriptionTemplate: "Create or update the OpenAPI/Swagger spec. Specify request/response schemas, status codes, and headers.",
    whyNeeded: "API consumers need a stable contract before implementation begins.",
    dependencyHints: ["Must be reviewed by API owners before implementation"],
    suggestedOwner: "architect",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },
  {
    category: "Validation",
    titleTemplate: "Implement request validation for {title}",
    descriptionTemplate: "Add input validation for all request fields (type, length, format, required checks). Return appropriate 400 errors.",
    whyNeeded: "Invalid input must be rejected at the boundary to prevent downstream corruption.",
    dependencyHints: ["Depends on API contract definition"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },
  {
    category: "Business Logic",
    titleTemplate: "Implement core business logic for {title}",
    descriptionTemplate: "Build the service layer logic per acceptance criteria. Apply business rules and orchestrate downstream calls.",
    whyNeeded: "Core deliverable of the story.",
    dependencyHints: ["Depends on contract + validation subtasks"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },
  {
    category: "Error Handling / Failure Mapping",
    titleTemplate: "Implement error handling & status code mapping for {title}",
    descriptionTemplate: "Map all error scenarios to appropriate HTTP status codes and error response bodies. Include timeout/circuit-breaker handling.",
    whyNeeded: "Consistent error responses prevent client confusion and support troubleshooting.",
    dependencyHints: ["Depends on business logic implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },
  {
    category: "Unit Tests",
    titleTemplate: "Write unit tests for {title}",
    descriptionTemplate: "Cover positive, negative, and boundary scenarios. Aim for 80%+ coverage on new code.",
    whyNeeded: "Unit tests prevent regressions and document expected behavior.",
    dependencyHints: ["Depends on business logic implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },
  {
    category: "Integration Tests / Simulators / Injectors",
    titleTemplate: "Write integration tests for {title}",
    descriptionTemplate: "Test end-to-end flow through the API layer with mocked downstream services.",
    whyNeeded: "Integration tests catch wiring issues between layers.",
    dependencyHints: ["Depends on full implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_API_CHANGE"],
  },

  // ─── BACKEND_VALIDATION_RULE_CHANGE ────────────────────
  {
    category: "Validation",
    titleTemplate: "Implement new validation rules for {title}",
    descriptionTemplate: "Add or modify validation logic per specified rules. Document each rule with expected input/output.",
    whyNeeded: "Validation rules are the core deliverable of this story.",
    dependencyHints: [],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE"],
  },
  {
    category: "Sanitization / Normalization",
    titleTemplate: "Add input sanitization/normalization for {title}",
    descriptionTemplate: "Normalize inputs (trim whitespace, case conversion, encoding) before validation is applied.",
    whyNeeded: "Raw input variability can bypass validation rules.",
    dependencyHints: ["Should be done before validation logic"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE"],
  },
  {
    category: "Error Handling / Failure Mapping",
    titleTemplate: "Define error codes and messages for validation failures",
    descriptionTemplate: "Map each validation rule to a specific error code and user-friendly message. Align with existing error taxonomy.",
    whyNeeded: "Consistent error codes enable proper client-side handling.",
    dependencyHints: ["Depends on validation rule implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE"],
  },
  {
    category: "Unit Tests",
    titleTemplate: "Write unit tests for validation rules in {title}",
    descriptionTemplate: "Test each rule with valid, invalid, boundary, and null/empty inputs.",
    whyNeeded: "Validation rules need exhaustive testing to prevent bypass.",
    dependencyHints: ["Depends on validation implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BACKEND_VALIDATION_RULE_CHANGE"],
  },

  // ─── INTEGRATION_CHANGE ────────────────────────────────
  {
    category: "Contract / Interface",
    titleTemplate: "Define integration contract for {title}",
    descriptionTemplate: "Document the external service contract: endpoint, method, auth, request/response schema, timeout, retry policy.",
    whyNeeded: "Integration contracts must be explicit to avoid runtime surprises.",
    dependencyHints: ["May need sign-off from external team or vendor"],
    suggestedOwner: "architect",
    applicableTypes: ["INTEGRATION_CHANGE"],
  },
  {
    category: "Downstream Integration",
    titleTemplate: "Implement service client / adapter for {title}",
    descriptionTemplate: "Build the HTTP/MQ/event client that communicates with the downstream service. Include timeout, retry, and circuit-breaker logic.",
    whyNeeded: "The adapter encapsulates all integration complexity.",
    dependencyHints: ["Depends on contract definition"],
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE"],
  },
  {
    category: "Error Handling / Failure Mapping",
    titleTemplate: "Handle downstream errors and timeouts for {title}",
    descriptionTemplate: "Map each error scenario (timeout, 4xx, 5xx, connectivity) to appropriate fallback behavior.",
    whyNeeded: "Unhandled downstream failures cascade into customer-facing outages.",
    dependencyHints: ["Depends on adapter implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE"],
  },
  {
    category: "Integration Tests / Simulators / Injectors",
    titleTemplate: "Create mock/simulator for downstream service in {title}",
    descriptionTemplate: "Build a lightweight mock server or WireMock stub for the external service to enable local and CI testing.",
    whyNeeded: "Without mocks, testing is blocked by external system availability.",
    dependencyHints: ["Should be built before integration tests"],
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE"],
  },
  {
    category: "Logging / Observability",
    titleTemplate: "Add integration observability for {title}",
    descriptionTemplate: "Log request/response (redacted), measure latency, and add alerts for error rate thresholds.",
    whyNeeded: "Integration failures are invisible without proper observability.",
    dependencyHints: ["Depends on adapter implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["INTEGRATION_CHANGE"],
  },

  // ─── DATA_MAPPING_OR_TRANSFORMATION ────────────────────
  {
    category: "Contract / Interface",
    titleTemplate: "Document field mapping for {title}",
    descriptionTemplate: "Create a source-to-target field mapping table. Specify data types, transformations, and default values.",
    whyNeeded: "Data mappings must be explicit to prevent data loss or misinterpretation.",
    dependencyHints: [],
    suggestedOwner: "architect",
    applicableTypes: ["DATA_MAPPING_OR_TRANSFORMATION"],
  },
  {
    category: "Business Logic",
    titleTemplate: "Implement data transformation logic for {title}",
    descriptionTemplate: "Build the mapping/transformation layer per the documented field mapping. Handle edge cases (nulls, missing, defaults).",
    whyNeeded: "Core deliverable of the transformation story.",
    dependencyHints: ["Depends on field mapping documentation"],
    suggestedOwner: "developer",
    applicableTypes: ["DATA_MAPPING_OR_TRANSFORMATION"],
  },
  {
    category: "Validation",
    titleTemplate: "Validate source data before transformation for {title}",
    descriptionTemplate: "Pre-validate source fields before applying transformation to catch data quality issues early.",
    whyNeeded: "Garbage in → garbage out. Pre-validation catches issues at the boundary.",
    dependencyHints: ["Depends on field mapping"],
    suggestedOwner: "developer",
    applicableTypes: ["DATA_MAPPING_OR_TRANSFORMATION"],
  },
  {
    category: "Unit Tests",
    titleTemplate: "Write mapping tests for {title}",
    descriptionTemplate: "Test each field mapping with valid, null, edge-case, and multi-byte character inputs.",
    whyNeeded: "Data transformation bugs are subtle and expensive once in production.",
    dependencyHints: ["Depends on transformation implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["DATA_MAPPING_OR_TRANSFORMATION"],
  },

  // ─── CONFIG_OR_ENVIRONMENT_CHANGE ──────────────────────
  {
    category: "Config / Environment",
    titleTemplate: "Define configuration entries for {title}",
    descriptionTemplate: "Document all new/changed config properties, their types, defaults, and which environments need them.",
    whyNeeded: "Missing config at deploy time causes runtime failures.",
    dependencyHints: [],
    suggestedOwner: "devops",
    applicableTypes: ["CONFIG_OR_ENVIRONMENT_CHANGE"],
  },
  {
    category: "Config / Environment",
    titleTemplate: "Update deployment manifests for {title}",
    descriptionTemplate: "Update Helm values, Docker configs, or CI pipelines to include new config entries.",
    whyNeeded: "Config must be propagated to all deployment environments.",
    dependencyHints: ["Depends on config definition"],
    suggestedOwner: "devops",
    applicableTypes: ["CONFIG_OR_ENVIRONMENT_CHANGE"],
  },
  {
    category: "Documentation / Release Notes",
    titleTemplate: "Document config changes for {title}",
    descriptionTemplate: "Update runbooks, READMEs, or wiki pages with new config properties and their purpose.",
    whyNeeded: "Undocumented config creates toil for future operators.",
    dependencyHints: ["Depends on config definition"],
    suggestedOwner: "developer",
    applicableTypes: ["CONFIG_OR_ENVIRONMENT_CHANGE"],
  },

  // ─── BUG_FIX ──────────────────────────────────────────
  {
    category: "Business Logic",
    titleTemplate: "Implement fix for {title}",
    descriptionTemplate: "Apply the code fix per root cause analysis. Ensure the fix addresses the root cause, not just the symptom.",
    whyNeeded: "The primary deliverable of the bug fix story.",
    dependencyHints: [],
    suggestedOwner: "developer",
    applicableTypes: ["BUG_FIX"],
  },
  {
    category: "Unit Tests",
    titleTemplate: "Add regression test for {title}",
    descriptionTemplate: "Write a test that reproduces the original bug and verifies the fix. This prevents future regressions.",
    whyNeeded: "A bug without a regression test will eventually recur.",
    dependencyHints: ["Depends on fix implementation"],
    suggestedOwner: "developer",
    applicableTypes: ["BUG_FIX"],
  },

  // ─── Universal (all types) ─────────────────────────────
  {
    category: "Logging / Observability",
    titleTemplate: "Add logging and metrics for {title}",
    descriptionTemplate: "Add structured logging for key operations. Add metrics for request count, error rate, and latency where applicable.",
    whyNeeded: "Observability enables production troubleshooting.",
    dependencyHints: ["Depends on core implementation"],
    suggestedOwner: "developer",
    applicableTypes: [],
    presenceSignals: ["log", "metric", "monitor", "alert", "observ", "trace"],
  },
  {
    category: "Documentation / Release Notes",
    titleTemplate: "Update documentation for {title}",
    descriptionTemplate: "Update API docs, runbooks, or release notes to reflect the changes made.",
    whyNeeded: "Stale documentation creates confusion for consumers and operators.",
    dependencyHints: ["Should be the last subtask"],
    suggestedOwner: "developer",
    applicableTypes: [],
    dimensionGate: { key: "api_contract_clarity", maxScore: 70 },
  },
];

// ── Generator ──────────────────────────────────────────────

export function generateSubtasks(
  req: StoryReadinessRequest,
  storyType: StoryType,
  dimensions: ReadinessDimension[],
): SuggestedSubtask[] {
  const corpus = [req.title, req.description, req.acceptanceCriteria].join(" ").toLowerCase();
  const dimScores = new Map(dimensions.map((d) => [d.key as string, d.score]));
  const subtasks: SuggestedSubtask[] = [];
  let counter = 0;

  const isSparse = req.description.trim().length < 50 && req.acceptanceCriteria.trim().length < 50;

  for (const tpl of TEMPLATES) {
    // Story type filter
    if (tpl.applicableTypes.length > 0 && !tpl.applicableTypes.includes(storyType)) {
      continue;
    }

    // Presence signal: only emit if at least one term is in the corpus
    if (tpl.presenceSignals && tpl.presenceSignals.length > 0) {
      const anyPresent = tpl.presenceSignals.some((sig) => corpus.includes(sig));
      if (!anyPresent) continue;
    }

    // Dimension gate
    if (tpl.dimensionGate) {
      const dimScore = dimScores.get(tpl.dimensionGate.key) ?? 100;
      if (dimScore > tpl.dimensionGate.maxScore) continue;
    }

    counter++;
    const title = tpl.titleTemplate.replace("{title}", req.title);
    const isDraft = isSparse || storyType === ("UNKNOWN" as StoryType);

    subtasks.push({
      id: `st-${counter}`,
      title,
      description: tpl.descriptionTemplate,
      category: tpl.category,
      whyNeeded: tpl.whyNeeded,
      dependencyHints: tpl.dependencyHints,
      confidence: isDraft ? "low" : "medium",
      optionalAssigneeType: tpl.suggestedOwner,
      isDraft,
    });
  }

  return subtasks;
}
