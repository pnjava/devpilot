// GroomPilot PR Review Engine V3 — AI-Powered Multi-Dimensional Review

import { complete, getProviderInfo, isAIEnabled, completeStructured, llmContextWindow, llmReviewModel } from "./ai-provider";
import {
  buildBehavioralPatternContext,
  HistoricalReviewSignal,
  rankHistoricalPrecedents,
  type RankedHistoricalPrecedent,
} from "./behavioral-pattern-engine";
import {
  applyActiveSuppressions,
  type SuppressedFindingRecord,
} from "./review-suppression-store";
import type { ReviewFeedbackSignals } from "./review-governance-store";
import { resolveDelta, filterBaselineVulns, type DeltaResolution } from "./repo-code-delta-resolver";
import {
  buildTreeSitterContextSubgraph,
  serializeTreeSitterContextForPrompt,
} from "./tree-sitter-context";
import {
  derivePolicyFindingsFromDiff,
  selectPolicyPacks,
  type PolicyFinding,
} from "./review-policy-packs";
import {
  buildStrictReviewOutput,
  ensureValidStrictReviewOutput,
  type StrictReviewOutput,
} from "./review-output-schema";
import {
  buildReviewPlan,
  filterAIEligibleFiles,
  formatReviewPlanComment,
  type ReviewPlan,
} from "./review-planner";
import { ensureValidReviewPlan } from "./review-planner-schema";
import { detectSecrets, secretDetectionsToPolicyFindings } from "./secret-detector";
import { chunkPRFiles, selectChunksForLLM, type PatchChunk } from "./review-chunker";
import { triageFiles, type FileTriageDecision, type TriageFileParams } from "./review-file-triage";
import { validateChunkReview, mergeChunkReviews, getChunkReviewJsonSchema, type ChunkReviewOutput } from "./chunk-review-schema";
import { buildSecurityPrompt } from "./prompts/review/security.prompt";
import { buildCorrectnessPrompt } from "./prompts/review/correctness.prompt";
import { buildPerfPrompt } from "./prompts/review/perf.prompt";
import { scanWithSemgrep, semgrepEnabled } from "./static-analysis/semgrep";
import { scanWithCodeQL, codeqlEnabled } from "./static-analysis/codeql";
import fs from "fs";
import path from "path";
import { getFileContent } from "./bitbucket-server";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  fullContent?: string;
  previousFilename?: string;
}

export interface ExistingPRComment {
  author: string;
  text: string;
  severity: string;
  state: string;
  filePath?: string;
  lineNumber?: number;
}

export interface PRReviewInput {
  prTitle: string;
  prBody: string;
  files: PRFile[];
  specs?: string;
  testCases?: string;
  linkedTicket?: string;
  repoSlug?: string;
  baseBranch?: string;
  sourceBranch?: string;
  author?: string;
  existingComments?: ExistingPRComment[];
  historicalSignals?: HistoricalReviewSignal[];
  precomputedBehavioralRefs?: KnowledgeReference[];
  feedbackSignals?: ReviewFeedbackSignals;
}

export type Severity = "critical" | "error" | "warning" | "info" | "suggestion";
export type Confidence = "high" | "medium" | "low";
export type Dimension =
  | "correctness" | "security" | "reliability" | "performance"
  | "maintainability" | "test-quality" | "api-contract" | "observability"
  | "compliance" | "business-domain";
export type Action = "block" | "require-human-review" | "warning" | "suggestion" | "informational" | "auto-approve";
export type ChangeType =
  | "feature" | "bugfix" | "refactor" | "docs-only" | "test-only"
  | "dependency-bump" | "config-only" | "migration" | "security-sensitive"
  | "infra-platform" | "generated-code" | "large-rename" | "mixed";

type ReviewMode = "ai_only" | "hybrid_balanced" | "hybrid_strict";

export interface Finding {
  id: string;
  file: string;
  filePath?: string;
  line?: number;
  lineStart?: number;
  endLine?: number;
  lineEnd?: number;
  severity: Severity;
  confidence: Confidence;
  dimension: Dimension;
  category: string;
  title: string;
  message: string;
  whyItMatters?: string;
  evidence?: string;
  suggestedFix?: string;
  suggested_fix?: string;
  testsToAddOrUpdate?: string;
  suggestedTest?: string;
  cweId?: string;
  exploitabilityOrFailureMode?: string;
  businessImpact?: string;
  relevantRuleOrPolicyRefs?: string[];
  relatedPrecedents?: string[];
  duplicateOf?: string;
  needsHumanConfirmation?: boolean;
  exploitability_or_failure_mode?: string;
  business_impact?: string;
  file_path?: string;
  line_start?: number;
  line_end?: number;
  why_it_matters?: string;
  tests_to_add_or_update?: string;
  relevant_rule_or_policy_refs?: string[];
  related_precedents?: string[];
  duplicate_of?: string;
  needs_human_confirmation?: boolean;
  action: Action;
  reviewStatus?: "actionable" | "needs_more_context";
  verificationStatus?: "confirmed" | "downgraded" | "dismissed";
  verificationNote?: string;
}

export interface SpecAlignment {
  spec: string;
  status: "met" | "partial" | "missing" | "not-applicable";
  evidence: string;
  confidence: Confidence;
}

export interface RiskProfile {
  overallScore: number;
  label: "low" | "medium" | "high" | "critical";
  factors: RiskFactor[];
  changeType: ChangeType;
  recommendation: Action;
}

export interface RiskFactor {
  factor: string;
  weight: number;
  detail: string;
}

export interface DimensionScore {
  dimension: Dimension;
  score: number;
  label: string;
  findingCount: number;
  blockerCount: number;
  summary: string;
}

export interface ReviewSummary {
  headline: string;
  changeType: ChangeType;
  totalFindings: number;
  blockers: number;
  warnings: number;
  suggestions: number;
  informational: number;
  topRisks: string[];
  strengths: string[];
  verdict: Action;
  riskSummary?: string;
}

export interface ReviewReportItem {
  title: string;
  description: string;
  file?: string;
  line?: number;
  severity?: string;
  suggestedFix?: string;
}

export interface ReviewReport {
  recommendation: "APPROVE" | "APPROVE WITH CONDITIONS" | "REJECT";
  blockingIssues: ReviewReportItem[];
  nonBlockingIssues: ReviewReportItem[];
  positiveObservations: string[];
  followUpActions: string[];
  existingFeedbackSummary: string;
}

export interface PRReviewResult {
  summary: ReviewSummary;
  riskProfile: RiskProfile;
  triage: PRTriage;
  contextBundle: ReviewContextBundle;
  dimensionScores: DimensionScore[];
  findings: Finding[];
  specsAlignment: SpecAlignment[];
  knowledgeContext: KnowledgeReference[];
  complianceScore: number;
  reviewerRouting: string[];
  autoApprovalEligible: boolean;
  governance: {
    schemaAdjusted: number;
    suppressedCount: number;
    suppressedFindings: SuppressedFindingRecord[];
  };
  report: ReviewReport;
  audit: ReviewAudit;
  metrics: ReviewExecutionMetrics;
  behavioralPattern: {
    enabled: boolean;
    historySignalsUsed: number;
    contextHash: string;
    highlights: string[];
  };
  astContext: {
    enabled: boolean;
    parserLanguagesAvailable: string[];
    parsedFiles: number;
    failures: Array<{ filePath: string; reason: string }>;
    selectedPolicyPacks: string[];
  };
  reviewPlan: ReviewPlan;
  strictOutput: StrictReviewOutput;
}

export interface KnowledgeReference {
  source: string;
  title: string;
  guidance: string;
  appliesTo: string[];
}

export type ReviewSurfaceMode =
  | "code"
  | "executable-template"
  | "infra-config"
  | "api-schema"
  | "api-collection"
  | "fixture-data"
  | "manifest"
  | "ci-pipeline"
  | "docs"
  | "diagram"
  | "generic-noncode";

export interface FileChangeClassification {
  file: string;
  previousFile?: string;
  changeKind: "added" | "modified" | "removed" | "renamed" | "moved";
  reviewMode: ReviewSurfaceMode;
  subsystem: string;
  sensitivity: string[];
  blastRadius: "low" | "medium" | "high";
  highRiskCategories: string[];
  generated: boolean;
  infraConfig: boolean;
  pureInterface: boolean;
}

export interface PRTriage {
  files: FileChangeClassification[];
  subsystem: string[];
  sensitivity: string[];
  blastRadius: "low" | "medium" | "high";
  highRiskCategories: string[];
}

export interface AffectedSymbol {
  name: string;
  type: "function" | "class" | "method" | "module";
  lineStart?: number;
  lineEnd?: number;
}

export interface FileContextBundle {
  file: string;
  metadata: FileChangeClassification;
  affectedSymbols: AffectedSymbol[];
  nearbyContext: string[];
  /** Code that runs BEFORE the changed lines inside the same enclosing method/function.
   * Extracted at analysis time so the AI can see prior guards, null-checks, and
   * validation calls without needing access to the full file. */
  priorCallsContext: string[];
  ownership: string[];
  selectedPolicyPacks: string[];
  relevantPrecedentIds: string[];
}

export interface ReviewContextBundle {
  files: FileContextBundle[];
  selectedPolicyPacks: string[];
  relevantPrecedents: RankedHistoricalPrecedent[];
  ownershipMetadataPresent: boolean;
}

export interface ReviewAudit {
  traceId: string;
  provider: string;
  model: string;
  reviewMode: ReviewMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  promptInjectionGuardsApplied: boolean;
  secretRedactionsApplied: number;
  structuredOutputValidated: boolean;
  evidenceCaptureComplete: boolean;
}

export interface BatchFailure {
  batchIndex: number;
  fileCount: number;
  error: string;
}

export interface ReviewExecutionMetrics {
  duplicateFindingCount: number;
  suppressedFindingCount: number;
  schemaAdjustmentCount: number;
  reviewedFileCount: number;
  precedentCount: number;
  batchFailures: BatchFailure[];
  dismissedFindingCount: number;
  downgradedFindingCount: number;
  verificationSkippedCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_SEVERITIES: Severity[] = ["critical", "error", "warning", "info", "suggestion"];
const VALID_CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const VALID_DIMENSIONS: Dimension[] = [
  "correctness", "security", "reliability", "performance",
  "maintainability", "test-quality", "api-contract", "observability",
  "compliance", "business-domain",
];
const VALID_ACTIONS: Action[] = ["block", "require-human-review", "warning", "suggestion", "informational", "auto-approve"];
const VALID_CHANGE_TYPES: ChangeType[] = [
  "feature", "bugfix", "refactor", "docs-only", "test-only",
  "dependency-bump", "config-only", "migration", "security-sensitive",
  "infra-platform", "generated-code", "large-rename", "mixed",
];

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 5);
const MAX_PATCH_CHARS = Number(process.env.MAX_PATCH_CHARS || 6000);
const MAX_PR_BODY_CHARS = Number(process.env.MAX_PR_BODY_CHARS || 6000);
const MAX_PR_NARRATIVE_CHARS = Number(process.env.MAX_PR_NARRATIVE_CHARS || 3500);
const MAX_VERIFICATION_CANDIDATES = 12;

// ─── Feature flags for new review pipeline modules ────────────────────────────
function isChunkerEnabled(): boolean {
  return (process.env.REVIEW_CHUNKER_ENABLED || "").toLowerCase() === "true";
}
function isMultipassEnabled(): boolean {
  return (process.env.REVIEW_MULTIPASS || "").toLowerCase() === "true";
}
function isSecretDetectorEnabled(): boolean {
  // Enabled by default — it runs fast and produces safe fingerprints only
  return (process.env.SECRET_DETECTOR_ENABLED || "true").toLowerCase() !== "false";
}
function isSemgrepEnabled(): boolean {
  return semgrepEnabled();
}
function isCodeQLEnabled(): boolean {
  return codeqlEnabled();
}

// Read REVIEW_MODE lazily — dotenv.config() runs after all import/require() calls are hoisted
function getReviewModeEnv(): ReviewMode {
  const mode = (process.env.REVIEW_MODE || "ai_only").toLowerCase();
  if (mode === "ai_only" || mode === "hybrid_balanced" || mode === "hybrid_strict") {
    return mode;
  }
  return "ai_only";
}
const TARGET_LANGUAGE_EXTENSIONS = [
  ".java", ".groovy", ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
  ".ts", ".tsx", ".js", ".jsx", ".py",
];

function isApplicationCodeFile(filename: string): boolean {
  const path = filename.toLowerCase();
  return TARGET_LANGUAGE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isTargetReviewFile(filename: string): boolean {
  const path = filename.toLowerCase();
  return isApplicationCodeFile(path)
    || /(^|\/)jenkinsfile([-.].+)?$/.test(path)
    || detectInfraConfigFile({ filename, status: "modified", additions: 0, deletions: 0 });
}

/**
 * Files eligible for the AI analysis track.
 * Application code + scripting languages + infra-as-code (Dockerfile, Terraform, Helm templates).
 * Config/data files (.yaml, .json, .properties, etc.) are routed to heuristic-only.
 */
export function isAIEligibleFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  // Application code: always AI
  if (isApplicationCodeFile(lower)) return true;
  // Shell scripts, Groovy
  if (/\.(sh|bash|groovy|kts)$/.test(lower)) return true;
  // Jenkinsfile (Groovy-based pipeline code)
  if (/(^|\/)jenkinsfile([-.].+)?$/i.test(lower)) return true;
  // Infra-as-code with executable logic: Dockerfile, Terraform, Helm templates
  if (/(^|\/)dockerfile([-.].+)?$/i.test(lower)) return true;
  if (/\.(tf|hcl)$/.test(lower)) return true;
  if (/\/templates\/.*\.ya?ml$/.test(lower)) return true; // Helm templates contain Go templating
  // Everything else (yaml, json, properties, xml, toml, ini, conf, env, avsc, md, txt) → heuristic-only
  return false;
}

function pathDirname(file: string): string {
  const idx = file.lastIndexOf("/");
  return idx >= 0 ? file.slice(0, idx) : "";
}

function pathBasename(file: string): string {
  const idx = file.lastIndexOf("/");
  return idx >= 0 ? file.slice(idx + 1) : file;
}

function isTestFilePath(file: string): boolean {
  const lower = file.toLowerCase();
  return (
    lower.includes("/src/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/test/") ||
    /(test|spec|it)\.[a-z0-9]+$/.test(lower)
  );
}

function inferProductionTokenFromTest(file: string): string | null {
  const base = pathBasename(file).replace(/\.[^.]+$/, "");
  const token = base.replace(/(integrationtest|tests|test|it)$/i, "");
  if (!token || token.toLowerCase() === base.toLowerCase()) return null;
  return token;
}

function inferModuleRoot(file: string): string {
  const normalized = file.toLowerCase();
  const idx = normalized.indexOf("/src/test/");
  if (idx >= 0) return normalized.slice(0, idx);
  return pathDirname(normalized);
}

function pathBucket(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function hasPromptInjectionMarker(text: string): boolean {
  return /(ignore (all|any|previous) instructions|system prompt|developer message|disregard .*instructions|act as|tool call|return json only)/i.test(text);
}

function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let next = text;
  const patterns = [
    /(ghp_[a-zA-Z0-9]{20,})/g,
    /(github_pat_[a-zA-Z0-9_]{20,})/g,
    /([A-Za-z0-9+/_-]{24,}\.[A-Za-z0-9+/_-]{10,}\.[A-Za-z0-9+/_-]{10,})/g,
    /((?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9\-_=+/]{8,}["']?)/gi,
  ];

  for (const pattern of patterns) {
    next = next.replace(pattern, () => {
      redactions += 1;
      return "[redacted-secret]";
    });
  }

  return { text: next, redactions };
}

export function sanitizeUntrustedText(raw: string, maxChars: number): { text: string; redactions: number } {
  const normalized = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  const promptSanitized = hasPromptInjectionMarker(normalized)
    ? normalized.replace(/ignore (all|any|previous) instructions/ig, "[sanitized-instruction-like-text]")
    : normalized;
  const redacted = redactSecrets(promptSanitized);
  const clipped = redacted.text.length > maxChars ? `${redacted.text.slice(0, maxChars)}\n... [truncated]` : redacted.text;
  return { text: clipped, redactions: redacted.redactions + (promptSanitized !== normalized ? 1 : 0) };
}

export function sanitizePatchForPrompt(raw: string, maxChars: number): { text: string; redactions: number } {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  let redactions = 0;
  const sanitized = lines.map((line) => {
    const isCommentLike = /^[+\- ]\s*(\/\/|#|\/\*|\*|<!--)/.test(line.trimStart());
    if (isCommentLike && hasPromptInjectionMarker(line)) {
      redactions += 1;
      return `${line.slice(0, 2)} [sanitized-comment-content]`;
    }
    const redacted = redactSecrets(line);
    redactions += redacted.redactions;
    return redacted.text;
  }).join("\n");

  return {
    text: sanitized.length > maxChars ? `${sanitized.slice(0, maxChars)}\n... [truncated]` : sanitized,
    redactions,
  };
}

function detectGeneratedFile(file: PRFile): boolean {
  const name = file.filename.toLowerCase();
  const patch = `${file.patch || ""}\n${file.fullContent || ""}`.toLowerCase();
  return (
    /(^|\/)(dist|build|coverage|generated|gen)\//.test(name) ||
    /\.generated\.(ts|js|java|py|cs)$/.test(name) ||
    /(_pb2\.py|\.pb\.java|\.g\.java|\.designer\.cs|\.min\.js|\.map)$/.test(name) ||
    /generated by|auto-generated|autogenerated|do not edit|codegen/.test(patch)
  );
}

function detectInfraConfigFile(file: PRFile): boolean {
  const name = file.filename.toLowerCase();
  return /(^|\/)(dockerfile|docker-compose|helm|charts|terraform|k8s|kubernetes|deploy|deployment|jenkins|jenkinsfile|github\/workflows|\.github\/workflows|cloudformation|ansible|pulumi|infra|config)\b/.test(name)
    || /\.(ya?ml|json|toml|ini|properties|conf|env)$/.test(name)
    || /(^|\/)(package\.json|pom\.xml|build\.gradle|settings\.gradle|tsconfig\.json|vite\.config\.(ts|js)|tailwind\.config\.js|docker-compose\.yml)$/.test(name);
}

function classifyReviewMode(file: PRFile): ReviewSurfaceMode {
  const name = file.filename.toLowerCase();

  if (isApplicationCodeFile(name)) return "code";
  if (/\.(sh|bash|groovy|kts)$/.test(name) || /(^|\/)jenkinsfile([-.].+)?$/.test(name)) return "code";
  if (/(^|\/)dockerfile([-.].+)?$/.test(name) || /\.(tf|hcl)$/.test(name) || /\/templates\/.*\.ya?ml$/.test(name)) {
    return "executable-template";
  }

  if (/(^|\/)(\.github\/workflows|github\/workflows)\//.test(name) || /(^|\/)(jenkins|pipeline|workflows?)\b/.test(name)) {
    return "ci-pipeline";
  }
  if (/(^|\/)(openapi|swagger)\b/.test(name) || /\.(avsc)$/.test(name)) return "api-schema";
  if (/bruno|postman|insomnia|collection/.test(name)) return "api-collection";
  if (/(^|\/)(replay-fixtures|fixtures?|mocks?|samples?|examples?)\//.test(name)) return "fixture-data";
  if (/\.(md|mdx|txt|rst|adoc|prompt\.md)$/.test(name)) return "docs";
  if (/\.(puml|plantuml|drawio|mmd)$/.test(name)) return "diagram";
  if (/(^|\/)(package\.json|package-lock\.json|pom\.xml|build\.gradle|settings\.gradle|tsconfig\.json|vite\.config\.(ts|js)|tailwind\.config\.js)$/.test(name)) {
    return "manifest";
  }

  if (detectInfraConfigFile(file)) return "infra-config";
  return "generic-noncode";
}

function isSecretExposureFinding(finding: Finding): boolean {
  const haystack = [finding.category, finding.title, finding.message, finding.evidence]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(hardcoded\s*(secret|token|password)|secret\s*leak|token\s*leak|credential\s*leak|sensitive data exposed|secrets? exposed|password exposed)/i.test(haystack);
}

function hasOnlyPlaceholderSecretReferences(file: PRFile): boolean {
  const content = `${file.patch || ""}\n${file.fullContent || ""}`;
  if (!content) return false;

  const hasSecretLikeNames = /(password|secret|token|api[_-]?key|credential)/i.test(content);
  const hasPlaceholderReference = /(\$\{[A-Z0-9_]+\}|\$\([A-Z0-9_]+\)|valueFrom:\s*$|secretKeyRef:|configMapKeyRef:)/m.test(content);
  const hasHardcodedSecretValue = /(?:password|secret|token|api[_-]?key|credential)\s*[:=]\s*["']?(?!\$\{|\$\()[A-Za-z0-9+\/_=.-]{6,}["']?/i.test(content);

  return hasSecretLikeNames && hasPlaceholderReference && !hasHardcodedSecretValue;
}

function classifySubsystem(file: PRFile): string {
  const path = file.filename.toLowerCase();
  if (/auth|security|jwt|oauth|login|token/.test(path)) return "auth";
  if (/payment|transaction|ledger|settlement|invoice|refund|billing|reconciliation|groom/.test(path)) return "payments";
  if (/customer|profile|user|email|notification/.test(path)) return "customer";
  if (/db|migration|schema|sql|liquibase|flyway/.test(path)) return "data";
  if (/metrics|prometheus|telemetry|observability|logging/.test(path)) return "observability";
  if (/docker|helm|deploy|infra|k8s|terraform|jenkins|workflow/.test(path)) return "platform";
  if (/api|route|controller|openapi|swagger/.test(path)) return "api";
  if (/frontend|component|tsx$|jsx$|css$/.test(path)) return "frontend";
  if (/test|spec/.test(path)) return "test";
  return "core";
}

function detectSensitivity(file: PRFile): string[] {
  const path = file.filename.toLowerCase();
  const patch = `${file.patch || ""}\n${file.fullContent || ""}`.toLowerCase();
  const sensitivity = new Set<string>();
  if (/auth|security|jwt|oauth|token|login|rbac|permission/.test(path) || /authorize|permission|role|token|jwt/.test(patch)) sensitivity.add("auth");
  if (/payment|transaction|refund|ledger|settle|reconcil|money|balance/.test(path) || /transfer|charge|debit|credit|balance/.test(patch)) sensitivity.add("money-movement");
  if (/pii|customer|email|profile|user|personal|ssn|pan|card/.test(path) || /email|ssn|pan|customer|personal/.test(patch)) sensitivity.add("pii");
  if (/crypto|encrypt|decrypt|cipher|signature|hash/.test(path) || /messagedigest|cipher|getinstance|sha1|md5|des|rsa/.test(patch)) sensitivity.add("crypto");
  if (/migration|schema|sql|flyway|liquibase/.test(path)) sensitivity.add("migrations");
  if (detectInfraConfigFile(file)) sensitivity.add("infra-changes");
  return Array.from(sensitivity);
}

function detectChangeKind(file: PRFile): FileChangeClassification["changeKind"] {
  if (file.status === "added") return "added";
  if (file.status === "removed") return "removed";
  if (file.previousFilename && file.previousFilename !== file.filename) {
    return pathBasename(file.previousFilename) === pathBasename(file.filename) ? "moved" : "renamed";
  }
  return "modified";
}

/** Detect files that are pure type/interface definitions with no implementation logic. */
function detectPureInterface(file: PRFile): boolean {
  const name = file.filename.toLowerCase();
  // TypeScript declaration files are always pure types
  if (name.endsWith(".d.ts")) return true;
  // Java / Kotlin: interface keyword present but no class keyword
  if (/\.(java|kt)$/i.test(name)) {
    const content = (file.patch || file.fullContent || "").replace(/^[-+]/gm, "");
    return /\binterface\s+\w+/.test(content) && !/\bclass\s+\w+/.test(content);
  }
  // C# interface files (IFoo.cs convention)
  if (/\.cs$/i.test(name) && /\binterface\s+\w+/.test(file.patch || "") && !/\bclass\s+\w+/.test(file.patch || "")) return true;
  return false;
}

function estimateBlastRadius(file: PRFile, classification: Omit<FileChangeClassification, "blastRadius">): FileChangeClassification["blastRadius"] {
  const churn = file.additions + file.deletions;
  if (
    classification.infraConfig ||
    classification.sensitivity.includes("money-movement") ||
    classification.sensitivity.includes("auth") ||
    classification.sensitivity.includes("migrations") ||
    churn >= 400
  ) {
    return "high";
  }
  if (classification.changeKind === "renamed" || classification.changeKind === "moved" || churn >= 120 || classification.generated) {
    return "medium";
  }
  return "low";
}

export function classifyChangedFiles(files: PRFile[]): PRTriage {
  const triagedFiles: FileChangeClassification[] = files.map((file) => {
    const generated = detectGeneratedFile(file);
    const infraConfig = detectInfraConfigFile(file);
    const reviewMode = classifyReviewMode(file);
    const pureInterface = detectPureInterface(file);
    const sensitivity = detectSensitivity(file);
    const subsystem = classifySubsystem(file);
    const highRiskCategories = Array.from(new Set([
      ...sensitivity,
      ...(generated ? ["generated-code"] : []),
      ...(infraConfig ? ["infra-changes"] : []),
      ...(reviewMode !== "code" && reviewMode !== "executable-template" ? ["non-code-review"] : []),
    ]));
    const base = {
      file: file.filename,
      previousFile: file.previousFilename,
      changeKind: detectChangeKind(file),
      reviewMode,
      subsystem,
      sensitivity,
      highRiskCategories,
      generated,
      infraConfig,
      pureInterface,
    };
    return {
      ...base,
      blastRadius: estimateBlastRadius(file, base),
    };
  });

  const aggregateBlast = triagedFiles.some((file) => file.blastRadius === "high")
    ? "high"
    : triagedFiles.some((file) => file.blastRadius === "medium")
      ? "medium"
      : "low";

  return {
    files: triagedFiles,
    subsystem: Array.from(new Set(triagedFiles.map((file) => file.subsystem))),
    sensitivity: Array.from(new Set(triagedFiles.flatMap((file) => file.sensitivity))),
    blastRadius: aggregateBlast,
    highRiskCategories: Array.from(new Set(triagedFiles.flatMap((file) => file.highRiskCategories))),
  };
}

function extractChangedLineRanges(patch: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(patch)) !== null) {
    const start = Number(match[1] || 0);
    const span = Number(match[2] || 1);
    ranges.push({ start, end: start + Math.max(0, span - 1) });
  }
  return ranges;
}

function extractAddedLines(patch: string): Array<{ lineNumber: number; text: string }> {
  const addedLines: Array<{ lineNumber: number; text: string }> = [];
  const lines = patch.split("\n");
  let nextDestinationLine: number | undefined;

  for (const line of lines) {
    const headerMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (headerMatch) {
      nextDestinationLine = Number(headerMatch[1]);
      continue;
    }
    if (nextDestinationLine == null) continue;
    if (line.startsWith("+++") || line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("+")) {
      addedLines.push({ lineNumber: nextDestinationLine, text: line.slice(1) });
      nextDestinationLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      continue;
    }
    nextDestinationLine += 1;
  }

  return addedLines;
}

function findExactAddedLine(patch: string, patterns: RegExp[]): number | undefined {
  const addedLines = extractAddedLines(patch);
  for (const { lineNumber, text } of addedLines) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return lineNumber;
      }
    }
  }
  return undefined;
}

