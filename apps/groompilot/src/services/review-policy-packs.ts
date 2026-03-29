import type { PRFile, PRTriage, ReviewSurfaceMode } from "./pr-review";
import type { TreeSitterFileContext } from "./tree-sitter-context";

export type PolicyPack =
  | "bugs-correctness"
  | "security-owasp"
  | "injection"
  | "auth-authz"
  | "performance"
  | "memory-resource"
  | "locking-concurrency"
  | "maintainability"
  | "solid-clean-code"
  | "business-logic"
  | "compliance-pci"
  | "fintech-aci";

export type StrictIssueType =
  | "BUG"
  | "SECURITY"
  | "OWASP"
  | "INJECTION"
  | "PERF"
  | "MEMORY"
  | "LOCKING"
  | "MAINTAINABILITY"
  | "SOLID"
  | "CLEAN_CODE"
  | "BUSINESS_LOGIC"
  | "COMPLIANCE";

export interface PolicyFinding {
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
  ruleRefs?: string[];
  needsHumanReview: boolean;
}

function stableId(prefix: string, file: string, line?: number): string {
  const base = `${prefix}:${file}:${line || 0}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return `${prefix}-${Math.abs(hash)}`;
}

function hasRegex(text: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
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
    if (line.startsWith("-")) continue;
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

function inferReviewModeFromPath(path: string): ReviewSurfaceMode {
  const lower = path.toLowerCase();
  if (/\.(java|groovy|c|cc|cpp|cxx|h|hh|hpp|hxx|ts|tsx|js|jsx|py)$/.test(lower)) return "code";
  if (/\.(sh|bash|groovy|kts)$/.test(lower) || /(^|\/)jenkinsfile([-.].+)?$/.test(lower)) return "code";
  if (/(^|\/)dockerfile([-.].+)?$/.test(lower) || /\.(tf|hcl)$/.test(lower) || /\/templates\/.*\.ya?ml$/.test(lower)) {
    return "executable-template";
  }
  if (/(^|\/)(\.github\/workflows|github\/workflows)\//.test(lower) || /(^|\/)(jenkins|pipeline|workflows?)\b/.test(lower)) return "ci-pipeline";
  if (/(^|\/)(openapi|swagger)\b/.test(lower) || /\.(avsc)$/.test(lower)) return "api-schema";
  if (/bruno|postman|insomnia|collection/.test(lower)) return "api-collection";
  if (/(^|\/)(replay-fixtures|fixtures?|mocks?|samples?|examples?)\//.test(lower)) return "fixture-data";
  if (/\.(md|mdx|txt|rst|adoc|prompt\.md)$/.test(lower)) return "docs";
  if (/\.(puml|plantuml|drawio|mmd)$/.test(lower)) return "diagram";
  if (/(^|\/)(package\.json|package-lock\.json|pom\.xml|build\.gradle|settings\.gradle|tsconfig\.json|vite\.config\.(ts|js)|tailwind\.config\.js)$/.test(lower)) return "manifest";
  return "infra-config";
}

function resolveReviewMode(file: PRFile, triage: PRTriage): ReviewSurfaceMode {
  const metadata = triage.files.find((candidate) => candidate.file === file.filename);
  return metadata?.reviewMode || inferReviewModeFromPath(file.filename);
}

function isCodeLikeReviewMode(mode: ReviewSurfaceMode): boolean {
  return mode === "code" || mode === "executable-template";
}

function hasHardcodedSecretInAddedLines(patch: string): boolean {
  return hasRegex(
    patch,
    /^\+.*(?:password|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*["']?(?!\$\{|\$\()[A-Za-z0-9+\/_=.-]{8,}/im,
  );
}

function findHardcodedSecretLine(patch: string): number | undefined {
  return findExactAddedLine(
    patch,
    [/(password|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*["']?(?!\$\{|\$\()[A-Za-z0-9+\/_=.-]{8,}/i],
  );
}

function looksLikeInsecureTlsOrUrlConfig(patch: string): boolean {
  return hasRegex(patch, /^\+.*(?:https?:\/\/|baseUrl|endpoint|url)\s*[:=].*/im)
    && hasRegex(patch, /(verify\s*ssl\s*[:=]\s*false|strictssl\s*[:=]\s*false|insecure\s*[:=]\s*true|rejectUnauthorized\s*[:=]\s*false)/i);
}

function containsPrivilegedContainerPattern(patch: string): boolean {
  return hasRegex(patch, /^\+.*(?:privileged\s*:\s*true|allowPrivilegeEscalation\s*:\s*true|hostNetwork\s*:\s*true|hostPID\s*:\s*true|runAsUser\s*:\s*0)\b/im);
}

function containsUnpinnedImagePattern(patch: string): boolean {
  return hasRegex(patch, /^\+.*image\s*:\s*[^\s:]+(?::latest)?\s*$/im);
}

export function selectPolicyPacks(
  triage: PRTriage,
  astContexts: TreeSitterFileContext[],
): PolicyPack[] {
  const packs = new Set<PolicyPack>([
    "bugs-correctness",
    "security-owasp",
    "injection",
    "maintainability",
    "business-logic",
  ]);

  const allSensitive = new Set(triage.sensitivity);
  const highRisk = triage.highRiskCategories.join(" ").toLowerCase();
  const securityApis = astContexts.flatMap((ctx) => ctx.securitySensitiveApis);

  if (allSensitive.has("auth") || hasRegex(highRisk, /auth|security|jwt|oauth/)) {
    packs.add("auth-authz");
  }
  if (allSensitive.has("money-movement") || hasRegex(highRisk, /payment|money|ledger|transaction/)) {
    packs.add("fintech-aci");
    packs.add("compliance-pci");
  }
  if (allSensitive.has("pii") || hasRegex(highRisk, /pii|sensitive|card|pan|pci/)) {
    packs.add("compliance-pci");
  }

  if (securityApis.some((api) => api.includes("process") || api.includes("network"))) {
    packs.add("security-owasp");
  }
  if (securityApis.some((api) => api.includes("sql"))) {
    packs.add("injection");
  }
  if (securityApis.some((api) => api.includes("file"))) {
    packs.add("memory-resource");
  }

  // Always include these pragmatic categories.
  packs.add("performance");
  packs.add("locking-concurrency");
  packs.add("solid-clean-code");

  return [...packs];
}

export function derivePolicyFindingsFromDiff(
  files: PRFile[],
  triage: PRTriage,
  selectedPacks: PolicyPack[],
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];

  for (const file of files) {
    const patch = file.patch || "";
    if (!patch) continue;

    const firstChangedLine = extractFirstChangedLine(patch);
    const lowerPath = file.filename.toLowerCase();
    const reviewMode = resolveReviewMode(file, triage);
    const codeLikeMode = isCodeLikeReviewMode(reviewMode);

    if (!codeLikeMode) {
      if (hasHardcodedSecretInAddedLines(patch)) {
        const exactLine = findHardcodedSecretLine(patch);
        findings.push({
          id: stableId("NCSEC", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "SECURITY",
          severity: "high",
          confidence: "high",
          title: "Potential hardcoded credential in non-code file",
          description: "Added content appears to include a literal secret/token/password value in a config, data, or documentation artifact.",
          whyItMatters: "Hardcoded credentials can leak through source control and make secret rotation difficult.",
          fix: "Replace literal values with secret references (environment variables, vault references, secretKeyRef/configMapKeyRef) and rotate exposed credentials.",
          ruleRefs: ["NC-CONFIG-SECRET", "CWE-798"],
          needsHumanReview: true,
        });
      }

      if ((reviewMode === "api-collection" || reviewMode === "infra-config" || reviewMode === "ci-pipeline") && looksLikeInsecureTlsOrUrlConfig(patch)) {
        const exactLine = findExactAddedLine(patch, [/verify\s*ssl\s*[:=]\s*false|strictssl\s*[:=]\s*false|insecure\s*[:=]\s*true|rejectUnauthorized\s*[:=]\s*false/i]);
        findings.push({
          id: stableId("NCTLS", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "SECURITY",
          severity: "medium",
          confidence: "medium",
          title: "Insecure transport verification setting",
          description: "The change appears to disable TLS/certificate verification in a non-code configuration artifact.",
          whyItMatters: "Disabling certificate verification can enable man-in-the-middle interception and weakens environment security posture.",
          fix: "Enable strict TLS verification and use trusted CA bundles/cert pinning for internal endpoints where required.",
          ruleRefs: ["NC-CONFIG-SECURITY", "OWASP-A02"],
          needsHumanReview: true,
        });
      }

      if ((reviewMode === "infra-config" || reviewMode === "executable-template") && containsPrivilegedContainerPattern(patch)) {
        const exactLine = findExactAddedLine(patch, [/privileged\s*:\s*true|allowPrivilegeEscalation\s*:\s*true|hostNetwork\s*:\s*true|hostPID\s*:\s*true|runAsUser\s*:\s*0/i]);
        findings.push({
          id: stableId("NCPRV", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "COMPLIANCE",
          severity: "high",
          confidence: "high",
          title: "Privileged container runtime setting",
          description: "The diff introduces a privileged or host-level container security setting.",
          whyItMatters: "Privileged runtime settings can broaden escape and lateral movement risk in containerized workloads.",
          fix: "Use least-privilege container settings, drop unnecessary capabilities, and avoid host-level namespace sharing.",
          ruleRefs: ["NC-INFRA-CONTAINER", "K8S-POD-SECURITY"],
          needsHumanReview: true,
        });
      }

      if ((reviewMode === "infra-config" || reviewMode === "executable-template") && containsUnpinnedImagePattern(patch)) {
        const exactLine = findExactAddedLine(patch, [/image\s*:\s*[^\s:]+(?::latest)?\s*$/i]);
        findings.push({
          id: stableId("NCIMG", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "MAINTAINABILITY",
          severity: "medium",
          confidence: "medium",
          title: "Container image appears unpinned",
          description: "The diff uses an image reference that may not be pinned to a deterministic version.",
          whyItMatters: "Mutable image tags reduce deployment reproducibility and can introduce unexpected runtime changes.",
          fix: "Pin image tags (or digest) explicitly and align with release policy for controlled upgrades.",
          ruleRefs: ["NC-INFRA-CONTAINER", "SUPPLY-CHAIN"],
          needsHumanReview: true,
        });
      }
    }

    if (codeLikeMode && (selectedPacks.includes("injection") || selectedPacks.includes("security-owasp"))) {
      if (hasRegex(patch, /\+.*(SELECT|UPDATE|DELETE|INSERT).*(\+|\$\{|"\s*\+)/i) || hasRegex(patch, /\+.*createStatement\s*\(/i)) {
        const exactLine = findExactAddedLine(patch, [/\b(select|update|delete|insert)\b.*(\+|\$\{|"\s*\+)/i, /createstatement\s*\(/i]);
        findings.push({
          id: stableId("INJ", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "INJECTION",
          severity: "high",
          confidence: "medium",
          title: "Potential SQL construction from dynamic input",
          description: "The diff appears to build SQL dynamically via string concatenation or raw statement execution.",
          whyItMatters: "Dynamic SQL composition increases injection risk and bypasses query plan safety.",
          fix: "Use parameterized queries or ORM parameter binding (PreparedStatement, named params, repository query params).",
          ruleRefs: ["OWASP-A03", "CWE-89"],
          needsHumanReview: true,
        });
      }
    }

    if (codeLikeMode && selectedPacks.includes("auth-authz")) {
      const removedAuthGuard = hasRegex(patch, /^-.*@(PreAuthorize|Secured|RolesAllowed)/m) || hasRegex(patch, /^-.*hasRole\(/m);
      if (removedAuthGuard) {
        findings.push({
          id: stableId("AUTH", file.filename, firstChangedLine),
          file: file.filename,
          line: firstChangedLine,
          type: "SECURITY",
          severity: "high",
          confidence: "high",
          title: "Authorization guard removed",
          description: "The change removes an authorization annotation or role check.",
          whyItMatters: "Guard removals can create privilege escalation or unauthorized data access paths.",
          fix: "Reinstate equivalent authorization checks or document and test the intended policy change.",
          ruleRefs: ["OWASP-A01", "AUTHZ-GUARD"],
          needsHumanReview: true,
        });
      }
    }

    if (codeLikeMode && selectedPacks.includes("memory-resource")) {
      const addsFileOrStream = hasRegex(patch, /^\+.*(FileInputStream|FileOutputStream|new\s+Socket\s*\()/m);
      const hasTryWithResources = hasRegex(patch, /^\+.*try\s*\([^)]*\)/m);
      if (addsFileOrStream && !hasTryWithResources) {
        const exactLine = findExactAddedLine(patch, [/(FileInputStream|FileOutputStream|new\s+Socket\s*\()/i]);
        findings.push({
          id: stableId("MEM", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          type: "MEMORY",
          severity: "medium",
          confidence: "medium",
          title: "Resource acquisition without clear lifecycle guard",
          description: "A resource allocation was added without obvious try-with-resources or close handling in the same diff.",
          whyItMatters: "Unreleased resources can cause descriptor leaks, connection starvation, and degraded service reliability.",
          fix: "Wrap resource usage in try-with-resources (or equivalent) and ensure deterministic close paths.",
          ruleRefs: ["RESOURCE-LIFECYCLE"],
          needsHumanReview: true,
        });
      }
    }

    if (codeLikeMode && selectedPacks.includes("locking-concurrency")) {
      const removedSync = hasRegex(patch, /^-.*\bsynchronized\b/m) || hasRegex(patch, /^-.*ReentrantLock/m);
      if (removedSync) {
        findings.push({
          id: stableId("LOCK", file.filename, firstChangedLine),
          file: file.filename,
          line: firstChangedLine,
          type: "LOCKING",
          severity: "medium",
          confidence: "low",
          title: "Potential concurrency guard removal",
          description: "The diff removes synchronization or lock usage.",
          whyItMatters: "Removing concurrency controls can introduce races and non-deterministic failures under load.",
          fix: "Confirm thread-safety strategy, update locking discipline tests, and validate with concurrent load tests.",
          ruleRefs: ["CONCURRENCY-RACE"],
          needsHumanReview: true,
        });
      }
    }

    // ── OWASP extended: SSRF detection (policy-level) ──
    if (codeLikeMode && (selectedPacks.includes("security-owasp") || selectedPacks.includes("injection"))) {
      const ssrfPattern = hasRegex(patch, /^\+.*(new\s+URL\s*\(|openConnection\s*\(|HttpURLConnection|restTemplate\.(get|post|exchange)\(|webClient\.(get|post)\(\)|requests\.(get|post)\(|fetch\s*\(|axios\.(get|post)\(|urllib)/im);
      const hasUserInput = hasRegex(patch, /^\+.*(request\.|param|getParameter|@RequestParam|query\.|req\.body|req\.query|req\.params|user_input|args\[)/im);
      const hasValidation = hasRegex(patch, /(allowlist|whitelist|allowedHosts|validat(e|ed|ion)|sanitiz(e|ed)|PERMITTED_HOSTS)/i);
      if (ssrfPattern && hasUserInput && !hasValidation) {
        const exactLine = findExactAddedLine(patch, [/new\s+URL\s*\(/i, /restTemplate\./i, /webClient\./i, /requests\.(get|post)\(/i, /fetch\s*\(/i, /axios\./i]);
        findings.push({
          id: stableId("SSRF", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "SECURITY",
          severity: "high",
          confidence: "medium",
          title: "Server-side request with user-controlled target",
          description: "Outbound HTTP request target appears to be derived from user input without visible destination validation.",
          whyItMatters: "SSRF can expose internal services, cloud metadata endpoints, and bypass network controls.",
          fix: "Validate URLs against an explicit allowlist of permitted schemes and hosts. Block internal/metadata ranges.",
          ruleRefs: ["OWASP-A10", "CWE-918"],
          needsHumanReview: true,
        });
      }
    }

    // ── OWASP extended: Path traversal (policy-level) ──
    if (codeLikeMode && (selectedPacks.includes("security-owasp") || selectedPacks.includes("injection"))) {
      const pathOps = hasRegex(patch, /^\+.*(new\s+File\s*\(|Paths\.get\s*\(|open\s*\(|readFile\s*\(|writeFile\s*\(|fs\.(read|write)|os\.path\.join\s*\()/im);
      const hasUserPath = hasRegex(patch, /^\+.*(request\.|param|getParameter|@RequestParam|@PathVariable|req\.body|req\.query|req\.params|user_input|fileName|filePath|uploadPath)/im);
      const hasGuard = hasRegex(patch, /(normalize|canonical|realPath|resolve|allowedDir|validatePath|startsWith\(baseDir)/i);
      if (pathOps && hasUserPath && !hasGuard) {
        const exactLine = findExactAddedLine(patch, [/new\s+File\s*\(/i, /Paths\.get\s*\(/i, /open\s*\(/i, /readFile\s*\(/i, /os\.path\.join/i]);
        findings.push({
          id: stableId("PATH", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "SECURITY",
          severity: "high",
          confidence: "medium",
          title: "File path from user input without traversal guard",
          description: "File system operation uses a path that may be derived from user input without canonicalization or base-directory validation.",
          whyItMatters: "Path traversal can read/write arbitrary files, escalate access, or overwrite configuration.",
          fix: "Normalize paths canonically and verify they resolve within the intended base directory.",
          ruleRefs: ["OWASP-A01", "CWE-22"],
          needsHumanReview: true,
        });
      }
    }

    // ── OWASP extended: XSS/template injection (policy-level) ──
    if (codeLikeMode && (selectedPacks.includes("security-owasp") || selectedPacks.includes("injection"))) {
      if (hasRegex(patch, /^\+.*(innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|v-html\s*=|\.html\s*\(|res\.send\s*\(\s*[`'"<])/im) &&
        !hasRegex(patch, /(sanitize|DOMPurify|escapeHtml|encode|xss)/i)) {
        const exactLine = findExactAddedLine(patch, [/innerHTML\s*=/i, /dangerouslySetInnerHTML/i, /document\.write\s*\(/i, /v-html/i]);
        findings.push({
          id: stableId("XSS", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          endLine: exactLine || firstChangedLine,
          type: "INJECTION",
          severity: "high",
          confidence: "medium",
          title: "HTML injection sink without sanitization",
          description: "Detected direct HTML rendering without visible encoding or sanitization.",
          whyItMatters: "Unsanitized HTML output enables cross-site scripting (XSS) attacks.",
          fix: "Use framework-provided encoding, DOMPurify, or escape functions before rendering untrusted content.",
          ruleRefs: ["OWASP-A03", "CWE-79"],
          needsHumanReview: true,
        });
      }
    }

    if (selectedPacks.includes("compliance-pci") || selectedPacks.includes("fintech-aci")) {
      const logsCardData = hasRegex(patch, /^\+.*(cardNumber|pan|cvv|track2|accountNumber).*(log\.|logger\.)/im)
        || hasRegex(patch, /^\+.*(logger\.|log\.).*(cardNumber|pan|cvv|track2|accountNumber)/im);
      if (logsCardData || (lowerPath.includes("payment") && hasRegex(patch, /^\+.*(cardNumber|pan|cvv|track2)/im))) {
        const exactLine = findExactAddedLine(patch, [/(cardNumber|pan|cvv|track2|accountNumber).*(log\.|logger\.)/i, /(logger\.|log\.).*(cardNumber|pan|cvv|track2|accountNumber)/i, /(cardNumber|pan|cvv|track2)/i]);
        findings.push({
          id: stableId("PCI", file.filename, exactLine || firstChangedLine),
          file: file.filename,
          line: exactLine || firstChangedLine,
          type: "COMPLIANCE",
          severity: "critical",
          confidence: "medium",
          title: "Potential PCI-sensitive data exposure",
          description: "The change appears to use or log cardholder-sensitive fields.",
          whyItMatters: "Sensitive payment data handling may violate PCI-DSS controls and increase breach impact.",
          fix: "Avoid logging PAN/CVV-like values, apply tokenization/redaction, and enforce field-level masking in telemetry.",
          ruleRefs: ["PCI-DSS-3", "PCI-DSS-10"],
          needsHumanReview: true,
        });
      }

      const idempotencyRisk = lowerPath.includes("payment") && hasRegex(patch, /^\+.*(retry|reprocess|replay)/im) && !hasRegex(patch, /(idempotency|dedup|deduplicate|requestId|transactionId)/i);
      if (idempotencyRisk) {
        findings.push({
          id: stableId("BIZ", file.filename, firstChangedLine),
          file: file.filename,
          line: firstChangedLine,
          type: "BUSINESS_LOGIC",
          severity: "high",
          confidence: "low",
          title: "Retry path without clear idempotency guard",
          description: "A money-movement retry/reprocess path appears without explicit idempotency or dedup safeguards in the patch.",
          whyItMatters: "Non-idempotent retries can trigger duplicate financial operations and reconciliation incidents.",
          fix: "Add idempotency keys/dedup checks and tests for duplicate replay prevention.",
          ruleRefs: ["FINTECH-IDEMPOTENCY", "ACI-MONEY-MOVEMENT"],
          needsHumanReview: true,
        });
      }
    }
  }

  // Deterministic ordering for auditability.
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.line || 0) - (b.line || 0);
  });

  // Deduplicate by title/file/line/type.
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.file}:${f.line || 0}:${f.type}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractFirstChangedLine(patch: string): number | undefined {
  const m = patch.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? Number(m[1]) : undefined;
}
