// ─────────────────────────────────────────────────────────────
// Story Readiness — Classifier Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { classifyStory } from "../src/services/story-readiness/classifier";
import {
  sparseBackendApi,
  strongBackendApi,
  sparseIntegration,
  dataMapping,
  validationRuleChange,
  configChange,
  bugFix,
  refactorStory,
  emptyStory,
} from "./fixtures/story-readiness-fixtures";

function classify(fixture: { title: string; description: string; acceptanceCriteria: string; labels: string[]; componentTags: string[]; issueType?: string }) {
  return classifyStory({
    title: fixture.title,
    description: fixture.description,
    acceptanceCriteria: fixture.acceptanceCriteria,
    labels: fixture.labels,
    componentTags: fixture.componentTags,
    issueType: fixture.issueType,
  });
}

// ── BACKEND_API_CHANGE ─────────────────────────────────────

test("classifies a strong backend API story as BACKEND_API_CHANGE", () => {
  const result = classify(strongBackendApi);
  assert.equal(result.storyType, "BACKEND_API_CHANGE");
  assert.ok(result.confidence === "high" || result.confidence === "medium");
  assert.ok(result.signals.length > 0);
});

test("classifies a sparse backend API story — endpoint mention triggers API classification", () => {
  const result = classify(sparseBackendApi);
  assert.equal(result.storyType, "BACKEND_API_CHANGE");
});

// ── INTEGRATION_CHANGE ─────────────────────────────────────

test("classifies an integration story as INTEGRATION_CHANGE", () => {
  const result = classify(sparseIntegration);
  assert.equal(result.storyType, "INTEGRATION_CHANGE");
});

test("classifies story with downstream/upstream keywords as INTEGRATION_CHANGE", () => {
  const result = classifyStory({
    title: "Connect to downstream fraud service",
    description: "Integration with the fraud scoring upstream service via Kafka message queue.",
    acceptanceCriteria: "Messages consumed from queue and forwarded to adapter.",
    labels: [],
    componentTags: [],
  });
  assert.equal(result.storyType, "INTEGRATION_CHANGE");
});

// ── DATA_MAPPING_OR_TRANSFORMATION ─────────────────────────

test("classifies ISO 8583 mapping story as DATA_MAPPING_OR_TRANSFORMATION", () => {
  const result = classify(dataMapping);
  assert.equal(result.storyType, "DATA_MAPPING_OR_TRANSFORMATION");
});

test("classifies story with mapping/transform keywords as DATA_MAPPING_OR_TRANSFORMATION", () => {
  const result = classifyStory({
    title: "Transform incoming SWIFT message to internal schema",
    description: "Parse and map SWIFT MT103 fields to the internal payment schema.",
    acceptanceCriteria: "All mandatory fields mapped. Optional fields handled gracefully.",
    labels: [],
    componentTags: [],
  });
  assert.equal(result.storyType, "DATA_MAPPING_OR_TRANSFORMATION");
});

// ── BACKEND_VALIDATION_RULE_CHANGE ─────────────────────────

test("classifies validation rule change story correctly", () => {
  const result = classify(validationRuleChange);
  assert.equal(result.storyType, "BACKEND_VALIDATION_RULE_CHANGE");
});

test("classifies story with validation keywords", () => {
  const result = classifyStory({
    title: "Add mandatory field validation for new PAN format",
    description: "Validate that the PAN length is exactly 19 digits when BIN starts with 6.",
    acceptanceCriteria: "- Valid PAN accepted\n- Invalid PAN rejected with error INVALID_LENGTH",
    labels: ["validation"],
    componentTags: [],
  });
  assert.equal(result.storyType, "BACKEND_VALIDATION_RULE_CHANGE");
});

// ── CONFIG_OR_ENVIRONMENT_CHANGE ───────────────────────────

test("classifies config/environment story correctly", () => {
  const result = classify(configChange);
  assert.equal(result.storyType, "CONFIG_OR_ENVIRONMENT_CHANGE");
});

// ── BUG_FIX ────────────────────────────────────────────────

test("classifies bug fix story correctly", () => {
  const result = classify(bugFix);
  assert.equal(result.storyType, "BUG_FIX");
});

test("issueType=Bug boosts BUG_FIX classification", () => {
  const result = classifyStory({
    title: "Transaction sometimes fails",
    description: "Intermittent failure in transaction processing.",
    acceptanceCriteria: "No more failures.",
    labels: [],
    componentTags: [],
    issueType: "Bug",
  });
  assert.equal(result.storyType, "BUG_FIX");
});

// ── REFACTOR ───────────────────────────────────────────────

test("classifies refactor story correctly", () => {
  const result = classify(refactorStory);
  assert.equal(result.storyType, "REFACTOR");
});

// ── UNKNOWN ────────────────────────────────────────────────

test("classifies empty/vague story as UNKNOWN", () => {
  const result = classify(emptyStory);
  assert.equal(result.storyType, "UNKNOWN");
  assert.equal(result.confidence, "low");
  assert.equal(result.signals.length, 0);
});

test("classifies completely ambiguous story as UNKNOWN", () => {
  const result = classifyStory({
    title: "Do the thing",
    description: "Needs to be done.",
    acceptanceCriteria: "Done.",
    labels: [],
    componentTags: [],
  });
  assert.equal(result.storyType, "UNKNOWN");
});

// ── Label / Component Signals ──────────────────────────────

test("label signal boosts classification weight", () => {
  const result = classifyStory({
    title: "Update service logic",
    description: "Minor change.",
    acceptanceCriteria: "Works.",
    labels: ["api"],
    componentTags: [],
  });
  assert.equal(result.storyType, "BACKEND_API_CHANGE");
});

test("multiple labels can influence classification", () => {
  const result = classifyStory({
    title: "Update processing",
    description: "Change required.",
    acceptanceCriteria: "Done.",
    labels: ["integration", "mapping"],
    componentTags: [],
  });
  // Should classify as one of the two — both have label signals
  assert.ok(
    result.storyType === "INTEGRATION_CHANGE" || result.storyType === "DATA_MAPPING_OR_TRANSFORMATION",
    `Expected INTEGRATION_CHANGE or DATA_MAPPING_OR_TRANSFORMATION, got ${result.storyType}`,
  );
});

// ── Confidence Levels ──────────────────────────────────────

test("strong story gets high confidence", () => {
  const result = classify(strongBackendApi);
  assert.equal(result.confidence, "high");
});

test("sparse story gets lower confidence", () => {
  const result = classify(sparseBackendApi);
  assert.ok(result.confidence === "medium" || result.confidence === "low");
});
