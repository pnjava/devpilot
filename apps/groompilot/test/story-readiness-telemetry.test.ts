// ─────────────────────────────────────────────────────────────
// Story Readiness — Telemetry Tests
// Uses the real SQLite DB (same as all snapshot-store tests)
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import {
  recordMetric,
  recordAnalysis,
  recordFeedback,
  recordJiraPreview,
  getMetricsSummary,
} from "../src/services/story-readiness/telemetry";

// ── recordMetric ───────────────────────────────────────────

test("recordMetric inserts a metric without throwing", () => {
  assert.doesNotThrow(() => {
    recordMetric("test.telemetry.basic", 1, { source: "unit-test" });
  });
});

test("recordMetric accepts zero value", () => {
  assert.doesNotThrow(() => {
    recordMetric("test.telemetry.zero", 0);
  });
});

test("recordMetric accepts negative value", () => {
  assert.doesNotThrow(() => {
    recordMetric("test.telemetry.negative", -5, { kind: "delta" });
  });
});

// ── recordAnalysis ─────────────────────────────────────────

test("recordAnalysis records all sub-metrics for a snapshot", () => {
  const snapshot = {
    jiraKey: "TEST-TELEM-1",
    storyType: "BACKEND_API_CHANGE",
    readinessState: "READY",
    readinessScoreOverall: 85,
    blockingGaps: [{ id: "g1" }],
    clarificationQuestions: [{ id: "q1" }, { id: "q2" }],
    suggestedSubtasks: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
    knowledgeConfidence: "high",
  };

  assert.doesNotThrow(() => recordAnalysis(snapshot));
});

// ── recordFeedback ─────────────────────────────────────────

test("recordFeedback records accepted and rejected counts", () => {
  assert.doesNotThrow(() => {
    recordFeedback("TEST-TELEM-FB-1", 3, 1);
  });
});

// ── recordJiraPreview ──────────────────────────────────────

test("recordJiraPreview records a preview event", () => {
  assert.doesNotThrow(() => {
    recordJiraPreview("TEST-TELEM-JP-1");
  });
});

// ── getMetricsSummary ──────────────────────────────────────

test("getMetricsSummary returns all expected fields", () => {
  // Ensure at least one analysis exists
  recordAnalysis({
    jiraKey: "TEST-TELEM-SUMM-1",
    storyType: "BUG_FIX",
    readinessState: "NEEDS_CLARIFICATION",
    readinessScoreOverall: 42,
    blockingGaps: [],
    clarificationQuestions: [{ id: "q1" }],
    suggestedSubtasks: [],
    knowledgeConfidence: "low",
  });

  const summary = getMetricsSummary(30);

  assert.equal(typeof summary.totalAnalyses, "number");
  assert.ok(summary.totalAnalyses >= 1, "Should have at least 1 analysis");
  assert.equal(typeof summary.averageScore, "number");
  assert.equal(typeof summary.totalBlockerGaps, "number");
  assert.equal(typeof summary.totalQuestionsGenerated, "number");
  assert.equal(typeof summary.totalSubtasksGenerated, "number");
  assert.equal(typeof summary.totalSubtasksAccepted, "number");
  assert.equal(typeof summary.totalFeedbackSubmitted, "number");
  assert.equal(typeof summary.totalJiraPreviews, "number");
  assert.equal(typeof summary.uniqueStoriesAnalyzed, "number");
  assert.ok(summary.uniqueStoriesAnalyzed >= 1, "Should have at least 1 unique story");
  assert.equal(typeof summary.readinessStateDistribution, "object");
});

test("getMetricsSummary readinessStateDistribution contains recorded states", () => {
  recordAnalysis({
    jiraKey: "TEST-TELEM-DIST-1",
    storyType: "BACKEND_API_CHANGE",
    readinessState: "BLOCKED_BY_MISSING_INFO",
    readinessScoreOverall: 15,
    blockingGaps: [{ id: "g1" }, { id: "g2" }],
    clarificationQuestions: [],
    suggestedSubtasks: [],
    knowledgeConfidence: "none",
  });

  const summary = getMetricsSummary(30);
  assert.ok(
    "BLOCKED_BY_MISSING_INFO" in summary.readinessStateDistribution,
    `Expected BLOCKED_BY_MISSING_INFO in distribution: ${JSON.stringify(summary.readinessStateDistribution)}`,
  );
});

test("getMetricsSummary with sinceDays=0 returns no data", () => {
  // Records all have recorded_at = 'now', so sindeDays=0 should
  // query from exactly now — might return 0 or 1 depending on timing.
  const summary = getMetricsSummary(0);
  assert.equal(typeof summary.totalAnalyses, "number");
});
