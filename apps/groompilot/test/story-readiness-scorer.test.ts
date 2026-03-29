// ─────────────────────────────────────────────────────────────
// Story Readiness — Scorer Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { scoreReadiness } from "../src/services/story-readiness/scorer";
import {
  sparseBackendApi,
  strongBackendApi,
  sparseIntegration,
  hiddenDependency,
  dataMapping,
  emptyStory,
  configChange,
  environmentSensitive,
} from "./fixtures/story-readiness-fixtures";

// ── Minimal Story with Weak AC ─────────────────────────────

test("sparse backend API story gets low readiness score", () => {
  const result = scoreReadiness(sparseBackendApi, "BACKEND_API_CHANGE");
  assert.ok(result.overallScore < 50, `Expected score < 50, got ${result.overallScore}`);
  assert.ok(
    result.readinessState === "NEEDS_CLARIFICATION" || result.readinessState === "BLOCKED_BY_MISSING_INFO",
    `Expected NEEDS_CLARIFICATION or BLOCKED_BY_MISSING_INFO, got ${result.readinessState}`,
  );
});

test("empty story gets very low readiness score with blocking gaps", () => {
  const result = scoreReadiness(emptyStory, "UNKNOWN");
  assert.ok(result.overallScore <= 30, `Expected score <= 30, got ${result.overallScore}`);
  assert.ok(result.blockingGaps.length > 0, "Expected blocking gaps for empty story");
  assert.equal(result.readinessState, "BLOCKED_BY_MISSING_INFO");
});

// ── Strong Story with Clear AC ─────────────────────────────

test("strong backend API story gets high readiness score", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  assert.ok(result.overallScore >= 50, `Expected score >= 50, got ${result.overallScore}`);
  assert.ok(
    result.readinessState === "READY" || result.readinessState === "READY_WITH_QUESTIONS",
    `Expected READY or READY_WITH_QUESTIONS, got ${result.readinessState}`,
  );
});

// ── Dimension Structure ────────────────────────────────────

test("scorer returns all 8 dimensions", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  assert.equal(result.dimensions.length, 8);

  const keys = result.dimensions.map((d) => d.key);
  assert.ok(keys.includes("business_clarity"));
  assert.ok(keys.includes("acceptance_criteria_clarity"));
  assert.ok(keys.includes("dependency_visibility"));
  assert.ok(keys.includes("api_contract_clarity"));
  assert.ok(keys.includes("data_validation_clarity"));
  assert.ok(keys.includes("testing_readiness"));
  assert.ok(keys.includes("environment_devops_readiness"));
  assert.ok(keys.includes("knowledge_confidence"));
});

test("each dimension has score between 0 and 100", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  for (const dim of result.dimensions) {
    assert.ok(dim.score >= 0 && dim.score <= 100, `${dim.key} score out of range: ${dim.score}`);
  }
});

test("each dimension has required fields", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  for (const dim of result.dimensions) {
    assert.ok(typeof dim.name === "string" && dim.name.length > 0, `${dim.key} missing name`);
    assert.ok(typeof dim.weight === "number" && dim.weight > 0, `${dim.key} missing weight`);
    assert.ok(typeof dim.rationale === "string", `${dim.key} missing rationale`);
    assert.ok(Array.isArray(dim.missingSignals), `${dim.key} missing missingSignals array`);
    assert.ok(["high", "medium", "low"].includes(dim.confidence), `${dim.key} invalid confidence`);
  }
});

test("dimension weights sum to 100", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  const totalWeight = result.dimensions.reduce((sum, d) => sum + d.weight, 0);
  assert.equal(totalWeight, 100);
});

// ── Missing Dependency Story ───────────────────────────────

test("hidden dependency story flags dependency dimension as weak", () => {
  const result = scoreReadiness(hiddenDependency, "INTEGRATION_CHANGE");
  const depDim = result.dimensions.find((d) => d.key === "dependency_visibility");
  assert.ok(depDim, "dependency_visibility dimension should exist");
  // Story mentions "fraud scoring engine" but no linked stories or explicit dependency language
  assert.ok(depDim!.score <= 70, `Expected dependency score ≤ 70, got ${depDim!.score}`);
});

// ── Missing Testing Story ──────────────────────────────────

test("sparse story has low testing readiness", () => {
  const result = scoreReadiness(sparseBackendApi, "BACKEND_API_CHANGE");
  const testDim = result.dimensions.find((d) => d.key === "testing_readiness");
  assert.ok(testDim, "testing_readiness dimension should exist");
  assert.ok(testDim!.score < 60, `Expected testing score < 60, got ${testDim!.score}`);
});

// ── Low Knowledge Confidence ───────────────────────────────

test("story without confluence or links has low knowledge confidence", () => {
  const result = scoreReadiness(sparseBackendApi, "BACKEND_API_CHANGE");
  assert.equal(result.knowledgeConfidence, "LOW");
  const kcDim = result.dimensions.find((d) => d.key === "knowledge_confidence");
  assert.ok(kcDim!.score < 30, `Expected knowledge score < 30, got ${kcDim!.score}`);
});

test("story with confluence and links has higher knowledge confidence", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  assert.ok(
    result.knowledgeConfidence === "MEDIUM" || result.knowledgeConfidence === "HIGH",
    `Expected MEDIUM or HIGH knowledge confidence, got ${result.knowledgeConfidence}`,
  );
});

// ── Source Coverage ────────────────────────────────────────

test("source coverage reflects linked confluence", () => {
  const result = scoreReadiness(strongBackendApi, "BACKEND_API_CHANGE");
  assert.equal(result.sourceCoverage.confluence, true);
  assert.equal(result.sourceCoverage.jiraHistory, true);
});

test("sparse story has no source coverage", () => {
  const result = scoreReadiness(sparseBackendApi, "BACKEND_API_CHANGE");
  assert.equal(result.sourceCoverage.confluence, false);
  assert.equal(result.sourceCoverage.jiraHistory, false);
  assert.equal(result.sourceCoverage.manualNotes, false);
});

// ── Readiness State Mapping ────────────────────────────────

test("readiness state maps correctly for very low scores", () => {
  const result = scoreReadiness(emptyStory, "UNKNOWN");
  assert.equal(result.readinessState, "BLOCKED_BY_MISSING_INFO");
});

test("readiness state maps correctly for config story with good detail", () => {
  const result = scoreReadiness(configChange, "CONFIG_OR_ENVIRONMENT_CHANGE");
  assert.ok(
    result.readinessState !== "BLOCKED_BY_MISSING_INFO",
    `Config story with detail should not be blocked, got ${result.readinessState}`,
  );
});

// ── Blocking Gaps ──────────────────────────────────────────

test("blocking gaps have required fields", () => {
  const result = scoreReadiness(emptyStory, "UNKNOWN");
  for (const gap of result.blockingGaps) {
    assert.ok(typeof gap.id === "string" && gap.id.length > 0);
    assert.ok(typeof gap.description === "string" && gap.description.length > 0);
    assert.ok(typeof gap.dimension === "string");
    assert.ok(["blocker", "important", "optional"].includes(gap.severity));
  }
});

// ── API Relevance — Non-API Story ──────────────────────────

test("non-API story gets neutral API contract score", () => {
  const result = scoreReadiness(configChange, "CONFIG_OR_ENVIRONMENT_CHANGE");
  const apiDim = result.dimensions.find((d) => d.key === "api_contract_clarity");
  // Config story should get a neutral API score (around 60)
  assert.ok(apiDim!.score >= 40, `Expected API neutral score >= 40 for config story, got ${apiDim!.score}`);
});
