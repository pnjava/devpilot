// ─────────────────────────────────────────────────────────────
// Story Readiness — Regression Test Fixtures
// Anonymized realistic stories for each major scenario.
// ─────────────────────────────────────────────────────────────
import type { StoryReadinessRequest } from "../../src/services/story-readiness/types";

const BASE: Omit<StoryReadinessRequest, "jiraKey" | "title" | "description" | "acceptanceCriteria" | "labels" | "componentTags"> = {
  storyLinks: [],
  linkedConfluenceUrls: [],
  triggerSource: "ui",
  runMode: "analyze_only",
};

// ── 1. Sparse Backend API Story ────────────────────────────
export const sparseBackendApi: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-SPARSE-API-1",
  title: "Update payment endpoint",
  description: "Need to update the payment endpoint.",
  acceptanceCriteria: "Payment works.",
  labels: [],
  componentTags: [],
};

// ── 2. Strong Backend API Story ────────────────────────────
export const strongBackendApi: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-STRONG-API-2",
  title: "Add POST /api/v2/payments endpoint for card transactions",
  description:
    "Implement a new REST endpoint POST /api/v2/payments that accepts card transaction requests. " +
    "The endpoint must validate the card number format (Luhn check), expiry date, CVV length, and amount > 0. " +
    "On success, return 201 with transaction ID. On validation failure, return 400 with error codes. " +
    "The business goal is to enable real-time card payment processing for the retail channel.",
  acceptanceCriteria:
    "Given a valid card request, when POST /api/v2/payments is called, then return 201 with transactionId.\n" +
    "Given an invalid card number, when POST is called, then return 400 with error code INVALID_CARD.\n" +
    "Given an expired card, when POST is called, then return 400 with error code EXPIRED_CARD.\n" +
    "Given amount <= 0, when POST is called, then return 400 with error code INVALID_AMOUNT.",
  labels: ["api", "payments"],
  componentTags: ["payment-service"],
  assignee: "dev-alice",
  reporter: "pm-bob",
  epicKey: "EPIC-100",
  issueType: "Story",
  storyLinks: ["FIX-99"],
  linkedConfluenceUrls: ["https://wiki.example.com/payments-v2"],
};

// ── 3. Sparse Integration Story ────────────────────────────
export const sparseIntegration: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-SPARSE-INT-3",
  title: "Integrate with downstream settlement service",
  description: "Connect to the new settlement service.",
  acceptanceCriteria: "Integration done.",
  labels: ["integration"],
  componentTags: [],
};

// ── 4. Hidden Dependency Story ─────────────────────────────
export const hiddenDependency: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-HIDDEN-DEP-4",
  title: "Add fraud check before payment authorization",
  description:
    "Before authorizing a payment, the system must call the fraud scoring engine. " +
    "If the fraud score exceeds the threshold, the payment should be held for manual review.",
  acceptanceCriteria:
    "- Payment with fraud score below threshold → authorized\n" +
    "- Payment with fraud score above threshold → held for review\n" +
    "- Fraud service unavailable → ???",
  labels: [],
  componentTags: ["payment-service"],
};

// ── 5. Data Mapping Story ──────────────────────────────────
export const dataMapping: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-MAP-5",
  title: "Map ISO 8583 field 48 to internal transaction metadata",
  description:
    "Implement the mapping and transformation of ISO 8583 field 48 (additional data) " +
    "into the internal transaction metadata schema. The field contains TLV-encoded sub-elements " +
    "that must be parsed and validated before persistence.",
  acceptanceCriteria:
    "Given a valid field 48 with sub-elements, when parsed, then each TLV tag maps to the correct metadata field.\n" +
    "Given an invalid TLV structure, when parsed, then reject with error code INVALID_TLV_FORMAT.\n" +
    "Given missing mandatory sub-element, when parsed, then reject with error code MISSING_MANDATORY_TAG.",
  labels: ["iso8583", "mapping"],
  componentTags: ["iso-parser", "transaction-service"],
  reporter: "pm-bob",
};

// ── 6. Validation Rule Change ──────────────────────────────
export const validationRuleChange: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-VAL-6",
  title: "Add BIN range validation for new card network",
  description:
    "Add validation rules for BIN ranges 456700–456799 for the new card network partnership. " +
    "Cards in this range must pass Luhn check and length must be exactly 16 digits.",
  acceptanceCriteria:
    "- BIN 456700 to 456799 with valid Luhn → accepted\n" +
    "- BIN outside range → existing behavior unchanged\n" +
    "- Length != 16 → reject with INVALID_LENGTH",
  labels: ["validation"],
  componentTags: ["card-validator"],
};

// ── 7. Config / Environment Change ─────────────────────────
export const configChange: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-CFG-7",
  title: "Add feature flag for new settlement batch window",
  description:
    "Add a feature flag to control the new settlement batch window timing. " +
    "When enabled, the batch runs at 02:00 UTC instead of 06:00 UTC. " +
    "Requires Helm chart update and config map change in Kubernetes.",
  acceptanceCriteria:
    "- Feature flag enabled → batch at 02:00 UTC\n" +
    "- Feature flag disabled → batch at 06:00 UTC\n" +
    "- Config deployed via helm upgrade in CIT environment first",
  labels: ["config", "infra"],
  componentTags: ["settlement-batch", "helm"],
};

// ── 8. Bug Fix Story ───────────────────────────────────────
export const bugFix: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-BUG-8",
  title: "Fix null pointer exception in refund processing",
  description:
    "When a refund is processed for a transaction with no original authorization record, " +
    "the system throws a null pointer exception. The fix should gracefully handle the missing record " +
    "and return an appropriate error response.",
  acceptanceCriteria:
    "- Refund with valid original → processed normally\n" +
    "- Refund with missing original → return 404 with ORIGINAL_NOT_FOUND\n" +
    "- No stack trace in production logs",
  labels: [],
  componentTags: ["refund-service"],
  issueType: "Bug",
};

// ── 9. Refactor Story ──────────────────────────────────────
export const refactorStory: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-REF-9",
  title: "Refactor legacy transaction validator to use strategy pattern",
  description:
    "Extract the monolithic validation switch into a strategy pattern. " +
    "Each card network should have its own validator class. Consolidate duplicate code.",
  acceptanceCriteria:
    "- All existing unit tests pass\n" +
    "- No change in external behavior\n" +
    "- Code coverage remains above 80%",
  labels: ["refactor", "tech-debt"],
  componentTags: ["card-validator"],
};

// ── 10. Environment-Sensitive Story ────────────────────────
export const environmentSensitive: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-ENV-10",
  title: "Rotate TLS certificates for downstream payment gateway",
  description:
    "The TLS certificates for the downstream payment gateway connection expire next month. " +
    "New certificates must be provisioned, stored in vault, and deployed to all environments " +
    "in sequence: CIT → SIT → UAT → PROD.",
  acceptanceCriteria:
    "- New certificates provisioned and stored in vault\n" +
    "- CIT environment updated first\n" +
    "- Rollout to PROD only after SIT/UAT validation\n" +
    "- Monitoring confirms successful TLS handshake after rotation",
  labels: ["infra", "devops"],
  componentTags: ["payment-gateway", "vault"],
  storyLinks: ["FIX-ENV-9"],
};

// ── 11. Completely Empty Story ─────────────────────────────
export const emptyStory: StoryReadinessRequest = {
  ...BASE,
  jiraKey: "FIX-EMPTY-11",
  title: "TBD",
  description: "",
  acceptanceCriteria: "",
  labels: [],
  componentTags: [],
};
