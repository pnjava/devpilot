// ─────────────────────────────────────────────────────────────
// Story Readiness — Optional AI Refiner
// Feature-flagged: STORY_READINESS_AI_ENABLED=true
// Deterministic engine works fully without this.
// AI only improves: wording, grouping, ranking, subtle gaps.
// ─────────────────────────────────────────────────────────────
import type {
  ClarificationQuestion,
  SuggestedSubtask,
  StoryReadinessSnapshot,
} from "./types";

const AI_ENABLED = String(process.env.STORY_READINESS_AI_ENABLED || "false").toLowerCase() === "true";

export function isAiRefinementEnabled(): boolean {
  return AI_ENABLED;
}

async function callAIComplete(prompt: string, opts: { maxTokens?: number; temperature?: number }): Promise<string> {
  const { complete } = await import("../ai-provider");
  const result = await complete({
    messages: [{ role: "user", content: prompt }],
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  return result.content;
}

/**
 * Refine questions: improve wording, de-duplicate near-duplicates,
 * and optionally detect subtle missing questions.
 * Returns the original list unmodified if AI is disabled or call fails.
 */
export async function refineQuestions(
  questions: ClarificationQuestion[],
  context: { title: string; description: string; storyType: string },
): Promise<ClarificationQuestion[]> {
  if (!AI_ENABLED || questions.length === 0) return questions;

  try {
    const prompt = [
      "You are a senior engineering lead reviewing clarification questions generated for a Jira story.",
      `Story: "${context.title}" (type: ${context.storyType})`,
      "",
      "Current questions:",
      ...questions.map((q, i) => `${i + 1}. [${q.severity}] [${q.category}] ${q.questionText}`),
      "",
      "Tasks:",
      "1. Improve the wording of any unclear questions to be more specific and actionable.",
      "2. Remove near-duplicate questions (keep the better-worded one).",
      "3. If you detect an obvious missing question (API contract, dependency, rollout risk), add it with category and severity.",
      "",
      "Return ONLY a JSON array of objects with fields: id, category, questionText, whyThisMatters, severity, triggeredBy, confidence, suggestedOwner.",
      "Preserve the original IDs for existing questions. Use new UUIDs for any added questions.",
      "If no changes needed, return the original array unchanged.",
    ].join("\n");

    const response = await callAIComplete(prompt, { maxTokens: 2000, temperature: 0.3 });
    const parsed = JSON.parse(response);

    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].questionText) {
      return parsed as ClarificationQuestion[];
    }
  } catch {
    // AI refinement is best-effort; fall back to deterministic output
  }

  return questions;
}

/**
 * Refine subtasks: improve descriptions, flag obvious missing subtasks.
 * Returns the original list unmodified if AI is disabled or call fails.
 */
export async function refineSubtasks(
  subtasks: SuggestedSubtask[],
  context: { title: string; description: string; storyType: string },
): Promise<SuggestedSubtask[]> {
  if (!AI_ENABLED || subtasks.length === 0) return subtasks;

  try {
    const prompt = [
      "You are a senior engineering lead reviewing suggested subtasks for a Jira story.",
      `Story: "${context.title}" (type: ${context.storyType})`,
      "",
      "Current subtasks:",
      ...subtasks.map((s, i) => `${i + 1}. [${s.category}] ${s.title} — ${s.description}`),
      "",
      "Tasks:",
      "1. Improve any vague descriptions to be more specific.",
      "2. Flag any critical missing subtask for this story type (e.g., missing error handling, missing test, missing config).",
      "3. Do NOT add generic placeholders.",
      "",
      "Return ONLY a JSON array of objects with fields: id, title, description, category, whyNeeded, dependencyHints, confidence, optionalAssigneeType, isDraft.",
      "Preserve original IDs. Use new UUIDs for added subtasks.",
    ].join("\n");

    const response = await callAIComplete(prompt, { maxTokens: 2000, temperature: 0.3 });
    const parsed = JSON.parse(response);

    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].title) {
      return parsed as SuggestedSubtask[];
    }
  } catch {
    // Best-effort; fall back silently
  }

  return subtasks;
}

/**
 * Generate a brief executive summary of the readiness snapshot.
 * Returns null if AI is disabled.
 */
export async function generateSummary(
  snapshot: StoryReadinessSnapshot,
): Promise<string | null> {
  if (!AI_ENABLED) return null;

  try {
    const prompt = [
      "Summarize this story readiness assessment in 2-3 sentences for a tech lead.",
      `Story: ${snapshot.jiraKey} — "${snapshot.title}"`,
      `Type: ${snapshot.storyType}, Score: ${snapshot.readinessScoreOverall}/100, State: ${snapshot.readinessState}`,
      `Blocking gaps: ${snapshot.blockingGaps.length}, Questions: ${snapshot.clarificationQuestions.length}, Subtasks: ${snapshot.suggestedSubtasks.length}`,
      `Knowledge confidence: ${snapshot.knowledgeConfidence}`,
      "",
      "Use neutral, non-blaming language. Focus on what needs attention before sprint work begins.",
    ].join("\n");

    return await callAIComplete(prompt, { maxTokens: 300, temperature: 0.4 });
  } catch {
    return null;
  }
}
