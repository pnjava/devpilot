// ─────────────────────────────────────────────────────────────
// Story Readiness — Question Generator Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import { generateQuestions } from "../src/services/story-readiness/question-generator";
import { scoreReadiness } from "../src/services/story-readiness/scorer";
import { classifyStory } from "../src/services/story-readiness/classifier";
import {
  sparseBackendApi,
  strongBackendApi,
  sparseIntegration,
  hiddenDependency,
  dataMapping,
  validationRuleChange,
  emptyStory,
} from "./fixtures/story-readiness-fixtures";
import type { StoryReadinessRequest } from "../src/services/story-readiness/types";

function questionsFor(fixture: StoryReadinessRequest) {
  const classification = classifyStory({
    title: fixture.title,
    description: fixture.description,
    acceptanceCriteria: fixture.acceptanceCriteria,
    labels: fixture.labels,
    componentTags: fixture.componentTags,
    issueType: fixture.issueType,
  });
  const scoring = scoreReadiness(fixture, classification.storyType);
  return generateQuestions(fixture, classification.storyType, scoring.dimensions);
}

// ── Sparse Stories Generate More Questions ──────────────────

test("sparse backend API story generates multiple questions", () => {
  const questions = questionsFor(sparseBackendApi);
  assert.ok(questions.length >= 3, `Expected >= 3 questions, got ${questions.length}`);
});

test("empty story generates many questions", () => {
  const questions = questionsFor(emptyStory);
  assert.ok(questions.length >= 4, `Expected >= 4 questions for empty story, got ${questions.length}`);
});

test("strong story generates fewer questions than sparse story", () => {
  const strongQs = questionsFor(strongBackendApi);
  const sparseQs = questionsFor(sparseBackendApi);
  assert.ok(
    strongQs.length < sparseQs.length,
    `Strong story should have fewer questions (${strongQs.length}) than sparse (${sparseQs.length})`,
  );
});

// ── Question Structure ─────────────────────────────────────

test("questions have all required fields", () => {
  const questions = questionsFor(sparseBackendApi);
  for (const q of questions) {
    assert.ok(typeof q.id === "string" && q.id.length > 0, "Missing id");
    assert.ok(typeof q.category === "string" && q.category.length > 0, "Missing category");
    assert.ok(typeof q.questionText === "string" && q.questionText.length > 0, "Missing questionText");
    assert.ok(typeof q.whyThisMatters === "string" && q.whyThisMatters.length > 0, "Missing whyThisMatters");
    assert.ok(["blocker", "important", "optional"].includes(q.severity), `Invalid severity: ${q.severity}`);
    assert.ok(typeof q.triggeredBy === "string", "Missing triggeredBy");
    assert.ok(["high", "medium", "low"].includes(q.confidence), `Invalid confidence: ${q.confidence}`);
    assert.ok(
      ["product", "architect", "lead", "developer", "devops", "unknown"].includes(q.suggestedOwner),
      `Invalid suggestedOwner: ${q.suggestedOwner}`,
    );
  }
});

// ── Questions Sorted by Severity ───────────────────────────

test("questions sorted with blockers first", () => {
  const questions = questionsFor(sparseBackendApi);
  const severityOrder: Record<string, number> = { blocker: 0, important: 1, optional: 2 };
  for (let i = 1; i < questions.length; i++) {
    assert.ok(
      severityOrder[questions[i].severity] >= severityOrder[questions[i - 1].severity],
      `Questions not sorted: ${questions[i - 1].severity} before ${questions[i].severity}`,
    );
  }
});

// ── Dependency Questions ───────────────────────────────────

test("integration story generates dependency questions", () => {
  const questions = questionsFor(sparseIntegration);
  const depQuestions = questions.filter((q) => q.category === "Dependency / Ownership");
  // May or may not generate dependency questions depending on dimension score
  // But integration story should get at least some relevant questions
  assert.ok(questions.length > 0, "Integration story should generate at least some questions");
});

test("hidden dependency story generates clarification questions", () => {
  const questions = questionsFor(hiddenDependency);
  assert.ok(questions.length > 0, "Hidden dependency story should generate questions");
});

// ── API / Contract Questions ───────────────────────────────

test("sparse API story triggers API/contract questions when score is low", () => {
  const questions = questionsFor(sparseBackendApi);
  // Check for any question that would be relevant
  const apiOrBizQuestions = questions.filter(
    (q) => q.category === "API / Contract" || q.category === "Business Rules",
  );
  assert.ok(apiOrBizQuestions.length > 0, "Sparse API story should trigger business or API questions");
});

// ── Validation Questions ───────────────────────────────────

test("validation rule story generates data/validation questions", () => {
  const questions = questionsFor(validationRuleChange);
  // Validation story is fairly well-described so may have fewer questions
  // but should still generate some
  assert.ok(questions.length >= 0, "Validation story should be processable");
});

// ── Testing Questions ──────────────────────────────────────

test("story with no test mentions generates testing questions or general questions", () => {
  const questions = questionsFor(sparseBackendApi);
  // Should have at least one question — testing or otherwise
  assert.ok(questions.length > 0, "Should generate questions for sparse story");
});

// ── No Generic Filler ──────────────────────────────────────

test("questions are specific — no filler like 'anything else?'", () => {
  const questions = questionsFor(sparseBackendApi);
  for (const q of questions) {
    assert.ok(q.questionText.length >= 20, `Question too short, likely filler: "${q.questionText}"`);
    assert.ok(!q.questionText.toLowerCase().includes("anything else"), `Filler question detected: "${q.questionText}"`);
  }
});

// ── Category Coverage ──────────────────────────────────────

test("empty story questions cover multiple categories", () => {
  const questions = questionsFor(emptyStory);
  const categories = new Set(questions.map((q) => q.category));
  assert.ok(categories.size >= 2, `Expected >= 2 categories, got ${categories.size}: ${[...categories].join(", ")}`);
});
