/**
 * GroomPilot Review File Triage
 *
 * Per-file triage that determines how each file in a PR should be analysed.
 * Extends the review planner with:
 *   - `.groompilotignore` support (gitignore-like patterns)
 *   - Risk classification per file
 *   - Language detection
 *   - Required deterministic check IDs
 *   - Required SAST tool selection
 *   - Human-escalation role hints
 *   - Estimated complexity scoring
 */

import * as fs from "fs";
import * as path from "path";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TriageAction = "SKIP" | "SCAN_ONLY" | "FULL_REVIEW" | "HUMAN_ESCALATION";

export interface FileTriageDecision {
  /** Relative file path */
  file: string;
  /** The decided action tier */
  action: TriageAction;
  /** Human-readable reasons */
  reasons: string[];
  /** Risk classification derived from triage signals */
  risk: "low" | "medium" | "high" | "critical";
  /** Detected language (best-effort) */
  language: string | null;
  /** Inferred subsystem label */
  subsystem: string | null;
  /** Sensitivity tags */
  sensitivity: string[];
  /** Estimated complexity (heuristic from patch size + language) */
  estimatedComplexity: "trivial" | "low" | "medium" | "high";
  /** Cap on AI findings for this unit (guards output budget) */
  maxAiFindingsForUnit: number;
  /** IDs of deterministic check families required */
  requiredDeterministicChecks: string[];
  /** SAST tools to run for this file (empty if none configured) */
  requiredSastTools: string[];
  /** Human role hints for escalation (e.g. "payments-sme", "security-reviewer") */
  requiresHumanRole: string[];
}

// ─── .groompilotignore ────────────────────────────────────────────────────────

let cachedIgnorePatterns: RegExp[] | null = null;

function loadGroompilotIgnore(repoRoot?: string): RegExp[] {
  if (cachedIgnorePatterns) return cachedIgnorePatterns;

  const roots = [
    repoRoot,
    process.env.GROOMPILOT_REPO_ROOT,
    process.cwd(),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    const ignorePath = path.join(root, ".groompilotignore");
    try {
      const content = fs.readFileSync(ignorePath, "utf8");
      cachedIgnorePatterns = parseIgnorePatterns(content);
      return cachedIgnorePatterns;
    } catch {
      // file doesn't exist, try next
    }
  }

  cachedIgnorePatterns = [];
  return cachedIgnorePatterns;
}

/**
 * Parse gitignore-like patterns into RegExps.
 * Supports: `*` (glob), `**` (recursive), `#` comments, `!` negation (not yet).
 */
export function parseIgnorePatterns(content: string): RegExp[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => !line.startsWith("!")) // negation not supported yet
    .map((pattern) => {
      // Convert gitignore glob to regex
      let regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (except * and ?)
        .replace(/\*\*/g, "<<<GLOBSTAR>>>")
        .replace(/\*/g, "[^/]*")
        .replace(/<<<GLOBSTAR>>>/g, ".*")
        .replace(/\?/g, "[^/]");

      // If pattern starts with /, anchor to root; otherwise match anywhere
      if (regex.startsWith("/")) {
        regex = "^" + regex.slice(1);
      }
      // If pattern ends with /, match directory prefix
      if (regex.endsWith("/")) {
        regex = regex + ".*";
      }

      return new RegExp(regex, "i");
    });
}

function isIgnoredByGroompilotIgnore(filePath: string, repoRoot?: string): boolean {
  const patterns = loadGroompilotIgnore(repoRoot);
  return patterns.some((re) => re.test(filePath));
}

/** Reset the ignore cache (for testing). */
export function resetIgnoreCache(): void {
  cachedIgnorePatterns = null;
}

// ─── Language detection ───────────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  ".java": "java",
  ".groovy": "groovy",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".h": "c",
  ".hh": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".tf": "terraform",
  ".hcl": "hcl",
};

function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}

// ─── File classification helpers ──────────────────────────────────────────────

const GENERATED_PATTERNS = [
  /(^|\/)(dist|build|coverage|generated|gen|out|target)\//i,
  /\.generated\.(ts|js|java|py|cs)$/i,
  /(_pb2\.py|\.pb\.java|\.g\.java|\.designer\.cs|\.min\.js|\.map)$/i,
  /(^|\/)(node_modules|vendor|third_party)\//i,
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".tiff",
  ".pdf", ".docx", ".xlsx", ".pptx", ".odt",
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".jar", ".war", ".ear", ".class",
  ".so", ".dylib", ".dll", ".exe", ".bin",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".ttf", ".otf", ".woff", ".woff2",
]);

const LOCKFILE_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /Gemfile\.lock$/i,
  /poetry\.lock$/i,
  /Cargo\.lock$/i,
  /composer\.lock$/i,
  /\.lock$/i,
];

