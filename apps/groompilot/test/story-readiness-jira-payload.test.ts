// ─────────────────────────────────────────────────────────────
// Story Readiness — Jira Payload Builder Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { buildJiraPayload } from "../src/services/story-readiness/jira-payload-builder";
import type { StoryReadinessSnapshot, JiraWriteBackPayload } from "../src/services/story-readiness/types";

// ── Helper: Build a realistic snapshot ─────────────────────

function makeSnapshot(overrides?: Partial<StoryReadinessSnapshot>): StoryReadinessSnapshot {
  return {
    snapshotId: "snap-test-1",
    jiraKey: "TEST-123",
    title: "Add payment validation endpoint",
    storyType: "BACKEND_API_CHANGE",
    readinessState: "READY_WITH_QUESTIONS",
    readinessScoreOverall: 62,
    readinessDimensions: [
      { key: "business_clarity", name: "Business Clarity", score: 70, weight: 15, rationale: "OK", missingSignals: [], confidence: "high" },
      { key: "acceptance_criteria_clarity", name: "AC Clarity", score: 55, weight: 15, rationale: "Weak", missingSignals: ["GWT missing"], confidence: "medium" },
      { key: "dependency_visibility", name: "Dependency Visibility", score: 40, weight: 15, rationale: "Few links", missingSignals: [], confidence: "medium" },
      { key: "api_contract_clarity", name: "API / Contract Clarity", score: 65, weight: 15, rationale: "Some terms", missingSignals: [], confidence: "medium" },
      { key: "data_validation_clarity", name: "Data / Validation Clarity", score: 60, weight: 15, rationale: "Moderate", missingSignals: [], confidence: "medium" },
      { key: "testing_readiness", name: "Testing Readiness", score: 45, weight: 10, rationale: "Low", missingSignals: ["test"], confidence: "low" },
      { key: "environment_devops_readiness", name: "Environment & DevOps", score: 65, weight: 10, rationale: "Neutral", missingSignals: [], confidence: "medium" },
      { key: "knowledge_confidence", name: "Knowledge Confidence", score: 30, weight: 5, rationale: "Low", missingSignals: ["confluence"], confidence: "low" },
    ],
    blockingGaps: [
      { id: "gap-1", description: "No acceptance criteria structure", dimension: "acceptance_criteria_clarity", severity: "important" },
    ],
    clarificationQuestions: [
      {
        id: "q-1",
        category: "Business Rules",
        questionText: "What is the business goal?",
        whyThisMatters: "Prevents wrong implementation.",
        severity: "blocker",
        triggeredBy: "Missing: business, goal",
        confidence: "high",
        suggestedOwner: "product",
      },
      {
        id: "q-2",
        category: "API / Contract",
        questionText: "Are there specific error codes required?",
        whyThisMatters: "Consumers need stable error contracts.",
        severity: "important",
        triggeredBy: "Missing: error code",
        confidence: "medium",
        suggestedOwner: "architect",
      },
    ],
    suggestedSubtasks: [
      {
        id: "st-1",
        title: "Define API contract for payment validation",
        description: "Create OpenAPI spec.",
        category: "Contract / Interface",
        whyNeeded: "Consumers need a stable contract.",
        dependencyHints: ["Must be reviewed first"],
        confidence: "medium",
        optionalAssigneeType: "architect",
        isDraft: false,
      },
      {
        id: "st-2",
        title: "Implement request validation",
        description: "Validate all fields.",
        category: "Validation",
        whyNeeded: "Reject bad input at boundary.",
        dependencyHints: ["Depends on contract"],
        confidence: "medium",
        optionalAssigneeType: "developer",
        isDraft: false,
      },
      {
        id: "st-3",
        title: "Draft: Add logging for payment flow",
        description: "Add structured logging.",
        category: "Logging / Observability",
        whyNeeded: "Traceability needed.",
        dependencyHints: [],
        confidence: "low",
        optionalAssigneeType: "developer",
        isDraft: true,
      },
    ],
    knowledgeConfidence: "MEDIUM",
    sourceCoverage: { jiraHistory: true, pastStories: false, linkedPRs: false, confluence: false, manualNotes: false },
    similarStoryRefs: [],
    similarPrRefs: [],
    generatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

// ── Dry-Run Mode ───────────────────────────────────────────

test("buildJiraPayload always returns dryRun: true in phase 1", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.equal(payload.dryRun, true);
});

test("buildJiraPayload defaults dryRun to true when not specified", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.equal(payload.dryRun, true);
});

