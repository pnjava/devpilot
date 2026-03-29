/**
 * GroomPilot CodeQL Integration (optional)
 *
 * Runs CodeQL analysis when:
 *   CODEQL_ENABLED=true AND codeql binary exists AND a CodeQL database path is set.
 *
 * Parses SARIF (v2.1.0) output and maps to PolicyFinding[].
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { PolicyFinding } from "../review-policy-packs";

const execFileAsync = promisify(execFile);

// ─── Configuration ────────────────────────────────────────────────────────────

export function codeqlEnabled(): boolean {
  return process.env.CODEQL_ENABLED === "true";
}

function codeqlBin(): string {
  return process.env.CODEQL_BIN || "codeql";
}

function codeqlDbPath(): string | undefined {
  return process.env.CODEQL_DB_PATH;
}

function codeqlTimeout(): number {
  return Number(process.env.CODEQL_TIMEOUT_MS) || 300_000;
}

function codeqlQuerySuite(): string {
  return process.env.CODEQL_QUERY_SUITE || "code-scanning";
}

// ─── SARIF Types (subset) ─────────────────────────────────────────────────────

interface SarifResult {
  ruleId: string;
  level?: "error" | "warning" | "note" | "none";
  message: { text: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri: string };
      region?: { startLine: number; endLine?: number; startColumn?: number };
    };
  }>;
}

interface SarifRun {
  results: SarifResult[];
  tool?: {
    driver?: {
      rules?: Array<{
        id: string;
        shortDescription?: { text: string };
        fullDescription?: { text: string };
        help?: { text: string; markdown?: string };
        properties?: { tags?: string[]; precision?: string; "security-severity"?: string };
      }>;
    };
  };
}

interface SarifLog {
  $schema?: string;
  version: string;
  runs: SarifRun[];
}

interface SarifRule {
  id: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  help?: { text: string; markdown?: string };
  properties?: { tags?: string[]; precision?: string; "security-severity"?: string };
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function isCodeQLAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(codeqlBin(), ["version", "--format=json"], {
      timeout: 10_000,
    });
    return stdout.includes("version");
  } catch {
    return false;
  }
}

/**
 * Run CodeQL analysis using an existing database, output SARIF.
 */
export async function runCodeQL(params: {
  /** Language (java, javascript, python, etc.) */
  language: string;
  /** Override DB path */
  dbPath?: string;
  /** Extra query packs */
  extraPacks?: string[];
}): Promise<{ sarif: SarifLog | null; errors: string[] }> {
  const dbPath = params.dbPath || codeqlDbPath();
  if (!dbPath || !existsSync(dbPath)) {
    return { sarif: null, errors: [`CodeQL database not found at: ${dbPath || "(not configured)"}`] };
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "gp-codeql-"));
  const sarifPath = join(tmpDir, "results.sarif");

  const suite = codeqlQuerySuite();
  const args = [
    "database", "analyze",
    dbPath,
    `${params.language}-${suite}`,
    "--format=sarifv2.1.0",
    `--output=${sarifPath}`,
    "--threads=0", // use all available
  ];

  if (params.extraPacks?.length) {
    for (const pack of params.extraPacks) {
      args.push("--additional-packs", pack);
    }
  }

  try {
    await execFileAsync(codeqlBin(), args, {
      timeout: codeqlTimeout(),
      maxBuffer: 20 * 1024 * 1024,
    });

    const sarifContent = readFileSync(sarifPath, "utf-8");
    const sarif = JSON.parse(sarifContent) as SarifLog;
    return { sarif, errors: [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sarif: null, errors: [`CodeQL execution failed: ${msg.slice(0, 500)}`] };
  }
}

// ─── SARIF → PolicyFinding mapping ────────────────────────────────────────────

function mapLevel(level?: string): PolicyFinding["severity"] {
  switch (level) {
    case "error": return "high";
    case "warning": return "medium";
    case "note": return "low";
    default: return "medium";
  }
}

/**
 * Parse SARIF log and convert to GroomPilot PolicyFinding[].
 */
export function sarifToFindings(
  sarif: SarifLog,
  repoRoot?: string,
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];

  for (const run of sarif.runs) {
    const rulesMap = new Map<string, SarifRule>();
    if (run.tool?.driver?.rules) {
      for (const rule of run.tool.driver.rules) {
        rulesMap.set(rule.id, rule);
      }
    }

    for (const result of run.results) {
      const loc = result.locations?.[0]?.physicalLocation;
      let filePath = loc?.artifactLocation?.uri || "unknown";
      // Strip file:// prefix and make relative
      filePath = filePath.replace(/^file:\/\//, "");
      if (repoRoot && filePath.startsWith(repoRoot)) {
        filePath = filePath.slice(repoRoot.length + 1);
      }

      const rule = rulesMap.get(result.ruleId);
      const tags = rule?.properties?.tags || [];
      const secSeverity = rule?.properties?.["security-severity"];

      let severity = mapLevel(result.level);
      if (secSeverity) {
        const s = parseFloat(secSeverity);
        if (s >= 9.0) severity = "critical";
        else if (s >= 7.0) severity = "high";
        else if (s >= 4.0) severity = "medium";
        else severity = "low";
      }

      const ruleRefs: string[] = [result.ruleId];
      for (const tag of tags) {
        if (/^(CWE-|cwe-|external\/cwe)/.test(tag)) ruleRefs.push(tag);
      }

      findings.push({
        id: `CODEQL-${stableHash(result.ruleId + ":" + filePath + ":" + (loc?.region?.startLine || 0))}`,
        file: filePath,
        line: loc?.region?.startLine,
        endLine: loc?.region?.endLine,
        type: classifyType(result.ruleId, tags),
        severity,
        confidence: (rule?.properties?.precision?.toLowerCase() as PolicyFinding["confidence"]) || "medium",
        title: `[CodeQL] ${rule?.shortDescription?.text || result.ruleId}`,
        description: result.message.text,
        whyItMatters: rule?.fullDescription?.text || `Detected by CodeQL rule ${result.ruleId}.`,
        fix: rule?.help?.text?.slice(0, 500) || "See the CodeQL rule documentation for remediation.",
        ruleRefs,
        needsHumanReview: severity === "critical" || severity === "high",
      });
    }
  }

  return findings;
}

// ─── Convenience ──────────────────────────────────────────────────────────────

/**
 * Full pipeline: run CodeQL → parse SARIF → return findings.
 * Returns empty if CodeQL is disabled or unavailable.
 */
export async function scanWithCodeQL(params: {
  language: string;
  dbPath?: string;
  extraPacks?: string[];
}): Promise<{ findings: PolicyFinding[]; errors: string[] }> {
  if (!codeqlEnabled()) {
    return { findings: [], errors: [] };
  }

  const available = await isCodeQLAvailable();
  if (!available) {
    return { findings: [], errors: [`CodeQL binary not found at "${codeqlBin()}"`] };
  }

  const { sarif, errors } = await runCodeQL(params);
  if (!sarif) {
    return { findings: [], errors };
  }

  const findings = sarifToFindings(sarif);
  return { findings, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyType(ruleId: string, tags: string[]): PolicyFinding["type"] {
  const lower = ruleId.toLowerCase() + " " + tags.join(" ").toLowerCase();
  if (lower.includes("injection") || lower.includes("sqli") || lower.includes("xss")) return "INJECTION";
  if (lower.includes("auth")) return "SECURITY";
  if (lower.includes("performance")) return "PERF";
  return "SECURITY";
}

function stableHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}