function isGenerated(filePath: string, patchOrContent?: string): boolean {
  if (GENERATED_PATTERNS.some((re) => re.test(filePath))) return true;
  if (patchOrContent) {
    const lower = patchOrContent.slice(0, 1500).toLowerCase();
    if (/generated by|auto-generated|autogenerated|do not edit|codegen/.test(lower)) return true;
  }
  return false;
}

function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function isLockfile(filePath: string): boolean {
  return LOCKFILE_PATTERNS.some((re) => re.test(filePath));
}

// ─── Sensitivity detection ────────────────────────────────────────────────────

const SENSITIVITY_SIGNALS: Array<{ tag: string; pathPattern: RegExp; patchPattern?: RegExp }> = [
  { tag: "auth", pathPattern: /(auth|login|session|token|jwt|oauth|saml|sso|credential|identity)/i, patchPattern: /(authenticate|authorize|hasRole|@Secured|@PreAuthorize|session\.set|jwt\.sign)/i },
  { tag: "money-movement", pathPattern: /(payment|transfer|ledger|settlement|billing|invoice|fund|balance|debit|credit)/i, patchPattern: /(transfer|debit|credit|settle|charge|refund)/i },
  { tag: "crypto", pathPattern: /(crypt|cipher|encrypt|decrypt|hash|key|cert|tls|ssl)/i, patchPattern: /(Cipher|MessageDigest|KeyGenerator|SecretKey|PrivateKey|encrypt|decrypt|hash)/i },
  { tag: "pii", pathPattern: /(customer|user|profile|personal|address|ssn|social|passport|driver)/i, patchPattern: /(cardNumber|pan|cvv|ssn|socialSecurity|dateOfBirth|passportNumber)/i },
  { tag: "migrations", pathPattern: /(migration|flyway|liquibase|schema|alter|ddl)/i, patchPattern: /(ALTER TABLE|CREATE TABLE|DROP TABLE|ADD COLUMN|RENAME)/i },
];

function detectSensitivity(filePath: string, patch?: string): string[] {
  const tags: string[] = [];
  for (const signal of SENSITIVITY_SIGNALS) {
    if (signal.pathPattern.test(filePath)) {
      tags.push(signal.tag);
    } else if (patch && signal.patchPattern?.test(patch)) {
      tags.push(signal.tag);
    }
  }
  return [...new Set(tags)];
}

// ─── Subsystem inference ──────────────────────────────────────────────────────

function inferSubsystem(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (/(auth|login|session|oauth|sso|jwt)/i.test(lower)) return "auth";
  if (/(payment|transfer|settlement|billing|ledger)/i.test(lower)) return "payments";
  if (/(migration|flyway|liquibase|ddl|schema)/i.test(lower)) return "data";
  if (/(test|spec|fixture)/i.test(lower)) return "test";
  if (/(config|properties|application\.|settings)/i.test(lower)) return "config";
  if (/(api|route|controller|handler|endpoint)/i.test(lower)) return "api";
  if (/(service|usecase|domain|model)/i.test(lower)) return "domain";
  if (/(repository|dao|store|mapper)/i.test(lower)) return "persistence";
  return null;
}

// ─── Complexity estimation ────────────────────────────────────────────────────

function estimateComplexity(
  additions: number,
  deletions: number,
  language: string | null,
): "trivial" | "low" | "medium" | "high" {
  const churn = additions + deletions;
  if (churn === 0) return "trivial";
  if (churn <= 20) return "trivial";
  if (churn <= 80) return "low";
  if (churn <= 250) return "medium";
  return "high";
}

// ─── Deterministic check selection ────────────────────────────────────────────

function selectDeterministicChecks(
  language: string | null,
  sensitivity: string[],
): string[] {
  const checks: string[] = ["hardcoded-secrets", "fail-open-validation"];

  if (language === "java" || language === "groovy" || language === "kotlin") {
    checks.push(
      "java-deserialization", "java-reflection", "orm-query-injection",
      "crypto-misuse", "ssrf", "path-traversal", "xss", "xxe",
      "command-injection", "zip-slip", "weak-rng", "trust-all-tls",
      "sensitive-logging", "missing-timeout",
    );
  }

  if (language === "python") {
    checks.push(
      "python-deserialization", "python-subprocess", "python-unsafe-io",
      "ssrf", "path-traversal",
    );
  }

  if (language === "typescript" || language === "javascript") {
    checks.push(
      "js-child-process", "prototype-pollution", "xss-template",
      "ssrf", "path-traversal", "open-redirect",
    );
  }

  if (language === "c" || language === "cpp") {
    checks.push("c-unsafe-buffer", "format-string");
  }

  if (sensitivity.includes("auth")) {
    checks.push("auth-guard-removal", "authz-bypass");
  }
  if (sensitivity.includes("money-movement")) {
    checks.push("decimal-precision", "idempotency-guard", "pci-logging");
  }
  if (sensitivity.includes("pii")) {
    checks.push("pci-logging");
  }

  return [...new Set(checks)];
}

