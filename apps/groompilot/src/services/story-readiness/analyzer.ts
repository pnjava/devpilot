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
import { normalizeStoryInput } from "./normalizer";
import { recordAnalysis } from "./telemetry";
import { isAiRefinementEnabled, refineQuestions, refineSubtasks } from "./ai-refiner";

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
  // ── Step 0: Normalize sparse input ───────────────────────
  const { normalized, acExtractedFromDescription } = normalizeStoryInput({
    jiraKey: req.jiraKey,
    title: req.title,
    description: req.description,
    acceptanceCriteria: req.acceptanceCriteria,
    epicKey: req.epicKey,
    issueType: req.issueType,
    labels: req.labels,
    assignee: req.assignee,
    reporter: req.reporter,
    status: req.status,
    componentTags: req.componentTags,
    storyLinks: req.storyLinks,
    linkedConfluenceUrls: req.linkedConfluenceUrls,
    manualContextText: req.manualContextText,
  });

  const normalizedReq: StoryReadinessRequest = {
    ...req,
    title: normalized.title,
    description: normalized.description,
    acceptanceCriteria: normalized.acceptanceCriteria,
    labels: normalized.labels,
    componentTags: normalized.componentTags,
    storyLinks: normalized.storyLinks,
    linkedConfluenceUrls: normalized.linkedConfluenceUrls,
  };

  // ── Step 1: Retrieve knowledge context ───────────────────
  let knowledgeContextUsed = false;
  let enrichedDescription = normalizedReq.description;

  try {
    const ctx = getKnowledgeContextForJira(normalizedReq.jiraKey);
    if (ctx.contextText) {
      enrichedDescription = [normalizedReq.description, "\n--- Knowledge Context ---\n", ctx.contextText].join("\n");
      knowledgeContextUsed = true;
    }
  } catch {
    // Knowledge retrieval is best-effort; proceed without it
  }

  // Build enriched request with knowledge context
  const enrichedReq: StoryReadinessRequest = {
    ...normalizedReq,
    description: enrichedDescription,
  };

  // ── Step 2: Classify story type ──────────────────────────
  const classification = classifyStory({
    title: normalizedReq.title,
    description: enrichedReq.description,
    acceptanceCriteria: normalizedReq.acceptanceCriteria,
    labels: normalizedReq.labels,
    componentTags: normalizedReq.componentTags,
    issueType: normalizedReq.issueType,
  });

  // ── Step 3: Score readiness dimensions ───────────────────
  const scoring = scoreReadiness(enrichedReq, classification.storyType);

  // ── Step 4: Generate clarification questions ─────────────
  let questions = generateQuestions(enrichedReq, classification.storyType, scoring.dimensions);

  // ── Step 5: Generate subtask suggestions ─────────────────
  let subtasks = generateSubtasks(enrichedReq, classification.storyType, scoring.dimensions);

  // ── Step 5b: Optional AI refinement (feature-flagged) ────
  if (isAiRefinementEnabled()) {
    const aiCtx = { title: normalizedReq.title, description: normalizedReq.description, storyType: classification.storyType };
    questions = await refineQuestions(questions, aiCtx);
    subtasks = await refineSubtasks(subtasks, aiCtx);
  }

  // ── Step 6: Build snapshot ───────────────────────────────
  const previousSnapshot = getLatestSnapshot(normalizedReq.jiraKey);
  const version = previousSnapshot ? previousSnapshot.version + 1 : 1;

  const snapshot: StoryReadinessSnapshot = {
    snapshotId: crypto.randomUUID(),
    jiraKey: normalizedReq.jiraKey,
    title: normalizedReq.title,
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
  if (normalizedReq.runMode !== "analyze_only") {
    saveSnapshot(snapshot);
    persisted = true;
  }

  // ── Step 8: Record telemetry ─────────────────────────────
  try {
    recordAnalysis(snapshot);
  } catch {
    // Telemetry must not break analysis
  }

  return { snapshot, persisted, knowledgeContextUsed };
}
