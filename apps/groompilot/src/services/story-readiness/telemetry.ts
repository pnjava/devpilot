// ─────────────────────────────────────────────────────────────
// Story Readiness — Telemetry (In-Process Counters)
// Lightweight metrics without external dependencies.
// Query via GET /api/story-readiness/metrics
// ─────────────────────────────────────────────────────────────
import db from "../../db";

// ── Ensure metrics table ───────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS story_readiness_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL DEFAULT 0,
    labels_json TEXT NOT NULL DEFAULT '{}',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sr_metrics_name
    ON story_readiness_metrics(metric_name, recorded_at DESC);
`);

// ── Recording ──────────────────────────────────────────────

const insertMetric = db.prepare(`
  INSERT INTO story_readiness_metrics (metric_name, metric_value, labels_json, recorded_at)
  VALUES (@metric_name, @metric_value, @labels_json, @recorded_at)
`);

export function recordMetric(name: string, value: number, labels: Record<string, string> = {}): void {
  insertMetric.run({
    metric_name: name,
    metric_value: value,
    labels_json: JSON.stringify(labels),
    recorded_at: new Date().toISOString(),
  });
}

// ── Convenience recorders ──────────────────────────────────

export function recordAnalysis(snapshot: {
  jiraKey: string;
  storyType: string;
  readinessState: string;
  readinessScoreOverall: number;
  blockingGaps: { id: string }[];
  clarificationQuestions: { id: string }[];
  suggestedSubtasks: { id: string }[];
  knowledgeConfidence: string;
}): void {
  const labels = {
    jiraKey: snapshot.jiraKey,
    storyType: snapshot.storyType,
    readinessState: snapshot.readinessState,
    knowledgeConfidence: snapshot.knowledgeConfidence,
  };

  recordMetric("story_readiness.analysis_completed", 1, labels);
  recordMetric("story_readiness.overall_score", snapshot.readinessScoreOverall, labels);
  recordMetric("story_readiness.blocking_gaps_count", snapshot.blockingGaps.length, labels);
  recordMetric("story_readiness.questions_generated", snapshot.clarificationQuestions.length, labels);
  recordMetric("story_readiness.subtasks_generated", snapshot.suggestedSubtasks.length, labels);
}

export function recordFeedback(jiraKey: string, accepted: number, rejected: number): void {
  recordMetric("story_readiness.feedback_submitted", 1, { jiraKey });
  recordMetric("story_readiness.subtasks_accepted", accepted, { jiraKey });
  recordMetric("story_readiness.subtasks_rejected", rejected, { jiraKey });
}

export function recordJiraPreview(jiraKey: string): void {
  recordMetric("story_readiness.jira_preview_prepared", 1, { jiraKey });
}

// ── Querying ───────────────────────────────────────────────

interface MetricsSummary {
  totalAnalyses: number;
  readinessStateDistribution: Record<string, number>;
  averageScore: number;
  totalBlockerGaps: number;
  totalQuestionsGenerated: number;
  totalSubtasksGenerated: number;
  totalSubtasksAccepted: number;
  totalFeedbackSubmitted: number;
  totalJiraPreviews: number;
  uniqueStoriesAnalyzed: number;
}

export function getMetricsSummary(sinceDays = 30): MetricsSummary {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const sinceStr = since.toISOString();

  const sumMetric = (name: string): number => {
    const row = db
      .prepare(`SELECT COALESCE(SUM(metric_value), 0) as total FROM story_readiness_metrics WHERE metric_name = ? AND recorded_at >= ?`)
      .get(name, sinceStr) as { total: number };
    return row.total;
  };

  const avgMetric = (name: string): number => {
    const row = db
      .prepare(`SELECT COALESCE(AVG(metric_value), 0) as avg FROM story_readiness_metrics WHERE metric_name = ? AND recorded_at >= ?`)
      .get(name, sinceStr) as { avg: number };
    return Math.round(row.avg * 10) / 10;
  };

  // Readiness state distribution from labels_json  
  const stateRows = db
    .prepare(`
      SELECT json_extract(labels_json, '$.readinessState') as state, COUNT(*) as cnt
      FROM story_readiness_metrics
      WHERE metric_name = 'story_readiness.analysis_completed'
        AND recorded_at >= ?
      GROUP BY state
    `)
    .all(sinceStr) as { state: string; cnt: number }[];

  const readinessStateDistribution: Record<string, number> = {};
  for (const row of stateRows) {
    if (row.state) readinessStateDistribution[row.state] = row.cnt;
  }

  // Unique stories
  const uniqueRow = db
    .prepare(`
      SELECT COUNT(DISTINCT json_extract(labels_json, '$.jiraKey')) as cnt
      FROM story_readiness_metrics
      WHERE metric_name = 'story_readiness.analysis_completed'
        AND recorded_at >= ?
    `)
    .get(sinceStr) as { cnt: number };

  return {
    totalAnalyses: sumMetric("story_readiness.analysis_completed"),
    readinessStateDistribution,
    averageScore: avgMetric("story_readiness.overall_score"),
    totalBlockerGaps: sumMetric("story_readiness.blocking_gaps_count"),
    totalQuestionsGenerated: sumMetric("story_readiness.questions_generated"),
    totalSubtasksGenerated: sumMetric("story_readiness.subtasks_generated"),
    totalSubtasksAccepted: sumMetric("story_readiness.subtasks_accepted"),
    totalFeedbackSubmitted: sumMetric("story_readiness.feedback_submitted"),
    totalJiraPreviews: sumMetric("story_readiness.jira_preview_prepared"),
    uniqueStoriesAnalyzed: uniqueRow.cnt,
  };
}