function selectSastTools(): string[] {
  const tools: string[] = [];
  if (process.env.SEMGREP_ENABLED === "true") tools.push("semgrep");
  if (process.env.CODEQL_ENABLED === "true") tools.push("codeql");
  return tools;
}

// ─── Risk classification ─────────────────────────────────────────────────────

function classifyRisk(
  action: TriageAction,
  sensitivity: string[],
  complexity: "trivial" | "low" | "medium" | "high",
): "low" | "medium" | "high" | "critical" {
  if (action === "HUMAN_ESCALATION") return "critical";
  if (sensitivity.includes("money-movement") && sensitivity.includes("auth")) return "critical";
  if (sensitivity.includes("money-movement") || sensitivity.includes("auth") || sensitivity.includes("crypto")) {
    return complexity === "high" ? "critical" : "high";
  }
  if (sensitivity.includes("pii") || sensitivity.includes("migrations")) return "high";
  if (complexity === "high") return "medium";
  if (action === "SCAN_ONLY" || action === "SKIP") return "low";
  return "medium";
}

// ─── Human role selection ─────────────────────────────────────────────────────

function selectHumanRoles(sensitivity: string[]): string[] {
  const roles: string[] = [];
  if (sensitivity.includes("money-movement")) roles.push("payments-sme");
  if (sensitivity.includes("auth") || sensitivity.includes("crypto")) roles.push("security-reviewer");
  if (sensitivity.includes("pii")) roles.push("privacy-reviewer");
  if (sensitivity.includes("migrations")) roles.push("dba-reviewer");
  return roles;
}

// ─── Interface change detection ───────────────────────────────────────────────

/**
 * Check whether a Java interface change is truly "interface-only" and safe
 * to SCAN_ONLY, or if it needs FULL_REVIEW due to signature/annotation changes.
 */
