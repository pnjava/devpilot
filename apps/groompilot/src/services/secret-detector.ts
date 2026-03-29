/**
 * GroomPilot Secret Detector
 *
 * Detects potential hardcoded secrets in diffs/source BEFORE redaction.
 * Never stores or logs actual secret values — only fingerprints and metadata.
 *
 * Design:
 * 1. Run on raw patch/content before any redaction.
 * 2. Produce findings with hashed fingerprints (SHA-256 + configurable salt).
 * 3. Allowlist obvious placeholders and test paths.
 * 4. Use entropy heuristic for base64/hex values.
 */

import { createHash } from "crypto";
import type { PolicyFinding } from "./review-policy-packs";

// ─── Configuration ────────────────────────────────────────────────────────────

const FINGERPRINT_SALT = process.env.SECRET_FINGERPRINT_SALT || "groompilot-dev-default";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SecretDetection {
  /** SHA-256 fingerprint of the secret value (salted, truncated) */
  fingerprint: string;
  /** Key/variable name that holds the secret */
  keyName: string;
  /** Length of the detected secret value */
  valueLength: number;
  /** File path where detected */
  filePath: string;
  /** Line number (1-based) if available */
  line?: number;
  /** Category of secret pattern */
  category: SecretCategory;
  /** Entropy score of the value (0–8 bits) */
  entropy: number;
  /** Whether this looks like a placeholder */
  isPlaceholder: boolean;
}

export type SecretCategory =
  | "password"
  | "api-key"
  | "token"
  | "private-key"
  | "connection-string"
  | "aws-key"
  | "generic-secret"
  | "high-entropy";

// ─── Patterns ─────────────────────────────────────────────────────────────────

interface SecretPattern {
  category: SecretCategory;
  /** Regex that captures: group(1) = key name, group(2) = secret value */
  pattern: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Generic key=value patterns
  {
    category: "password",
    pattern: /\b(password|passwd|pwd|db_password|user_password)\s*[:=]\s*["']([^"'\s]{4,})["']/gi,
  },
  {
    category: "api-key",
    pattern: /\b(api[_-]?key|apikey|client[_-]?key|app[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
  },
  {
    category: "token",
    pattern: /\b(token|access[_-]?token|auth[_-]?token|bearer[_-]?token|refresh[_-]?token|session[_-]?token)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
  },
  {
    category: "generic-secret",
    pattern: /\b(secret|client[_-]?secret|app[_-]?secret|secret[_-]?key|signing[_-]?key|encryption[_-]?key)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
  },
  {
    category: "private-key",
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----)/g,
  },
  {
    category: "connection-string",
    pattern: /\b(connection[_-]?string|jdbc[_-]?url|database[_-]?url|mongo[_-]?uri)\s*[:=]\s*["']([^"'\s]{10,})["']/gi,
  },
  // AWS access keys
  {
    category: "aws-key",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  // GitHub PATs
  {
    category: "token",
    pattern: /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
  },
  {
    category: "token",
    pattern: /\b(github_pat_[a-zA-Z0-9_]{20,})\b/g,
  },
  // Java-style: private static final String KEY = "value"
  {
    category: "generic-secret",
    pattern: /(?:private|public|protected)?\s*(?:static\s+)?(?:final\s+)?String\s+([\w_]+(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)[\w_]*)\s*=\s*"([^"]{4,})"/gi,
  },
  // Const/let/var assignments in JS/TS
  {
    category: "generic-secret",
    pattern: /(?:const|let|var)\s+([\w_]*(?:key|secret|password|token|credential)[\w_]*)\s*=\s*["']([^"'\s]{8,})["']/gi,
  },
];

// ─── Placeholder allowlist ────────────────────────────────────────────────────

const PLACEHOLDER_VALUES = new Set([
  "changeme", "change_me", "change-me",
  "example", "example-key", "example_key",
  "dummy", "dummy-key", "dummy_key",
  "test", "test-key", "test_key", "test123",
  "placeholder", "placeholder-key",
  "xxx", "xxxx", "xxxxxxxx",
  "your-key-here", "your_key_here",
  "replace-me", "replace_me",
  "todo", "fixme",
  "none", "null", "undefined", "empty",
  "default", "sample", "demo",
]);

const PLACEHOLDER_PATTERNS = [
  /^(changeme|dummy|test|example|placeholder|replace|todo|fixme|sample|demo)/i,
  /^x{3,}$/i,
  /^\$\{.+\}$/, // ${VAR} template
  /^%\(.+\)s$/, // %(VAR)s template
  /^\{\{.+\}\}$/, // {{VAR}} template
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  if (PLACEHOLDER_VALUES.has(lower)) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(lower));
}

// ─── Test path detection ──────────────────────────────────────────────────────

function isTestPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return /\/(test|tests|spec|__tests__|fixtures?|replay-fixtures|mocks?|samples?|examples?)\//i.test(lower)
    || /\.(test|spec|it)\.[a-z]+$/i.test(lower);
}

// ─── Entropy calculation (Shannon) ────────────────────────────────────────────

function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const char of value) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ─── Fingerprinting ──────────────────────────────────────────────────────────

