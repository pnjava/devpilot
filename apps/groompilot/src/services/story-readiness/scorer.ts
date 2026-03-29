// ─────────────────────────────────────────────────────────────
// Story Readiness — 8-Dimension Readiness Scorer
// ─────────────────────────────────────────────────────────────
import type {
  DimensionKey,
  ReadinessDimension,
  ReadinessState,
  StoryType,
  BlockingGap,
  SourceCoverage,
  KnowledgeConfidence,
  StoryReadinessRequest,
} from "./types";

// ── Dimension Definitions ──────────────────────────────────

interface DimensionDef {
  key: DimensionKey;
  name: string;
  weight: number; // sums to 100
}

const DIMENSIONS: DimensionDef[] = [
  { key: "business_clarity",             name: "Business Clarity",           weight: 15 },
  { key: "acceptance_criteria_clarity",  name: "AC Clarity",                 weight: 15 },
  { key: "dependency_visibility",        name: "Dependency Visibility",      weight: 15 },
  { key: "api_contract_clarity",         name: "API / Contract Clarity",     weight: 15 },
  { key: "data_validation_clarity",      name: "Data / Validation Clarity",  weight: 15 },
  { key: "testing_readiness",            name: "Testing Readiness",          weight: 10 },
  { key: "environment_devops_readiness", name: "Environment & DevOps",       weight: 10 },
  { key: "knowledge_confidence",         name: "Knowledge Confidence",       weight: 5  },
];

// ── Signal Extractors ──────────────────────────────────────

type SignalCheck = (ctx: ScoringContext) => { score: number; rationale: string; missing: string[] };

interface ScoringContext {
  req: StoryReadinessRequest;
  storyType: StoryType;
  titleLen: number;
  descLen: number;
  acLen: number;
  corpus: string;
  hasLinks: boolean;
  hasConfluence: boolean;
  hasManualContext: boolean;
  componentCount: number;
  labelCount: number;
}

function buildContext(req: StoryReadinessRequest, storyType: StoryType): ScoringContext {
  return {
    req,
    storyType,
    titleLen: req.title.trim().length,
    descLen: req.description.trim().length,
    acLen: req.acceptanceCriteria.trim().length,
    corpus: [req.title, req.description, req.acceptanceCriteria].join(" ").toLowerCase(),
    hasLinks: req.storyLinks.length > 0,
    hasConfluence: req.linkedConfluenceUrls.length > 0,
    hasManualContext: !!req.manualContextText?.trim(),
    componentCount: req.componentTags.length,
    labelCount: req.labels.length,
  };
}

// ── Individual Dimension Scorers ───────────────────────────