function isSemanticInterfaceChange(patch: string, language: string | null): boolean {
  if (language !== "java" && language !== "kotlin" && language !== "groovy") return false;

  // If interface signatures, generics, or annotations changed → NOT safe to skip
  const signatureChange = /^\+.*\b(public|protected|default)\s+\S+\s+\w+\s*\(/m.test(patch);
  const genericChange = /^\+.*<[^>]+>/m.test(patch);
  const annotationChange = /^\+.*@(Override|Deprecated|FunctionalInterface|Target|Retention)/m.test(patch);
  const extendsChange = /^\+.*\b(extends|implements)\s+/m.test(patch);

  return signatureChange || genericChange || annotationChange || extendsChange;
}

// ─── Max AI findings budget ──────────────────────────────────────────────────

function maxAiFindingsBudget(action: TriageAction, complexity: "trivial" | "low" | "medium" | "high"): number {
  if (action === "SKIP" || action === "SCAN_ONLY") return 0;
  switch (complexity) {
    case "trivial": return 3;
    case "low": return 5;
    case "medium": return 8;
    case "high": return 12;
  }
}

// ─── Infra/config sensitivity check ──────────────────────────────────────────

function isHighRiskInfraConfig(filePath: string, patch?: string): boolean {
  const infraSensitivePatterns = [
    /auth|oauth|saml|sso|jwt/i,
    /tls|ssl|cert/i,
    /endpoint|baseurl|host/i,
    /secret|password|token|key/i,
    /payment|settlement|transfer/i,
  ];
  return infraSensitivePatterns.some((re) => re.test(filePath) || (patch && re.test(patch)));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TriageFileParams {
  filePath: string;
  patch?: string;
  fullContent?: string;
  additions?: number;
  deletions?: number;
  status?: "added" | "modified" | "removed" | "renamed";
  repoRoot?: string;
  /** If true, the file was classified as generated by upstream triage */
  generated?: boolean;
  /** If true, the file was classified as pure interface by upstream triage */
  pureInterface?: boolean;
  /** If true, the file is an infra/config file */
  infraConfig?: boolean;
  /** Blast radius from upstream triage */
  blastRadius?: "low" | "medium" | "high";
}

/**
 * Triage a single file and produce a FileTriageDecision.
 * This is the enriched, standalone triage that feeds into the review planner.
 */
export function triageFile(params: TriageFileParams): FileTriageDecision {
  const {
    filePath,
    patch,
    fullContent,
    additions = 0,
    deletions = 0,
    repoRoot,
    generated = false,
    pureInterface = false,
    infraConfig = false,
    blastRadius = "low",
  } = params;

  const reasons: string[] = [];
  const language = detectLanguage(filePath);
  const subsystem = inferSubsystem(filePath);
  const sensitivity = detectSensitivity(filePath, patch);
  const complexity = estimateComplexity(additions, deletions, language);
  const content = patch || fullContent || "";

  // ── SKIP tier ──────────────────────────────────────────────────────────────

  if (isIgnoredByGroompilotIgnore(filePath, repoRoot)) {
    reasons.push("matched .groompilotignore pattern");
    return buildDecision(filePath, "SKIP", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  if (generated || isGenerated(filePath, content)) {
    reasons.push("generated/vendored/auto-produced file");
    return buildDecision(filePath, "SKIP", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  if (isBinary(filePath)) {
    reasons.push("binary blob — not reviewable");
    return buildDecision(filePath, "SKIP", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  if (isLockfile(filePath)) {
    reasons.push("lock file — deterministic output, not hand-written");
    return buildDecision(filePath, "SKIP", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  // ── HUMAN_ESCALATION tier ──────────────────────────────────────────────────

  if (sensitivity.includes("money-movement") && sensitivity.includes("auth")) {
    reasons.push("touches both money-movement and auth domains");
    return buildDecision(filePath, "HUMAN_ESCALATION", reasons, "critical", language, subsystem, sensitivity, complexity);
  }

  if (sensitivity.includes("money-movement") && sensitivity.includes("migrations")) {
    reasons.push("money-movement logic combined with migration changes");
    return buildDecision(filePath, "HUMAN_ESCALATION", reasons, "critical", language, subsystem, sensitivity, complexity);
  }

  if (infraConfig && isHighRiskInfraConfig(filePath, patch)) {
    reasons.push("infra/config change touching auth, TLS, secrets, or payment routing");
    return buildDecision(filePath, "HUMAN_ESCALATION", reasons, "high", language, subsystem, sensitivity, complexity);
  }

  // ── FULL_REVIEW tier ───────────────────────────────────────────────────────

  if (sensitivity.length > 0) {
    reasons.push(`sensitive domain(s): ${sensitivity.join(", ")}`);
    return buildDecision(filePath, "FULL_REVIEW", reasons, classifyRisk("FULL_REVIEW", sensitivity, complexity), language, subsystem, sensitivity, complexity);
  }

  if (complexity === "high") {
    reasons.push(`large change (${additions + deletions} lines)`);
    return buildDecision(filePath, "FULL_REVIEW", reasons, "medium", language, subsystem, sensitivity, complexity);
  }

  if (blastRadius === "high") {
    reasons.push("high blast radius");
    return buildDecision(filePath, "FULL_REVIEW", reasons, "medium", language, subsystem, sensitivity, complexity);
  }

  // Java interface with semantic changes → FULL_REVIEW
  if (pureInterface && content && isSemanticInterfaceChange(content, language)) {
    reasons.push("interface change with signature/annotation/extends modifications");
    return buildDecision(filePath, "FULL_REVIEW", reasons, "medium", language, subsystem, sensitivity, complexity);
  }

  // ── SCAN_ONLY tier ─────────────────────────────────────────────────────────

  if (infraConfig) {
    reasons.push("infrastructure/configuration file — deterministic checks only");
    return buildDecision(filePath, "SCAN_ONLY", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  if (pureInterface && !isSemanticInterfaceChange(content, language)) {
    reasons.push("pure interface/type with no semantic changes");
    return buildDecision(filePath, "SCAN_ONLY", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  if (subsystem === "test") {
    reasons.push("test/spec file — scan for coverage signals");
    return buildDecision(filePath, "SCAN_ONLY", reasons, "low", language, subsystem, sensitivity, complexity);
  }

  // ── Default: FULL_REVIEW ───────────────────────────────────────────────────
  reasons.push("application source — full review");
  const risk = classifyRisk("FULL_REVIEW", sensitivity, complexity);
  return buildDecision(filePath, "FULL_REVIEW", reasons, risk, language, subsystem, sensitivity, complexity);
}

function buildDecision(
  file: string,
  action: TriageAction,
  reasons: string[],
  risk: "low" | "medium" | "high" | "critical",
  language: string | null,
  subsystem: string | null,
  sensitivity: string[],
  complexity: "trivial" | "low" | "medium" | "high",
): FileTriageDecision {
  return {
    file,
    action,
    reasons,
    risk,
    language,
    subsystem,
    sensitivity,
    estimatedComplexity: complexity,
    maxAiFindingsForUnit: maxAiFindingsBudget(action, complexity),
    requiredDeterministicChecks: action === "SKIP" ? [] : selectDeterministicChecks(language, sensitivity),
    requiredSastTools: (action === "SKIP") ? [] : selectSastTools(),
    requiresHumanRole: action === "HUMAN_ESCALATION" ? selectHumanRoles(sensitivity) : [],
  };
}

/**
 * Batch triage all files in a PR.
 */
export function triageFiles(
  files: Array<TriageFileParams>,
): FileTriageDecision[] {
  return files.map(triageFile);
}
