/**
 * GroomPilot Semgrep Integration
 *
 * Runs Semgrep static analysis on diff-targeted files when:
 *   SEMGREP_ENABLED=true AND the semgrep binary is on PATH (or SEMGREP_BIN set).
 *
 * Output is parsed from --json and mapped to PolicyFinding[].
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PolicyFinding } from "../review-policy-packs";

const execFileAsync = promisify(execFile);

// ─── Configuration ────────────────────────────────────────────────────────────

export function semgrepEnabled(): boolean {
  return process.env.SEMGREP_ENABLED === "true";
}

function semgrepBin(): string {
  return process.env.SEMGREP_BIN || "semgrep";
}

function semgrepConfig(): string {
  // Default ruleset; override with SEMGREP_CONFIG to use org-specific rules
  return process.env.SEMGREP_CONFIG || "p/owasp-top-ten";
}

function semgrepTimeout(): number {
  return Number(process.env.SEMGREP_TIMEOUT_MS) || 120_000;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      cwe?: string | string[];
      owasp?: string | string[];
      confidence?: string;
      references?: string[];
      category?: string;
      impact?: string;
    };
    fix?: string;
  };
}

export interface SemgrepOutput {
  results: SemgrepResult[];
  errors: Array<{ message: string; level: string }>;
}

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Check whether the semgrep binary is available.
 */
export async function isSemgrepAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(semgrepBin(), ["--version"], {
      timeout: 10_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Run Semgrep on specific file paths and return raw JSON output.
 */
export async function runSemgrep(params: {
  /** Absolute paths to files to scan */
  filePaths: string[];
  /** Working directory (repo root) */
  cwd: string;
  /** Extra Semgrep config/rulesets beyond default */
  extraConfigs?: string[];
}): Promise<SemgrepOutput> {
  const { filePaths, cwd, extraConfigs = [] } = params;

  if (filePaths.length === 0) {
    return { results: [], errors: [] };
  }

  // Write file list to a temp targets file
  const tmpDir = mkdtempSync(join(tmpdir(), "gp-semgrep-"));
  const targetsFile = join(tmpDir, "targets.txt");
  writeFileSync(targetsFile, filePaths.join("\n"), "utf-8");

  const configs = [semgrepConfig(), ...extraConfigs];
  const args: string[] = [];
  for (const c of configs) {
    args.push("--config", c);
  }
  args.push(
    "--json",
    "--no-git-ignore",
    "--target-list", targetsFile,
  );

  try {
    const { stdout, stderr } = await execFileAsync(semgrepBin(), args, {
      cwd,
      timeout: semgrepTimeout(),
      maxBuffer: 10 * 1024 * 1024,
    });

    try {
      return JSON.parse(stdout) as SemgrepOutput;
    } catch {
      return {
        results: [],
        errors: [{ message: `Failed to parse Semgrep JSON: ${stderr?.slice(0, 500)}`, level: "error" }],
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      results: [],
      errors: [{ message: `Semgrep execution failed: ${msg.slice(0, 500)}`, level: "error" }],
    };
  } finally {
    try { unlinkSync(targetsFile); } catch { /* ignore */ }
  }
}

// ─── Mapping to PolicyFinding ─────────────────────────────────────────────────

function mapSeverity(s: string): PolicyFinding["severity"] {
  switch (s.toUpperCase()) {
    case "ERROR": return "high";
    case "WARNING": return "medium";
    case "INFO": return "low";
    default: return "medium";
  }
}

function extractRuleRefs(meta?: SemgrepResult["extra"]["metadata"]): string[] {
  if (!meta) return [];
  const refs: string[] = [];
  if (meta.cwe) {
    const cweList = Array.isArray(meta.cwe) ? meta.cwe : [meta.cwe];
    refs.push(...cweList.map((c) => c.replace(/^CWE-/, "CWE-")));
  }
  if (meta.owasp) {
    const owaspList = Array.isArray(meta.owasp) ? meta.owasp : [meta.owasp];
    refs.push(...owaspList);
  }
  if (meta.references) {
    refs.push(...meta.references.slice(0, 3));
  }
  return refs;
}

function classifyType(checkId: string, meta?: SemgrepResult["extra"]["metadata"]): PolicyFinding["type"] {
  const lower = checkId.toLowerCase();
  if (lower.includes("injection") || lower.includes("sqli") || lower.includes("xss")) return "INJECTION";
  if (lower.includes("owasp")) return "OWASP";
  if (lower.includes("auth")) return "SECURITY";
  if (lower.includes("perf") || lower.includes("performance")) return "PERF";
  // Default based on metadata category
  if (meta?.category === "security") return "SECURITY";
  return "SECURITY";
}

/**
 * Convert Semgrep JSON results to GroomPilot PolicyFinding[].
 */
export function semgrepResultsToFindings(
  results: SemgrepResult[],
  repoRoot?: string,
): PolicyFinding[] {
  return results.map((r) => {
    const relPath = repoRoot && r.path.startsWith(repoRoot)
      ? r.path.slice(repoRoot.length + 1)
      : r.path;

    return {
      id: `SEMGREP-${stableHash(r.check_id + ":" + relPath + ":" + r.start.line)}`,
      file: relPath,
      line: r.start.line,
      endLine: r.end.line,
      type: classifyType(r.check_id, r.extra.metadata),
      severity: mapSeverity(r.extra.severity),
      confidence: (r.extra.metadata?.confidence?.toLowerCase() as PolicyFinding["confidence"]) || "medium",
      title: `[Semgrep] ${r.check_id.split(".").pop() || r.check_id}`,
      description: r.extra.message,
      whyItMatters: `Detected by Semgrep rule ${r.check_id}.`,
      fix: r.extra.fix || "See the rule documentation for remediation guidance.",
      ruleRefs: [r.check_id, ...extractRuleRefs(r.extra.metadata)],
      needsHumanReview: r.extra.severity === "ERROR",
    };
  });
}

// ─── Convenience ──────────────────────────────────────────────────────────────

/**
 * Full pipeline: run Semgrep on files → convert to findings.
 * Returns empty array if Semgrep is disabled or unavailable.
 */
export async function scanWithSemgrep(params: {
  filePaths: string[];
  cwd: string;
  extraConfigs?: string[];
}): Promise<{ findings: PolicyFinding[]; errors: string[] }> {
  if (!semgrepEnabled()) {
    return { findings: [], errors: [] };
  }

  const available = await isSemgrepAvailable();
  if (!available) {
    return { findings: [], errors: [`Semgrep binary not found at "${semgrepBin()}"`] };
  }

  const output = await runSemgrep(params);
  const findings = semgrepResultsToFindings(output.results, params.cwd);
  const errors = output.errors.map((e) => e.message);

  return { findings, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}
