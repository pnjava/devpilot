// ─────────────────────────────────────────────────────────────
// Story Readiness & Subtask Copilot — Domain Types
// ─────────────────────────────────────────────────────────────

// ── Story Type Classification ──────────────────────────────
export type StoryType =
  | "BACKEND_API_CHANGE"
  | "BACKEND_VALIDATION_RULE_CHANGE"
  | "INTEGRATION_CHANGE"
  | "DATA_MAPPING_OR_TRANSFORMATION"
  | "CONFIG_OR_ENVIRONMENT_CHANGE"
  | "BUG_FIX"
  | "REFACTOR"
  | "UNKNOWN";

// ── Readiness State ────────────────────────────────────────
export type ReadinessState =
  | "READY"
  | "READY_WITH_QUESTIONS"
  | "NEEDS_CLARIFICATION"
  | "BLOCKED_BY_MISSING_INFO";

// ── Knowledge Confidence ───────────────────────────────────
export type KnowledgeConfidence = "HIGH" | "MEDIUM" | "LOW";

// ── Severity & Confidence ──────────────────────────────────
export type QuestionSeverity = "blocker" | "important" | "optional";
export type DimensionConfidence = "high" | "medium" | "low";
export type SubtaskConfidence = "high" | "medium" | "low";
export type SuggestedOwner = "product" | "architect" | "lead" | "developer" | "devops" | "unknown";

// ── Trigger & Run Mode ─────────────────────────────────────
export type TriggerSource = "ui" | "webhook" | "refresh" | "batch";
export type RunMode = "analyze_only" | "analyze_and_persist" | "analyze_and_prepare_jira_payload";

// ── Request ────────────────────────────────────────────────
export interface StoryReadinessRequest {
  jiraKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  epicKey?: string;
  issueType?: string;
  labels: string[];
  assignee?: string;
  reporter?: string;
  status?: string;
  componentTags: string[];
  storyLinks: string[];
  linkedConfluenceUrls: string[];
  manualContextText?: string;
  triggerSource: TriggerSource;
  requestedBy?: string;
  runMode: RunMode;
}

// ── Readiness Dimension ────────────────────────────────────
export interface ReadinessDimension {
  name: string;
  key: DimensionKey;
  score: number;       // 0–100
  weight: number;      // weighting factor (sums to 100)
  rationale: string;
  missingSignals: string[];
  confidence: DimensionConfidence;
}

export type DimensionKey =
  | "business_clarity"
  | "acceptance_criteria_clarity"
  | "dependency_visibility"
  | "api_contract_clarity"
  | "data_validation_clarity"
  | "testing_readiness"
  | "environment_devops_readiness"
  | "knowledge_confidence";

// ── Blocking Gap ───────────────────────────────────────────
export interface BlockingGap {
  id: string;
  description: string;
  dimension: DimensionKey;
  severity: QuestionSeverity;
}

// ── Clarification Question ─────────────────────────────────
export type QuestionCategory =
  | "Business Rules"
  | "API / Contract"
  | "Data / Validation"
  | "Dependency / Ownership"
  | "Testing"
  | "Environment / Rollout"
  | "Observability / Logging"
  | "Failure / Edge Cases";

export interface ClarificationQuestion {
  id: string;
  category: QuestionCategory;
  questionText: string;
  whyThisMatters: string;
  severity: QuestionSeverity;
  triggeredBy: string;
  confidence: DimensionConfidence;
  suggestedOwner: SuggestedOwner;
}

// ── Suggested Subtask ──────────────────────────────────────
export type SubtaskCategory =
  | "Contract / Interface"
  | "Validation"
  | "Sanitization / Normalization"
  | "Business Logic"
  | "Downstream Integration"
  | "Error Handling / Failure Mapping"
  | "Logging / Observability"
  | "Unit Tests"
  | "Integration Tests / Simulators / Injectors"
  | "Config / Environment"
  | "Documentation / Release Notes";

export interface SuggestedSubtask {
  id: string;
  title: string;
  description: string;
  category: SubtaskCategory;
  whyNeeded: string;
  dependencyHints: string[];
  confidence: SubtaskConfidence;
  optionalAssigneeType?: SuggestedOwner;
  isDraft: boolean;   // true when generated from sparse info
}

// ── Source Reference ───────────────────────────────────────
export interface SourceReference {
  type: "jira_story" | "jira_subtask" | "pull_request" | "confluence" | "manual_note";
  ref: string;       // e.g. JIRA-123, PR #45, doc-id
  title: string;
  excerpt?: string;
  confidence: DimensionConfidence;
}

// ── Source Coverage ────────────────────────────────────────
export interface SourceCoverage {
  jiraHistory: boolean;
  pastStories: boolean;
  linkedPRs: boolean;
  confluence: boolean;
  manualNotes: boolean;
}

// ── Snapshot ───────────────────────────────────────────────
export interface StoryReadinessSnapshot {
  snapshotId: string;
  jiraKey: string;
  title: string;
  storyType: StoryType;
  readinessState: ReadinessState;
  readinessScoreOverall: number;   // 0–100
  readinessDimensions: ReadinessDimension[];
  blockingGaps: BlockingGap[];
  clarificationQuestions: ClarificationQuestion[];
  suggestedSubtasks: SuggestedSubtask[];
  knowledgeConfidence: KnowledgeConfidence;
  sourceCoverage: SourceCoverage;
  similarStoryRefs: SourceReference[];
  similarPrRefs: SourceReference[];
  generatedAt: string;   // ISO 8601
  staleReason?: string;
  version: number;
}

// ── Jira Write-Back Payload ────────────────────────────────
export interface JiraWriteBackPayload {
  jiraKey: string;
  commentBody: string;     // Markdown formatted
  subtaskPayloads: JiraSubtaskPayload[];
  dryRun: boolean;
}

export interface JiraSubtaskPayload {
  summary: string;
  description: string;
  labels: string[];
}

// ── DB Row (for persistence) ───────────────────────────────
export interface StoryReadinessSnapshotRow {
  id: string;
  jira_key: string;
  title: string;
  story_type: StoryType;
  readiness_state: ReadinessState;
  overall_score: number;
  dimensions_json: string;
  blocking_gaps_json: string;
  questions_json: string;
  subtasks_json: string;
  knowledge_confidence: KnowledgeConfidence;
  source_coverage_json: string;
  similar_refs_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StoryReadinessSourceRow {
  id: string;
  snapshot_id: string;
  source_type: string;
  source_ref: string;
  title: string;
  excerpt: string;
  confidence: string;
}

export interface StoryReadinessFeedbackRow {
  id: string;
  jira_key: string;
  snapshot_id: string;
  feedback_type: string;
  feedback_text: string;
  accepted_question_ids_json: string;
  accepted_subtask_ids_json: string;
  created_by: string;
  created_at: string;
}