const scorers: Record<DimensionKey, SignalCheck> = {
  business_clarity(ctx) {
    let score = 0;
    const missing: string[] = [];

    // Title clarity
    if (ctx.titleLen >= 20) score += 25;
    else if (ctx.titleLen >= 10) score += 15;
    else { score += 5; missing.push("Title is too short — add context"); }

    // Description body
    if (ctx.descLen >= 200) score += 30;
    else if (ctx.descLen >= 50) score += 20;
    else if (ctx.descLen > 0) score += 10;
    else { missing.push("No description provided"); }

    // Business-relevant terms
    const bizTerms = ["business", "user", "customer", "stakeholder", "requirement", "purpose", "goal", "value", "benefit"];
    const hits = bizTerms.filter((t) => ctx.corpus.includes(t)).length;
    score += Math.min(hits * 5, 25);
    if (hits === 0) missing.push("No business context terms found");

    // Reporter / assignee populated
    if (ctx.req.reporter) score += 10;
    else missing.push("Reporter not set");

    if (ctx.req.assignee) score += 10;
    else missing.push("Assignee not set");

    return { score: Math.min(score, 100), rationale: `${hits} business terms, desc ${ctx.descLen} chars`, missing };
  },

  acceptance_criteria_clarity(ctx) {
    let score = 0;
    const missing: string[] = [];

    if (ctx.acLen === 0) {
      missing.push("No acceptance criteria provided");
      return { score: 0, rationale: "AC is empty", missing };
    }

    // Length
    if (ctx.acLen >= 200) score += 30;
    else if (ctx.acLen >= 80) score += 20;
    else score += 10;

    // Given-When-Then or numbered/bulleted
    const gwtCount = (ctx.req.acceptanceCriteria.match(/given|when|then/gi) || []).length;
    if (gwtCount >= 3) score += 30;
    else if (gwtCount >= 1) score += 15;
    else missing.push("No Given/When/Then structure detected");

    // Bullet points / numbered list
    const bulletCount = (ctx.req.acceptanceCriteria.match(/^[\s]*[-*•\d]+[.)]/gm) || []).length;
    if (bulletCount >= 3) score += 20;
    else if (bulletCount >= 1) score += 10;
    else missing.push("AC not structured as a list");

    // Edge case / error terms
    const edgeTerms = ["error", "edge", "boundary", "invalid", "negative", "failure", "timeout", "null", "empty"];
    const edgeHits = edgeTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (edgeHits >= 2) score += 20;
    else if (edgeHits >= 1) score += 10;
    else missing.push("No error/edge-case scenarios in AC");

    return { score: Math.min(score, 100), rationale: `AC ${ctx.acLen} chars, ${gwtCount} GWT, ${bulletCount} bullets`, missing };
  },

  dependency_visibility(ctx) {
    let score = 20; // base: dependency section not always relevant
    const missing: string[] = [];

    // Linked stories
    if (ctx.req.storyLinks.length > 0) score += 30;
    else missing.push("No linked stories/issues");

    // Dependency terms
    const depTerms = ["depend", "block", "prerequisite", "upstream", "downstream", "before", "after", "sequence"];
    const depHits = depTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (depHits >= 2) score += 25;
    else if (depHits >= 1) score += 15;

    // Component tags hint at cross-team
    if (ctx.componentCount >= 2) score += 15;
    else if (ctx.componentCount >= 1) score += 10;
    else missing.push("No component tags — cross-team dependencies unclear");

    // Labels
    if (ctx.labelCount >= 1) score += 10;

    return { score: Math.min(score, 100), rationale: `${ctx.req.storyLinks.length} links, ${depHits} dep terms`, missing };
  },

  api_contract_clarity(ctx) {
    let score = 0;
    const missing: string[] = [];

    // Relevance check: some story types need heavy API scoring
    const apiTypes: StoryType[] = ["BACKEND_API_CHANGE", "INTEGRATION_CHANGE"];
    const isApiRelevant = apiTypes.includes(ctx.storyType);

    const apiTerms = ["endpoint", "api", "request", "response", "payload", "header", "status code", "contract", "schema", "field", "parameter"];
    const apiHits = apiTerms.filter((t) => ctx.corpus.includes(t)).length;

    if (!isApiRelevant && apiHits === 0) {
      // Not relevant — neutral score
      return { score: 60, rationale: "API contract not relevant for this story type", missing: [] };
    }

    if (apiHits >= 5) score += 40;
    else if (apiHits >= 3) score += 25;
    else if (apiHits >= 1) score += 15;
    else missing.push("No API/contract terms found");

    // Specific field names mentioned
    const fieldMentionPattern = /\b[a-z_]+[A-Z][a-zA-Z]*\b|\b[a-z_]+_[a-z_]+\b/g;
    const fieldMentions = (ctx.corpus.match(fieldMentionPattern) || []).length;
    if (fieldMentions >= 3) score += 25;
    else if (fieldMentions >= 1) score += 15;
    else missing.push("No specific field/property names mentioned");

    // Error codes / status codes
    const hasStatusCodes = /\b[245]\d{2}\b/.test(ctx.corpus);
    if (hasStatusCodes) score += 15;
    else if (isApiRelevant) missing.push("No HTTP status codes specified");

    // Method mention
    const hasMethods = /\b(GET|POST|PUT|DELETE|PATCH)\b/i.test(ctx.corpus);
    if (hasMethods) score += 20;
    else if (isApiRelevant) missing.push("No HTTP method specified");

    return { score: Math.min(score, 100), rationale: `${apiHits} API terms, ${fieldMentions} field mentions`, missing };
  },

  data_validation_clarity(ctx) {
    let score = 0;
    const missing: string[] = [];

    const dataTypes: StoryType[] = ["BACKEND_VALIDATION_RULE_CHANGE", "DATA_MAPPING_OR_TRANSFORMATION"];
    const isDataHeavy = dataTypes.includes(ctx.storyType);

    const valTerms = ["validate", "validation", "format", "length", "max", "min", "required", "mandatory", "optional", "regex", "pattern", "type", "range"];
    const valHits = valTerms.filter((t) => ctx.corpus.includes(t)).length;

    if (!isDataHeavy && valHits === 0) {
      return { score: 55, rationale: "Data validation not central to this story type", missing: [] };
    }

    if (valHits >= 5) score += 40;
    else if (valHits >= 3) score += 25;
    else if (valHits >= 1) score += 15;
    else missing.push("No validation rule terms found");

    // Specific value constraints
    const hasNumbers = /\b\d{1,10}\b/.test(ctx.req.acceptanceCriteria + " " + ctx.req.description);
    if (hasNumbers) score += 20;
    else if (isDataHeavy) missing.push("No specific numeric constraints mentioned");

    // Field mapping terms
    const mapTerms = ["mapping", "transform", "convert", "source", "target", "input", "output"];
    const mapHits = mapTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (mapHits >= 2) score += 20;
    else if (mapHits >= 1) score += 10;

    // Error / rejection behavior
    const errorTerms = ["error", "reject", "invalid", "fail", "exception"];
    const errorHits = errorTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (errorHits >= 2) score += 20;
    else if (errorHits >= 1) score += 10;
    else if (isDataHeavy) missing.push("No error/rejection behavior specified");

    return { score: Math.min(score, 100), rationale: `${valHits} val terms, ${mapHits} mapping terms`, missing };
  },

  testing_readiness(ctx) {
    let score = 20; // base
    const missing: string[] = [];

    const testTerms = ["test", "testing", "unit test", "integration test", "e2e", "scenario", "fixture", "mock", "stub", "coverage", "regression"];
    const testHits = testTerms.filter((t) => ctx.corpus.includes(t)).length;

    if (testHits >= 3) score += 40;
    else if (testHits >= 1) score += 20;
    else missing.push("No testing requirements mentioned");

    // AC with testable conditions (Given/When/Then or bullet points)
    if (ctx.acLen > 0) score += 20;
    else missing.push("No AC to derive test cases from");

    // Edge/negative test scenarios
    const negTerms = ["negative", "edge", "boundary", "invalid", "error case", "failure"];
    const negHits = negTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (negHits >= 1) score += 20;
    else missing.push("No negative/edge test scenarios specified");

    return { score: Math.min(score, 100), rationale: `${testHits} test terms, ${negHits} edge mentions`, missing };
  },

  environment_devops_readiness(ctx) {
    let score = 30; // base (many stories don't need env changes)
    const missing: string[] = [];

    const envTypes: StoryType[] = ["CONFIG_OR_ENVIRONMENT_CHANGE"];
    const isEnvHeavy = envTypes.includes(ctx.storyType);

    const envTerms = ["deploy", "environment", "config", "helm", "docker", "kubernetes", "k8s", "pipeline", "ci/cd", "feature flag", "toggle", "secret", "vault", "certificate"];
    const envHits = envTerms.filter((t) => ctx.corpus.includes(t)).length;

    if (!isEnvHeavy && envHits === 0) {
      return { score: 65, rationale: "Environment changes not relevant for this story type", missing: [] };
    }

    if (envHits >= 4) score += 40;
    else if (envHits >= 2) score += 25;
    else if (envHits >= 1) score += 15;
    else if (isEnvHeavy) missing.push("No environment/config terms found");

    // Rollout considerations
    const rolloutTerms = ["rollback", "canary", "blue-green", "feature flag", "toggle", "gradual", "phased"];
    const rolloutHits = rolloutTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (rolloutHits >= 1) score += 15;

    // Migration terms
    const migTerms = ["migration", "backward", "compatibility", "version"];
    const migHits = migTerms.filter((t) => ctx.corpus.includes(t)).length;
    if (migHits >= 1) score += 15;

    return { score: Math.min(score, 100), rationale: `${envHits} env terms, ${rolloutHits} rollout mentions`, missing };
  },

  knowledge_confidence(ctx) {
    let score = 0;
    const missing: string[] = [];

    // Confluence docs linked
    if (ctx.hasConfluence) score += 35;
    else missing.push("No Confluence pages linked");

    // Manual context notes
    if (ctx.hasManualContext) score += 25;

    // Linked stories / issues
    if (ctx.hasLinks) score += 20;
    else missing.push("No related stories linked");

    // Labels / component tags provide classification context
    if (ctx.labelCount + ctx.componentCount >= 2) score += 10;
    if (ctx.labelCount + ctx.componentCount >= 4) score += 10;

    return { score: Math.min(score, 100), rationale: `confluence:${ctx.hasConfluence}, links:${ctx.hasLinks}, manual:${ctx.hasManualContext}`, missing };
  },
};

