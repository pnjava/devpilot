// ─────────────────────────────────────────────────────────────
// Story Readiness — Analyzer Orchestrator
// ─────────────────────────────────────────────────────────────
import crypto from "crypto";
import type {
  StoryReadinessRequest,
  StoryReadinessSnapshot,
  SourceReference,
} from "./types";
import { classifyStory } from "./classifier";
import { scoreReadiness } from "./scorer";
import { generateQuestions } from "./question-generator";
import { generateSubtasks } from "./subtask-generator";
import { saveSnapshot, getLatestSnapshot } from "./snapshot-store";
import { getKnowledgeContextForJira } from "../knowledge-warehouse";

// ── Public API ─────────────────────────────────────────────

export interface AnalyzeResult {
  snapshot: StoryReadinessSnapshot;
  persisted: boolean;
  knowledgeContextUsed: boolean;
}

/**
 * Full readiness analysis pipeline:
 * 1. Retrieve knowledge context from warehouse
 * 2. Classify story type deterministically
 * 3. Score 8 readiness dimensions
 * 4. Generate clarification questions
 * 5. Generate subtask suggestions
 * 6. Build snapshot
 * 7. Persist (if runMode != 'analyze_only')
 */
export async function analyzeStory(req: StoryReadinessRequest): Promise<AnalyzeResult> {
  // ── Step 1: Retrieve knowledge context ───────────────────
  let knowledgeContextUsed = false;
  let enrichedDescription = req.description;

  try {
    const ctx = getKnowledgeContextForJira(req.jiraKey);
    if (ctx.contextText) {
      enrichedDescription = [req.description, "\n--- Knowledge Context ---\n", ctx.contextText].join("\n");
      knowledgeContextUsed = true;
    }
  } catch {
    // Knowledge retrieval is best-effort; proceed without it
  }

  // Build enriched request with knowledge context
  const enrichedReq: StoryReadinessRequest = {
    ...req,
    description: enrichedDescription,
  };

  // ── Step 2: Classify story type ──────────────────────────
  const classification = classifyStory({
    title: req.title,
    description: enrichedReq.description,
    acceptanceCriteria: req.acceptanceCriteria,
    labels: req.labels,
    componentTags: req.componentTags,
    issueType: req.issueType,
  });

  // ── Step 3: Score readiness dimensions ───────────────────
  const scoring = scoreReadiness(enrichedReq, classification.storyType);

  // ── Step 4: Generate clarification questions ─────────────
  const questions = generateQuestions(enrichedReq, classification.storyType, scoring.dimensions);

  // ── Step 5: Generate subtask suggestions ─────────────────
  const subtasks = generateSubtasks(enrichedReq, classification.storyType, scoring.dimensions);

  // ── Step 6: Build snapshot ───────────────────────────────
  const previousSnapshot = getLatestSnapshot(req.jiraKey);
  const version = previousSnapshot ? previousSnapshot.version + 1 : 1;

  const snapshot: StoryReadinessSnapshot = {
    snapshotId: crypto.randomUUID(),
    jiraKey: req.jiraKey,
    title: req.title,
    storyType: classification.storyType,
    readinessState: scoring.readinessState,
    readinessScoreOverall: scoring.overallScore,
    readinessDimensions: scoring.dimensions,
    blockingGaps: scoring.blockingGaps,
    clarificationQuestions: questions,
    suggestedSubtasks: subtasks,
    knowledgeConfidence: scoring.knowledgeConfidence,
    sourceCoverage: {
      ...scoring.sourceCoverage,
      confluence: knowledgeContextUsed || scoring.sourceCoverage.confluence,
    },
    similarStoryRefs: [],
    similarPrRefs: [],
    generatedAt: new Date().toISOString(),
    version,
  };

  // ── Step 7: Persist ──────────────────────────────────────
  let persisted = false;
  if (req.runMode !== "analyze_only") {
    saveSnapshot(snapshot);
    persisted = true;
  }

  return { snapshot, persisted, knowledgeContextUsed };
}
