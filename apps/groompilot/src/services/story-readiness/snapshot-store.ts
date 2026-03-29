// ─────────────────────────────────────────────────────────────
// Story Readiness — Snapshot Store (SQLite CRUD)
// ─────────────────────────────────────────────────────────────
import db from "../../db";
import type {
  StoryReadinessSnapshot,
  StoryReadinessSnapshotRow,
  StoryReadinessSourceRow,
  StoryReadinessFeedbackRow,
  SourceReference,
} from "./types";
import crypto from "crypto";

// ── Tables ─────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS story_readiness_snapshots (
    id TEXT PRIMARY KEY,
    jira_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    story_type TEXT NOT NULL DEFAULT 'UNKNOWN',
    readiness_state TEXT NOT NULL DEFAULT 'NEEDS_CLARIFICATION',
    overall_score INTEGER NOT NULL DEFAULT 0,
    dimensions_json TEXT NOT NULL DEFAULT '[]',
    blocking_gaps_json TEXT NOT NULL DEFAULT '[]',
    questions_json TEXT NOT NULL DEFAULT '[]',
    subtasks_json TEXT NOT NULL DEFAULT '[]',
    knowledge_confidence TEXT NOT NULL DEFAULT 'LOW',
    source_coverage_json TEXT NOT NULL DEFAULT '{}',
    similar_refs_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sr_snapshots_jira_key
    ON story_readiness_snapshots(jira_key, created_at DESC);

  CREATE TABLE IF NOT EXISTS story_readiness_sources (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    confidence TEXT NOT NULL DEFAULT 'medium',
    FOREIGN KEY (snapshot_id) REFERENCES story_readiness_snapshots(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sr_sources_snapshot
    ON story_readiness_sources(snapshot_id);

  CREATE TABLE IF NOT EXISTS story_readiness_feedback (
    id TEXT PRIMARY KEY,
    jira_key TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL DEFAULT 'general',
    feedback_text TEXT NOT NULL DEFAULT '',
    accepted_question_ids_json TEXT NOT NULL DEFAULT '[]',
    accepted_subtask_ids_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL DEFAULT 'anonymous',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (snapshot_id) REFERENCES story_readiness_snapshots(id)
  );

  CREATE INDEX IF NOT EXISTS idx_sr_feedback_jira
    ON story_readiness_feedback(jira_key, created_at DESC);
`);

// ── Prepared Statements ────────────────────────────────────

const insertSnapshotStmt = db.prepare(`
  INSERT INTO story_readiness_snapshots (
    id, jira_key, title, story_type, readiness_state, overall_score,
    dimensions_json, blocking_gaps_json, questions_json, subtasks_json,
    knowledge_confidence, source_coverage_json, similar_refs_json,
    version, created_at, updated_at
  ) VALUES (
    @id, @jira_key, @title, @story_type, @readiness_state, @overall_score,
    @dimensions_json, @blocking_gaps_json, @questions_json, @subtasks_json,
    @knowledge_confidence, @source_coverage_json, @similar_refs_json,
    @version, @created_at, @updated_at
  )
`);

const getLatestByKeyStmt = db.prepare(`
  SELECT * FROM story_readiness_snapshots
  WHERE jira_key = ?
  ORDER BY created_at DESC
  LIMIT 1
`);

const getHistoryByKeyStmt = db.prepare(`
  SELECT * FROM story_readiness_snapshots
  WHERE jira_key = ?
  ORDER BY created_at DESC
  LIMIT ?
`);

const getByIdStmt = db.prepare(`
  SELECT * FROM story_readiness_snapshots
  WHERE id = ?
`);

const insertSourceStmt = db.prepare(`
  INSERT INTO story_readiness_sources (id, snapshot_id, source_type, source_ref, title, excerpt, confidence)
  VALUES (@id, @snapshot_id, @source_type, @source_ref, @title, @excerpt, @confidence)
`);

const getSourcesBySnapshotStmt = db.prepare(`
  SELECT * FROM story_readiness_sources WHERE snapshot_id = ?
`);

const insertFeedbackStmt = db.prepare(`
  INSERT INTO story_readiness_feedback (
    id, jira_key, snapshot_id, feedback_type, feedback_text,
    accepted_question_ids_json, accepted_subtask_ids_json, created_by, created_at
  ) VALUES (
    @id, @jira_key, @snapshot_id, @feedback_type, @feedback_text,
    @accepted_question_ids_json, @accepted_subtask_ids_json, @created_by, @created_at
  )
`);

// ── Helpers ────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

function rowToSnapshot(row: StoryReadinessSnapshotRow): StoryReadinessSnapshot {
  return {
    snapshotId: row.id,
    jiraKey: row.jira_key,
    title: row.title,
    storyType: row.story_type,
    readinessState: row.readiness_state,
    readinessScoreOverall: row.overall_score,
    readinessDimensions: JSON.parse(row.dimensions_json),
    blockingGaps: JSON.parse(row.blocking_gaps_json),
    clarificationQuestions: JSON.parse(row.questions_json),
    suggestedSubtasks: JSON.parse(row.subtasks_json),
    knowledgeConfidence: row.knowledge_confidence,
    sourceCoverage: JSON.parse(row.source_coverage_json),
    similarStoryRefs: [],
    similarPrRefs: [],
    generatedAt: row.created_at,
    version: row.version,
  };
}

// ── Public API ─────────────────────────────────────────────

export function saveSnapshot(snapshot: StoryReadinessSnapshot): string {
  const id = snapshot.snapshotId || uid();
  const now = new Date().toISOString();

  insertSnapshotStmt.run({
    id,
    jira_key: snapshot.jiraKey,
    title: snapshot.title,
    story_type: snapshot.storyType,
    readiness_state: snapshot.readinessState,
    overall_score: snapshot.readinessScoreOverall,
    dimensions_json: JSON.stringify(snapshot.readinessDimensions),
    blocking_gaps_json: JSON.stringify(snapshot.blockingGaps),
    questions_json: JSON.stringify(snapshot.clarificationQuestions),
    subtasks_json: JSON.stringify(snapshot.suggestedSubtasks),
    knowledge_confidence: snapshot.knowledgeConfidence,
    source_coverage_json: JSON.stringify(snapshot.sourceCoverage),
    similar_refs_json: JSON.stringify([
      ...snapshot.similarStoryRefs,
      ...snapshot.similarPrRefs,
    ]),
    version: snapshot.version,
    created_at: now,
    updated_at: now,
  });

  // Save source references
  const allRefs: SourceReference[] = [
    ...snapshot.similarStoryRefs,
    ...snapshot.similarPrRefs,
  ];
  for (const ref of allRefs) {
    insertSourceStmt.run({
      id: uid(),
      snapshot_id: id,
      source_type: ref.type,
      source_ref: ref.ref,
      title: ref.title,
      excerpt: ref.excerpt || "",
      confidence: ref.confidence,
    });
  }

  return id;
}

export function getLatestSnapshot(jiraKey: string): StoryReadinessSnapshot | null {
  const row = getLatestByKeyStmt.get(jiraKey) as StoryReadinessSnapshotRow | undefined;
  if (!row) return null;

  const snapshot = rowToSnapshot(row);

  // Hydrate sources
  const sources = getSourcesBySnapshotStmt.all(row.id) as StoryReadinessSourceRow[];
  for (const s of sources) {
    const ref: SourceReference = {
      type: s.source_type as SourceReference["type"],
      ref: s.source_ref,
      title: s.title,
      excerpt: s.excerpt || undefined,
      confidence: s.confidence as SourceReference["confidence"],
    };
    if (s.source_type === "pull_request") {
      snapshot.similarPrRefs.push(ref);
    } else {
      snapshot.similarStoryRefs.push(ref);
    }
  }

  return snapshot;
}

export function getSnapshotHistory(jiraKey: string, limit = 10): StoryReadinessSnapshot[] {
  const rows = getHistoryByKeyStmt.all(jiraKey, limit) as StoryReadinessSnapshotRow[];
  return rows.map(rowToSnapshot);
}

export function getSnapshotById(id: string): StoryReadinessSnapshot | null {
  const row = getByIdStmt.get(id) as StoryReadinessSnapshotRow | undefined;
  if (!row) return null;
  return rowToSnapshot(row);
}

export function saveFeedback(input: {
  jiraKey: string;
  snapshotId: string;
  feedbackType: string;
  feedbackText: string;
  acceptedQuestionIds: string[];
  acceptedSubtaskIds: string[];
  createdBy: string;
}): string {
  const id = uid();
  insertFeedbackStmt.run({
    id,
    jira_key: input.jiraKey,
    snapshot_id: input.snapshotId,
    feedback_type: input.feedbackType,
    feedback_text: input.feedbackText,
    accepted_question_ids_json: JSON.stringify(input.acceptedQuestionIds),
    accepted_subtask_ids_json: JSON.stringify(input.acceptedSubtaskIds),
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
  });
  return id;
}