// ── Main Scorer ────────────────────────────────────────────

export interface ScoringResult {
  overallScore: number;
  readinessState: ReadinessState;
  dimensions: ReadinessDimension[];
  blockingGaps: BlockingGap[];
  knowledgeConfidence: KnowledgeConfidence;
  sourceCoverage: SourceCoverage;
}

export function scoreReadiness(
  req: StoryReadinessRequest,
  storyType: StoryType,
): ScoringResult {
  const ctx = buildContext(req, storyType);
  const dimensions: ReadinessDimension[] = [];
  const blockingGaps: BlockingGap[] = [];
  let gapCounter = 0;

  for (const def of DIMENSIONS) {
    const check = scorers[def.key];
    const result = check(ctx);

    const confidence: "high" | "medium" | "low" =
      result.score >= 70 ? "high" : result.score >= 40 ? "medium" : "low";

    dimensions.push({
      key: def.key,
      name: def.name,
      score: result.score,
      weight: def.weight,
      rationale: result.rationale,
      missingSignals: result.missing,
      confidence,
    });

    // Any dimension scoring ≤ 20 with missing signals creates a blocking gap
    for (const m of result.missing) {
      if (result.score <= 20) {
        gapCounter++;
        blockingGaps.push({
          id: `gap-${gapCounter}`,
          description: m,
          dimension: def.key,
          severity: result.score === 0 ? "blocker" : "important",
        });
      }
    }
  }

  // Weighted overall score
  const overallScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / 100,
  );

  // Readiness state
  const blockerCount = blockingGaps.filter((g) => g.severity === "blocker").length;
  let readinessState: ReadinessState;
  if (blockerCount > 0) {
    readinessState = "BLOCKED_BY_MISSING_INFO";
  } else if (overallScore < 40) {
    readinessState = "NEEDS_CLARIFICATION";
  } else if (overallScore < 70) {
    readinessState = "READY_WITH_QUESTIONS";
  } else {
    readinessState = "READY";
  }

  // Knowledge confidence (from the knowledge_confidence dimension)
  const knowledgeDim = dimensions.find((d) => d.key === "knowledge_confidence");
  const kScore = knowledgeDim?.score ?? 0;
  const knowledgeConfidence: KnowledgeConfidence =
    kScore >= 60 ? "HIGH" : kScore >= 30 ? "MEDIUM" : "LOW";

  // Source coverage
  const sourceCoverage: SourceCoverage = {
    jiraHistory: ctx.hasLinks,
    pastStories: false,    // enriched later by analyzer
    linkedPRs: false,      // enriched later by analyzer
    confluence: ctx.hasConfluence,
    manualNotes: ctx.hasManualContext,
  };

  return {
    overallScore,
    readinessState,
    dimensions,
    blockingGaps,
    knowledgeConfidence,
    sourceCoverage,
  };
}
