import { DbPRSignal } from "./behavioral-pattern-store";

export interface AuthorPatternInsight {
  key: string;
  title: string;
  confidence: number;
  authorScore: number;
  teamScore: number;
  deltaFromTeam: number;
  guidance: string;
  appliesTo: string[];
}

export interface AuthorInsightResult {
  author: string;
  repoSlug: string;
  minSampleThreshold: number;
  sampleSize: number;
  eligible: boolean;
  privacy: {
    visibility: "author-and-leads";
    rationale: string;
  };
  message: string;
  summary: string;
  insights: AuthorPatternInsight[];
}

interface ThemeDef {
  key: string;
  title: string;
  keywords: string[];
  guidance: string;
  appliesTo: string[];
}

const THEMES: ThemeDef[] = [
  {
    key: "regression-tests",
    title: "Regression Tests On Behavior Changes",
    keywords: ["test", "coverage", "regression", "spec", "unit test", "integration test"],
    guidance: "add regression tests in mapper and service behavior changes before requesting review",
    appliesTo: ["test-quality", "correctness"],
  },
  {
    key: "null-safety-validation",
    title: "Null Safety And Input Validation",
    keywords: ["null", "npe", "optional", "@valid", "@notnull", "validation", "guard"],
    guidance: "add explicit null and input validation guards in changed paths",
    appliesTo: ["correctness", "reliability"],
  },
  {
    key: "api-contract",
    title: "API Contract And Backward Compatibility",
    keywords: ["contract", "backward", "breaking", "schema", "compatible", "payload"],
    guidance: "validate backward compatibility for request and response contract updates",
    appliesTo: ["api-contract", "correctness"],
  },
  {
    key: "security-secrets",
    title: "Security And Secret Hygiene",
    keywords: ["secret", "token", "auth", "jwt", "injection", "credential", "pii"],
    guidance: "re-check secret handling, authz/authn flow, and unsafe input usage",
    appliesTo: ["security", "compliance"],
  },
  {
    key: "observability",
    title: "Logging And Observability Completeness",
    keywords: ["log", "metric", "trace", "telemetry", "observability", "prometheus"],
    guidance: "include meaningful logs and metrics for new decision paths and failures",
    appliesTo: ["observability", "maintainability"],
  },
];

function normalizeAuthor(author: string): string {
  return author.trim().toLowerCase();
}

function getWeight(mergedAt: string, halfLifeDays: number): number {
  const mergedTs = new Date(mergedAt).getTime();
  if (!Number.isFinite(mergedTs)) return 1;
  const ageDays = Math.max(0, (Date.now() - mergedTs) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
}

function weightedThemeScore(signals: DbPRSignal[], theme: ThemeDef, halfLifeDays: number): number {
  if (signals.length === 0) return 0;

  let weightedHits = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const weight = getWeight(signal.mergedAt, halfLifeDays);
    totalWeight += weight;

    const blob = (signal.commentSamples || []).join(" ").toLowerCase();
    if (!blob) continue;

    const matchedKeyword = theme.keywords.some((k) => blob.includes(k));
    if (!matchedKeyword) continue;

    const severityBoost = 1 + (signal.needsWorkCount * 0.3) + (signal.blockerCount * 0.5);
    weightedHits += weight * severityBoost;
  }

  if (totalWeight <= 0) return 0;
  return weightedHits / totalWeight;
}

export function computeAuthorPatternInsights(params: {
  repoSlug: string;
  author: string;
  allSignals: DbPRSignal[];
  minSampleThreshold?: number;
  halfLifeDays?: number;
  maxInsights?: number;
}): AuthorInsightResult {
  const repoSlug = params.repoSlug;
  const author = params.author.trim();
  const normalizedAuthor = normalizeAuthor(author);
  const minSampleThreshold = Math.max(1, params.minSampleThreshold ?? 8);
  const halfLifeDays = Math.max(1, params.halfLifeDays ?? 45);
  const maxInsights = Math.max(1, params.maxInsights ?? 5);

  const authorSignals = params.allSignals.filter((s) => normalizeAuthor(s.author) === normalizedAuthor);
  const teamSignals = params.allSignals;

  if (authorSignals.length < minSampleThreshold) {
    return {
      author,
      repoSlug,
      minSampleThreshold,
      sampleSize: authorSignals.length,
      eligible: false,
      privacy: {
        visibility: "author-and-leads",
        rationale: "Author-level insights are private by default.",
      },
      message: `Author-level guidance is available after at least ${minSampleThreshold} merged PRs.`,
      summary: "Insufficient sample size for reliable author-level patterns.",
      insights: [],
    };
  }

  const insights: AuthorPatternInsight[] = THEMES.map((theme) => {
    const authorScore = weightedThemeScore(authorSignals, theme, halfLifeDays);
    const teamScore = weightedThemeScore(teamSignals, theme, halfLifeDays);
    const delta = authorScore - teamScore;

    const sampleFactor = Math.min(1, authorSignals.length / (minSampleThreshold * 2));
    const deltaFactor = Math.min(1, Math.max(0, delta) / 1.5);
    const confidence = Math.max(0, Math.min(1, 0.45 + (sampleFactor * 0.35) + (deltaFactor * 0.2)));

    return {
      key: theme.key,
      title: theme.title,
      confidence,
      authorScore,
      teamScore,
      deltaFromTeam: delta,
      guidance: `Common review asks for your recent PRs: ${theme.guidance}.`,
      appliesTo: theme.appliesTo,
    };
  })
    .filter((i) => i.deltaFromTeam > 0.05)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxInsights);

  const summary = insights.length > 0
    ? "Personalized guidance based on recent review feedback, weighted toward newer PRs and compared to team baseline."
    : "No strong author-specific deltas detected versus team baseline in the current window.";

  return {
    author,
    repoSlug,
    minSampleThreshold,
    sampleSize: authorSignals.length,
    eligible: true,
    privacy: {
      visibility: "author-and-leads",
      rationale: "Author-level insights are private by default.",
    },
    message: "Guidance is coaching-oriented and should not be used for ranking or performance scoring.",
    summary,
    insights,
  };
}