function fingerprintSecret(value: string): string {
  return createHash("sha256")
    .update(FINGERPRINT_SALT + ":" + value)
    .digest("hex")
    .slice(0, 24);
}

// ─── High-entropy string detection ────────────────────────────────────────────

const HIGH_ENTROPY_PATTERN = /["']([A-Za-z0-9+/=_-]{20,})["']/g;
const MIN_ENTROPY_THRESHOLD = 4.0;
const MIN_HEX_ENTROPY_THRESHOLD = 3.5;

function detectHighEntropyStrings(
  text: string,
  filePath: string,
  lineOffset: number,
): SecretDetection[] {
  const detections: SecretDetection[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only check added lines in diffs
    if (text.includes("@@") && !line.startsWith("+")) continue;

    HIGH_ENTROPY_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HIGH_ENTROPY_PATTERN.exec(line)) !== null) {
      const value = match[1];
      if (value.length < 20 || value.length > 500) continue;

      const entropy = shannonEntropy(value);
      if (entropy < MIN_ENTROPY_THRESHOLD) continue;
      if (isPlaceholder(value)) continue;

      // Skip if it looks like a normal import path, URL path, or class name
      if (/^[a-z.]+$/.test(value) || /^https?:/.test(value)) continue;
      if (/^[A-Z][a-zA-Z]+$/.test(value)) continue; // CamelCase class name

      detections.push({
        fingerprint: fingerprintSecret(value),
        keyName: "high-entropy-string",
        valueLength: value.length,
        filePath,
        line: lineOffset + i + 1,
        category: "high-entropy",
        entropy,
        isPlaceholder: false,
      });
    }
  }

  return detections;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect potential secrets in a patch or source content.
 * Returns detections with fingerprints — NEVER the actual secret values.
 */
export function detectSecrets(params: {
  filePath: string;
  content: string;
  /** If true, content is a unified diff (only scan added lines) */
  isDiff?: boolean;
}): SecretDetection[] {
  const { filePath, content, isDiff = true } = params;
  const detections: SecretDetection[] = [];

  // For diffs, only scan added lines (lines starting with +)
  const textToScan = isDiff
    ? content.split("\n").filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n")
    : content;

  if (!textToScan.trim()) return [];

  // Determine line offset by parsing hunk headers
  let lineOffset = 0;
  if (isDiff) {
    const hunkMatch = content.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) lineOffset = Number(hunkMatch[1]) - 1;
  }

  // Run pattern-based detection
  for (const sp of SECRET_PATTERNS) {
    sp.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = sp.pattern.exec(textToScan)) !== null) {
      const keyName = match[1] || "unknown";
      const value = match[2] || match[1] || match[0];

      if (isPlaceholder(value)) continue;

      // Find line number
      const charsBefore = textToScan.slice(0, match.index);
      const lineNum = charsBefore.split("\n").length;

      const entropy = shannonEntropy(value);

      detections.push({
        fingerprint: fingerprintSecret(value),
        keyName: keyName.replace(/["']/g, ""),
        valueLength: value.length,
        filePath,
        line: lineOffset + lineNum,
        category: sp.category,
        entropy,
        isPlaceholder: false,
      });
    }
  }

  // Run high-entropy detection
  const entropyDetections = detectHighEntropyStrings(textToScan, filePath, lineOffset);
  detections.push(...entropyDetections);

  // Deduplicate by fingerprint
  const seen = new Set<string>();
  return detections.filter((d) => {
    if (seen.has(d.fingerprint)) return false;
    seen.add(d.fingerprint);
    return true;
  });
}

/**
 * Convert secret detections to PolicyFinding objects.
 * Safe for storage — no actual secret values included.
 */
export function secretDetectionsToPolicyFindings(
  detections: SecretDetection[],
): PolicyFinding[] {
  // Filter out test-path detections (lower severity) and placeholders
  const actionable = detections.filter((d) => !d.isPlaceholder);

  return actionable.map((d, i) => {
    const isTestFile = isTestPath(d.filePath);
    const severity = isTestFile ? "medium" as const : (d.category === "private-key" ? "critical" as const : "high" as const);

    return {
      id: `SECRET-${d.fingerprint.slice(0, 12)}`,
      file: d.filePath,
      line: d.line,
      endLine: d.line,
      type: "SECURITY" as const,
      severity,
      confidence: d.entropy > 4.5 ? "high" as const : "medium" as const,
      title: `Potential hardcoded ${d.category.replace(/-/g, " ")}`,
      description: `Detected a potential hardcoded secret. Fingerprint: sha256:${d.fingerprint}; key name: ${d.keyName}; value length: ${d.valueLength}; entropy: ${d.entropy.toFixed(2)} bits.${isTestFile ? " (test file — lower risk)" : ""}`,
      whyItMatters: "Hardcoded secrets in source control can leak through repository access, CI logs, and backup systems. Secret rotation becomes difficult when values are compiled into artifacts.",
      fix: "Move secret to environment variable, vault (HashiCorp Vault, AWS Secrets Manager), or Kubernetes Secret. Rotate any exposed credential immediately.",
      ruleRefs: ["CWE-798", "OWASP-A07", "SECRET-DETECTION"],
      needsHumanReview: !isTestFile,
    };
  });
}