function inferExactChangedLineForFinding(finding: Finding, patch: string): number | undefined {
  const haystack = [finding.category, finding.title, finding.message, finding.evidence, finding.cweId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack) return undefined;

  if (/crypto-misuse|weak cryptographic primitive|weak digest|cipher mode|md5|sha-1|sha1|des|aes-ecb/.test(haystack)) {
    return findExactAddedLine(patch, [
      /messagedigest\.getinstance\(\s*"(?:md5|sha-?1)"/i,
      /cipher\.getinstance\(\s*"(?:des|aes\/ecb)/i,
    ]);
  }

  if (/java-reflection|reflection|class\.forname|method\.invoke|setaccessible|accessibility override/.test(haystack)) {
    return findExactAddedLine(patch, [
      /class\.forname\(/i,
      /method\.invoke\(/i,
      /field\.setaccessible\(true\)/i,
      /constructor\.setaccessible\(true\)/i,
    ]);
  }

  if (/sql injection|orm-query-injection|dynamic sql|query construction|cwe-89/.test(haystack)) {
    return findExactAddedLine(patch, [
      /createquery\s*\(\s*"[^"]*\+/i,
      /@query\s*\(\s*"[^"]*\+/i,
      /createsqlquery\s*\(\s*"[^"]*\+/i,
      /\b(select|update|delete|insert)\b.*(\+|\$\{|"\s*\+)/i,
      /createstatement\s*\(/i,
    ]);
  }

  if (/deserialization|readobject|objectinputstream|yaml\.load|xmldecoder|pickle\.loads|marshal\.loads/.test(haystack)) {
    return findExactAddedLine(patch, [
      /objectinputstream/i,
      /readobject\s*\(/i,
      /yaml\.load\(/i,
      /xmldecoder/i,
      /pickle\.loads\(/i,
      /marshal\.loads\(/i,
    ]);
  }

  if (/child_process|command execution|shell-enabled subprocess|os\.system|subprocess/.test(haystack)) {
    return findExactAddedLine(patch, [
      /child_process\.(exec|execsync|spawn)\(/i,
      /require\(['"]child_process['"]\)/i,
      /subprocess\.(run|popen|call)\([^\)]*shell\s*=\s*true/i,
      /os\.system\(/i,
    ]);
  }

  return undefined;
}

function refineFindingAnchorsToChangedStatements(findings: Finding[], input: PRReviewInput): Finding[] {
  const fileMap = new Map(input.files.map((file) => [file.filename, file]));

  return findings.map((finding) => {
    if (!finding.file || finding.file === "unknown") return finding;
    if (finding.dimension === "maintainability") return finding;

    const file = fileMap.get(finding.file);
    const patch = file?.patch || "";
    if (!patch) return finding;

    const exactLine = inferExactChangedLineForFinding(finding, patch);
    if (!exactLine || exactLine === finding.line) return finding;

    return applyCompatibilityFields({
      ...finding,
      line: exactLine,
      lineStart: exactLine,
      line_start: exactLine,
      endLine: finding.endLine && finding.endLine >= exactLine ? finding.endLine : exactLine,
      lineEnd: finding.endLine && finding.endLine >= exactLine ? finding.endLine : exactLine,
      line_end: finding.endLine && finding.endLine >= exactLine ? finding.endLine : exactLine,
    });
  });
}

function symbolPatternForFile(filename: string): RegExp {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".py")) return /^\s*(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return /^\s*(export\s+)?(async\s+)?(function|class|const|let)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  }
  if (lower.endsWith(".java") || lower.endsWith(".groovy")) {
    return /^\s*(public|private|protected|static|final|abstract|synchronized|class|interface|enum|@\w+|\s)+\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\(|extends|implements|\{)/;
  }
  if (lower.endsWith(".c") || lower.endsWith(".cc") || lower.endsWith(".cpp") || lower.endsWith(".cxx") || lower.endsWith(".h") || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx")) {
    return /^\s*(static\s+|inline\s+|constexpr\s+|class\s+|struct\s+|template<.*>\s*)?([A-Za-z_][A-Za-z0-9_:<>~]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\(|\{)/;
  }
  return /^$/;
}

function extractSymbolContext(file: PRFile): { affectedSymbols: AffectedSymbol[]; nearbyContext: string[]; priorCallsContext: string[] } {
  if (!file.fullContent) {
    return { affectedSymbols: [], nearbyContext: [], priorCallsContext: [] };
  }

  const ranges = extractChangedLineRanges(file.patch || "");
  if (ranges.length === 0) {
    return { affectedSymbols: [], nearbyContext: [], priorCallsContext: [] };
  }

  const lines = file.fullContent.split("\n");
  const pattern = symbolPatternForFile(file.filename);
  const symbols: AffectedSymbol[] = [];
  const snippets: string[] = [];
  const priorCallsContextArr: string[] = [];

  for (const range of ranges.slice(0, 4)) {
    const anchorLine = Math.max(1, Math.min(lines.length, range.start));
    let symbolLine = anchorLine;
    let symbolSource = lines[anchorLine - 1] || "";
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let cursor = Math.max(0, anchorLine - 80); cursor < Math.min(lines.length, anchorLine + 40); cursor += 1) {
      if (pattern.test(lines[cursor])) {
        const distance = Math.abs((cursor + 1) - anchorLine);
        if (distance < bestDistance) {
          bestDistance = distance;
          symbolLine = cursor + 1;
          symbolSource = lines[cursor];
        }
      }
    }
    if (bestDistance !== Number.MAX_SAFE_INTEGER) {
      const match = symbolSource.match(pattern);
      const name = match?.[4] || match?.[2] || match?.[3] || "module";
      const type = /class|interface|enum/.test(symbolSource) ? "class" : /def|function/.test(symbolSource) ? "function" : "method";
      if (!symbols.some((symbol) => symbol.name === name && symbol.lineStart === symbolLine)) {
        symbols.push({ name, type: type as AffectedSymbol["type"], lineStart: symbolLine, lineEnd: range.end });
      }
    }

    // Extract the method body that runs BEFORE the changed line so the AI can
    // see prior guards, validation calls, and null-checks in the same method.
    const priorFrom = symbolLine + 1; // first line after the symbol signature
    const priorTo = anchorLine - 1;   // last line before the change
    if (priorTo > priorFrom + 1) {
      const priorSlice = lines
        .slice(priorFrom - 1, priorTo - 1)
        .map((line, idx) => `${priorFrom + idx}: ${line}`)
        .join("\n");
      const priorClipped = priorSlice.length > 1200
        ? "... [prior method body truncated]\n" + priorSlice.slice(-1200)
        : priorSlice;
      if (priorClipped.trim()) priorCallsContextArr.push(priorClipped);
    }

    const start = Math.max(1, symbolLine - 2);
    const end = Math.min(lines.length, Math.max(range.end + 4, anchorLine + 6));
    const snippet = lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line}`).join("\n");
    snippets.push(snippet);
  }

  return {
    affectedSymbols: symbols.slice(0, 6),
    nearbyContext: snippets.slice(0, 4),
    priorCallsContext: priorCallsContextArr.slice(0, 4),
  };
}

function selectRelevantPolicyPacks(refs: KnowledgeReference[], metadata: FileChangeClassification): string[] {
  const keywords = new Set<string>([
    metadata.subsystem,
    ...metadata.sensitivity,
    ...(metadata.generated ? ["generated"] : []),
    ...(metadata.infraConfig ? ["infra", "migration", "config"] : []),
  ]);

  return refs
    .filter((ref) => {
      const haystack = `${ref.source} ${ref.title} ${ref.guidance}`.toLowerCase();
      for (const keyword of keywords) {
        if (keyword && haystack.includes(keyword.toLowerCase())) return true;
      }
      return ref.appliesTo.includes("compliance") || ref.appliesTo.includes("security");
    })
    .map((ref) => ref.title)
    .slice(0, 6);
}

export function buildReviewContextBundle(
  input: PRReviewInput,
  triage: PRTriage,
  knowledgeContext: KnowledgeReference[],
  relevantPrecedents: RankedHistoricalPrecedent[],
): { contextBundle: ReviewContextBundle; redactionsApplied: number } {
  let redactionsApplied = 0;
  const files: FileContextBundle[] = triage.files.map((metadata) => {
    const file = input.files.find((candidate) => candidate.filename === metadata.file);
    const symbolContext = file ? extractSymbolContext(file) : { affectedSymbols: [], nearbyContext: [], priorCallsContext: [] };
    const sanitizedContext = symbolContext.nearbyContext.map((snippet) => {
      const sanitized = sanitizeUntrustedText(snippet, 1200);
      redactionsApplied += sanitized.redactions;
      return sanitized.text;
    });
    const sanitizedPriorContext = symbolContext.priorCallsContext.map((snippet) => {
      const sanitized = sanitizeUntrustedText(snippet, 1200);
      redactionsApplied += sanitized.redactions;
      return sanitized.text;
    });

    const relevantPrecedentIds = relevantPrecedents
      .filter((precedent) => precedent.topPaths.some((bucket) => metadata.file.toLowerCase().startsWith(bucket.toLowerCase())))
      .map((precedent) => precedent.precedentId)
      .slice(0, 3);

    return {
      file: metadata.file,
      metadata,
      affectedSymbols: symbolContext.affectedSymbols,
      nearbyContext: sanitizedContext,
      priorCallsContext: sanitizedPriorContext,
      ownership: computeReviewerRouting([{ filename: metadata.file, status: "modified", additions: 0, deletions: 0 }]),
      selectedPolicyPacks: selectRelevantPolicyPacks(knowledgeContext, metadata),
      relevantPrecedentIds,
    };
  });

  return {
    contextBundle: {
      files,
      selectedPolicyPacks: Array.from(new Set(files.flatMap((file) => file.selectedPolicyPacks))),
      relevantPrecedents,
      ownershipMetadataPresent: false,
    },
    redactionsApplied,
  };
}

function calibrateBusinessImpact(category: string, triage: PRTriage): string {
  const labels = new Set([...triage.highRiskCategories, ...triage.sensitivity, category.toLowerCase()]);
  if (labels.has("money-movement")) return "Could cause incorrect monetary state, duplicate processing, or reconciliation failures.";
  if (labels.has("auth")) return "Could enable unauthorized access, privilege misuse, or broken access control.";
  if (labels.has("pii")) return "Could expose customer or regulated personal data beyond intended boundaries.";
  if (labels.has("migrations") || labels.has("infra-changes")) return "Could trigger deployment instability, rollback difficulty, or data integrity issues.";
  if (labels.has("crypto")) return "Could weaken cryptographic protections or compromise integrity guarantees.";
  return "Could degrade service reliability, correctness, or operational safety if merged without mitigation.";
}

function applyCompatibilityFields(finding: Finding): Finding {
  return {
    ...finding,
    filePath: finding.file,
    file_path: finding.file,
    lineStart: finding.line,
    line_start: finding.line,
    lineEnd: finding.endLine,
    line_end: finding.endLine,
    whyItMatters: finding.whyItMatters || finding.message,
    why_it_matters: finding.whyItMatters || finding.message,
    suggested_fix: finding.suggestedFix,
    tests_to_add_or_update: finding.testsToAddOrUpdate || finding.suggestedTest,
    relevant_rule_or_policy_refs: finding.relevantRuleOrPolicyRefs,
    related_precedents: finding.relatedPrecedents,
    duplicate_of: finding.duplicateOf,
    needs_human_confirmation: finding.needsHumanConfirmation,
    exploitability_or_failure_mode: finding.exploitabilityOrFailureMode,
    business_impact: finding.businessImpact,
  };
}

function mapPolicySeverity(severity: PolicyFinding["severity"]): Severity {
  if (severity === "critical") return "critical";
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "suggestion";
  return "info";
}

function mapPolicyDimension(type: PolicyFinding["type"]): Dimension {
  if (type === "SECURITY" || type === "OWASP" || type === "INJECTION") return "security";
  if (type === "PERF") return "performance";
  if (type === "MEMORY" || type === "LOCKING") return "reliability";
  if (type === "SOLID" || type === "CLEAN_CODE" || type === "MAINTAINABILITY") return "maintainability";
  if (type === "COMPLIANCE") return "compliance";
  if (type === "BUSINESS_LOGIC") return "business-domain";
  return "correctness";
}

function policyFindingsToFindings(policyFindings: PolicyFinding[]): Finding[] {
  return policyFindings.map((finding) => {
    const severity = mapPolicySeverity(finding.severity);
    const action: Action = finding.severity === "critical" || finding.severity === "high"
      ? "block"
      : finding.needsHumanReview
        ? "require-human-review"
        : finding.severity === "medium"
          ? "warning"
          : finding.severity === "low"
            ? "suggestion"
            : "informational";

    return applyCompatibilityFields({
      id: finding.id,
      file: finding.file,
      line: finding.line,
      endLine: finding.endLine,
      severity,
      confidence: finding.confidence,
      dimension: mapPolicyDimension(finding.type),
      category: finding.type,
      title: finding.title,
      message: finding.description,
      whyItMatters: finding.whyItMatters,
      suggestedFix: finding.fix,
      relevantRuleOrPolicyRefs: finding.ruleRefs,
      needsHumanConfirmation: finding.needsHumanReview,
      action,
    });
  });
}

function chunkIssuesToFindings(issues: import("./review-output-schema").StrictReviewIssue[]): Finding[] {
  return issues.map((issue) => {
    const severity = mapPolicySeverity(issue.severity);
    const action: Action = issue.severity === "critical" || issue.severity === "high"
      ? "block"
      : issue.needsHumanReview
        ? "require-human-review"
        : issue.severity === "medium"
          ? "warning"
          : "suggestion";

    return applyCompatibilityFields({
      id: issue.id,
      file: issue.file,
      line: issue.line,
      endLine: issue.endLine,
      severity,
      confidence: issue.confidence as Confidence,
      dimension: mapPolicyDimension(issue.type),
      category: issue.type,
      title: issue.title,
      message: issue.description,
      whyItMatters: issue.whyItMatters,
      suggestedFix: issue.fix,
      relevantRuleOrPolicyRefs: issue.ruleRefs,
      needsHumanConfirmation: issue.needsHumanReview,
      action,
    });
  });
}

export function deduplicateFindingsDetailed(findings: Finding[]): { findings: Finding[]; duplicateCount: number } {
  const sorted = [...findings].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return confidenceRank(right.confidence) - confidenceRank(left.confidence);
  });

  const seen = new Map<string, string>();
  const deduped: Finding[] = [];
  let duplicateCount = 0;

  for (const finding of sorted) {
    const key = `${finding.file}:${finding.line ?? "na"}:${finding.category.toLowerCase()}:${finding.title.toLowerCase()}`;
    const existing = seen.get(key);
    if (existing) {
      duplicateCount += 1;
      continue;
    }
    seen.set(key, finding.id);
    deduped.push(finding);
  }

  return { findings: deduped, duplicateCount };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJson<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const codeBlock = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch { /* continue */ }
  }
  const start = trimmed.search(/[[\{]/);
  if (start >= 0) {
    const bracket = trimmed[start];
    const end = bracket === "[" ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");
    if (end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* continue */ }
    }
  }
  return fallback;
}

function getReviewMode(): ReviewMode {
  return getReviewModeEnv();
}

function normalizePRBody(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function buildPRNarrative(prBody: string): string {
  const normalized = sanitizeUntrustedText(normalizePRBody(prBody || ""), MAX_PR_BODY_CHARS).text;
  if (!normalized) return "";

  const lines = normalized.split("\n").map((l) => l.trim());
  const sectionRegex = /^(problem statement|root cause|solution overview|changes made|key test coverage|test coverage|reviewers|backward compatible|safe deployment|no consumer impact)\b/i;
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (sectionRegex.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) sections.push(current.join("\n"));

  const preferred = sections.filter((s) => sectionRegex.test(s.split("\n")[0] || ""));
  const selected = preferred.length > 0 ? preferred : [normalized];
  const joined = selected.join("\n\n");

  if (joined.length <= MAX_PR_BODY_CHARS) return joined;
  return joined.slice(0, MAX_PR_BODY_CHARS) + "\n... [truncated]";
}

function buildDiffContext(input: PRReviewInput, triage?: PRTriage): string {
  const lines: string[] = [];
  lines.push(`PR Title: ${input.prTitle}`);
  if (input.prBody) lines.push(`PR Description: ${buildPRNarrative(input.prBody)}`);
  if (input.repoSlug) lines.push(`Repo: ${input.repoSlug}`);
  if (input.baseBranch) lines.push(`Base: ${input.baseBranch} ← Source: ${input.sourceBranch || "unknown"}`);
  if (input.linkedTicket) lines.push(`Linked Ticket: ${input.linkedTicket}`);
  if (triage) {
    lines.push(`Triage: subsystems=${triage.subsystem.join(", ") || "none"}; sensitivity=${triage.sensitivity.join(", ") || "none"}; blastRadius=${triage.blastRadius}; highRisk=${triage.highRiskCategories.join(", ") || "none"}`);
  }
  lines.push(`\nFiles changed (${input.files.length}):`);
  for (const f of input.files) {
    const triaged = triage?.files.find((file) => file.file === f.filename);
    const detail = triaged
      ? ` subsystem=${triaged.subsystem}; blastRadius=${triaged.blastRadius}; risk=${triaged.highRiskCategories.join("|") || "none"}`
      : "";
    lines.push(`  ${f.status.toUpperCase()} ${f.filename} (+${f.additions} -${f.deletions})${detail}`);
  }
  return lines.join("\n");
}

function buildFilePatchContext(files: PRFile[]): string {
  const patches: string[] = [];
  for (const f of files) {
    const sanitizedPatch = sanitizePatchForPrompt(f.patch || "", MAX_PATCH_CHARS);
    const symbolContext = extractSymbolContext(f);
    const priorCtx = symbolContext.priorCallsContext.length > 0
      ? `\n\nPrior calls within enclosing method (these run BEFORE the changed lines — existing guards/validation may already handle the concern):\n${symbolContext.priorCallsContext.join("\n\n---\n\n")}`
      : "";
    const nearby = symbolContext.nearbyContext.length > 0
      ? `\n\nNearby context:\n${symbolContext.nearbyContext.join("\n\n---\n\n")}`
      : "";
    patches.push(`=== ${f.filename} (${f.status}, +${f.additions} -${f.deletions}) ===\n${sanitizedPatch.text}${priorCtx}${nearby}`);
  }
  return patches.join("\n\n");
}

function serializeHistoricalPrecedents(precedents: RankedHistoricalPrecedent[]): string {
  if (precedents.length === 0) return "None";
  return precedents
    .map((precedent, index) => `${index + 1}. [${precedent.precedentId}] ${precedent.title} :: score=${precedent.score}; outcome=${precedent.outcome}; rationale=${precedent.rationale.join(", ")}`)
    .join("\n");
}

// ─── Dynamic CONTRIBUTING.md loader ──────────────────────────────────────────
// Tries: 1) Bitbucket repo file  2) local workspace file  3) returns null
async function fetchContributingMd(repoSlug?: string): Promise<string | null> {
  // 1. Try Bitbucket API
  if (repoSlug) {
    try {
      const content = await getFileContent(repoSlug, "CONTRIBUTING.md");
      if (content && content.trim().length > 50) return content;
    } catch {
      // repo may not have a CONTRIBUTING.md — fall through
    }
  }
  // 2. Try local workspace file
  try {
    const localPath = path.resolve(__dirname, "../../../CONTRIBUTING.md");
    if (fs.existsSync(localPath)) {
      const content = fs.readFileSync(localPath, "utf-8");
      if (content.trim().length > 50) return content;
    }
  } catch {
    // not available locally either
  }
  return null;
}

function buildKnowledgeContext(input: PRReviewInput): KnowledgeReference[] {
  const refs: KnowledgeReference[] = [];
  const paths = input.files.map((f) => f.filename.toLowerCase());

  // ── Story acceptance criteria (from grooming specs) ───────────────────────
  if (input.specs) {
    const specLines = input.specs
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !!l)
      .slice(0, 6);
    if (specLines.length > 0) {
      refs.push({
        source: "grooming-specs",
        title: "Story acceptance criteria",
        guidance: specLines.join(" | "),
        appliesTo: ["compliance", "business-domain", "correctness"],
      });
    }
  }

  // ── Security rules (review playbook + general) ───────────────────────────
  refs.push({
    source: "review-playbook",
    title: "Security validation rules",
    guidance:
      "No hardcoded passwords, secrets, API keys, or tokens in code. No production IPs or URLs embedded. JWT/auth configuration must be externalized to environment variables. Validate authz/authn checks on sensitive actions, avoid leaking tokens in logs.",
    appliesTo: ["security", "correctness", "compliance"],
  });

  // ── Auth/token specific files get extra scrutiny ──────────────────────────
  if (paths.some((p) => p.includes("auth") || p.includes("security") || p.includes("token") || p.includes("jwt"))) {
    refs.push({
      source: "review-playbook",
      title: "Authentication and security controls",
      guidance: "Ensure explicit error handling for unauthorized access. No secrets in logs or stack traces. Token expiry and refresh logic must be correct.",
      appliesTo: ["security", "correctness", "compliance"],
    });
  }

  // ── Java workflow step files — architecture annotations ───────────────────
  const hasJavaSteps = paths.some(
    (p) => p.endsWith(".java") && (p.includes("step") || p.includes("workflow") || p.includes("service") || p.includes("processor"))
  );
  if (hasJavaSteps) {
    refs.push({
      source: "architecture-playbook",
      title: "Workflow step required annotations",
      guidance:
        "Each workflow step MUST have: @Timed(value='ServiceName.StepName.latency', percentiles=true, recordFailures=true, tags={'step=StepName'}), @Counter(name='ServiceName.StepName.executions', recordOnSuccess=true, recordOnException=true), @ErrorCounter(type, code, source, target, step). " +
        "Required methods: validateInputCardinality(int expectedCount), validateOutputCardinality(int expectedCount). " +
        "handle() method must null-check ProcessingContext.",
      appliesTo: ["compliance", "observability", "correctness"],
    });
  }

  // ── Java code quality rules ────────────────────────────────────────────────
  if (paths.some((p) => p.endsWith(".java"))) {
    refs.push({
      source: "review-playbook",
      title: "Java code quality standards",
      guidance:
        "Max method length: 50 lines. Max class length: 500 lines. Javadoc required on public methods. " +
        "No excessive commented-out code. Proper error handling with meaningful messages. " +
        "Logging must be present at key decision points (INFO level for normal flow, ERROR for failures).",
      appliesTo: ["maintainability", "correctness", "observability"],
    });
    refs.push({
      source: "spring-framework",
      title: "Spring/Jackson input validation context",
      guidance:
        "Spring Boot with Jackson provides type-level input sanitisation at the API boundary: " +
        "if a DTO field is declared as Long/Integer/Short, Jackson will reject any non-numeric JSON value with a 400 before the mapper runs. " +
        "@Pattern, @NotNull, @Size and other javax/jakarta validation annotations on DTO fields are enforced by Spring's @Valid before business logic is reached. " +
        "When assessing a security or parsing finding, check whether the DTO field type and validation annotations already prevent the attack vector. " +
        "If a DTO field is typed Long and the mapper calls Long.parseLong(dto.getField()), that is a code-smell (unnecessary conversion) but NOT a runtime security risk because Jackson has already guaranteed a valid Long. " +
        "Downgrade severity accordingly: type-safe DTO fields with Bean Validation should be rated low/info rather than high.",
      appliesTo: ["security", "correctness", "reliability"],
    });
    refs.push({
      source: "spring-framework",
      title: "JDBC/JPA SQL injection context",
      guidance:
        "Spring Data JPA and Spring JDBC prevent SQL injection by design when used correctly. " +
        "JPQL/HQL queries with :namedParams or positional ?1 parameters are parameterized — user input is never interpolated into the query string. " +
        "Spring JDBC JdbcTemplate with '?' placeholders uses PreparedStatement under the hood — these are NOT vulnerable to SQL injection. " +
        "SQL injection is only a real risk when string concatenation is used to build a query: e.g. 'SELECT ... WHERE id = ' + userInput. " +
        "If the code uses JpaRepository, @Query with :param bindings, JdbcTemplate with '?' args, or Criteria API, these are safe by design. " +
        "Do NOT flag parameterized queries as SQL injection vulnerabilities — this is a false positive. " +
        "Only flag when raw string concatenation of untrusted input into a query is observed.",
      appliesTo: ["security", "correctness"],
    });
  }

  // ── Schema / mapper files ─────────────────────────────────────────────────
  if (paths.some((p) => p.includes("mapper") || p.includes("canonical") || p.includes("tde") || p.includes("schema") || p.includes("avro"))) {
    refs.push({
      source: "architecture-playbook",
      title: "Schema mapping conventions",
      guidance:
        "TDE→Canonical mappings handle input format from external systems. Canonical→TDE handles output for downstream processing. " +
        "Auto-generated mapper files (9 total) must be regenerated via `gradlew generateMapperFactorySources`. " +
        "Do not manually edit auto-generated files.",
      appliesTo: ["api-contract", "correctness", "maintainability"],
    });
  }

  // ── Message flow YAML files ───────────────────────────────────────────────
  if (paths.some((p) => p.endsWith(".yml") || p.endsWith(".yaml"))) {
    refs.push({
      source: "architecture-playbook",
      title: "Message flow YAML required fields",
      guidance:
        "YAML message flow config must include: steps, type, input, output. " +
        "Valid step types: TDEToCanonicalMappingStep, CanonicalToTDEMappingStep, MessagePublishStep, ValidationStep, AttributeExtractionStep, PersistenceStep.",
      appliesTo: ["correctness", "api-contract", "compliance"],
    });
  }

  // ── API / route / controller files ────────────────────────────────────────
  if (paths.some((p) => p.includes("route") || p.includes("controller") || p.includes("api") || p.includes("openapi"))) {
    refs.push({
      source: "review-playbook",
      title: "API contract consistency",
      guidance: "Ensure request/response fields remain backward compatible, status codes are intentional, and error payloads are stable.",
      appliesTo: ["api-contract", "correctness", "reliability"],
    });
  }

  // ── Database / migration files ────────────────────────────────────────────
  if (paths.some((p) => p.includes("migration") || p.includes("sql") || p.includes("db") || p.includes("liquibase") || p.includes("flyway"))) {
    refs.push({
      source: "review-playbook",
      title: "Database and migration safety",
      guidance: "Check rollback strategy, idempotency of migration scripts, data backfill impact, and lock/contention risks.",
      appliesTo: ["reliability", "performance", "maintainability"],
    });
  }

  // ── Frontend files ────────────────────────────────────────────────────────
  if (paths.some((p) => p.includes("frontend") || p.endsWith(".tsx") || p.endsWith(".jsx") || p.endsWith(".css"))) {
    refs.push({
      source: "review-playbook",
      title: "Frontend behavior and accessibility",
      guidance: "Verify loading/error/empty states, keyboard accessibility, and that UI text or workflows match story acceptance criteria.",
      appliesTo: ["correctness", "business-domain", "maintainability"],
    });
  }

  // ── Test coverage (banking-be threshold = 80%) ────────────────────────────
  const hasCode = paths.some((p) => !p.includes("test") && (
    p.endsWith(".java") || p.endsWith(".c") || p.endsWith(".cc") || p.endsWith(".cpp") || p.endsWith(".cxx") || p.endsWith(".h") || p.endsWith(".hh") || p.endsWith(".hpp") || p.endsWith(".hxx") ||
    p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".py")
  ));
  const hasTests = paths.some((p) => p.includes("test") || p.includes("spec"));
  if (hasCode && !hasTests) {
    refs.push({
      source: "banking-be/CONTRIBUTING.md",
      title: "Test coverage requirement (80% threshold)",
      guidance:
        "Test coverage must meet 80% threshold (banking-be policy). For bug fixes, at least one new test case must be added to prove the fix. " +
        "If tests are intentionally absent, PR description must explain the reason.",
      appliesTo: ["test-quality", "compliance"],
    });
  }

  // ── Vert.x migration pattern (monolith → microservices) ───────────────────
  if (paths.some((p) => p.endsWith(".java") && (p.includes("vertx") || p.includes("vert.x") || p.includes("verticle") || p.includes("router") || p.includes("handler")))) {
    refs.push({
      source: "architecture-playbook",
      title: "Vert.x migration — blocking I/O and event loop safety",
      guidance:
        "The architecture is migrating from Spring MVC (blocking) to Vert.x (non-blocking event loop). " +
        "CRITICAL: Never perform blocking I/O on the Vert.x event loop thread — this includes JDBC calls, Thread.sleep(), synchronized blocks, " +
        "blocking HTTP clients (RestTemplate, OkHttp sync), and file I/O without Vert.x async APIs. " +
        "Use executeBlocking() or worker verticles for unavoidable blocking operations. " +
        "If a Spring MVC controller still calls a CRUD/repository layer directly instead of going through the Vert.x REST client → CRUD service path, " +
        "flag it as an architectural violation — the migration requires MVC → REST component → Vert.x → CRUD Service. " +
        "Check that WebClient (Vert.x) is used instead of RestTemplate/WebClient (Spring) for outbound calls.",
      appliesTo: ["correctness", "performance", "reliability", "maintainability"],
    });
  }

  // ── Prometheus / PromQL — metrics cardinality and tenant isolation ─────────
  if (paths.some((p) => p.includes("metrics") || p.includes("prometheus") || p.includes("promql") || p.includes("meter") || p.includes("micrometer"))) {
    refs.push({
      source: "architecture-playbook",
      title: "Prometheus metrics — cardinality and tenant isolation",
      guidance:
        "High-cardinality labels (e.g., user IDs, request IDs, transaction IDs, session tokens) must NEVER be used as Prometheus label values — " +
        "each unique label combination creates a new time series, causing memory explosion and degraded query performance. " +
        "Labels should be bounded enums: tenant_id, network (Region8, MasterCard), channel (POS, ATM), status (authorized, declined), service_name. " +
        "Multi-tenant isolation: every PromQL query path MUST filter by tenant_id extracted from the JWT token. " +
        "Verify that tenant_id is propagated to the query enrichment layer and cannot be omitted or overridden by the caller. " +
        "Metric definitions loaded from config files must be validated at startup — reject definitions with unknown label keys or missing required filters. " +
        "Check that metric names follow the convention: <domain>_<entity>_<unit> (e.g., transactions_total_count, authorization_latency_seconds).",
      appliesTo: ["performance", "security", "reliability", "observability"],
    });
  }

  // ── Platform portability (Windows dev → Linux CIT) ────────────────────────
  if (paths.some((p) => p.endsWith(".java") || p.endsWith(".py") || p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".sh") || p.endsWith(".bat"))) {
    refs.push({
      source: "review-playbook",
      title: "Platform portability — Windows dev to Linux CIT",
      guidance:
        "Dev environment is Windows; CIT/production is Linux. Flag platform-specific code that will break cross-platform: " +
        "1) Hardcoded backslash path separators ('\\\\') — use Path.of() / Paths.get() or '/' which works on both. " +
        "2) Drive letters in paths (C:\\\\, D:\\\\). " +
        "3) OS-dependent line endings assumed (\\r\\n hard-coded instead of System.lineSeparator()). " +
        "4) Case-insensitive filename assumptions — Linux filesystems are case-sensitive. " +
        "5) Windows-only commands in scripts (e.g., 'dir' instead of 'ls', PowerShell-specific syntax). " +
        "6) File.separator or System.getProperty('os.name') checks that behave differently across platforms. " +
        "7) Hardcoded temp paths like 'C:\\\\Temp' instead of System.getProperty('java.io.tmpdir'). " +
        "If .bat files are added without a corresponding .sh equivalent, flag the gap.",
      appliesTo: ["reliability", "correctness", "maintainability"],
    });
  }

  // ── Definition of Done checklist ──────────────────────────────────────────
  refs.push({
    source: "banking-be/CONTRIBUTING.md",
    title: "Definition of Done — PR completeness",
    guidance:
      "PR must include: unit tests, necessary logs, OpenTelemetry/metrics added, PR description with all required sections " +
      "(Problem Statement, Approaches Considered, Pros and Cons, Reviewer Focus Areas, Test Instructions, Backward Compatibility). " +
      "Design docs and ADR compliance must be checked if architectural changes are included.",
    appliesTo: ["compliance", "observability", "maintainability"],
  });

  // ── Intentional refactor / stub-replacement detection ────────────────────
  refs.push({
    source: "review-playbook",
    title: "Intentional refactor and stub-replacement detection",
    guidance:
      "If a class or file is DELETED and a replacement with the same responsibility is ADDED in the same PR " +
      "(visible from the DELETED/ADDED list in the context), treat this as an intentional refactor — do NOT flag it as " +
      "'hidden bypass', 'missing class', or 'deleted functionality'. " +
      "Stub classes that always returned true/pass are frequently replaced by real implementations in refactor PRs; " +
      "flag the old stub only if the replacement does NOT exist in the PR. " +
      "Comments explaining what an attack vector looks like (e.g., 'prevents bypass-style attacks') are not themselves a bypass.",
    appliesTo: ["correctness", "security", "maintainability"],
  });

  return refs;
}

function serializeKnowledgeContext(refs: KnowledgeReference[]): string {
  if (refs.length === 0) return "None";
  return refs
    .map((r, i) => `${i + 1}. [${r.source}] ${r.title} :: ${r.guidance} (appliesTo: ${r.appliesTo.join(", ")})`)
    .join("\n");
}

function serializeContextBundle(contextBundle: ReviewContextBundle): string {
  if (contextBundle.files.length === 0) return "None";
  return contextBundle.files.map((file, index) => {
    const symbols = file.affectedSymbols.map((symbol) => `${symbol.type}:${symbol.name}${symbol.lineStart ? `@${symbol.lineStart}` : ""}`).join(", ") || "none";
    const prior = file.priorCallsContext && file.priorCallsContext.length > 0
      ? file.priorCallsContext.join("\n---\n")
      : "none";
    const nearby = file.nearbyContext.length > 0 ? file.nearbyContext.join("\n---\n") : "none";
    return `${index + 1}. ${file.file}\n  subsystem=${file.metadata.subsystem}; blastRadius=${file.metadata.blastRadius}; sensitivity=${file.metadata.sensitivity.join(",") || "none"}; highRisk=${file.metadata.highRiskCategories.join(",") || "none"}; generated=${file.metadata.generated}; infra=${file.metadata.infraConfig}\n  ownership=${file.ownership.join(", ") || "none"}\n  policyPacks=${file.selectedPolicyPacks.join(", ") || "none"}\n  precedents=${file.relevantPrecedentIds.join(", ") || "none"}\n  symbols=${symbols}\n  priorCallsContext (code that runs BEFORE the changed lines — check for existing guards/validation here):\n${prior}\n  nearbyContext:\n${nearby}`;
  }).join("\n\n");
}

function severityRank(s: Severity): number {
  return ({ critical: 5, error: 4, warning: 3, info: 1, suggestion: 1 } as Record<string, number>)[s] ?? 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function actionRank(a: Action): number {
  return ({ block: 5, "require-human-review": 4, warning: 3, suggestion: 2, informational: 1, "auto-approve": 0 } as Record<string, number>)[a] ?? 0;
}

function confidenceRank(c: Confidence): number {
  return ({ high: 3, medium: 2, low: 1 } as Record<string, number>)[c] ?? 0;
}

function stableFindingId(prefix: string, file: string, sequence: number): string {
  const token = pathBasename(file).replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "file";
  return `${prefix}-${token}-${sequence}`;
}

function normalizeFindingPath(raw: string, changedFiles: Set<string>): string {
  const cleaned = (raw || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!cleaned || cleaned === "unknown") return "unknown";
  if (changedFiles.has(cleaned)) return cleaned;

  // Allow model to emit short relative paths or repo-prefixed paths if they uniquely map.
  const shortPathSuffix = `/${cleaned}`;
  const repoPrefixedMatches = Array.from(changedFiles).filter((f) => cleaned === f || cleaned.endsWith(`/${f}`));
  if (repoPrefixedMatches.length === 1) return repoPrefixedMatches[0];

  const matches = Array.from(changedFiles).filter((f) => f === cleaned || f.endsWith(shortPathSuffix));
  if (matches.length === 1) return matches[0];

  // Basename-only fallback: handles cases where the model omits intermediate
  // directory segments (e.g. emits "trninquiry/Foo.java" but actual path is
  // "trninquiry/controller/Foo.java"). Safe only when the filename is unique.
  const basename = cleaned.split("/").pop() || "";
  if (basename) {
    const basenameMatches = Array.from(changedFiles).filter(
      (f) => f.split("/").pop() === basename,
    );
    if (basenameMatches.length === 1) return basenameMatches[0];
  }

  return cleaned;
}

export function enforceEvidenceGate(findings: Finding[], input: PRReviewInput): Finding[] {
  const changedFiles = new Set(input.files.map((f) => f.filename));

  return findings.map((finding) => {
    const normalizedFile = normalizeFindingPath(finding.file, changedFiles);
    const hasFile = normalizedFile !== "unknown";
    const hasLine = typeof finding.line === "number" && finding.line > 0;
    const hasEvidence = !!finding.evidence && finding.evidence.trim().length >= 8;
    const hasReasoning = finding.message.trim().length >= 20;
    const highImpact = finding.action === "block" || finding.severity === "critical" || finding.severity === "error";

    if (!highImpact) {
      return {
        ...finding,
        file: normalizedFile,
        reviewStatus: finding.reviewStatus || "actionable",
      };
    }

    // Maintainability/design findings are structural — they describe class-level
    // concerns where a precise line number is less meaningful than file + reasoning.
    const isDesignFinding = finding.dimension === "maintainability" &&
      ["class-bloat", "misplaced-inner-type", "god-class", "solid-violation"].includes(finding.category);
    if (highImpact && isDesignFinding) {
      if (!hasFile || !hasReasoning) {
        return {
          ...finding,
          file: normalizedFile,
          severity: "warning" as Severity,
          action: "warning" as Action,
          reviewStatus: "needs_more_context" as const,
          verificationNote: "Design finding: relaxed evidence gate applied.",
        };
      }
      return {
        ...finding,
        file: normalizedFile,
        reviewStatus: finding.reviewStatus || "actionable",
      };
    }

    // Evidence-first rule: severe findings without precise anchors are downgraded,
    // not posted as blockers.
    if (!hasFile || !hasLine || !hasEvidence || !hasReasoning) {
      const missing: string[] = [];
      if (!hasFile) missing.push("file");
      if (!hasLine) missing.push("line");
      if (!hasEvidence) missing.push("evidence");
      if (!hasReasoning) missing.push("root-cause detail");

      return {
        ...finding,
        file: normalizedFile,
        severity: "info",
        confidence: finding.confidence === "high" ? "medium" : finding.confidence,
        action: "informational",
        reviewStatus: "needs_more_context",
        verificationStatus: "downgraded",
        verificationNote: `Evidence gate: missing ${missing.join(", ")}.`,
        message: `Needs more context before blocking: ${finding.message}`,
      };
    }

    return {
      ...finding,
      file: normalizedFile,
      reviewStatus: finding.reviewStatus || "actionable",
    };
  });
}

function sortFindingsDeterministically(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const actionDelta = actionRank(b.action) - actionRank(a.action);
    if (actionDelta !== 0) return actionDelta;

    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;

    const confidenceDelta = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;

    const fileDelta = a.file.localeCompare(b.file);
    if (fileDelta !== 0) return fileDelta;

    const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
    const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
    if (lineA !== lineB) return lineA - lineB;

    return a.title.localeCompare(b.title);
  });
}

export function enforceFindingSchema(findings: Finding[], input: PRReviewInput): { findings: Finding[]; schemaAdjusted: number } {
  const changedFiles = new Set(input.files.map((f) => f.filename));
  const seenIds = new Set<string>();
  let schemaAdjusted = 0;

  const normalized = findings.map((raw, idx) => {
    let changed = false;
    const fallbackId = `F-${String(idx + 1).padStart(3, "0")}`;
    const next: Finding = { ...raw };

    const nextId = String(next.id || "").trim() || fallbackId;
    if (nextId !== next.id) changed = true;
    next.id = nextId;

    const normalizedFile = normalizeFindingPath(String(next.file || next.filePath || next.file_path || "unknown"), changedFiles);
    if (normalizedFile !== next.file) changed = true;
    next.file = normalizedFile;
    next.filePath = normalizedFile;
    next.file_path = normalizedFile;

    const rawLineStart = typeof next.line === "number"
      ? next.line
      : typeof next.lineStart === "number"
        ? next.lineStart
        : typeof next.line_start === "number"
          ? next.line_start
          : undefined;
    if (typeof rawLineStart === "number") {
      const line = Math.floor(rawLineStart);
      if (!Number.isFinite(line) || line <= 0) {
        next.line = undefined;
        changed = true;
      } else if (line !== rawLineStart) {
        next.line = line;
        changed = true;
      } else {
        next.line = line;
      }
    }
    next.lineStart = next.line;
    next.line_start = next.line;

    const rawLineEnd = typeof next.endLine === "number"
      ? next.endLine
      : typeof next.lineEnd === "number"
        ? next.lineEnd
        : typeof next.line_end === "number"
          ? next.line_end
          : undefined;
    if (typeof rawLineEnd === "number") {
      const endLine = Math.floor(rawLineEnd);
      if (!Number.isFinite(endLine) || endLine <= 0) {
        next.endLine = undefined;
        changed = true;
      } else if (endLine !== rawLineEnd) {
        next.endLine = endLine;
        changed = true;
      } else {
        next.endLine = endLine;
      }
    }
    next.lineEnd = next.endLine;
    next.line_end = next.endLine;

    const nextTitle = String(next.title || "").trim().slice(0, 180) || "Finding";
    if (nextTitle !== next.title) changed = true;
    next.title = nextTitle;

    const nextMessage = String(next.message || "").trim().slice(0, 3000) || "Review signal detected.";
    if (nextMessage !== next.message) changed = true;
    next.message = nextMessage;

    const nextWhyItMatters = String(next.whyItMatters || next.why_it_matters || next.message || "").trim().slice(0, 2000) || next.message;
    if (nextWhyItMatters !== next.whyItMatters || nextWhyItMatters !== next.why_it_matters) changed = true;
    next.whyItMatters = nextWhyItMatters;
    next.why_it_matters = nextWhyItMatters;

    const nextCategory = String(next.category || "general").trim().slice(0, 80) || "general";
    if (nextCategory !== next.category) changed = true;
    next.category = nextCategory;

    if (!VALID_SEVERITIES.includes(next.severity)) {
      next.severity = "info";
      changed = true;
    }
    if (!VALID_CONFIDENCES.includes(next.confidence)) {
      next.confidence = "medium";
      changed = true;
    }
    if (!VALID_DIMENSIONS.includes(next.dimension)) {
      next.dimension = "correctness";
      changed = true;
    }
    if (!VALID_ACTIONS.includes(next.action)) {
      next.action = "suggestion";
      changed = true;
    }

    if (next.reviewStatus !== "actionable" && next.reviewStatus !== "needs_more_context") {
      next.reviewStatus = "actionable";
      changed = true;
    }

    if (next.reviewStatus === "needs_more_context" && next.action === "block") {
      next.action = "informational";
      next.severity = "info";
      changed = true;
    }

    if ((next.severity === "info" || next.severity === "suggestion") && next.action === "block") {
      next.action = "require-human-review";
      changed = true;
    }

    const nextEvidence = next.evidence ? String(next.evidence).trim().slice(0, 2000) : undefined;
    if (nextEvidence !== next.evidence) changed = true;
    next.evidence = nextEvidence;

    const nextSuggestedFix = next.suggestedFix ? String(next.suggestedFix).trim().slice(0, 2000) : undefined;
    if (nextSuggestedFix !== next.suggestedFix) changed = true;
    next.suggestedFix = nextSuggestedFix;
    next.suggested_fix = nextSuggestedFix;

    const nextSuggestedTest = (next.testsToAddOrUpdate || next.tests_to_add_or_update || next.suggestedTest)
      ? String(next.testsToAddOrUpdate || next.tests_to_add_or_update || next.suggestedTest).trim().slice(0, 1200)
      : undefined;
    if (nextSuggestedTest !== next.suggestedTest || nextSuggestedTest !== next.testsToAddOrUpdate || nextSuggestedTest !== next.tests_to_add_or_update) changed = true;
    next.suggestedTest = nextSuggestedTest;
    next.testsToAddOrUpdate = nextSuggestedTest;
    next.tests_to_add_or_update = nextSuggestedTest;

    const nextExploitability = next.exploitabilityOrFailureMode || next.exploitability_or_failure_mode
      ? String(next.exploitabilityOrFailureMode || next.exploitability_or_failure_mode).trim().slice(0, 600)
      : undefined;
    if (nextExploitability !== next.exploitabilityOrFailureMode || nextExploitability !== next.exploitability_or_failure_mode) changed = true;
    next.exploitabilityOrFailureMode = nextExploitability;
    next.exploitability_or_failure_mode = nextExploitability;

    const nextBusinessImpact = next.businessImpact || next.business_impact
      ? String(next.businessImpact || next.business_impact).trim().slice(0, 600)
      : undefined;
    if (nextBusinessImpact !== next.businessImpact || nextBusinessImpact !== next.business_impact) changed = true;
    next.businessImpact = nextBusinessImpact;
    next.business_impact = nextBusinessImpact;

    const nextPolicyRefs = Array.isArray(next.relevantRuleOrPolicyRefs || next.relevant_rule_or_policy_refs)
      ? Array.from(new Set((next.relevantRuleOrPolicyRefs || next.relevant_rule_or_policy_refs || []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 8)
      : undefined;
    if (JSON.stringify(nextPolicyRefs) !== JSON.stringify(next.relevantRuleOrPolicyRefs) || JSON.stringify(nextPolicyRefs) !== JSON.stringify(next.relevant_rule_or_policy_refs)) changed = true;
    next.relevantRuleOrPolicyRefs = nextPolicyRefs;
    next.relevant_rule_or_policy_refs = nextPolicyRefs;

    const nextPrecedents = Array.isArray(next.relatedPrecedents || next.related_precedents)
      ? Array.from(new Set((next.relatedPrecedents || next.related_precedents || []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 5)
      : undefined;
    if (JSON.stringify(nextPrecedents) !== JSON.stringify(next.relatedPrecedents) || JSON.stringify(nextPrecedents) !== JSON.stringify(next.related_precedents)) changed = true;
    next.relatedPrecedents = nextPrecedents;
    next.related_precedents = nextPrecedents;

    const nextDuplicateOf = next.duplicateOf || next.duplicate_of ? String(next.duplicateOf || next.duplicate_of).trim().slice(0, 80) : undefined;
    if (nextDuplicateOf !== next.duplicateOf || nextDuplicateOf !== next.duplicate_of) changed = true;
    next.duplicateOf = nextDuplicateOf;
    next.duplicate_of = nextDuplicateOf;

    const nextNeedsHumanConfirmation = typeof next.needsHumanConfirmation === "boolean"
      ? next.needsHumanConfirmation
      : typeof next.needs_human_confirmation === "boolean"
        ? next.needs_human_confirmation
        : next.reviewStatus === "needs_more_context";
    if (nextNeedsHumanConfirmation !== next.needsHumanConfirmation || nextNeedsHumanConfirmation !== next.needs_human_confirmation) changed = true;
    next.needsHumanConfirmation = nextNeedsHumanConfirmation;
    next.needs_human_confirmation = nextNeedsHumanConfirmation;

    if (seenIds.has(next.id)) {
      next.id = `${next.id}-${idx + 1}`;
      changed = true;
    }
    seenIds.add(next.id);

    if (changed) schemaAdjusted += 1;
    return applyCompatibilityFields(next);
  });

  return { findings: normalized, schemaAdjusted };
}

// ─── AI: Classify Change Type & Risk ────────────────────────────────────────

async function aiClassifyAndRisk(
  input: PRReviewInput,
  diffCtx: string,
  knowledgeCtx: string,
  triage: PRTriage,
  contextBundle: ReviewContextBundle,
  precedentCtx: string,
): Promise<{ changeType: ChangeType; riskProfile: RiskProfile }> {
  const prNarrative = buildPRNarrative(input.prBody || "").slice(0, MAX_PR_NARRATIVE_CHARS);
  const prompt = `You are a senior code reviewer. Analyze this PR and classify it.

${diffCtx}

PR Narrative (author intent and rollout details):
${prNarrative || "None"}

Relevant review knowledge:
${knowledgeCtx}

Explicit triage metadata:
${JSON.stringify({ subsystem: triage.subsystem, sensitivity: triage.sensitivity, blastRadius: triage.blastRadius, highRiskCategories: triage.highRiskCategories }, null, 2)}

Targeted code context:
${serializeContextBundle(contextBundle).slice(0, 5000)}

Relevant historical precedents:
${precedentCtx}

Return JSON (no markdown):
{
  "changeType": "<one of: ${VALID_CHANGE_TYPES.join(", ")}>",
  "riskLabel": "<low|medium|high|critical>",
  "riskScore": <0-100>,
  "recommendation": "<one of: ${VALID_ACTIONS.join(", ")}>",
  "factors": [{ "factor": "string", "weight": <0-100>, "detail": "string" }]
}

Consider: size of change, sensitive files (security, auth, payment, DB migrations), test coverage, complexity, generated code, renamed or moved files, infra/config changes, and the explicit triage metadata above.`;

  const resp = await complete({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 800,
  });

  const parsed = parseJson<any>(resp.content, {});
  const changeType = VALID_CHANGE_TYPES.includes(parsed.changeType) ? parsed.changeType : "mixed";
  const riskLabel = (["low", "medium", "high", "critical"] as const).includes(parsed.riskLabel) ? parsed.riskLabel : "medium";
  const recommendation = VALID_ACTIONS.includes(parsed.recommendation) ? parsed.recommendation : "require-human-review";

  const factors: RiskFactor[] = Array.isArray(parsed.factors)
    ? parsed.factors.map((f: any) => ({
        factor: String(f.factor || "unknown"),
        weight: clamp(Number(f.weight) || 50, 0, 100),
        detail: String(f.detail || ""),
      }))
    : [];

  return {
    changeType,
    riskProfile: {
      overallScore: clamp(Number(parsed.riskScore) || 50, 0, 100),
      label: riskLabel,
      factors,
      changeType,
      recommendation,
    },
  };
}

// ─── AI: Analyze Findings (batched) ─────────────────────────────────────────

async function aiAnalyzeFindings(
  input: PRReviewInput,
  diffCtx: string,
  knowledgeCtx: string,
  triage: PRTriage,
  contextBundle: ReviewContextBundle,
  precedentCtx: string,
): Promise<{ findings: Finding[]; batchFailures: BatchFailure[] }> {
  // Two-track pipeline: only send code files to AI; config/data files are handled by heuristic layer
  const aiFiles = input.files.filter((f) => isAIEligibleFile(f.filename));
  const heuristicOnlyCount = input.files.length - aiFiles.length;
  if (heuristicOnlyCount > 0) {
    console.log(`[aiAnalyzeFindings] ${aiFiles.length} files → AI track, ${heuristicOnlyCount} files → heuristic-only track`);
  }

  const batches: PRFile[][] = [];
  for (let i = 0; i < aiFiles.length; i += BATCH_SIZE) {
    batches.push(aiFiles.slice(i, i + BATCH_SIZE));
  }

  if (batches.length === 0) {
    return { findings: [], batchFailures: [] };
  }

  const prNarrative = buildPRNarrative(input.prBody || "").slice(0, MAX_PR_NARRATIVE_CHARS);

  // Build a PR-level refactor map so the model understands intentional removals.
  const deletedFiles = input.files.filter((f) => f.status === "removed").map((f) => f.filename);
  const addedFiles = input.files.filter((f) => f.status === "added").map((f) => f.filename);
  const refactorCtx = deletedFiles.length > 0
    ? `\nPR-level structural changes (IMPORTANT — treat paired removals+additions as intentional refactors):\n` +
      `  DELETED: ${deletedFiles.join(", ")}\n` +
      `  ADDED:   ${addedFiles.join(", ")}\n` +
      `If a deleted file has a corresponding new file with overlapping purpose in the same PR, do NOT flag the removal as a risk or hidden bypass.\n`
    : "";

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      try {
      const patchCtx = buildFilePatchContext(batch);
      const prompt = `You are a world-class code reviewer. Analyze these file diffs and report findings.

Context:
${diffCtx}${refactorCtx}

PR Narrative (author intent and rollout details):
${prNarrative || "None"}

Relevant review knowledge:
${knowledgeCtx}

Explicit triage metadata:
${JSON.stringify({ subsystem: triage.subsystem, sensitivity: triage.sensitivity, blastRadius: triage.blastRadius, highRiskCategories: triage.highRiskCategories }, null, 2)}

Targeted code context:
${serializeContextBundle({ ...contextBundle, files: contextBundle.files.filter((file) => batch.some((candidate) => candidate.filename === file.file)) }).slice(0, 6000)}

Relevant historical precedents:
${precedentCtx}

Diffs to analyze:
${patchCtx}

For each issue found, return a JSON array of findings. Each finding:
{
  "file_path": "filename",
  "line_start": <number or null>,
  "line_end": <number or null>,
  "severity": "<${VALID_SEVERITIES.join("|")}>",
  "confidence": "<${VALID_CONFIDENCES.join("|")}>",
  "dimension": "<${VALID_DIMENSIONS.join("|")}>",
  "category": "short category label",
  "title": "one-line title",
  "exploitability_or_failure_mode": "short failure or exploit path",
  "business_impact": "business impact text",
  "evidence": "code snippet if relevant",
  "why_it_matters": "detailed explanation",
  "suggested_fix": "fix suggestion or null",
  "tests_to_add_or_update": "specific test suggestion or null",
  "relevant_rule_or_policy_refs": ["policy ref"],
  "related_precedents": ["PR-123"],
  "duplicate_of": "finding id or null",
  "needs_human_confirmation": <true|false>,
  "cweId": "CWE ID if security issue, else null",
  "action": "<${VALID_ACTIONS.join("|")}>"
}

Be thorough but avoid false positives. Focus on real issues: bugs, security vulnerabilities, performance problems, missing error handling, test gaps, API contract violations, logging gaps, and business logic errors.
Also flag design and maintainability violations:
- God class / bloated service: if a class has more than 5 private utility methods that could live in a separate helper class, flag as dimension="maintainability", severity="warning", category="class-bloat".
- Misplaced inner types: if records, enums, or inner classes are defined inside a service class but are not tightly coupled to that class's single responsibility, flag as dimension="maintainability", severity="warning", category="misplaced-inner-type".
- SOLID violations: Single Responsibility violations (class does caching + API calls + token parsing + fallback logic), Open/Closed violations, Dependency Inversion violations. Use dimension="maintainability", severity="warning", category="solid-violation".
- For maintainability findings, always provide the file_path, line_start pointing to the class declaration or first utility method, and include the method/type names in the evidence field.
- For security, correctness, reliability, performance, and API contract findings, line_start MUST point to the exact offending changed statement or expression when identifiable. Do not anchor these findings to the class declaration or hunk start.
Classification calibration rules:
- Findings about insufficient diagnostic detail in logs (for example: "not enough context to troubleshoot", "missing failure reason in warning/error logs") MUST use dimension="observability" and severity="suggestion" unless there is direct evidence of a real security exploit.
- Do not classify generic log-detail gaps as security issues unless logs leak secrets/PII/tokens or demonstrate an actual auth/security bypass.
If no issues are found, return an empty array [].
Return ONLY the JSON array, no markdown.`;

      const resp = await complete({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: 4000,
      });

      // Guard against empty AI content (provider disabled or empty response)
      if (!resp.content.trim()) {
        return { parsed: [] as any[], failed: true, error: "AI returned empty content" };
      }

      let parsed = parseJson<any[]>(resp.content, []);
      if (Array.isArray(parsed)) return { parsed, failed: false, error: "" };

      // Retry once with a strict JSON repair instruction when the model output is malformed.
      const repairPrompt = `Repair the following text into valid JSON ONLY.
Rules:
- Output must be a JSON array.
- If content cannot be repaired, output [].
- Do not add commentary.

Text to repair:
${resp.content}`;

      const repaired = await complete({
        messages: [{ role: "user", content: repairPrompt }],
        temperature: 0,
        maxTokens: 2500,
      });

      parsed = parseJson<any[]>(repaired.content, []);
      if (!Array.isArray(parsed)) return { parsed: [] as any[], failed: true, error: "JSON repair failed" };
      return { parsed, failed: false, error: "" };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown batch error";
      console.error(`[aiAnalyzeFindings] Batch failed:`, msg);
      return { parsed: [] as any[], failed: true, error: msg };
    }
    })
  );

  const batchFailures: BatchFailure[] = [];
  for (let batchIdx = 0; batchIdx < batchResults.length; batchIdx++) {
    const result = batchResults[batchIdx];
    if (result.failed) {
      batchFailures.push({ batchIndex: batchIdx, fileCount: batches[batchIdx].length, error: result.error });
      console.warn(`[aiAnalyzeFindings] Batch ${batchIdx} failed (${batches[batchIdx].length} files): ${result.error}`);
    }
  }

  let findingIdx = 0;
  const allFindings: Finding[] = [];
  for (const result of batchResults) {
    for (const f of result.parsed) {
      findingIdx++;
      allFindings.push({
        id: `F-${String(findingIdx).padStart(3, "0")}`,
        file: String(f.file_path || f.file || "unknown"),
        filePath: String(f.file_path || f.file || "unknown"),
        file_path: String(f.file_path || f.file || "unknown"),
        line: typeof f.line_start === "number" ? f.line_start : typeof f.line === "number" ? f.line : undefined,
        lineStart: typeof f.line_start === "number" ? f.line_start : typeof f.line === "number" ? f.line : undefined,
        line_start: typeof f.line_start === "number" ? f.line_start : typeof f.line === "number" ? f.line : undefined,
        endLine: typeof f.line_end === "number" ? f.line_end : typeof f.endLine === "number" ? f.endLine : undefined,
        lineEnd: typeof f.line_end === "number" ? f.line_end : typeof f.endLine === "number" ? f.endLine : undefined,
        line_end: typeof f.line_end === "number" ? f.line_end : typeof f.endLine === "number" ? f.endLine : undefined,
        severity: VALID_SEVERITIES.includes(f.severity) ? f.severity : "info",
        confidence: VALID_CONFIDENCES.includes(f.confidence) ? f.confidence : "medium",
        dimension: VALID_DIMENSIONS.includes(f.dimension) ? f.dimension : "correctness",
        category: String(f.category || "general"),
        title: String(f.title || "Finding"),
        message: String(f.why_it_matters || f.message || ""),
        whyItMatters: f.why_it_matters ? String(f.why_it_matters) : undefined,
        why_it_matters: f.why_it_matters ? String(f.why_it_matters) : undefined,
        evidence: f.evidence ? String(f.evidence) : undefined,
        suggestedFix: f.suggested_fix ? String(f.suggested_fix) : f.suggestedFix ? String(f.suggestedFix) : undefined,
        suggested_fix: f.suggested_fix ? String(f.suggested_fix) : f.suggestedFix ? String(f.suggestedFix) : undefined,
        suggestedTest: f.tests_to_add_or_update ? String(f.tests_to_add_or_update) : f.suggestedTest ? String(f.suggestedTest) : undefined,
        testsToAddOrUpdate: f.tests_to_add_or_update ? String(f.tests_to_add_or_update) : undefined,
        tests_to_add_or_update: f.tests_to_add_or_update ? String(f.tests_to_add_or_update) : undefined,
        exploitabilityOrFailureMode: f.exploitability_or_failure_mode ? String(f.exploitability_or_failure_mode) : undefined,
        exploitability_or_failure_mode: f.exploitability_or_failure_mode ? String(f.exploitability_or_failure_mode) : undefined,
        businessImpact: f.business_impact ? String(f.business_impact) : undefined,
        business_impact: f.business_impact ? String(f.business_impact) : undefined,
        relevantRuleOrPolicyRefs: Array.isArray(f.relevant_rule_or_policy_refs) ? f.relevant_rule_or_policy_refs.map(String) : undefined,
        relevant_rule_or_policy_refs: Array.isArray(f.relevant_rule_or_policy_refs) ? f.relevant_rule_or_policy_refs.map(String) : undefined,
        relatedPrecedents: Array.isArray(f.related_precedents) ? f.related_precedents.map(String) : undefined,
        related_precedents: Array.isArray(f.related_precedents) ? f.related_precedents.map(String) : undefined,
        duplicateOf: f.duplicate_of ? String(f.duplicate_of) : undefined,
        duplicate_of: f.duplicate_of ? String(f.duplicate_of) : undefined,
        needsHumanConfirmation: typeof f.needs_human_confirmation === "boolean" ? f.needs_human_confirmation : undefined,
        needs_human_confirmation: typeof f.needs_human_confirmation === "boolean" ? f.needs_human_confirmation : undefined,
        cweId: f.cweId ? String(f.cweId) : undefined,
        action: VALID_ACTIONS.includes(f.action) ? f.action : "suggestion",
      });
    }
  }

  return { findings: allFindings, batchFailures };
}

function buildVerificationContext(input: PRReviewInput, finding: Finding): string {
  const file = input.files.find((f) => f.filename === finding.file);
  const exceptionType = detectExceptionType(finding);
  const safeguards = detectSafeguardSignals(file);
  const lines: string[] = [];
  lines.push(`Candidate finding: ${finding.title}`);
  lines.push(`Severity: ${finding.severity}`);
  lines.push(`Confidence: ${finding.confidence}`);
  lines.push(`Dimension: ${finding.dimension}`);
  lines.push(`Category: ${finding.category}`);
  lines.push(`ExceptionType: ${exceptionType}`);
  if (finding.line) lines.push(`Line: ${finding.line}`);
  lines.push(`Message: ${finding.message}`);
  if (finding.evidence) lines.push(`Evidence: ${finding.evidence}`);
  if (finding.cweId) lines.push(`CWE: ${finding.cweId}`);
  if (safeguards.length > 0) lines.push(`SafeguardSignals: ${safeguards.join(" | ")}`);
  lines.push(`Changed files in PR: ${input.files.map((f) => f.filename).join(", ")}`);

  if (file?.patch) {
    const patch = file.patch.length > MAX_PATCH_CHARS
      ? file.patch.slice(0, MAX_PATCH_CHARS) + "\n... [truncated]"
      : file.patch;
    lines.push(`\nRelevant file diff (${file.filename}):\n${patch}`);
  }

  if (file?.fullContent) {
    const content = file.fullContent.length > 4000
      ? file.fullContent.slice(0, 4000) + "\n... [truncated]"
      : file.fullContent;
    lines.push(`\nRelevant file content (${file.filename}):\n${content}`);
  }

  return lines.join("\n");
}

function detectExceptionType(finding: Finding): string {
  const text = [finding.title, finding.message, finding.category, finding.evidence || "", finding.cweId || ""]
    .join(" ")
    .toLowerCase();

  if (text.includes("nullpointer") || text.includes("null pointer") || text.includes("npe") || text.includes("null dereference")) {
    return "null-pointer";
  }
  if (text.includes("numberformatexception") || text.includes("parse") || text.includes("long.parselong") || text.includes("integer.parseint")) {
    return "number-parse";
  }
  if (text.includes("indexoutofbounds") || text.includes("array index") || text.includes("out of bounds")) {
    return "bounds";
  }
  if (text.includes("arithmeticexception") || text.includes("divide by zero") || text.includes("/0")) {
    return "arithmetic";
  }
  if (text.includes("sql injection") || text.includes("cwe-89")) {
    return "sql-injection";
  }
  return "other";
}

function detectSafeguardSignals(file?: PRFile): string[] {
  if (!file) return [];
  const source = `${file.patch || ""}\n${file.fullContent || ""}`;
  const text = source.toLowerCase();
  const signals: string[] = [];

  if (
    text.includes("!= null") ||
    text.includes("== null") ||
    text.includes("objects.requirenonnull") ||
    text.includes("optional.ofnullable") ||
    text.includes("optional<")
  ) {
    signals.push("null-guard-present");
  }

  if (
    text.includes("@nonnull") ||
    text.includes("@notnull") ||
    text.includes("@valid") ||
    text.includes("@pattern") ||
    text.includes("@size")
  ) {
    signals.push("validation-annotation-present");
  }

  if (
    text.includes("catch (numberformatexception") ||
    text.includes("catch(numberformatexception") ||
    text.includes("try {")
  ) {
    signals.push("parse-exception-handled");
  }

  if (
    text.includes("jdbctemplate") && text.includes("?") ||
    text.includes("@query(") && text.includes(":") ||
    text.includes("preparedstatement")
  ) {
    signals.push("parameterized-sql-pattern");
  }

  return signals;
}

interface VerificationResult {
  findings: Finding[];
  dismissedCount: number;
  downgradedCount: number;
  skippedCount: number;
}

const VERIFICATION_TIMEOUT_MS = Number(process.env.VERIFICATION_TIMEOUT_MS || 45000);

async function aiVerifyHighImpactFindings(input: PRReviewInput, findings: Finding[], knowledgeCtx: string): Promise<VerificationResult> {
  const allHighImpact = findings.filter(
    (f) =>
      f.severity === "critical" ||
      f.severity === "error" ||
      f.severity === "warning" ||
      f.action === "block" ||
      f.confidence === "high",
  );
  const candidates = allHighImpact.slice(0, MAX_VERIFICATION_CANDIDATES);
  const skippedCount = Math.max(0, allHighImpact.length - MAX_VERIFICATION_CANDIDATES);

  if (candidates.length === 0) return { findings, dismissedCount: 0, downgradedCount: 0, skippedCount: 0 };

  const verified = new Map<string, Finding>();
  for (const finding of findings) {
    verified.set(finding.id, finding);
  }

  let dismissedCount = 0;
  let downgradedCount = 0;
  const verificationStart = Date.now();

  for (const candidate of candidates) {
    // Enforce timeout to prevent verification from blocking the entire review
    if (Date.now() - verificationStart > VERIFICATION_TIMEOUT_MS) {
      console.warn(`[aiVerifyHighImpactFindings] Timeout reached after ${Date.now() - verificationStart}ms, ${candidates.indexOf(candidate)} of ${candidates.length} candidates verified`);
      break;
    }

    const exceptionType = detectExceptionType(candidate);
    const file = input.files.find((f) => f.filename === candidate.file);
    const safeguards = detectSafeguardSignals(file);

    const prompt = `You are performing a second-pass verification on a potentially severe code review finding.

Relevant review knowledge:
${knowledgeCtx}

${buildVerificationContext(input, candidate)}

Task:
Double-check whether this finding is truly severe after considering framework protections, validation annotations, parameterized queries, error handling, and any safeguards visible in the provided diff/context.

Return JSON only:
{
  "status": "<confirmed|downgraded|dismissed>",
  "severity": "<critical|error|warning|info|suggestion>",
  "confidence": "<high|medium|low>",
  "action": "<block|require-human-review|warning|suggestion|informational|auto-approve>",
  "rationale": "short explanation",
  "message": "updated finding message",
  "suggestedFix": "updated fix or null"
}

Rules:
- Use dismissed if the issue is a false positive or already mitigated.
- Use downgraded if the concern is real but severity/action should be reduced.
- Keep confirmed only when the evidence still supports a severe finding.`;

    const exceptionAwareRules = `
Exception-aware rules:
- ExceptionType: ${exceptionType}
- SafeguardSignals: ${safeguards.join(" | ") || "none"}
- For null-pointer findings: if null checks/non-null annotations/validation guards already exist in nearby code path, do not keep as critical.
- For number-parse findings: if parse exceptions are handled or input is framework-validated/typed before parsing, downgrade or dismiss.
- For sql-injection findings: if query uses parameter binding (JpaRepository/@Query :params/JdbcTemplate '?' placeholders), dismiss as false positive.
`;

    let resp;
    try {
      resp = await complete({
        messages: [{ role: "user", content: `${prompt}\n${exceptionAwareRules}` }],
        temperature: 0.1,
        maxTokens: 700,
      });
    } catch (err) {
      console.warn(`[aiVerifyHighImpactFindings] Verification call failed for ${candidate.id}:`, err instanceof Error ? err.message : err);
      continue; // Keep finding as-is on verification failure
    }

    const parsed = parseJson<any>(resp.content, {});
    const current = verified.get(candidate.id);
    if (!current) continue;

    let status = ["confirmed", "downgraded", "dismissed"].includes(parsed.status) ? parsed.status : "confirmed";

    // Deterministic safety net: if clear safeguards exist, do not leave exception findings at critical/error.
    const hasNullSafeguards = safeguards.includes("null-guard-present") || safeguards.includes("validation-annotation-present");
    const hasParseSafeguards = safeguards.includes("parse-exception-handled") || safeguards.includes("validation-annotation-present");
    const hasSqlSafeguards = safeguards.includes("parameterized-sql-pattern");

    if (status === "confirmed") {
      if (exceptionType === "null-pointer" && hasNullSafeguards) status = "downgraded";
      if (exceptionType === "number-parse" && hasParseSafeguards) status = "downgraded";
      if (exceptionType === "sql-injection" && hasSqlSafeguards) status = "dismissed";
    }

    if (status === "dismissed") {
      verified.delete(candidate.id);
      dismissedCount++;
      continue;
    }

    if (status === "downgraded") {
      downgradedCount++;
    }

    const nextSeverity = VALID_SEVERITIES.includes(parsed.severity) ? parsed.severity : current.severity;
    const nextConfidence = VALID_CONFIDENCES.includes(parsed.confidence) ? parsed.confidence : current.confidence;
    const nextAction = VALID_ACTIONS.includes(parsed.action) ? parsed.action : current.action;

    verified.set(candidate.id, {
      ...current,
      severity: nextSeverity,
      confidence: nextConfidence,
      action: nextAction,
      message: parsed.message ? String(parsed.message) : current.message,
      suggestedFix: parsed.suggestedFix ? String(parsed.suggestedFix) : current.suggestedFix,
      verificationStatus: status,
      verificationNote: parsed.rationale ? String(parsed.rationale) : undefined,
    });
  }

  const verifiedFindings = findings
    .map((f) => verified.get(f.id))
    .filter((f): f is Finding => !!f);

  return { findings: verifiedFindings, dismissedCount, downgradedCount, skippedCount };
}

// ─── AI: Specs Alignment ────────────────────────────────────────────────────

async function aiCheckSpecsAlignment(input: PRReviewInput, diffCtx: string, knowledgeCtx: string): Promise<SpecAlignment[]> {
  if (!input.specs) return [];

  const patchCtx = buildFilePatchContext(input.files.slice(0, 15));
  const prNarrative = buildPRNarrative(input.prBody || "").slice(0, MAX_PR_NARRATIVE_CHARS);
  const prompt = `You are a senior code reviewer. Check whether the PR fulfills the given specs/acceptance criteria.

Context:
${diffCtx}

PR Narrative (author intent and rollout details):
${prNarrative || "None"}

Relevant review knowledge:
${knowledgeCtx}

Specs / Acceptance Criteria:
${input.specs.slice(0, 3000)}

Code changes (truncated):
${patchCtx.slice(0, 2000)}

For each spec item, return a JSON array:
{
  "spec": "the spec text",
  "status": "<met|partial|missing|not-applicable>",
  "evidence": "brief explanation of why status was chosen",
  "confidence": "<high|medium|low>"
}

Return ONLY the JSON array, no markdown.`;

  const resp = await complete({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    maxTokens: 2000,
  });

  const parsed = parseJson<any[]>(resp.content, []);
  if (!Array.isArray(parsed)) return [];

  return parsed.map((a) => ({
    spec: String(a.spec || ""),
    status: (["met", "partial", "missing", "not-applicable"] as const).includes(a.status) ? a.status : "missing",
    evidence: String(a.evidence || ""),
    confidence: VALID_CONFIDENCES.includes(a.confidence) ? a.confidence : "medium",
  }));
}

// ─── Scoring (arithmetic, not AI) ───────────────────────────────────────────

export function computeDimensionScore(dim: Dimension, findings: Finding[]): DimensionScore {
  const dimFindings = findings.filter((f) => f.dimension === dim);
  const blockers = dimFindings.filter((f) => f.action === "block").length;
  let score = 100;
  for (const f of dimFindings) {
    score -= severityRank(f.severity) * (f.confidence === "high" ? 3 : f.confidence === "medium" ? 2 : 1);
  }
  score = clamp(score, 0, 100);
  const label = score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : score >= 30 ? "poor" : "critical";
  const summary =
    dimFindings.length === 0
      ? `No issues found in ${dim}`
      : `${dimFindings.length} finding(s) — ${blockers} blocker(s)`;
  return { dimension: dim, score, label, findingCount: dimFindings.length, blockerCount: blockers, summary };
}

function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveDeterministicFindingsFromDiff(input: PRReviewInput): Finding[] {
  const deterministic: Finding[] = [];
  let sequence = 1;

  for (const file of input.files) {
    const patch = file.patch || "";
    if (!patch) continue;

    const hasHardcodedSetStatus = /setStatus\(OrderStatus\.[A-Z_]+\)/.test(patch);
    const hasDynamicSetStatus = /setStatus\(status\)/.test(patch);
    const touchesStatusUpdateFlow = /updateOrderStatus/.test(patch) || file.filename.toLowerCase().includes("orderservice");
    const hardcodedStatusTransition = hasHardcodedSetStatus && touchesStatusUpdateFlow;

    if (hardcodedStatusTransition) {
      deterministic.push({
        id: stableFindingId("D", file.filename, sequence++),
        file: file.filename,
        severity: "error",
        confidence: "high",
        dimension: "correctness",
        category: "Business Logic",
        title: "Hardcoded order status transition",
        message: "Detected replacement of dynamic status update with a hardcoded enum value. This can force incorrect workflow state transitions.",
        evidence: hasDynamicSetStatus
          ? "order.setStatus(OrderStatus.*) replacing order.setStatus(status)"
          : "order.setStatus(OrderStatus.*) detected in status update flow",
        suggestedFix: "Restore status update to use the method input parameter and validate allowed transitions.",
        action: "block",
        verificationStatus: "confirmed",
        verificationNote: "Deterministic rule: status transition was hardcoded in patch.",
      });
    }
  }

  return deterministic;
}

function deriveDeletedTestCoverageFindingsFromDiff(input: PRReviewInput, triage: PRTriage): Finding[] {
  const findings: Finding[] = [];
  let sequence = 1;

  const triagedTests = triage.files.filter((file) => file.changeKind === "removed" && isTestFilePath(file.file));
  if (triagedTests.length === 0) return findings;

  for (const removedTest of triagedTests) {
    const token = inferProductionTokenFromTest(removedTest.file);
    if (!token) continue;

    const tokenLower = token.toLowerCase();
    const moduleRoot = inferModuleRoot(removedTest.file);
    const productionTouches = triage.files.filter((file) => {
      if (isTestFilePath(file.file)) return false;
      const lower = file.file.toLowerCase();
      if (!lower.startsWith(moduleRoot)) return false;
      return pathBasename(lower).startsWith(tokenLower);
    });
    const replacementTests = triage.files.filter((file) => {
      if (file.changeKind === "removed" || !isTestFilePath(file.file)) return false;
      const lower = file.file.toLowerCase();
      if (!lower.startsWith(moduleRoot) || lower === removedTest.file.toLowerCase()) return false;
      return pathBasename(lower).includes(tokenLower);
    });

    const onlyProductionRemoved =
      productionTouches.length > 0 &&
      productionTouches.every((file) => file.changeKind === "removed");

    if (onlyProductionRemoved) {
      findings.push(applyCompatibilityFields({
        id: stableFindingId("T", removedTest.file, sequence++),
        file: removedTest.file,
        line: 1,
        endLine: 1,
        severity: "info",
        confidence: "high",
        dimension: "maintainability",
        category: "orphaned-test-cleanup",
        title: "Deleted test appears to be orphan cleanup",
        message:
          `Removed test ${pathBasename(removedTest.file)} appears to target production class '${token}' that is also removed in this PR. Treat as cleanup, not coverage regression.`,
        evidence: `Removed test file: ${removedTest.file}; removed production matches: ${productionTouches.map((file) => file.file).join(", ")}`,
        suggestedFix: "Include a short PR note confirming this is orphaned-test cleanup tied to removed production code.",
        action: "informational",
      }));
      continue;
    }

    if (replacementTests.length > 0) {
      findings.push(applyCompatibilityFields({
        id: stableFindingId("T", removedTest.file, sequence++),
        file: removedTest.file,
        line: 1,
        endLine: 1,
        severity: "suggestion",
        confidence: "high",
        dimension: "test-quality",
        category: "test-refactor",
        title: "Deleted test has likely replacement coverage",
        message:
          `Removed test ${pathBasename(removedTest.file)} has replacement test coverage in the same module.`,
        evidence: `Replacement tests: ${replacementTests.map((file) => file.file).join(", ")}`,
        suggestedFix: "Ensure replacement tests are functionally equivalent to removed scenarios.",
        action: "suggestion",
      }));
      continue;
    }

    if (productionTouches.length > 0) {
      findings.push(applyCompatibilityFields({
        id: stableFindingId("T", removedTest.file, sequence++),
        file: removedTest.file,
        line: 1,
        endLine: 1,
        severity: "warning",
        confidence: "high",
        dimension: "test-quality",
        category: "coverage-regression",
        title: "Deleted test without clear replacement coverage",
        message:
          `Removed test ${pathBasename(removedTest.file)} targets '${token}', and production files with that token still changed in this PR without replacement tests.`,
        evidence: `Removed test file: ${removedTest.file}; production touches: ${productionTouches.map((file) => file.file).join(", ")}`,
        suggestedFix: "Restore coverage or add replacement tests that validate the same behavior before merge.",
        suggestedTest: `Add/extend tests for '${token}' paths equivalent to deleted scenarios from ${pathBasename(removedTest.file)}.`,
        action: "warning",
      }));
      continue;
    }

    findings.push(applyCompatibilityFields({
      id: stableFindingId("T", removedTest.file, sequence++),
      file: removedTest.file,
      line: 1,
      endLine: 1,
      severity: "warning",
      confidence: "medium",
      dimension: "test-quality",
      category: "coverage-regression-unknown",
      title: "Deleted test requires orphan/coverage confirmation",
      message:
        `Removed test ${pathBasename(removedTest.file)} has no clear replacement in this PR. Confirm whether it is orphaned cleanup or an unintended coverage drop.`,
      evidence: `Removed test file: ${removedTest.file}; inferred production token: ${token}`,
      suggestedFix: "Document orphan-cleanup rationale in PR, or add replacement tests for equivalent behavior.",
      action: "warning",
      needsHumanConfirmation: true,
    }));
  }

  return findings;
}

function deriveArchitectureRiskFindingsFromDiff(input: PRReviewInput): Finding[] {
  const findings: Finding[] = [];
  let sequence = 1;

  for (const file of input.files) {
    const patch = file.patch || "";
    if (!patch) continue;

    const lowerPath = file.filename.toLowerCase();
    const isConfigLikeFile =
      lowerPath.includes("config") ||
      lowerPath.endsWith("configuration.java") ||
      lowerPath.endsWith("application.yml") ||
      lowerPath.endsWith("application.yaml") ||
      lowerPath.endsWith("application.properties");

    // Rule 1 (generic): replacing framework-default @Primary beans with manual
    // `new` construction can silently change app-wide behavior.
    const primaryBeanOverride = /@Primary/.test(patch) && /@Bean/.test(patch) && /\bnew\s+[A-Z][A-Za-z0-9_$.]*\s*\(/.test(patch);
    const riskyGlobalBeanType = patch.match(/\b(ObjectMapper|Validator|ConversionService|HttpMessageConverters?|RestTemplateBuilder|WebClient\.Builder|DataSource|TaskExecutor|Executor|CacheManager|MeterRegistry|SecurityFilterChain|PasswordEncoder|AuthenticationManager|PlatformTransactionManager)\b/);
    const beanType = riskyGlobalBeanType?.[1] || "framework bean";

    if (primaryBeanOverride && riskyGlobalBeanType) {
      const isObjectMapper = beanType === "ObjectMapper";
      findings.push({
        id: stableFindingId("A", file.filename, sequence++),
        file: file.filename,
        severity: isConfigLikeFile ? "critical" : "error",
        confidence: "high",
        dimension: "reliability",
        category: "Architecture Risk",
        title: "Primary framework bean replacement risk",
        message:
          `Detected @Primary ${beanType} manual construction via new ${beanType}(...). This can replace framework defaults and silently alter global behavior.`,
        evidence:
          `@Primary + @Bean + new ${beanType}(...) pattern detected in ${isConfigLikeFile ? "configuration" : "application"} code.`,
        suggestedFix:
          isObjectMapper
            ? "Use Jackson2ObjectMapperBuilderCustomizer (or customize existing mapper bean) to apply only delta behavior instead of replacing the global mapper."
            : "Prefer extending/customizing existing framework-managed bean construction instead of overriding with @Primary + new ... unless absolutely required.",
        suggestedTest:
          "Add integration tests that verify behavior parity for representative endpoints/flows before and after this bean change.",
        action: "block",
        verificationStatus: "confirmed",
        verificationNote: "Deterministic architecture rule: primary framework bean replacement pattern detected.",
      });
    }

    // Rule 2 (generic): fail-open defaults for unknown/missing config or policy keys.
    const touchesPolicyFlow =
      lowerPath.includes("validation") ||
      lowerPath.includes("security") ||
      lowerPath.includes("auth") ||
      lowerPath.includes("policy") ||
      isConfigLikeFile;
    const hasFailOpenPattern = /if\s*\([^)]*(unknown|missing|unconfigured|not\s+found|isEmpty\(\)|==\s*null)[^)]*\)\s*\{[\s\S]{0,260}return\s+(ValidationResult\.pass\s*\(\s*\)|true)\s*;/i.test(patch);

    if (touchesPolicyFlow && hasFailOpenPattern) {
      findings.push({
        id: stableFindingId("A", file.filename, sequence++),
        file: file.filename,
        severity: "error",
        confidence: "high",
        dimension: "security",
        category: "Policy Default",
        title: "Fail-open default on unknown/missing state",
        message:
          "Detected a fail-open return path for unknown/missing state or configuration. This can silently bypass intended controls.",
        evidence:
          "Pattern detected: unknown/missing guard branch returns pass/true.",
        suggestedFix:
          "Fail closed by default for unknown/missing inputs or configuration, or gate fail-open behavior behind an explicit compatibility flag limited to non-production usage.",
        suggestedTest:
          "Add unit tests proving unknown/missing keys cannot bypass policy checks in production mode.",
        action: "block",
        verificationStatus: "confirmed",
        verificationNote: "Deterministic architecture rule: fail-open default detected.",
      });
    }

    // Architecture-risk pass marker for config-like files. Keep strict when these patterns exist.
    if (isConfigLikeFile && (primaryBeanOverride || hasFailOpenPattern)) {
      continue;
    }
  }

  return findings;
}

export function deriveHeuristicFindingsFromDiff(input: PRReviewInput, triage: PRTriage, precedents: RankedHistoricalPrecedent[]): Finding[] {
  let findings: Finding[] = [];
  let sequence = 1;
  let addedTestGapFinding = false;

  for (const file of input.files) {
    const patch = file.patch || "";
    if (!patch) continue;
    const metadata = triage.files.find((candidate) => candidate.file === file.filename);
    if (!metadata) continue;

    const precedentIds = precedents
      .filter((precedent) => precedent.topPaths.some((path) => file.filename.toLowerCase().startsWith(path.toLowerCase())))
      .map((precedent) => precedent.precedentId)
      .slice(0, 3);
    const baseLine = extractChangedLineRanges(patch)[0]?.start;
    const baseFinding: Partial<Finding> = {
      file: file.filename,
      line: baseLine,
      endLine: baseLine,
      relatedPrecedents: precedentIds,
      relevantRuleOrPolicyRefs: metadata.infraConfig ? ["Database and migration safety", "Definition of Done — PR completeness"] : ["Definition of Done — PR completeness"],
    };

    const addFinding = (partial: Partial<Finding>) => {
      const title = partial.title || "Finding";
      findings.push(applyCompatibilityFields({
        id: stableFindingId("H", file.filename, sequence++),
        file: file.filename,
        severity: partial.severity || "warning",
        confidence: partial.confidence || "medium",
        dimension: partial.dimension || "correctness",
        category: partial.category || "heuristic",
        title,
        message: partial.message || title,
        whyItMatters: partial.whyItMatters || partial.message || title,
        evidence: partial.evidence,
        suggestedFix: partial.suggestedFix,
        testsToAddOrUpdate: partial.testsToAddOrUpdate,
        suggestedTest: partial.suggestedTest,
        exploitabilityOrFailureMode: partial.exploitabilityOrFailureMode,
        businessImpact: partial.businessImpact || calibrateBusinessImpact(partial.category || "heuristic", triage),
        relevantRuleOrPolicyRefs: partial.relevantRuleOrPolicyRefs || baseFinding.relevantRuleOrPolicyRefs,
        relatedPrecedents: partial.relatedPrecedents || precedentIds,
        duplicateOf: partial.duplicateOf,
        needsHumanConfirmation: partial.needsHumanConfirmation,
        action: partial.action || "warning",
        line: partial.line ?? baseFinding.line,
        endLine: partial.endLine ?? baseFinding.endLine,
      }));
    };

    if (!detectInfraConfigFile(file) && metadata.sensitivity.includes("money-movement") && /(double|float|math\.round|tofixed\(|parsefloat\(|new decimalformat)/i.test(patch)) {
      addFinding({
        severity: "error",
        confidence: "high",
        dimension: "business-domain",
        category: "decimal-precision",
        title: "Imprecise numeric handling in financial flow",
        message: "Detected floating-point or rounding APIs in a money-moving code path. Financial values should use exact decimal representations and explicit rounding policy.",
        evidence: "Diff includes double/float/Math.round/toFixed/parseFloat in a sensitive financial path.",
        suggestedFix: "Use exact decimal types and a documented rounding mode for monetary values.",
        testsToAddOrUpdate: "Add reconciliation and rounding-boundary tests for representative amounts.",
        exploitabilityOrFailureMode: "Precision drift can cause incorrect balances or reconciliation mismatches.",
        action: "block",
      });
    }

    if (!detectInfraConfigFile(file) && /(catch\s*\([^)]*\)\s*\{\s*[+\- ]?\s*(return\s+(true|false|null|success)|\}|pass\b))/is.test(patch)) {
      addFinding({
        severity: "error",
        confidence: "high",
        dimension: "reliability",
        category: "swallowed-errors",
        title: "Exception path appears to swallow failure",
        message: "Detected a catch block that returns a default success-like result, null, or no handling. This can create false-success behavior and hide production failures.",
        evidence: "Diff contains a catch block with an empty body or a default return value.",
        suggestedFix: "Log the failure, preserve the error signal, and return an explicit failure path.",
        testsToAddOrUpdate: "Add tests covering exception paths and verify the caller receives a failure outcome.",
        exploitabilityOrFailureMode: "Failures may be masked as success, causing duplicate processing or silent data corruption.",
        action: "block",
      });
    }

    if (!isTestFilePath(file.filename) && !detectInfraConfigFile(file) &&
      (metadata.sensitivity.includes("auth") || metadata.sensitivity.includes("money-movement") || metadata.sensitivity.includes("pii")) &&
      /(approve|transfer|refund|reset|unlock|authorize|process|delete|update)/i.test(patch) &&
      !/(audit|auditlog|log\.(info|warn|error)|logger\.|emitAudit|securityEvent|trackEvent)/i.test(patch)) {
      addFinding({
        severity: "warning",
        confidence: "medium",
        dimension: "observability",
        category: "missing-audit-log",
        title: "Privileged or financial action lacks visible audit signal",
        message: "The diff touches a sensitive action but does not show a matching audit or security event signal. Fintech-sensitive flows should leave a reviewable audit trail.",
        evidence: "Sensitive action keywords were added without a corresponding audit/log signal in the diff.",
        suggestedFix: "Emit an audit event or structured log that records the action, actor, and outcome without exposing secrets.",
        testsToAddOrUpdate: "Add tests proving sensitive actions emit an audit or security event.",
        exploitabilityOrFailureMode: "Missing auditability impairs investigations and compliance verification.",
      });
    }

    if (!isTestFilePath(file.filename) && !detectInfraConfigFile(file) && metadata.sensitivity.includes("migrations") && !/(rollback|down\b|revert|undo)/i.test(patch)) {
      addFinding({
        severity: "warning",
        confidence: "medium",
        dimension: "reliability",
        category: "rollback-difficulty",
        title: "Migration change lacks rollback evidence",
        message: "The migration diff does not show a rollback, down, revert, or compensating strategy. This raises production rollback risk.",
        evidence: "Migration-related file changed without rollback-oriented statements in the diff.",
        suggestedFix: "Document or add the rollback path and verify forward/backward compatibility.",
        testsToAddOrUpdate: "Add migration replay or rollback verification tests.",
      });
    }

    if (!detectInfraConfigFile(file) && /(skipAuth|bypass|allowAll|permitAll|disableAuth|ignoreAuth)/i.test(patch) && /(return\s+true|ValidationResult\.pass\(|authorized\s*=\s*true)/i.test(patch)) {
      addFinding({
        severity: "critical",
        confidence: "high",
        dimension: "security",
        category: "hidden-bypass",
        title: "Bypass path may weaken a control",
        message: "Detected bypass-style logic paired with an allow/pass outcome. Hidden bypass paths are high risk in auth and policy-sensitive flows.",
        evidence: "Diff includes bypass/skipAuth-style logic and an allow/pass return path.",
        suggestedFix: "Remove the bypass or gate it behind a tightly scoped non-production compatibility switch with explicit audit logging.",
        testsToAddOrUpdate: "Add tests proving unauthorized or malformed inputs cannot use the bypass path.",
        exploitabilityOrFailureMode: "Could permit unauthorized actions or disable a control silently.",
        action: "block",
      });
    }

    if (!addedTestGapFinding && !detectInfraConfigFile(file) && !file.filename.toLowerCase().includes("test") && metadata.blastRadius !== "low" && triage.highRiskCategories.length > 0 && !input.files.some((candidate) => /test|spec/i.test(candidate.filename))) {
      addFinding({
        severity: "warning",
        confidence: "high",
        dimension: "test-quality",
        category: "test-gap",
        title: "High-risk change without corresponding tests",
        message: "The PR contains sensitive or broad-impact changes but does not include tests in the changed file set.",
        evidence: `High-risk categories: ${triage.highRiskCategories.join(", ")}; blastRadius=${triage.blastRadius}.`,
        suggestedFix: "Add focused tests for the sensitive path before merge.",
        testsToAddOrUpdate: "Add regression coverage for the changed high-risk path.",
      });
      addedTestGapFinding = true;
    }

    if (file.filename.endsWith(".java") || file.filename.endsWith(".groovy")) {
      const nullChainAccessPattern = /\b\w+\.get\s*\([^)]*\)\s*\.(trim|toLowerCase|toUpperCase)\s*\(/i;
      const nullableCollectionSizePattern = /\b\w+\.get(?:Parameters|Items|Values|Entries|List|Collection)?\s*\([^)]*\)\s*\.size\s*\(\s*\)/i;
      const explicitNullGuardPattern = /(?:!=\s*null|==\s*null|objects\.requirenonnull\(|optional\.ofnullable\(|if\s*\(\s*\w+\s*\))/i;
      const hasPotentialNullChain = nullChainAccessPattern.test(patch) || nullableCollectionSizePattern.test(patch);
      const hasExplicitNullGuard = explicitNullGuardPattern.test(patch);

      if (hasPotentialNullChain && !hasExplicitNullGuard) {
        addFinding({
          severity: "warning",
          confidence: "medium",
          dimension: "correctness",
          category: "java-null-chain-risk",
          title: "Possible null-pointer chain in Java access path",
          message: "Detected a chained dereference (for example map.get(...).trim() or collection.size()) without a nearby explicit null guard in the diff.",
          evidence: "Diff contains chained Java access on values that may be nullable.",
          suggestedFix: "Add an explicit null contract (Objects.requireNonNull) or guard before dereference, and keep boundary validation assumptions documented.",
          exploitabilityOrFailureMode: "Can throw NullPointerException in alternate call paths where boundary assumptions do not hold.",
        });
      }

      if (/(objectinputstream|readobject\s*\(|yaml\.load\(|xmldecoder)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "java-deserialization", title: "Unsafe deserialization pattern", message: "Detected Java/Groovy deserialization APIs that frequently create remote code execution or type confusion risk when fed untrusted input.", evidence: "Diff contains ObjectInputStream/readObject/YAML.load/XMLDecoder.", suggestedFix: "Use a safe parser/allowlist or avoid native deserialization for untrusted input.", exploitabilityOrFailureMode: "Untrusted payloads may trigger gadget execution or unsafe object construction.", action: "block", line: findExactAddedLine(patch, [/objectinputstream/i, /readobject\s*\(/i, /yaml\.load\(/i, /xmldecoder/i]) });
      }
      if (/(class\.forname\(|method\.invoke\(|field\.setaccessible\(true\)|constructor\.setaccessible\(true\))/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "java-reflection", title: "Reflection use needs strict input control", message: "Detected reflection or accessibility override APIs. In sensitive paths this can widen attack surface and bypass encapsulation assumptions.", evidence: "Diff contains Class.forName/Method.invoke/setAccessible(true).", suggestedFix: "Constrain reflection targets to explicit allowlists and keep reflective code out of untrusted input paths.", exploitabilityOrFailureMode: "Dynamic dispatch may execute unintended code paths.", line: findExactAddedLine(patch, [/class\.forname\(/i, /method\.invoke\(/i, /field\.setaccessible\(true\)/i, /constructor\.setaccessible\(true\)/i]), });
      }
      if (/(createquery\s*\(\s*"[^"]*\+|@query\s*\(\s*"[^"]*\+|createsqlquery\s*\(\s*"[^"]*\+)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "orm-query-injection", title: "String-built ORM query in diff", message: "Detected query construction through string concatenation. This bypasses the parameterized-query safeguards already accounted for elsewhere.", evidence: "Diff contains concatenated JPQL/HQL/SQL query construction.", suggestedFix: "Use named or positional parameters instead of concatenation.", exploitabilityOrFailureMode: "Untrusted input may alter query semantics.", action: "block", line: findExactAddedLine(patch, [/createquery\s*\(\s*"[^"]*\+/i, /@query\s*\(\s*"[^"]*\+/i, /createsqlquery\s*\(\s*"[^"]*\+/i]) });
      }
      if (/@transactional\s*\([^)]*readonly\s*=\s*true[^)]*\)/i.test(patch) && /(save\(|update\(|delete\(|insert\()/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "correctness", category: "transaction-boundary", title: "Read-only transaction appears to perform writes", message: "Detected a readOnly transactional annotation alongside write operations in the diff.", evidence: "Diff contains @Transactional(readOnly=true) with save/update/delete/insert usage.", suggestedFix: "Split read and write paths or remove the readOnly flag for the write transaction.", exploitabilityOrFailureMode: "Writes may not be flushed or may behave inconsistently under transaction management.", });
      }
      if (/(messagedigest\.getinstance\(\s*"(?:md5|sha-?1)"|cipher\.getinstance\(\s*"(?:des|aes\/ecb))/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "crypto-misuse", title: "Weak cryptographic primitive or mode", message: "Detected a weak digest or cipher mode in the diff.", evidence: "Diff contains MD5/SHA1/DES/AES-ECB usage.", suggestedFix: "Use modern approved primitives and authenticated modes.", exploitabilityOrFailureMode: "Weak crypto can undermine confidentiality or integrity guarantees.", action: "block", line: findExactAddedLine(patch, [/messagedigest\.getinstance\(\s*"(?:md5|sha-?1)"/i, /cipher\.getinstance\(\s*"(?:des|aes\/ecb)/i]) });
      }
    }

    if (file.filename.endsWith(".py")) {
      if (/(pickle\.loads\(|yaml\.load\(|marshal\.loads\()/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "python-deserialization", title: "Unsafe Python object loading", message: "Detected Python deserialization APIs that are unsafe for untrusted input.", evidence: "Diff contains pickle.loads/yaml.load/marshal.loads.", suggestedFix: "Use safe loaders or validated structured formats.", exploitabilityOrFailureMode: "Untrusted payloads can execute code or construct unsafe objects.", action: "block" });
      }
      if (/(subprocess\.(run|popen|call)\([^\)]*shell\s*=\s*true|os\.system\()/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "python-subprocess", title: "Shell-enabled subprocess usage", message: "Detected shell-enabled command execution in Python.", evidence: "Diff contains subprocess(..., shell=True) or os.system().", suggestedFix: "Pass argument arrays without shell=True and validate inputs.", exploitabilityOrFailureMode: "Command injection may be possible if inputs are attacker-controlled.", action: "block" });
      }
      if (/(tempfile\.mktemp\(|requests\.(get|post)\([^\)]*(url|target|endpoint)|urllib\.request\.(urlopen|Request)\()/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "python-unsafe-io", title: "Python I/O path needs stricter validation", message: "Detected temporary-file or outbound-request patterns that need explicit safety checks for SSRF/path races.", evidence: "Diff contains tempfile.mktemp or direct outbound request construction.", suggestedFix: "Use secure temp-file APIs and validate/allowlist outbound destinations.", exploitabilityOrFailureMode: "Can enable SSRF, temp-file races, or unsafe file targeting.", });
      }
    }

    if (file.filename.endsWith(".ts") || file.filename.endsWith(".tsx") || file.filename.endsWith(".js") || file.filename.endsWith(".jsx")) {
      if (/(child_process\.(exec|execsync|spawn)\(|require\(['"]child_process['"]\))/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "js-child-process", title: "Runtime command execution added", message: "Detected child_process usage in JavaScript/TypeScript. This requires strict validation and usually should not be exposed to request input paths.", evidence: "Diff contains child_process exec/spawn usage.", suggestedFix: "Avoid shell execution or constrain inputs with fixed argument lists.", exploitabilityOrFailureMode: "Can enable command injection or operational instability.", action: "block" });
      }
      if (/(lodash\.merge\(|\.merge\(|Object\.setPrototypeOf\(|__proto__)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "prototype-pollution", title: "Potential prototype pollution sink", message: "Detected object merge or prototype mutation patterns that are risky with untrusted input.", evidence: "Diff contains deep merge or prototype mutation constructs.", suggestedFix: "Use safe object copying and validate input object keys.", exploitabilityOrFailureMode: "Unexpected prototype mutation can alter downstream behavior.", });
      }
      if (/(innerhtml\s*=|dangerouslysetinnerhtml|res\.send\(.*<|template\.compile\()/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "xss-template", title: "Template or HTML injection sink", message: "Detected an HTML rendering sink that needs explicit encoding or sanitization.", evidence: "Diff contains innerHTML/dangerouslySetInnerHTML or direct HTML response construction.", suggestedFix: "Encode untrusted content or use a safe templating API.", exploitabilityOrFailureMode: "Untrusted content may execute in the client context.", });
      }
    }

    if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file.filename)) {
      if (/(strcpy\(|strcat\(|sprintf\(|vsprintf\(|gets\()/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "c-unsafe-buffer", title: "Unsafe C/C++ buffer API", message: "Detected legacy buffer APIs that commonly lead to memory safety issues.", evidence: "Diff contains strcpy/strcat/sprintf/gets-family usage.", suggestedFix: "Use bounded APIs and explicit length validation.", exploitabilityOrFailureMode: "Can cause memory corruption, overflow, or code execution.", action: "block" });
      }
      if (/(printf\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)|fprintf\s*\([^,]+,\s*[A-Za-z_][A-Za-z0-9_]*\s*\))/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "format-string", title: "Unbounded format string sink", message: "Detected printf-style usage where the format string may be variable.", evidence: "Diff contains printf/fprintf with a non-literal format position.", suggestedFix: "Use literal format strings and pass user data as arguments.", exploitabilityOrFailureMode: "Can expose memory or corrupt process state.", });
      }
    }

    if (file.filename.endsWith(".groovy")) {
      if (/(evaluate\(|groovyshell\(|parseclass\(|metaclass\.|invokemethod\(|execute\(\))/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "groovy-dynamic-exec", title: "Dynamic Groovy execution primitive", message: "Detected Groovy dynamic execution or metaprogramming constructs that are unsafe when influenced by external input.", evidence: "Diff contains evaluate/GroovyShell/parseClass/metaclass/invokeMethod/execute usage.", suggestedFix: "Replace dynamic execution with explicit allowlisted behavior.", exploitabilityOrFailureMode: "Can lead to script injection or sandbox escape.", action: "block" });
      }
    }

    // ── Expanded OWASP deterministic rules (cross-language & Java extras) ──

    // SSRF — Java URL/HttpURLConnection/RestTemplate/WebClient with variable URL
    if ((file.filename.endsWith(".java") || file.filename.endsWith(".groovy")) && !isTestFilePath(file.filename)) {
      if (/(new\s+URL\s*\(|HttpURLConnection|restTemplate\.(get|post|put|delete|exchange)\(|webClient\.(get|post|put|delete)\(\)|CloseableHttpClient|HttpClients)/i.test(patch) &&
        !/(?:allowlist|whitelist|validat(?:e|ed|ion)|sanitiz(?:e|ed)|ALLOWED_HOSTS)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "ssrf-risk", title: "Outbound request target may be user-influenced", message: "Detected HTTP client construction that may accept user-controlled URLs without explicit destination validation.", evidence: "Diff contains URL/HttpURLConnection/RestTemplate/WebClient usage without visible allowlist.", suggestedFix: "Validate outbound URLs against an explicit allowlist of permitted hosts and schemes.", exploitabilityOrFailureMode: "SSRF can expose internal services, cloud metadata, or bypass network controls.", line: findExactAddedLine(patch, [/new\s+URL\s*\(/i, /restTemplate\./i, /webClient\./i, /HttpClients/i]) });
      }

      // Path traversal — File/Paths with user input
      if (/(new\s+File\s*\(|Paths\.get\s*\(|Files\.(read|write|copy|move|delete|createFile|createDir))/i.test(patch) &&
        /(request\.|param\.|getParameter\(|@RequestParam|@PathVariable|userInput|fileName|filePath)/i.test(patch) &&
        !/(?:normalize|canonical|realpath|allowedDir|validatePath)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "medium", dimension: "security", category: "path-traversal", title: "File path constructed from request input", message: "Detected file system operations using values that may be derived from user input without path normalization.", evidence: "Diff contains File/Paths construction with request parameter references.", suggestedFix: "Normalize paths with Path.normalize(), resolve canonically, and validate against a base directory.", exploitabilityOrFailureMode: "Path traversal can read/write arbitrary files on the server.", action: "block", line: findExactAddedLine(patch, [/new\s+File\s*\(/i, /Paths\.get\s*\(/i]) });
      }

      // XXE — XML parsing without disabling external entities
      if (/(DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory|XMLReader)/i.test(patch) &&
        !/(?:FEATURE_SECURE_PROCESSING|DISALLOW_DOCTYPE_DECL|EXTERNAL_GENERAL_ENTITIES|setExpandEntityReferences\s*\(\s*false)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "xxe", title: "XML parser configured without entity restrictions", message: "Detected XML parser factory creation without visible security feature configuration to prevent XXE attacks.", evidence: "Diff contains XML parser factory without DISALLOW_DOCTYPE_DECL or EXTERNAL_GENERAL_ENTITIES feature.", suggestedFix: "Disable external entity processing: factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true) and DISALLOW_DOCTYPE_DECL.", exploitabilityOrFailureMode: "XXE can read local files, perform SSRF, or cause denial of service.", action: "block", line: findExactAddedLine(patch, [/DocumentBuilderFactory/i, /SAXParserFactory/i, /XMLInputFactory/i]) });
      }

      // Zip slip — ZipEntry name used in file path
      if (/(ZipEntry|ZipInputStream|JarEntry)/i.test(patch) && /(getName\(\)|getEntry\()/i.test(patch) &&
        !/(?:normalize|canonical|startsWith\(|validatePath|stripPath)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "zip-slip", title: "Zip entry path not validated against traversal", message: "Detected zip/jar entry extraction without path normalization. Malicious archives can use ../../ entries to overwrite arbitrary files.", evidence: "Diff contains ZipEntry.getName() used in file operations without path validation.", suggestedFix: "Resolve the entry path canonically and verify it starts with the intended output directory.", exploitabilityOrFailureMode: "Zip slip can overwrite configuration files, scripts, or libraries.", action: "block", line: findExactAddedLine(patch, [/ZipEntry/i, /ZipInputStream/i]) });
      }

      // Open redirect
      if (/(sendRedirect\(|response\.setHeader\s*\(\s*"Location"|HttpServletResponse.*redirect|RedirectView)/i.test(patch) &&
        /(request\.|param\.|getParameter\(|@RequestParam|returnUrl|redirectUrl|targetUrl|nextUrl)/i.test(patch) &&
        !/(?:allowlist|whitelist|validat(?:e|ed|ion)|startsWith\(|isSafeUrl)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "open-redirect", title: "Redirect target may be user-controlled", message: "Detected HTTP redirect using values that may come from user input without validation.", evidence: "Diff contains redirect with request-derived target URL.", suggestedFix: "Validate redirect targets against an allowlist or restrict to relative paths.", exploitabilityOrFailureMode: "Open redirects enable phishing and OAuth token theft.", line: findExactAddedLine(patch, [/sendRedirect\(/i, /RedirectView/i]) });
      }

      // Weak RNG
      if (/new\s+Random\s*\(/i.test(patch) && !/(test|mock|sample|demo)/i.test(file.filename) &&
        /(token|session|key|nonce|salt|otp|password|secret|csrf|uuid)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "weak-rng", title: "java.util.Random used in security-sensitive context", message: "Detected java.util.Random (predictable) in a context suggesting security use (tokens, keys, nonces).", evidence: "Diff contains new Random() near security-related variable names.", suggestedFix: "Use java.security.SecureRandom for security-sensitive random values.", exploitabilityOrFailureMode: "Predictable random values can be guessed by attackers.", line: findExactAddedLine(patch, [/new\s+Random\s*\(/i]) });
      }

      // Trust-all TLS
      if (/(TrustAllCerts|TrustAll|InsecureTrustManager|trustAllCertificates|ALLOW_ALL_HOSTNAME_VERIFIER|NoopHostnameVerifier|setHostnameVerifier\s*\(\s*\(?.*?\)?\s*=>\s*true|setSSLSocketFactory|sslContext.*trustAll)/i.test(patch)) {
        addFinding({ severity: "critical", confidence: "high", dimension: "security", category: "trust-all-tls", title: "TLS certificate validation bypassed", message: "Detected trust-all or insecure TLS configuration that disables certificate verification.", evidence: "Diff contains TrustAllCerts/InsecureTrustManager/ALLOW_ALL_HOSTNAME_VERIFIER pattern.", suggestedFix: "Use proper certificate validation. For dev environments, use a self-signed CA trust store instead of disabling verification.", exploitabilityOrFailureMode: "Disabling TLS verification enables man-in-the-middle attacks.", action: "block", line: findExactAddedLine(patch, [/TrustAll/i, /InsecureTrustManager/i, /ALLOW_ALL_HOSTNAME_VERIFIER/i, /NoopHostnameVerifier/i]) });
      }

      // Runtime.exec command injection
      if (/(Runtime\.getRuntime\(\)\.exec\(|ProcessBuilder\s*\()/i.test(patch) &&
        /(request\.|param\.|getParameter\(|@RequestParam|userInput|commandArg)/i.test(patch)) {
        addFinding({ severity: "critical", confidence: "high", dimension: "security", category: "command-injection", title: "OS command execution with request-derived input", message: "Detected Runtime.exec or ProcessBuilder using values that may come from user input.", evidence: "Diff contains command execution with request-derived arguments.", suggestedFix: "Avoid passing user input to command execution. Use fixed command lists with validated arguments.", exploitabilityOrFailureMode: "Command injection can give attackers full system access.", action: "block", line: findExactAddedLine(patch, [/Runtime\.getRuntime\(\)\.exec\(/i, /ProcessBuilder\s*\(/i]) });
      }

      // Missing connect/read timeout on HTTP clients
      if (/(HttpURLConnection|restTemplate|webClient|CloseableHttpClient|OkHttpClient|HttpClient\.newBuilder)/i.test(patch) &&
        !/(?:timeout|connectTimeout|readTimeout|soTimeout|setConnectTimeout|connectionRequestTimeout|responseTimeout)/i.test(patch)) {
        addFinding({ severity: "info", confidence: "medium", dimension: "reliability", category: "missing-timeout", title: "HTTP client without explicit timeout", message: "Detected HTTP client usage without visible timeout configuration. Missing timeouts can lead to thread exhaustion under network failures.", evidence: "Diff contains HTTP client without timeout settings.", suggestedFix: "Set explicit connect and read timeouts appropriate for the call pattern.", exploitabilityOrFailureMode: "Missing timeouts can cause thread pool exhaustion and cascade failures." });
      }

      // LDAP injection
      if (/(InitialDirContext|DirContext\.search\s*\(|LdapTemplate\.search\s*\()/i.test(patch) &&
        /(["']\s*\+\s*\w|request\.|param\.|getParameter\()/i.test(patch) &&
        !/(?:encode|escape|sanitiz|filter\.encode)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "medium", dimension: "security", category: "ldap-injection", title: "LDAP query built from external input", message: "Detected LDAP search or context creation with string concatenation that may include user input.", evidence: "Diff contains DirContext.search/InitialDirContext with concatenated filter.", suggestedFix: "Use parameterized LDAP filters or encode special characters before inclusion.", exploitabilityOrFailureMode: "LDAP injection can bypass authentication or extract directory data.", action: "block", line: findExactAddedLine(patch, [/InitialDirContext/i, /DirContext\.search\s*\(/i, /LdapTemplate\.search\s*\(/i]) });
      }

      // XPath injection
      if (/(XPathFactory|xpath\.evaluate\s*\(|xpath\.compile\s*\()/i.test(patch) &&
        /(["']\s*\+\s*\w|request\.|getParameter\()/i.test(patch)) {
        addFinding({ severity: "error", confidence: "medium", dimension: "security", category: "xpath-injection", title: "XPath expression built from external input", message: "Detected XPath evaluation with string concatenation from potential user input.", evidence: "Diff contains XPathFactory/xpath.evaluate with concatenated expression.", suggestedFix: "Use parameterized XPath queries (XPathVariableResolver) instead of string concatenation.", exploitabilityOrFailureMode: "XPath injection can extract unauthorized data from XML documents.", action: "block", line: findExactAddedLine(patch, [/XPathFactory/i, /xpath\.evaluate\s*\(/i]) });
      }

      // JNDI injection (Log4Shell family)
      if (/(InitialContext\s*\(\)|\.lookup\s*\(|JndiTemplate\.lookup\s*\()/i.test(patch) &&
        /(request\.|param\.|getParameter\(|getHeader\(|\$\{)/i.test(patch) &&
        !/(?:allowlist|whitelist|validat)/i.test(patch)) {
        addFinding({ severity: "critical", confidence: "high", dimension: "security", category: "jndi-injection", title: "JNDI lookup with external input", message: "Detected JNDI lookup using values that may originate from user input. This pattern is associated with Log4Shell-family attacks.", evidence: "Diff contains InitialContext.lookup/JndiTemplate.lookup with user-influenced args.", suggestedFix: "Restrict JNDI lookups to fixed resource names. Disable remote class loading and use allowlisted schemes only.", exploitabilityOrFailureMode: "JNDI injection can achieve remote code execution via malicious class loading.", action: "block", line: findExactAddedLine(patch, [/InitialContext/i, /\.lookup\s*\(/i]) });
      }

      // SpEL injection
      if (/(SpelExpressionParser|parseExpression\s*\(|ExpressionParser)/i.test(patch) &&
        /(request\.|param\.|getParameter\(|@RequestParam|userInput)/i.test(patch)) {
        addFinding({ severity: "critical", confidence: "medium", dimension: "security", category: "spel-injection", title: "Spring Expression Language evaluated with user input", message: "Detected SpEL expression parsing with values that may be user-controlled. SpEL supports method invocation and can lead to RCE.", evidence: "Diff contains SpelExpressionParser.parseExpression with request-derived input.", suggestedFix: "Use SimpleEvaluationContext (no method invocation) or avoid evaluating user-supplied expressions.", exploitabilityOrFailureMode: "SpEL injection can execute arbitrary Java code on the server.", action: "block", line: findExactAddedLine(patch, [/SpelExpressionParser/i, /parseExpression\s*\(/i]) });
      }

      // Insecure cookie — missing Secure/HttpOnly flags
      if (/(new\s+Cookie\s*\()/i.test(patch) &&
        !/(?:setSecure\s*\(\s*true|setHttpOnly\s*\(\s*true)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "insecure-cookie", title: "Cookie created without security flags", message: "Detected Cookie construction without visible Secure or HttpOnly flag. Missing flags weaken session security.", evidence: "Diff contains new Cookie() without corresponding setSecure(true)/setHttpOnly(true).", suggestedFix: "Set cookie.setSecure(true), cookie.setHttpOnly(true), and consider SameSite attribute.", exploitabilityOrFailureMode: "Cookies without Secure can be intercepted over HTTP; without HttpOnly they're accessible to XSS.", line: findExactAddedLine(patch, [/new\s+Cookie\s*\(/i]) });
      }

      // CORS wildcard
      if (/(@CrossOrigin\s*\(\s*(?:origins\s*=\s*)?\s*["']\*["']|allowedOrigins\s*\(\s*["']\*["']|Access-Control-Allow-Origin['":\s]+\*)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "high", dimension: "security", category: "cors-wildcard", title: "CORS allows all origins", message: "Detected wildcard (*) CORS origin configuration. This effectively disables the same-origin policy protection.", evidence: "Diff contains @CrossOrigin(\"*\") or allowedOrigins(\"*\") or Access-Control-Allow-Origin: *.", suggestedFix: "Restrict allowed origins to specific trusted domains. Never use wildcard when credentials are included.", exploitabilityOrFailureMode: "Wildcard CORS can enable cross-site data theft and CSRF-like attacks.", line: findExactAddedLine(patch, [/@CrossOrigin/i, /allowedOrigins/i, /Access-Control-Allow-Origin/i]) });
      }

      // Stack trace / error exposure to response
      if (/(\.printStackTrace\s*\(\s*\))/i.test(patch) && !isTestFilePath(file.filename)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "error-exposure", title: "Stack trace printed — may leak to clients", message: "Detected e.printStackTrace() which writes to stderr. In web applications, stack traces can leak internal details to end users.", evidence: "Diff contains .printStackTrace().", suggestedFix: "Use structured logging (logger.error(..., e)) and ensure exception details are not returned in HTTP responses.", exploitabilityOrFailureMode: "Stack traces can reveal class names, library versions, and internal paths to attackers.", line: findExactAddedLine(patch, [/\.printStackTrace\s*\(\s*\)/i]) });
      }

      // Unclosed I/O resources (without try-with-resources nearby)
      if (/(new\s+(FileOutputStream|FileInputStream|BufferedReader|Scanner|ObjectOutputStream)\s*\()/i.test(patch) &&
        !/try\s*\(/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "reliability", category: "resource-leak", title: "I/O resource opened without try-with-resources", message: "Detected resource allocation (stream, reader, scanner) without visible try-with-resources or close handling in the diff.", evidence: "Diff contains new FileOutputStream/Scanner/etc without surrounding try(...).", suggestedFix: "Wrap in try-with-resources to guarantee closure on all code paths.", exploitabilityOrFailureMode: "Leaked I/O handles can exhaust file descriptors and degrade service stability.", line: findExactAddedLine(patch, [/new\s+FileOutputStream\s*\(/i, /new\s+FileInputStream\s*\(/i, /new\s+BufferedReader\s*\(/i, /new\s+Scanner\s*\(/i]) });
      }

      // HTTP response header injection
      if (/(response\.setHeader\s*\(|response\.addHeader\s*\(|HttpHeaders\.set\s*\()/i.test(patch) &&
        /(request\.|param\.|getParameter\(|@RequestParam|getHeader\()/i.test(patch) &&
        !/(?:sanitiz|encod|escap|validat)/i.test(patch)) {
        addFinding({ severity: "error", confidence: "medium", dimension: "security", category: "header-injection", title: "HTTP response header set from request input", message: "Detected HTTP response header value derived from request input without visible sanitization.", evidence: "Diff contains response.setHeader/addHeader with request-derived values.", suggestedFix: "Sanitize header values to prevent CRLF injection. Reject or encode newline characters.", exploitabilityOrFailureMode: "Header injection can enable response splitting, XSS, and cache poisoning.", action: "block", line: findExactAddedLine(patch, [/response\.setHeader\s*\(/i, /response\.addHeader\s*\(/i]) });
      }

      // Unrestricted file upload
      if (/(MultipartFile|@RequestPart|CommonsMultipartFile)/i.test(patch) &&
        !/(?:getContentType|contentType|allowedTypes|validateFile|maxSize|FilenameUtils\.getExtension|ALLOWED_EXTENSIONS)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "unrestricted-upload", title: "File upload without content validation", message: "Detected file upload handling (MultipartFile) without visible content-type or extension validation.", evidence: "Diff contains MultipartFile/@RequestPart without type/size checks.", suggestedFix: "Validate file content type against an allowlist, enforce size limits, and sanitize filenames.", exploitabilityOrFailureMode: "Unrestricted uploads can deliver malware, web shells, or overwrite critical files.", line: findExactAddedLine(patch, [/MultipartFile/i, /@RequestPart/i]) });
      }

      // Insecure cipher mode — AES without explicit mode (defaults to ECB)
      if (/(Cipher\.getInstance\s*\(\s*"AES"\s*\))/i.test(patch)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "insecure-cipher-mode", title: "AES cipher without explicit mode defaults to ECB", message: "Detected Cipher.getInstance(\"AES\") without specifying a mode. Most JVM providers default to ECB, which leaks plaintext patterns.", evidence: "Diff contains Cipher.getInstance(\"AES\") without mode/padding specification.", suggestedFix: "Use an authenticated mode: Cipher.getInstance(\"AES/GCM/NoPadding\") with a unique IV per encryption.", exploitabilityOrFailureMode: "ECB mode reveals patterns in encrypted data and has no integrity protection.", action: "block", line: findExactAddedLine(patch, [/Cipher\.getInstance\s*\(\s*"AES"\s*\)/i]) });
      }

      // Hardcoded credential in Java source — constants with sensitive names
      if (/(private|public|protected|static|final)\s+(static\s+)?(final\s+)?String\s+\w*(PASSWORD|SECRET|API_?KEY|TOKEN|CREDENTIAL)\w*\s*=\s*"[^"]{6,}"/i.test(patch) &&
        !isTestFilePath(file.filename)) {
        addFinding({ severity: "error", confidence: "high", dimension: "security", category: "hardcoded-credential", title: "Hardcoded credential in Java constant", message: "Detected a Java string constant with a sensitive name (PASSWORD, SECRET, API_KEY, TOKEN) assigned a literal value.", evidence: "Diff contains field assignment like `static final String PASSWORD = \"...\"` with a non-placeholder value.", suggestedFix: "Move credentials to a secrets manager, vault, or environment variable. Never commit literal secrets to source control.", exploitabilityOrFailureMode: "Hardcoded credentials in source can be extracted from repositories, build artifacts, or decompiled JARs.", action: "block", line: findExactAddedLine(patch, [/(PASSWORD|SECRET|API_?KEY|TOKEN|CREDENTIAL)\w*\s*=\s*"/i]) });
      }
    }

    // Sensitive data in logs — cross-language
    if (!isTestFilePath(file.filename) && !detectInfraConfigFile(file)) {
      if (/(log\.(info|warn|error|debug)|logger\.(info|warn|error|debug)|console\.(log|warn|error)|System\.out\.print|System\.err\.print)/i.test(patch) &&
        /(password|passwd|secret|token|apiKey|api_key|creditCard|cardNumber|pan|ssn|socialSecurity|cvv|pin\b)/i.test(patch) &&
        !/(?:mask|redact|sanitiz|censor|\*\*\*|<REDACTED>)/i.test(patch)) {
        addFinding({ severity: "warning", confidence: "medium", dimension: "security", category: "sensitive-logging", title: "Potentially sensitive data in log output", message: "Detected logging statements that reference sensitive field names (password, token, card, SSN) without visible masking.", evidence: "Diff contains log output with sensitive field name references.", suggestedFix: "Mask or redact sensitive values before logging. Never log raw credentials, tokens, or PII.", exploitabilityOrFailureMode: "Sensitive data in logs can leak through log aggregation, support tickets, or backup systems." });
      }
    }

    // Fail-open auth pattern — cross-language
    if (!isTestFilePath(file.filename) && !detectInfraConfigFile(file)) {
      if (/(catch|except|rescue)\b/i.test(patch) &&
        /(auth|permission|access|security|principal|credential)/i.test(patch) &&
        /(return\s+true|allow|grant|permit|authorized\s*=\s*true|isAuthenticated\s*=\s*true)/i.test(patch)) {
        addFinding({ severity: "critical", confidence: "medium", dimension: "security", category: "fail-open-auth", title: "Authentication/authorization may fail open", message: "Detected an exception handler in auth-related code that grants access. This pattern can allow unauthorized access when auth checks fail.", evidence: "Diff contains catch/except block in auth context with allow/grant/true return.", suggestedFix: "Ensure auth exception handlers deny access by default. Log the failure and return unauthorized.", exploitabilityOrFailureMode: "Auth exceptions being caught as 'allow' can bypass all access controls.", action: "block" });
      }
    }

    // Hardcoded IP addresses — cross-language
    if (!isTestFilePath(file.filename) && !detectInfraConfigFile(file)) {
      const ipMatch = patch.match(/["'](\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})["']/);
      if (ipMatch && !/^(127\.0\.0\.1|0\.0\.0\.0|10\.\d|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.|255\.255)/.test(ipMatch[1]) &&
        !/(?:test|mock|example|localhost|loopback)/i.test(patch.slice(Math.max(0, patch.indexOf(ipMatch[0]) - 80), patch.indexOf(ipMatch[0]) + 80))) {
        addFinding({ severity: "info", confidence: "low", dimension: "maintainability", category: "hardcoded-ip", title: "Hardcoded IP address in source", message: "Detected a hardcoded IP address that should typically be configured externally.", evidence: `IP: ${ipMatch[1]}`, suggestedFix: "Move the address to configuration (environment variable, config file, or service registry)." });
      }
    }
  }

  findings = refineFindingAnchorsToChangedStatements(findings, input);

  // ── Per-file test coverage gap: high-risk production files without a matching test ──
  const testFilesInPR = input.files
    .map((f) => f.filename)
    .filter((f) => isTestFilePath(f));
  const testBaseNames = new Set(
    testFilesInPR.map((f) => {
      const base = pathBasename(f).replace(/\.[^.]+$/, "").toLowerCase();
      return base.replace(/(integrationtest|tests|test|it|spec)$/i, "");
    }).filter(Boolean),
  );

  for (const file of input.files) {
    if (isTestFilePath(file.filename)) continue;
    if (!isApplicationCodeFile(file.filename)) continue;
    const metadata = triage.files.find((c) => c.file === file.filename);
    if (!metadata || metadata.highRiskCategories.length === 0) continue;
    if (metadata.changeKind === "removed" || metadata.generated || metadata.pureInterface) continue;

    // Skip trivial classes: DTOs, POJOs, constants, configs, mappers, enums
    const baseName = pathBasename(file.filename).replace(/\.[^.]+$/, "");
    if (/^(.*)(Dto|DTO|Config|Constants?|Enum|Mapper|MapperImpl|Properties|Request|Response|Entity|Model|Record|Vo|VO|POJO)$/i.test(baseName)) continue;

    const prodBase = pathBasename(file.filename).replace(/\.[^.]+$/, "").toLowerCase();
    if (testBaseNames.has(prodBase)) continue;

    findings.push(applyCompatibilityFields({
      id: stableFindingId("H", file.filename, sequence++),
      file: file.filename,
      line: 1,
      endLine: 1,
      severity: "info",
      confidence: "high",
      dimension: "test-quality",
      category: "test-coverage",
      title: `Test coverage for ${pathBasename(file.filename).replace(/\.[^.]+$/, "")}`,
      message: `High-risk production file was changed but no corresponding test file (e.g. ${prodBase}Test) was included in the PR.`,
      whyItMatters: "Changes to sensitive code paths without test coverage increase the risk of undetected regressions.",
      evidence: `High-risk categories: ${metadata.highRiskCategories.join(", ")}; no matching test file found in PR.`,
      suggestedFix: `Add or update a test class for ${pathBasename(file.filename).replace(/\.[^.]+$/, "")} covering the changed logic.`,
      testsToAddOrUpdate: `Add ${prodBase}Test covering changed paths.`,
      action: "warning",
    }));
  }

  return findings;
}

function applyDeterministicEscalations(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    const haystack = [f.title, f.message, f.evidence, f.category, f.file]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Critical business-rule guardrail:
    // hardcoded state transitions (ignoring requested status) must block merge.
    const hardcodedStateTransition =
      (haystack.includes("status") && haystack.includes("hardcoded")) ||
      (haystack.includes("updateorderstatus") && haystack.includes("payment_approved")) ||
      (haystack.includes("business logic") && haystack.includes("instead of using the input status"));

    if (hardcodedStateTransition) {
      return {
        ...f,
        severity: "error",
        action: "block",
        confidence: f.confidence === "low" ? "medium" : f.confidence,
      };
    }

    return f;
  });
}

function applyStrictModeEscalations(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    // In strict mode, high-confidence reliability/security/api-contract issues should block.
    if (
      f.confidence === "high" &&
      (f.dimension === "security" || f.dimension === "reliability" || f.dimension === "api-contract") &&
      (f.severity === "critical" || f.severity === "error")
    ) {
      return {
        ...f,
        action: "block",
      };
    }

    return f;
  });
}

function hasDirectSecuritySignal(text: string): boolean {
  return /(sql\s*injection|xss|csrf|ssrf|rce|remote code execution|auth\s*bypass|authorization\s*bypass|privilege\s*escalation|hardcoded\s*(secret|token|password)|secret\s*leak|token\s*leak|credential\s*leak|pii\s*leak|bypass)/i.test(text);
}

function isLoggingDiagnosticGapFinding(finding: Finding): boolean {
  const text = [
    finding.title,
    finding.message,
    finding.category,
    finding.evidence || "",
    finding.suggestedFix || "",
  ].join(" ");

  const hasLoggingContext = /(log|logger|logging|emitwarning|warn|error\s*log|audit\s*log)/i.test(text);
  const hasDiagnosticGap = /(without details|missing details|lack(?:s|ing)? context|insufficient context|difficult to diagnose|hard to diagnose|troubleshoot|debug|failure reason not logged|reason not logged|add more details)/i.test(text);

  return hasLoggingContext && hasDiagnosticGap && !hasDirectSecuritySignal(text);
}

function isClassRemovalFinding(finding: Finding): boolean {
  const text = [finding.title, finding.message, finding.category, finding.suggestedFix || ""].join(" ").toLowerCase();
  return /code removal|class has been removed|entire\s+\w+\s+class\s+has\s+been\s+removed|removed/.test(text);
}

function hasNearbyValidationReplacementArtifacts(removedFile: string, triage: PRTriage): boolean {
  const removedDir = pathDirname(removedFile).toLowerCase();
  const moduleScope = pathDirname(removedDir);
  if (!moduleScope) return false;

  return triage.files.some((file) => {
    if (file.changeKind !== "added") return false;
    const path = file.file.toLowerCase();
    if (!path.startsWith(moduleScope)) return false;
    return /(validation|sanitization|validator|facade|rule|rules\.ya?ml)/.test(path);
  });
}

export function calibrateFindings(
  findings: Finding[],
  triage: PRTriage,
  precedents: RankedHistoricalPrecedent[],
  feedbackSignals?: ReviewFeedbackSignals,
  sourceFiles: PRFile[] = [],
): Finding[] {
  const falsePositiveRate = feedbackSignals
    ? feedbackSignals.falsePositiveCount / Math.max(1, feedbackSignals.acceptedCount + feedbackSignals.rejectedCount + feedbackSignals.falsePositiveCount)
    : 0;

  return findings.map((finding) => {
    const metadata = triage.files.find((file) => file.file === finding.file);
    const sourceFile = sourceFiles.find((file) => file.filename === finding.file || file.filename === finding.filePath);
    const matchingPrecedents = precedents.filter((precedent) => precedent.topPaths.some((path) => finding.file.toLowerCase().startsWith(path.toLowerCase())));
    const strongestPrecedent = matchingPrecedents[0];
    let severity = finding.severity;
    let confidence = finding.confidence;
    let action = finding.action;
    let dimension = finding.dimension;
    let category = finding.category;

    if (isLoggingDiagnosticGapFinding(finding)) {
      dimension = "observability";
      category = category === "security" ? "logging-diagnostics" : category;
      severity = "suggestion";
      if (action === "block" || action === "require-human-review" || action === "warning") {
        action = "suggestion";
      }
      if (confidence === "high") {
        confidence = "medium";
      }
    }

    if (metadata?.changeKind === "removed" && isClassRemovalFinding(finding) && hasNearbyValidationReplacementArtifacts(finding.file, triage)) {
      dimension = "maintainability";
      category = "refactor-replacement";
      severity = "suggestion";
      action = "suggestion";
      if (confidence === "high") {
        confidence = "medium";
      }
    }

    if (metadata?.generated && dimension !== "security" && dimension !== "api-contract" && severity !== "critical") {
      severity = severity === "error" ? "warning" : severity;
      action = action === "block" ? "warning" : action;
      confidence = confidence === "high" ? "medium" : confidence;
    }

    if (sourceFile && detectInfraConfigFile(sourceFile) && isSecretExposureFinding(finding) && hasOnlyPlaceholderSecretReferences(sourceFile)) {
      severity = "suggestion";
      action = "suggestion";
      confidence = confidence === "high" ? "medium" : "low";
      dimension = "security";
      category = "placeholder-secret-reference";
    }

    if (metadata && metadata.highRiskCategories.length > 0 && (dimension === "security" || dimension === "business-domain") && severity === "warning" && confidence !== "low") {
      severity = "error";
      action = action === "suggestion" ? "require-human-review" : action;
    }

    // Escalate maintainability findings for auth/security-critical files
    if (dimension === "maintainability" && severity === "suggestion" &&
        metadata && (metadata.sensitivity?.includes("auth") || metadata.highRiskCategories.some((c: string) => c === "auth" || c === "security"))) {
      severity = "warning";
      action = action === "suggestion" ? "warning" : action;
    }

    if (strongestPrecedent && strongestPrecedent.score >= 0.9 && strongestPrecedent.outcome === "needs-attention" && confidence === "medium") {
      confidence = "high";
    }
    if (strongestPrecedent && strongestPrecedent.score >= 0.9 && strongestPrecedent.outcome === "accepted" && falsePositiveRate >= 0.15 && confidence === "high") {
      confidence = "medium";
    }

    const businessImpact = finding.businessImpact || calibrateBusinessImpact(finding.category, triage);
    const needsHumanConfirmation = Boolean(
      finding.needsHumanConfirmation ||
      finding.reviewStatus === "needs_more_context" ||
      confidence === "low" ||
      (metadata?.blastRadius === "high" && severity !== "suggestion")
    );

    return applyCompatibilityFields({
      ...finding,
      severity,
      confidence,
      action,
      dimension,
      category,
      businessImpact,
      business_impact: businessImpact,
      relatedPrecedents: finding.relatedPrecedents || matchingPrecedents.map((precedent) => precedent.precedentId).slice(0, 3),
      related_precedents: finding.relatedPrecedents || matchingPrecedents.map((precedent) => precedent.precedentId).slice(0, 3),
      needsHumanConfirmation,
      needs_human_confirmation: needsHumanConfirmation,
    });
  });
}

// ─── Reviewer Routing (file-path heuristic) ─────────────────────────────────

function computeReviewerRouting(files: PRFile[]): string[] {
  const teams = new Set<string>();
  for (const f of files) {
    const p = f.filename.toLowerCase();
    if (p.includes("security") || p.includes("auth") || p.includes("crypto")) teams.add("security-team");
    if (p.includes("infra") || p.includes("deploy") || p.includes("helm") || p.includes("docker") || p.includes("jenkins") || p.includes("ci")) teams.add("devops-team");
    if (p.includes("migration") || p.includes("schema") || p.includes("flyway") || p.includes("liquibase")) teams.add("dba-team");
    if (p.includes("test") || p.includes("spec")) teams.add("qa-team");
    if (p.endsWith(".proto") || p.endsWith(".graphql") || p.includes("openapi") || p.includes("swagger")) teams.add("api-team");
  }
  if (teams.size === 0) teams.add("dev-team");
  return Array.from(teams);
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

export async function reviewPR(input: PRReviewInput): Promise<PRReviewResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const providerInfo = getProviderInfo();

  if (!isAIEnabled()) {
    return emptyResult("AI provider not configured — cannot perform review.");
  }

  const targetFiles = input.files.filter((f) => isTargetReviewFile(f.filename));
  if (targetFiles.length === 0) {
    return emptyResult("No supported reviewable files found in this PR. Supported: Java, C/C++, TypeScript/JavaScript, Python, Jenkins, Docker, Helm/Kubernetes, Terraform, CI/CD, and common config files.");
  }

  const scopedInput: PRReviewInput = {
    ...input,
    files: targetFiles,
  };
  const triage = classifyChangedFiles(scopedInput.files);
  const staticKnowledgeContext = buildKnowledgeContext(scopedInput);

  // ── Dynamic CONTRIBUTING.md injection ─────────────────────────────────────
  const contributingMd = await fetchContributingMd(scopedInput.repoSlug);
  if (contributingMd) {
    staticKnowledgeContext.push({
      source: "CONTRIBUTING.md (dynamic)",
      title: "Repository contributing guide, Definition of Done, and schema workflow",
      guidance: contributingMd.slice(0, 8000),
      appliesTo: ["compliance", "correctness", "test-quality", "api-contract", "maintainability", "observability", "security"],
    });
  }

  let behavioralMeta: PRReviewResult["behavioralPattern"];
  let behavioralKnowledge: KnowledgeReference[];

  if (scopedInput.precomputedBehavioralRefs && scopedInput.precomputedBehavioralRefs.length > 0) {
    behavioralKnowledge = scopedInput.precomputedBehavioralRefs;
    behavioralMeta = {
      enabled: true,
      historySignalsUsed: 0,
      contextHash: "db-backed",
      highlights: [`Nightly learned patterns loaded: ${behavioralKnowledge.length}`],
    };
  } else {
    const behavioralPattern = buildBehavioralPatternContext({
      prTitle: scopedInput.prTitle,
      prBody: scopedInput.prBody,
      files: scopedInput.files,
      historicalSignals: scopedInput.historicalSignals,
      feedbackSignals: scopedInput.feedbackSignals,
    });
    behavioralKnowledge = behavioralPattern.knowledgeReferences;
    behavioralMeta = {
      enabled: behavioralPattern.enabled,
      historySignalsUsed: behavioralPattern.historySignalsUsed,
      contextHash: behavioralPattern.contextHash,
      highlights: behavioralPattern.highlights,
    };
  }

  const knowledgeContext = [
    ...staticKnowledgeContext,
    ...behavioralKnowledge,
  ];
  const relevantPrecedents = rankHistoricalPrecedents({
    prTitle: scopedInput.prTitle,
    prBody: scopedInput.prBody,
    files: scopedInput.files,
    historicalSignals: scopedInput.historicalSignals,
    feedbackSignals: scopedInput.feedbackSignals,
  }, 5);
  const { contextBundle, redactionsApplied } = buildReviewContextBundle(scopedInput, triage, knowledgeContext, relevantPrecedents);
  const knowledgeCtxText = serializeKnowledgeContext(knowledgeContext);
  const precedentCtx = serializeHistoricalPrecedents(relevantPrecedents);
  const diffCtx = buildDiffContext(scopedInput, triage);

  // ── Tree-sitter changed-code context subgraph ───────────────────────────
  const astContextResult = await buildTreeSitterContextSubgraph(scopedInput.files);
  const selectedPolicyPacks = selectPolicyPacks(triage, astContextResult.fileContexts);
  const astPromptCtx = serializeTreeSitterContextForPrompt(astContextResult.fileContexts, 7000);
  const astPolicyCtx = `Selected policy packs: ${selectedPolicyPacks.join(", ") || "none"}`;

  // ── Repository Code Intelligence: Delta Resolution ──────────────────────
  let deltaResolution: DeltaResolution | undefined;
  let enrichedKnowledgeCtx = `${knowledgeCtxText}\n\n${astPolicyCtx}\n${astPromptCtx}`;
  if (scopedInput.repoSlug) {
    deltaResolution = resolveDelta(
      scopedInput.repoSlug,
      scopedInput.files.map((f) => ({
        filename: f.filename,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      })),
    );
    if (deltaResolution.indexed && deltaResolution.promptEnrichment) {
      enrichedKnowledgeCtx = `${knowledgeCtxText}\n\n${astPolicyCtx}\n${astPromptCtx}\n\n${deltaResolution.promptEnrichment}`;
    }
  }

  // ── Secret Detection: runs on raw patches BEFORE redaction ────────────────
  let secretFindings: Finding[] = [];
  if (isSecretDetectorEnabled()) {
    const allSecretDetections = scopedInput.files.flatMap((f) =>
      f.patch ? detectSecrets({ filePath: f.filename, content: f.patch, isDiff: true }) : [],
    );
    if (allSecretDetections.length > 0) {
      const secretPolicyFindings = secretDetectionsToPolicyFindings(allSecretDetections);
      secretFindings = policyFindingsToFindings(secretPolicyFindings);
      console.log(`[SecretDetector] Found ${allSecretDetections.length} potential secret(s) → ${secretFindings.length} finding(s)`);
    }
  }

  const rawPolicyFindings = derivePolicyFindingsFromDiff(scopedInput.files, triage, selectedPolicyPacks);
  const policyFindings = policyFindingsToFindings(rawPolicyFindings);

  // ── Static Analysis: Semgrep + CodeQL (behind env flags) ──────────────────
  let semgrepFindings: Finding[] = [];
  let codeqlFindings: Finding[] = [];

  if (isSemgrepEnabled() || isCodeQLEnabled()) {
    const filePaths = scopedInput.files.map((f) => f.filename);
    const cwd = process.cwd();

    const [semgrepResult, codeqlResult] = await Promise.all([
      isSemgrepEnabled()
        ? scanWithSemgrep({ filePaths, cwd })
        : Promise.resolve({ findings: [] as PolicyFinding[], errors: [] as string[] }),
      isCodeQLEnabled()
        ? scanWithCodeQL({ language: "java", dbPath: process.env.CODEQL_DB_PATH })
        : Promise.resolve({ findings: [] as PolicyFinding[], errors: [] as string[] }),
    ]);

    if (semgrepResult.findings.length > 0) {
      semgrepFindings = policyFindingsToFindings(semgrepResult.findings);
      console.log(`[Semgrep] ${semgrepResult.findings.length} finding(s)`);
    }
    if (semgrepResult.errors.length > 0) {
      console.warn(`[Semgrep] ${semgrepResult.errors.length} error(s): ${semgrepResult.errors[0]}`);
    }
    if (codeqlResult.findings.length > 0) {
      codeqlFindings = policyFindingsToFindings(codeqlResult.findings);
      console.log(`[CodeQL] ${codeqlResult.findings.length} finding(s)`);
    }
    if (codeqlResult.errors.length > 0) {
      console.warn(`[CodeQL] ${codeqlResult.errors.length} error(s): ${codeqlResult.errors[0]}`);
    }
  }

  // ── Enriched File Triage: per-file risk/language/sensitivity analysis ─────
  let fileTriageDecisions: FileTriageDecision[] | undefined;
  const triageParams: TriageFileParams[] = scopedInput.files.map((f) => ({
    filePath: f.filename,
    patch: f.patch,
    fullContent: f.fullContent,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status === "added" ? "added" as const
      : f.status === "removed" ? "removed" as const
      : f.status === "renamed" ? "renamed" as const
      : "modified" as const,
  }));
  fileTriageDecisions = triageFiles(triageParams);
  const skipCount = fileTriageDecisions.filter((d) => d.action === "SKIP").length;
  const escalateCount = fileTriageDecisions.filter((d) => d.action === "HUMAN_ESCALATION").length;
  if (skipCount > 0 || escalateCount > 0) {
    console.log(`[FileTriage] ${fileTriageDecisions.length} files: ${skipCount} SKIP, ${escalateCount} HUMAN_ESCALATION`);
  }

  // ── Review Planner: per-file triage before expensive AI stages ────────────
  const reviewPlan = ensureValidReviewPlan(
    buildReviewPlan({
      files: scopedInput.files,
      triage,
      initialPolicyFindings: rawPolicyFindings,
      deltaResolution,
      treeSitterAvailable: astContextResult.enabled && astContextResult.parserLanguagesAvailable.length > 0,
    }),
  );
  console.log(`[ReviewPlanner] ${reviewPlan.summary}`);

  // Gate AI analysis to files the planner marked as AI-eligible
  const aiEligibleFiles = filterAIEligibleFiles(reviewPlan, scopedInput.files);
  const aiScopedInput: PRReviewInput = { ...scopedInput, files: aiEligibleFiles };

  // ── Chunked + Multi-pass pipeline (behind feature flags) ──────────────────
  let analyzeResult: { findings: Finding[]; batchFailures: BatchFailure[] };
  let classifyResult: { changeType: ChangeType; riskProfile: RiskProfile };
  let specsAlignment: SpecAlignment[];

  if (isChunkerEnabled()) {
    // Build chunks from AI-eligible files using enriched triage metadata
    const chunkFiles = aiEligibleFiles.map((f) => {
      const triageDecision = fileTriageDecisions?.find((d) => d.file === f.filename);
      return {
        filePath: f.filename,
        patch: f.patch || "",
        language: triageDecision?.language || undefined,
        risk: triageDecision?.risk || ("medium" as const),
      };
    });

    const allChunks = chunkPRFiles(chunkFiles, { maxCharsPerChunk: 4500 });
    const maxTokenBudget = Math.floor(llmContextWindow() * 0.6);
    const { selected: selectedChunks, deferred: deferredChunks } = selectChunksForLLM(allChunks, maxTokenBudget);
    console.log(`[Chunker] ${allChunks.length} chunks total, ${selectedChunks.length} selected for LLM (${deferredChunks.length} deferred)`);

    // Inject enrichment context into selected chunks
    for (const chunk of selectedChunks) {
      const fileCtx = contextBundle.files.find((c) => c.file === chunk.filePath);
      if (fileCtx) {
        const nearbySnippets = fileCtx.nearbyContext.join("\n---\n").slice(0, 1200);
        const priorCalls = fileCtx.priorCallsContext.join("\n---\n").slice(0, 800);
        chunk.contextText = [nearbySnippets, priorCalls].filter(Boolean).join("\n\n");
      }
    }

    if (isMultipassEnabled() && selectedChunks.length > 0) {
      // ── Multi-pass: security + correctness + perf per chunk ─────────
      const chunkReviewOutputs: ChunkReviewOutput[] = [];
      const chunkBatchFailures: BatchFailure[] = [];

      // Process chunks with concurrency limit
      const CHUNK_CONCURRENCY = 3;
      for (let i = 0; i < selectedChunks.length; i += CHUNK_CONCURRENCY) {
        const batch = selectedChunks.slice(i, i + CHUNK_CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (chunk) => {
            const passes: Array<{ pass: "security" | "correctness" | "perf"; buildPrompt: (c: PatchChunk, ctx?: string) => string }> = [
              { pass: "security", buildPrompt: buildSecurityPrompt },
              { pass: "correctness", buildPrompt: buildCorrectnessPrompt },
              { pass: "perf", buildPrompt: buildPerfPrompt },
            ];

            const passResults: ChunkReviewOutput[] = [];
            for (const { pass, buildPrompt } of passes) {
              try {
                const prompt = buildPrompt(chunk, chunk.contextText);
                const resp = await complete({
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.2,
                  maxTokens: 3000,
                });

                if (!resp.content.trim()) continue;
                const raw = parseJson<any>(resp.content, null);
                if (!raw) continue;

                // If AI returns an array, wrap it in the expected schema
                const chunkOutput = Array.isArray(raw)
                  ? {
                      summary: `${pass} pass for ${chunk.filePath}`,
                      risk: "low" as const,
                      issues: raw,
                      meta: {
                        filePath: chunk.filePath,
                        chunkId: chunk.chunkId,
                        pass,
                        model: llmReviewModel(),
                      },
                    }
                  : { ...raw, meta: { filePath: chunk.filePath, chunkId: chunk.chunkId, pass, model: llmReviewModel(), ...(raw.meta || {}) } };

                const validated = validateChunkReview(chunkOutput);
                passResults.push(validated);
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : "Unknown chunk pass error";
                console.warn(`[MultiPass] ${pass} pass failed for ${chunk.filePath} chunk ${chunk.chunkIndex}: ${msg}`);
              }
            }
            return passResults;
          }),
        );

        for (const passResults of batchResults) {
          chunkReviewOutputs.push(...passResults);
        }
      }

      // Merge chunk results and convert to Finding[]
      const mergedOutput = mergeChunkReviews(chunkReviewOutputs);
      const chunkFindings = chunkIssuesToFindings(mergedOutput.issues);
      console.log(`[MultiPass] ${chunkReviewOutputs.length} pass results → ${chunkFindings.length} findings`);
      analyzeResult = { findings: chunkFindings, batchFailures: chunkBatchFailures };
    } else {
      // Chunker enabled but multi-pass disabled: use existing AI pipeline with chunked context
      // (The existing aiAnalyzeFindings still runs but benefits from better file triage)
      analyzeResult = await aiAnalyzeFindings(aiScopedInput, diffCtx, enrichedKnowledgeCtx, triage, contextBundle, precedentCtx);
    }

    // Always run classification and specs alignment regardless of chunker
    [classifyResult, specsAlignment] = await Promise.all([
      aiClassifyAndRisk(aiScopedInput, diffCtx, enrichedKnowledgeCtx, triage, contextBundle, precedentCtx),
      aiCheckSpecsAlignment(aiScopedInput, diffCtx, enrichedKnowledgeCtx),
    ]);
  } else {
    // ── Legacy pipeline: batched AI analysis ──────────────────────────────
    const [cr, ar, sa] = await Promise.all([
      aiClassifyAndRisk(aiScopedInput, diffCtx, enrichedKnowledgeCtx, triage, contextBundle, precedentCtx),
      aiAnalyzeFindings(aiScopedInput, diffCtx, enrichedKnowledgeCtx, triage, contextBundle, precedentCtx),
      aiCheckSpecsAlignment(aiScopedInput, diffCtx, enrichedKnowledgeCtx),
    ]);
    classifyResult = cr;
    analyzeResult = ar;
    specsAlignment = sa;
  }

  const { changeType, riskProfile } = classifyResult;
  const { findings: rawFindings, batchFailures } = analyzeResult;
  const hasBatchFailures = batchFailures.length > 0;
  if (hasBatchFailures) {
    console.warn(`[reviewPR] ${batchFailures.length} AI batch(es) failed — review may be incomplete`);
  }

  const verificationResult = await aiVerifyHighImpactFindings(scopedInput, rawFindings, enrichedKnowledgeCtx);
  const verifiedFindings = verificationResult.findings;
  const reviewMode = getReviewMode();
  const deletedTestCoverageFindings = deriveDeletedTestCoverageFindingsFromDiff(scopedInput, triage);

  const deterministicFindings = reviewMode === "ai_only"
    ? []
    : deriveDeterministicFindingsFromDiff(scopedInput);
  const architectureRiskFindings = reviewMode === "ai_only"
    ? []
    : deriveArchitectureRiskFindingsFromDiff(scopedInput);
  const heuristicFindings = reviewMode === "ai_only"
    ? []
    : deriveHeuristicFindingsFromDiff(scopedInput, triage, relevantPrecedents);

  let dedupeResult = deduplicateFindingsDetailed([
    ...verifiedFindings,
    ...policyFindings,
    ...secretFindings,
    ...semgrepFindings,
    ...codeqlFindings,
    ...deletedTestCoverageFindings,
    ...deterministicFindings,
    ...architectureRiskFindings,
    ...heuristicFindings,
  ]);
  let findings = dedupeResult.findings;

  // ── RCIE: Filter pre-existing baseline vulnerabilities ──────────────────
  if (deltaResolution?.indexed && deltaResolution.baselineFingerprints.size > 0) {
    const before = findings.length;
    findings = findings.filter((f) => {
      // Use exact line for precision; fall back to line bucket only if exact miss
      const exactFp = `${f.file}|${f.category}|${f.line ?? 0}`;
      if (deltaResolution!.baselineFingerprints.has(exactFp)) return false;
      // Legacy bucket fallback (5-line granularity) for pre-existing fingerprints
      const lineBucket = f.line ? Math.floor(f.line / 5) * 5 : 0;
      const bucketFp = `${f.file}|${f.category}|${lineBucket}`;
      return !deltaResolution!.baselineFingerprints.has(bucketFp);
    });
    if (findings.length < before) {
      console.log(`[RCIE] filtered ${before - findings.length} baseline vulnerability finding(s)`);
    }
  }

  if (reviewMode !== "ai_only") {
    findings = applyDeterministicEscalations(findings);
  }
  if (reviewMode === "hybrid_strict") {
    findings = applyStrictModeEscalations(findings);
  }

  findings = calibrateFindings(findings, triage, relevantPrecedents, scopedInput.feedbackSignals, scopedInput.files);

  findings = enforceEvidenceGate(findings, scopedInput);

  // ── Suppress findings on intentionally-broken test fixtures ─────────────
  findings = findings.filter((f) => {
    const lf = f.file.toLowerCase();
    const isTestResource = lf.includes("/src/test/") || lf.includes("/test/resources/") || lf.includes("/test/fixtures/") || lf.includes("/__tests__/");
    if (!isTestResource) return true;
    const base = pathBasename(lf);
    return !/(?:malformed|invalid|bad|broken|corrupt|negative|error)/.test(base);
  });

  const schemaResult = enforceFindingSchema(findings, scopedInput);
  findings = schemaResult.findings;
  const suppressionResult = applyActiveSuppressions(scopedInput.repoSlug, findings);
  findings = suppressionResult.findings;
  findings = sortFindingsDeterministically(findings);

  // Compute dimension scores
  const dimensionScores = VALID_DIMENSIONS.map((dim) => computeDimensionScore(dim, findings));

  // Compute verdict
  const blockers = findings.filter((f) => f.action === "block").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const suggestions = findings.filter((f) => f.severity === "suggestion").length;
  const informational = findings.filter((f) => f.severity === "info").length;
  const noFindings = findings.length === 0;
  const highRiskWithoutFindings = noFindings && (riskProfile.label === "high" || riskProfile.label === "critical");
  // If AI batches failed, treat as incomplete regardless of finding count
  const incompleteAnalysis = hasBatchFailures && noFindings;

  let verdict: Action;
  if (blockers > 0) verdict = "block";
  else if (riskProfile.label === "critical" && !noFindings) verdict = "require-human-review";
  else if (riskProfile.label === "critical" && incompleteAnalysis) verdict = "require-human-review";
  else if (highRiskWithoutFindings && incompleteAnalysis) verdict = "require-human-review";
  else if (highRiskWithoutFindings) verdict = "warning";
  else if (warnings >= 1 && (riskProfile.label === "high" || riskProfile.label === "critical")) verdict = "warning";
  else if (warnings > 3) verdict = "warning";
  else if (findings.length === 0 && riskProfile.label === "low" && !hasBatchFailures) verdict = "auto-approve";
  else verdict = "suggestion";

  const topRisks = riskProfile.factors
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((f) => f.factor);

  const strengths = dimensionScores
    .filter((d) => d.score >= 90)
    .map((d) => `${d.dimension}: ${d.label}`);

  // Compliance score: weighted average across ALL dimensions that have findings,
  // anchored by security + compliance, but penalised by any dimension with issues.
  const secScore = dimensionScores.find((d) => d.dimension === "security")?.score ?? 100;
  const compScore = dimensionScores.find((d) => d.dimension === "compliance")?.score ?? 100;
  const dimsWithFindings = dimensionScores.filter((d) => d.findingCount > 0);
  let complianceScore: number;
  if (dimsWithFindings.length === 0) {
    // No findings at all — perfect score
    complianceScore = 100;
  } else {
    // Blend: 40% security+compliance anchor, 60% average of all dims with findings
    const anchor = (secScore + compScore) / 2;
    const issueAvg = dimsWithFindings.reduce((sum, d) => sum + d.score, 0) / dimsWithFindings.length;
    complianceScore = Math.round(anchor * 0.4 + issueAvg * 0.6);
  }

  const reviewerRouting = computeReviewerRouting(scopedInput.files);
  const autoApprovalEligible = verdict === "auto-approve";
  const riskSummary = `Blast radius ${triage.blastRadius}; subsystems ${triage.subsystem.join(", ") || "none"}; high-risk categories ${triage.highRiskCategories.join(", ") || "none"}; model recommendation ${riskProfile.recommendation}.`;

  const headline =
    blockers > 0
      ? `${blockers} blocker(s) found — PR requires fixes`
      : incompleteAnalysis
        ? `Analysis incomplete (${batchFailures.length} batch failure(s)) — manual review required`
      : highRiskWithoutFindings
        ? "No concrete findings detected, but high-risk change requires approval with conditions"
      : findings.length === 0
        ? "Clean PR — no issues detected"
        : `${findings.length} finding(s) across ${new Set(findings.map((f) => f.dimension)).size} dimension(s)`;

  // ── Build structured report (CONTRIBUTING.md format) ────────────────────
  const report = deriveReviewReport(findings, dimensionScores, input.existingComments || [], verdict, {
    riskLabel: riskProfile.label,
    highRiskWithoutFindings,
  });
  const completedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - startedMs);
  const evidenceCaptureComplete = findings
    .filter((finding) => finding.action === "block" || finding.severity === "critical" || finding.severity === "error")
    .every((finding) => Boolean(finding.file && finding.line && finding.evidence));
  const audit: ReviewAudit = {
    traceId: `${scopedInput.repoSlug || "repo"}:${startedMs}`,
    provider: providerInfo.provider,
    model: providerInfo.model,
    reviewMode,
    startedAt,
    completedAt,
    durationMs,
    promptInjectionGuardsApplied: true,
    secretRedactionsApplied: redactionsApplied,
    structuredOutputValidated: true,
    evidenceCaptureComplete: evidenceCaptureComplete && !hasBatchFailures,
  };
  const metrics: ReviewExecutionMetrics = {
    duplicateFindingCount: dedupeResult.duplicateCount,
    suppressedFindingCount: suppressionResult.suppressed.length,
    schemaAdjustmentCount: schemaResult.schemaAdjusted,
    reviewedFileCount: scopedInput.files.length,
    precedentCount: relevantPrecedents.length,
    batchFailures,
    dismissedFindingCount: verificationResult.dismissedCount,
    downgradedFindingCount: verificationResult.downgradedCount,
    verificationSkippedCount: verificationResult.skippedCount,
  };

  const strictOutput = ensureValidStrictReviewOutput(buildStrictReviewOutput({
    summary: {
      headline,
      changeType,
      totalFindings: findings.length,
      blockers,
      warnings,
      suggestions,
      informational,
      topRisks,
      strengths,
      verdict,
      riskSummary,
    },
    riskProfile,
    triage,
    contextBundle,
    dimensionScores,
    findings,
    specsAlignment,
    knowledgeContext,
    complianceScore,
    reviewerRouting,
    autoApprovalEligible,
    governance: {
      schemaAdjusted: schemaResult.schemaAdjusted,
      suppressedCount: suppressionResult.suppressed.length,
      suppressedFindings: suppressionResult.suppressed,
    },
    report,
    audit,
    metrics,
    behavioralPattern: behavioralMeta,
    astContext: {
      enabled: astContextResult.enabled,
      parserLanguagesAvailable: astContextResult.parserLanguagesAvailable,
      parsedFiles: astContextResult.fileContexts.length,
      failures: astContextResult.failures,
      selectedPolicyPacks,
    },
    reviewPlan,
    strictOutput: { summary: "", risk: "medium", issues: [] },
  }));

  return {
    summary: {
      headline,
      changeType,
      totalFindings: findings.length,
      blockers,
      warnings,
      suggestions,
      informational,
      topRisks,
      strengths,
      verdict,
      riskSummary,
    },
    riskProfile,
    triage,
    contextBundle,
    dimensionScores,
    findings,
    specsAlignment,
    knowledgeContext,
    complianceScore,
    reviewerRouting,
    autoApprovalEligible,
    governance: {
      schemaAdjusted: schemaResult.schemaAdjusted,
      suppressedCount: suppressionResult.suppressed.length,
      suppressedFindings: suppressionResult.suppressed,
    },
    report,
    audit,
    metrics,
    behavioralPattern: behavioralMeta,
    astContext: {
      enabled: astContextResult.enabled,
      parserLanguagesAvailable: astContextResult.parserLanguagesAvailable,
      parsedFiles: astContextResult.fileContexts.length,
      failures: astContextResult.failures,
      selectedPolicyPacks,
    },
    reviewPlan,
    strictOutput,
  };
}

export async function reviewPRStrictJson(input: PRReviewInput): Promise<StrictReviewOutput> {
  const result = await reviewPR(input);
  return ensureValidStrictReviewOutput(result.strictOutput);
}

// ─── Derive structured review report from findings ─────────────────────────

function deriveReviewReport(
  findings: Finding[],
  dimensionScores: DimensionScore[],
  existingComments: ExistingPRComment[],
  verdict: Action,
  options?: {
    riskLabel?: RiskProfile["label"];
    highRiskWithoutFindings?: boolean;
  },
): ReviewReport {
  // Blocking issues: action=block or severity=critical/error
  const blockingIssues: ReviewReportItem[] = findings
    .filter((f) => f.action === "block" || f.severity === "critical" || f.severity === "error")
    .map((f) => ({
      title: f.title,
      description: f.message,
      file: f.file !== "unknown" ? f.file : undefined,
      line: f.line,
      severity: f.severity,
      suggestedFix: f.suggestedFix,
    }));

  // Non-blocking: warnings and suggestions
  const nonBlockingIssues: ReviewReportItem[] = findings
    .filter((f) => f.action !== "block" && f.severity !== "critical" && f.severity !== "error" && f.severity !== "info")
    .map((f) => ({
      title: f.title,
      description: f.message,
      file: f.file !== "unknown" ? f.file : undefined,
      line: f.line,
      severity: f.severity,
      suggestedFix: f.suggestedFix,
    }));

  // Positive observations from high-scoring dimensions
  const positiveObservations: string[] = dimensionScores
    .filter((d) => d.score >= 85 && d.findingCount === 0)
    .map((d) => `${d.dimension.charAt(0).toUpperCase() + d.dimension.slice(1)}: no issues found — ${d.label} quality`);

  // Follow-up actions: items from suggestedTest + info-level findings
  const followUpActions: string[] = [
    ...findings
      .filter((f) => f.suggestedTest)
      .map((f) => `Add test: ${f.suggestedTest}`),
    ...findings
      .filter((f) => f.severity === "info" && f.action === "informational")
      .map((f) => f.message),
    ...(options?.highRiskWithoutFindings
      ? [
        `High-risk change with zero concrete findings in this run. Add targeted manual checks and tests before merge (risk=${String(options.riskLabel || "high")}).`,
      ]
      : []),
  ].filter(Boolean).slice(0, 8);

  // Summary of existing reviewer feedback from Bitbucket
  let existingFeedbackSummary = "No existing reviewer comments found.";
  if (existingComments.length > 0) {
    const open = existingComments.filter((c) => c.state === "OPEN" || c.state === "UNRESOLVED");
    const blockers = existingComments.filter((c) => c.severity === "BLOCKER");
    const parts: string[] = [`${existingComments.length} existing comment(s) from reviewers.`];
    if (blockers.length > 0) parts.push(`${blockers.length} marked as BLOCKER.`);
    if (open.length > 0) parts.push(`${open.length} still open/unresolved.`);
    const samples = existingComments.slice(0, 3).map((c) => `• [${c.author}]${c.filePath ? ` on ${c.filePath}` : ""}: ${c.text.slice(0, 120)}`);
    existingFeedbackSummary = [...parts, ...samples].join("\n");
  }

  // Derive recommendation
  let recommendation: ReviewReport["recommendation"];
  if (verdict === "block") {
    recommendation = "REJECT";
  } else if (verdict === "auto-approve" || verdict === "informational") {
    recommendation = "APPROVE";
  } else {
    recommendation = "APPROVE WITH CONDITIONS";
  }

  return { recommendation, blockingIssues, nonBlockingIssues, positiveObservations, followUpActions, existingFeedbackSummary };
}

// ─── Empty result for when AI is disabled ───────────────────────────────────

function emptyResult(reason: string): PRReviewResult {
  const now = new Date().toISOString();
  return {
    summary: {
      headline: reason,
      changeType: "mixed",
      totalFindings: 0,
      blockers: 0,
      warnings: 0,
      suggestions: 0,
      informational: 0,
      topRisks: [],
      strengths: [],
      verdict: "informational",
      riskSummary: reason,
    },
    riskProfile: {
      overallScore: 0,
      label: "low",
      factors: [],
      changeType: "mixed",
      recommendation: "informational",
    },
    triage: {
      files: [],
      subsystem: [],
      sensitivity: [],
      blastRadius: "low",
      highRiskCategories: [],
    },
    contextBundle: {
      files: [],
      selectedPolicyPacks: [],
      relevantPrecedents: [],
      ownershipMetadataPresent: false,
    },
    astContext: {
      enabled: false,
      parserLanguagesAvailable: [],
      parsedFiles: 0,
      failures: [],
      selectedPolicyPacks: [],
    },
    strictOutput: {
      summary: reason,
      risk: "low",
      issues: [],
    },
    dimensionScores: VALID_DIMENSIONS.map((d) => ({
      dimension: d, score: 100, label: "n/a", findingCount: 0, blockerCount: 0, summary: "Not applicable",
    })),
    findings: [],
    specsAlignment: [],
    knowledgeContext: [],
    complianceScore: 100,
    reviewerRouting: [],
    autoApprovalEligible: false,
    governance: {
      schemaAdjusted: 0,
      suppressedCount: 0,
      suppressedFindings: [],
    },
    audit: {
      traceId: `empty:${Date.now()}`,
      provider: "none",
      model: "none",
      reviewMode: getReviewMode(),
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      promptInjectionGuardsApplied: true,
      secretRedactionsApplied: 0,
      structuredOutputValidated: true,
      evidenceCaptureComplete: true,
    },
    metrics: {
      duplicateFindingCount: 0,
      suppressedFindingCount: 0,
      schemaAdjustmentCount: 0,
      reviewedFileCount: 0,
      precedentCount: 0,
      batchFailures: [],
      dismissedFindingCount: 0,
      downgradedFindingCount: 0,
      verificationSkippedCount: 0,
    },
    behavioralPattern: {
      enabled: false,
      historySignalsUsed: 0,
      contextHash: "empty",
      highlights: [],
    },
    report: {
      recommendation: "APPROVE",
      blockingIssues: [],
      nonBlockingIssues: [],
      positiveObservations: [],
      followUpActions: [],
      existingFeedbackSummary: reason,
    },
    reviewPlan: {
      files: [],
      skipped: [],
      scanOnly: [],
      fullReview: [],
      humanEscalation: [],
      summary: "ReviewPlan: 0 FULL_REVIEW (empty result)",
    },
  };
}
