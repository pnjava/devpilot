/**
 * LLM Refinement — Optional async stage for PR Readiness pipeline.
 *
 * Feature-flagged via ENABLE_LLM_REFINEMENT.
 * CPU-only assumed (Ollama / Llama family).
 * Refines deterministic findings with AI analysis, never replaces them.
 */

import type {
  PRReadinessSnapshot,
  LLMFinding,
  LLMStatus,
  DeterministicFinding,
  ReadinessConfig,
} from "./types";
import { loadReadinessConfig } from "./types";
import { getSnapshotById, saveSnapshot } from "./snapshot-store";
import { getProviderInfo, complete } from "../ai-provider";

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run LLM refinement on an existing snapshot.
 * Mutates the snapshot in-place and persists the update.
 * Returns the updated snapshot or null if refinement was skipped.
 */
export async function refineLLM(
  snapshotId: string,
  config?: ReadinessConfig,
): Promise<PRReadinessSnapshot | null> {
  const cfg = config ?? loadReadinessConfig();
  if (!cfg.enableLlmRefinement) return null;

  const snap = getSnapshotById(snapshotId);
  if (!snap) {
    console.warn(`[llm-refinement] snapshot ${snapshotId} not found`);
    return null;
  }

  // Risk gate: skip LLM for PRs below minimum risk threshold
  if (!meetsRiskThreshold(snap.overallRisk, cfg.llmMinRiskToRun)) {
    updateLLMStatus(snap, "skipped");
    return snap;
  }

  // Mark as running
  updateLLMStatus(snap, "running");

  try {
    const llmFindings = await runRefinement(snap, cfg);

    snap.llmFindings = llmFindings;
    snap.llmStatus = "completed";
    snap.modelUsed = getProviderInfo().model;
    snap.finalMergedFindings = mergeFindings(
      snap.deterministicFindings,
      llmFindings,
    );

    // Recompute counts with merged findings
    snap.blockerCount = snap.finalMergedFindings.filter(
      (f) => f.classification === "blocker",
    ).length;
    snap.importantCount = snap.finalMergedFindings.filter(
      (f) => f.classification === "important",
    ).length;
    snap.followUpCount = snap.finalMergedFindings.filter(
      (f) => f.classification === "follow-up",
    ).length;

    snap.updatedAt = new Date().toISOString();
    saveSnapshot(snap);
    return snap;
  } catch (err) {
    console.error("[llm-refinement] failed:", err);
    updateLLMStatus(snap, "failed");
    return snap;
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function runRefinement(
  snap: PRReadinessSnapshot,
  cfg: ReadinessConfig,
): Promise<LLMFinding[]> {
  const prompt = buildRefinementPrompt(snap);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.llmTimeoutMs);

  try {
    const response = await complete({
      messages: [
        {
          role: "system" as const,
          content: SYSTEM_PROMPT,
        },
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    });

    const raw = response?.content || "";
    return parseRefinementResponse(raw, snap);
  } finally {
    clearTimeout(timeout);
  }
}

const SYSTEM_PROMPT = `You are a senior code reviewer analyzing PR findings. You receive deterministic findings from static analysis and provide additional insights.

Rules:
- Only report genuine issues with clear evidence from the findings context.
- Never duplicate existing deterministic findings — only add new insights.
- Classify each finding as: blocker, important, follow-up, or informational.
- Respond in strict JSON format: { "findings": [...] }
- Each finding must have: id, file, line (optional), severity, title, description, classification.
- Severity values: critical, high, medium, low, info.
- Be concise. No preamble.`;

function buildRefinementPrompt(snap: PRReadinessSnapshot): string {
  const findingsSummary = snap.deterministicFindings
    .slice(0, 20) // cap prompt size
    .map(
      (f) =>
        `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.title} (${f.source})`,
    )
    .join("\n");

  const jiraSummary = snap.linkedJiraSummary
    .filter((j) => j.available)
    .map((j) => `- ${j.key}: ${j.summary}`)
    .join("\n");

  return `PR: ${snap.prTitle} (by ${snap.prAuthor})
Commit: ${snap.latestCommitSha}
Risk: ${snap.overallRisk}
Context mode: ${snap.contextMode}
Policy packs applied: ${snap.appliedPolicyPacks.join(", ")}

Deterministic findings (${snap.deterministicFindings.length} total):
${findingsSummary || "None"}

Linked Jira:
${jiraSummary || "None"}

Acceptance criteria:
${snap.acceptanceCriteriaSummary || "Not available"}

Provide additional findings that the deterministic stage may have missed. Focus on architectural, design, and cross-cutting concerns.`;
}

function parseRefinementResponse(
  raw: string,
  snap: PRReadinessSnapshot,
): LLMFinding[] {
  // Extract JSON from potentially wrapped response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const findings: LLMFinding[] = [];

    for (const f of parsed.findings || []) {
      if (!f.title || !f.file) continue;

      findings.push({
        id: `llm-${snap.id.slice(0, 8)}-${findings.length + 1}`,
        file: String(f.file),
        line: typeof f.line === "number" ? f.line : undefined,
        severity: validateSeverity(f.severity),
        title: String(f.title).slice(0, 200),
        description: String(f.description || "").slice(0, 500),
        classification: validateClassification(f.classification),
        source: "llm-refinement",
      });
    }

    return findings;
  } catch {
    console.warn("[llm-refinement] failed to parse response");
    return [];
  }
}

function mergeFindings(
  deterministic: DeterministicFinding[],
  llm: LLMFinding[],
): (DeterministicFinding | LLMFinding)[] {
  // Deterministic findings always come first and take precedence
  const merged: (DeterministicFinding | LLMFinding)[] = [...deterministic];

  // Deduplicate LLM findings against deterministic by file+title similarity
  for (const lf of llm) {
    const isDuplicate = deterministic.some(
      (df) =>
        df.file === lf.file &&
        (df.title.toLowerCase().includes(lf.title.toLowerCase()) ||
          lf.title.toLowerCase().includes(df.title.toLowerCase())),
    );
    if (!isDuplicate) {
      merged.push(lf);
    }
  }

  return merged;
}

function meetsRiskThreshold(
  actual: string,
  minimum: string,
): boolean {
  const levels = ["low", "medium", "high", "critical"];
  const actualIdx = levels.indexOf(actual);
  const minIdx = levels.indexOf(minimum);
  return actualIdx >= minIdx;
}

function updateLLMStatus(snap: PRReadinessSnapshot, status: LLMStatus): void {
  snap.llmStatus = status;
  snap.updatedAt = new Date().toISOString();
  saveSnapshot(snap);
}

function validateSeverity(
  v: unknown,
): "critical" | "high" | "medium" | "low" | "info" {
  const s = String(v || "").toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(s)) {
    return s as any;
  }
  return "info";
}

function validateClassification(
  v: unknown,
): "blocker" | "important" | "follow-up" | "informational" {
  const s = String(v || "").toLowerCase();
  if (["blocker", "important", "follow-up", "informational"].includes(s)) {
    return s as any;
  }
  return "informational";
}