test("buildJiraPayload allows dryRun override", () => {
  const payload = buildJiraPayload(makeSnapshot(), { dryRun: false });
  assert.equal(payload.dryRun, false);
});

// ── Comment Body ───────────────────────────────────────────

test("payload includes comment body with story info", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.length > 0, "Comment body should not be empty");
  assert.ok(payload.commentBody.includes("TEST-123"), "Comment should include Jira key");
  assert.ok(payload.commentBody.includes("BACKEND_API_CHANGE"), "Comment should include story type");
  assert.ok(payload.commentBody.includes("READY_WITH_QUESTIONS"), "Comment should include readiness state");
});

test("comment body includes dimension breakdown", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.includes("Business Clarity"), "Comment should include dimension names");
  assert.ok(payload.commentBody.includes("Testing Readiness"), "Comment should include testing dimension");
});

test("comment body includes blocking gaps", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.includes("No acceptance criteria structure"), "Comment should include blocking gap");
});

test("comment body includes questions", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.includes("What is the business goal"), "Comment should include questions");
});

test("comment body includes subtask list", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.includes("Define API contract"), "Comment should include subtask titles");
});

// ── Subtask Payloads ───────────────────────────────────────

test("subtask payloads exclude draft subtasks by default", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.equal(payload.subtaskPayloads.length, 2, "Should have 2 non-draft subtasks");
  const summaries = payload.subtaskPayloads.map((s) => s.summary);
  assert.ok(!summaries.some((s) => s.includes("Draft")), "Should not include draft subtask");
});

test("subtask payloads have correct structure", () => {
  const payload = buildJiraPayload(makeSnapshot());
  for (const sp of payload.subtaskPayloads) {
    assert.ok(typeof sp.summary === "string" && sp.summary.length > 0, "Missing summary");
    assert.ok(typeof sp.description === "string" && sp.description.length > 0, "Missing description");
    assert.ok(Array.isArray(sp.labels) && sp.labels.length > 0, "Missing labels");
    assert.ok(sp.labels.includes("groompilot-generated"), "Should have groompilot-generated label");
  }
});

test("subtask payloads include readiness type label", () => {
  const payload = buildJiraPayload(makeSnapshot());
  for (const sp of payload.subtaskPayloads) {
    assert.ok(
      sp.labels.some((l) => l.startsWith("readiness-")),
      "Should include readiness type label",
    );
  }
});

// ── Selected Subtask IDs ───────────────────────────────────

test("only selected subtask IDs are included when specified", () => {
  const payload = buildJiraPayload(makeSnapshot(), { selectedSubtaskIds: ["st-1"] });
  assert.equal(payload.subtaskPayloads.length, 1);
  assert.equal(payload.subtaskPayloads[0].summary, "Define API contract for payment validation");
});

test("selected IDs can include draft subtasks", () => {
  const payload = buildJiraPayload(makeSnapshot(), { selectedSubtaskIds: ["st-3"] });
  assert.equal(payload.subtaskPayloads.length, 1);
  assert.ok(payload.subtaskPayloads[0].summary.includes("Draft"), "Should include draft subtask when explicitly selected");
});

// ── Options ────────────────────────────────────────────────

test("includeComment: false produces empty comment body", () => {
  const payload = buildJiraPayload(makeSnapshot(), { includeComment: false });
  assert.equal(payload.commentBody, "");
});

test("includeSubtasks: false produces no subtask payloads", () => {
  const payload = buildJiraPayload(makeSnapshot(), { includeSubtasks: false });
  assert.equal(payload.subtaskPayloads.length, 0);
});

// ── Jira Key Preserved ─────────────────────────────────────

test("jiraKey is carried through to payload", () => {
  const payload = buildJiraPayload(makeSnapshot({ jiraKey: "PROJ-999" }));
  assert.equal(payload.jiraKey, "PROJ-999");
});

// ── Generated Footer ───────────────────────────────────────

test("comment body includes GroomPilot attribution", () => {
  const payload = buildJiraPayload(makeSnapshot());
  assert.ok(payload.commentBody.includes("GroomPilot"), "Comment should attribute to GroomPilot");
});
