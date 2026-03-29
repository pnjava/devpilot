// ─────────────────────────────────────────────────────────────
// Story Readiness — Normalizer Tests
// ─────────────────────────────────────────────────────────────
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAcceptanceCriteria,
  normalizeStoryInput,
  type NormalizeInput,
} from "../src/services/story-readiness/normalizer";

// ═════════════════════════════════════════════════════════════
// extractAcceptanceCriteria
// ═════════════════════════════════════════════════════════════

test("extracts AC from explicit 'Acceptance Criteria:' header", () => {
  const desc =
    "Some intro text.\n\nAcceptance Criteria:\n- Item A\n- Item B\n- Item C\n\nNotes:\nSome notes here.";
  const ac = extractAcceptanceCriteria(desc);
  assert.ok(ac.includes("Item A"), `Expected 'Item A' in extracted AC: "${ac}"`);
  assert.ok(ac.includes("Item C"), `Expected 'Item C' in extracted AC: "${ac}"`);
  assert.ok(!ac.includes("Some notes here"), "Should not include text after Notes: header");
});

test("extracts AC from 'AC:' shorthand header", () => {
  const desc = "Overview of task.\n\nAC:\n1. First criterion.\n2. Second criterion.";
  const ac = extractAcceptanceCriteria(desc);
  assert.ok(ac.includes("First criterion"), `Expected 'First criterion' in: "${ac}"`);
  assert.ok(ac.includes("Second criterion"), `Expected 'Second criterion' in: "${ac}"`);
});

test("extracts Given/When/Then blocks", () => {
  const desc =
    "We need to handle refunds.\n\n" +
    "Given a valid refund request\n" +
    "When the refund endpoint is called\n" +
    "Then return 200 with refund ID\n\n" +
    "Some trailing text.";
  const ac = extractAcceptanceCriteria(desc);
  assert.ok(ac.includes("Given a valid refund request"), `GWT block not extracted: "${ac}"`);
  assert.ok(ac.includes("Then return 200"), `Then clause missing: "${ac}"`);
});

test("extracts Definition of Done section", () => {
  const desc =
    "Description of the task.\n\nDefinition of Done:\n- Unit tests pass\n- Code reviewed\n- Deployed to CIT";
  const ac = extractAcceptanceCriteria(desc);
  assert.ok(ac.includes("Unit tests pass"), `DoD not extracted: "${ac}"`);
  assert.ok(ac.includes("Deployed to CIT"), `DoD incomplete: "${ac}"`);
});

test("returns empty string for description with no recognizable AC patterns", () => {
  const desc = "Just a plain description with no acceptance criteria or GWT blocks.";
  const ac = extractAcceptanceCriteria(desc);
  assert.equal(ac, "");
});

test("returns empty string for empty or whitespace-only description", () => {
  assert.equal(extractAcceptanceCriteria(""), "");
  assert.equal(extractAcceptanceCriteria("   "), "");
});

test("returns empty string for null-ish input", () => {
  assert.equal(extractAcceptanceCriteria(undefined as unknown as string), "");
  assert.equal(extractAcceptanceCriteria(null as unknown as string), "");
});

// ═════════════════════════════════════════════════════════════
// normalizeStoryInput
// ═════════════════════════════════════════════════════════════

const BASE_INPUT: NormalizeInput = {
  jiraKey: "TEST-1",
  title: "  Some title  ",
  description: "  A description  ",
  acceptanceCriteria: "  AC here  ",
  labels: [" Api ", " PAYMENTS "],
  componentTags: [" payment-service "],
  storyLinks: [],
  linkedConfluenceUrls: [],
};

test("normalizeStoryInput trims string fields", () => {
  const { normalized } = normalizeStoryInput(BASE_INPUT);
  assert.equal(normalized.title, "Some title");
  assert.equal(normalized.description, "A description");
  assert.equal(normalized.acceptanceCriteria, "AC here");
});

test("normalizeStoryInput lowercases and trims labels", () => {
  const { normalized } = normalizeStoryInput(BASE_INPUT);
  assert.deepEqual(normalized.labels, ["api", "payments"]);
});

test("normalizeStoryInput trims component tags", () => {
  const { normalized } = normalizeStoryInput(BASE_INPUT);
  assert.deepEqual(normalized.componentTags, ["payment-service"]);
});

test("normalizeStoryInput defaults empty arrays", () => {
  const input: NormalizeInput = {
    ...BASE_INPUT,
    storyLinks: undefined as unknown as string[],
    linkedConfluenceUrls: undefined as unknown as string[],
  };
  const { normalized } = normalizeStoryInput(input);
  assert.deepEqual(normalized.storyLinks, []);
  assert.deepEqual(normalized.linkedConfluenceUrls, []);
});

test("normalizeStoryInput extracts AC from description when acceptanceCriteria is empty", () => {
  const input: NormalizeInput = {
    ...BASE_INPUT,
    acceptanceCriteria: "",
    description:
      "Some intro.\n\nAcceptance Criteria:\n- Login works\n- Logout works\n\nNotes:\nDone.",
  };
  const { normalized, acExtractedFromDescription, fieldsDefaulted } =
    normalizeStoryInput(input);
  assert.ok(acExtractedFromDescription, "acExtractedFromDescription should be true");
  assert.ok(
    normalized.acceptanceCriteria.includes("Login works"),
    `Expected extracted AC, got: "${normalized.acceptanceCriteria}"`,
  );
  assert.ok(!fieldsDefaulted.includes("acceptanceCriteria"), "AC was extracted—should not be in fieldsDefaulted");
});

test("normalizeStoryInput records fieldsDefaulted for truly empty fields", () => {
  const input: NormalizeInput = {
    ...BASE_INPUT,
    title: "",
    description: "",
    acceptanceCriteria: "",
  };
  const { fieldsDefaulted } = normalizeStoryInput(input);
  assert.ok(fieldsDefaulted.includes("title"), "title should be in fieldsDefaulted");
  assert.ok(fieldsDefaulted.includes("description"), "description should be in fieldsDefaulted");
  assert.ok(fieldsDefaulted.includes("acceptanceCriteria"), "acceptanceCriteria should be in fieldsDefaulted");
});

test("normalizeStoryInput does NOT extract AC if acceptanceCriteria is already provided", () => {
  const input: NormalizeInput = {
    ...BASE_INPUT,
    acceptanceCriteria: "Existing AC",
    description: "Acceptance Criteria:\n- Should not override",
  };
  const { normalized, acExtractedFromDescription } = normalizeStoryInput(input);
  assert.equal(acExtractedFromDescription, false);
  assert.equal(normalized.acceptanceCriteria, "Existing AC");
});

test("normalizeStoryInput preserves pass-through fields", () => {
  const input: NormalizeInput = {
    ...BASE_INPUT,
    epicKey: "EPIC-50",
    assignee: "alice",
    reporter: "bob",
    status: "Open",
    issueType: "Story",
    manualContextText: "Some context",
  };
  const { normalized } = normalizeStoryInput(input);
  assert.equal(normalized.epicKey, "EPIC-50");
  assert.equal(normalized.assignee, "alice");
  assert.equal(normalized.reporter, "bob");
  assert.equal(normalized.status, "Open");
  assert.equal(normalized.issueType, "Story");
  assert.equal(normalized.manualContextText, "Some context");
});
