// ─────────────────────────────────────────────────────────────
// Story Readiness — Subtask Generator Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { generateSubtasks } from "../src/services/story-readiness/subtask-generator";
import { scoreReadiness } from "../src/services/story-readiness/scorer";
import { classifyStory } from "../src/services/story-readiness/classifier";
import {
  sparseBackendApi,
  strongBackendApi,
  sparseIntegration,
  dataMapping,
  validationRuleChange,
  configChange,
  emptyStory,
} from "./fixtures/story-readiness-fixtures";
import type { StoryReadinessRequest, StoryType } from "../src/services/story-readiness/types";

function subtasksFor(fixture: StoryReadinessRequest, overrideType?: StoryType) {
  const classification = classifyStory({
    title: fixture.title,
    description: fixture.description,
    acceptanceCriteria: fixture.acceptanceCriteria,
    labels: fixture.labels,
    componentTags: fixture.componentTags,
    issueType: fixture.issueType,
  });
  const storyType = overrideType ?? classification.storyType;
  const scoring = scoreReadiness(fixture, storyType);
  return generateSubtasks(fixture, storyType, scoring.dimensions);
}

// ── Backend Story Produces Concrete Subtasks ────────────────

test("strong backend API story generates concrete subtasks", () => {
  const subtasks = subtasksFor(strongBackendApi);
  assert.ok(subtasks.length >= 3, `Expected >= 3 subtasks, got ${subtasks.length}`);

  // Should include contract / validation / business logic / tests
  const categories = new Set(subtasks.map((s) => s.category));
  assert.ok(categories.has("Contract / Interface") || categories.has("Validation") || categories.has("Business Logic"),
    `Expected concrete backend categories, got: ${[...categories].join(", ")}`,
  );
});

test("backend API subtasks include API contract definition", () => {
  const subtasks = subtasksFor(strongBackendApi, "BACKEND_API_CHANGE");
  const contractSubtask = subtasks.find((s) => s.category === "Contract / Interface");
  assert.ok(contractSubtask, "Should generate a contract/interface subtask for API change");
});

// ── Integration Story Produces Integration Subtasks ─────────

test("integration story generates downstream/integration subtasks", () => {
  const subtasks = subtasksFor(sparseIntegration, "INTEGRATION_CHANGE");
  assert.ok(subtasks.length >= 1, `Expected >= 1 subtask for integration story, got ${subtasks.length}`);
  const categories = new Set(subtasks.map((s) => s.category));
  assert.ok(
    categories.has("Downstream Integration") || categories.has("Error Handling / Failure Mapping") || categories.has("Integration Tests / Simulators / Injectors"),
    `Expected integration-related categories, got: ${[...categories].join(", ")}`,
  );
});

// ── Data Mapping Story ─────────────────────────────────────

test("data mapping story generates mapping/validation subtasks", () => {
  const subtasks = subtasksFor(dataMapping, "DATA_MAPPING_OR_TRANSFORMATION");
  assert.ok(subtasks.length >= 2, `Expected >= 2 subtasks for mapping story, got ${subtasks.length}`);
});

// ── Sparse Story Marks Low Confidence ──────────────────────

test("sparse story subtasks are marked as drafts", () => {
  const subtasks = subtasksFor(sparseBackendApi);
  const drafts = subtasks.filter((s) => s.isDraft);
  assert.ok(drafts.length > 0, "Sparse story should produce draft subtasks");
  for (const draft of drafts) {
    assert.equal(draft.confidence, "low", `Draft subtask should have low confidence: ${draft.title}`);
  }
});

test("empty story subtasks are all drafts", () => {
  const subtasks = subtasksFor(emptyStory, "UNKNOWN");
  for (const s of subtasks) {
    assert.ok(s.isDraft, `Expected all UNKNOWN story subtasks to be drafts: ${s.title}`);
    assert.equal(s.confidence, "low");
  }
});

// ── Strong Story Subtasks Are Not Drafts ────────────────────

test("strong story subtasks are not marked as drafts", () => {
  const subtasks = subtasksFor(strongBackendApi);
  const nonDrafts = subtasks.filter((s) => !s.isDraft);
  assert.ok(nonDrafts.length > 0, "Strong story should have non-draft subtasks");
});

// ── Subtask Structure ──────────────────────────────────────

test("subtasks have all required fields", () => {
  const subtasks = subtasksFor(strongBackendApi);
  for (const s of subtasks) {
    assert.ok(typeof s.id === "string" && s.id.length > 0, "Missing id");
    assert.ok(typeof s.title === "string" && s.title.length > 0, "Missing title");
    assert.ok(typeof s.description === "string" && s.description.length > 0, "Missing description");
    assert.ok(typeof s.category === "string" && s.category.length > 0, "Missing category");
    assert.ok(typeof s.whyNeeded === "string" && s.whyNeeded.length > 0, "Missing whyNeeded");
    assert.ok(Array.isArray(s.dependencyHints), "Missing dependencyHints array");
    assert.ok(["high", "medium", "low"].includes(s.confidence), `Invalid confidence: ${s.confidence}`);
    assert.ok(typeof s.isDraft === "boolean", "Missing isDraft flag");
  }
});

// ── No Generic Placeholder Subtasks ─────────────────────────

test("subtasks are not generic placeholders", () => {
  const subtasks = subtasksFor(strongBackendApi);
  const genericTitles = ["coding", "testing", "deployment", "implementation"];
  for (const s of subtasks) {
    const normalized = s.title.toLowerCase().trim();
    assert.ok(
      !genericTitles.includes(normalized),
      `Generic placeholder subtask detected: "${s.title}"`,
    );
    assert.ok(s.title.length >= 10, `Subtask title too short: "${s.title}"`);
  }
});

// ── Config Story ───────────────────────────────────────────

test("config story generates config/environment subtasks", () => {
  const subtasks = subtasksFor(configChange, "CONFIG_OR_ENVIRONMENT_CHANGE");
  assert.ok(subtasks.length >= 1, `Expected >= 1 subtask for config story, got ${subtasks.length}`);
});

// ── Validation Rule Story ──────────────────────────────────

test("validation story generates validator-related subtasks", () => {
  const subtasks = subtasksFor(validationRuleChange, "BACKEND_VALIDATION_RULE_CHANGE");
  assert.ok(subtasks.length >= 1, `Expected >= 1 subtask for validation story, got ${subtasks.length}`);
});
