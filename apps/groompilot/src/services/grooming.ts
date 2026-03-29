export interface GroomingInput {
  storyTitle: string;
  storyBody: string;
  storyLabels: string[];
  comments: string[];
  repoContext?: string;
  jiraKey?: string;
  repoSlug?: string;
}

export interface CodeAnalysisFile {
  path: string;
  exists: boolean;
  status: "done" | "needs-change" | "new";
  detail: string;
  snippet?: string;
}

export interface CodeAnalysisResult {
  repoSlug: string;
  summary: string;
  alreadyDone: string[];
  needsChange: string[];
  newWork: string[];
  filesChecked: CodeAnalysisFile[];
}

export interface GroomingResult {
  understanding: string;
  scenarios: Scenario[];
  acceptanceCriteria: string[];
  testCases: TestCase[];
  expectedBehavior: string;
  spikes: string[];
  subtasks: Subtask[];
  totalEstimate: string;
  implementationHints: ImplementationHint[];
  uiSnapshots: string[];
  codeAnalysis?: CodeAnalysisResult;
  groomingSummary: GroomingSummary;
}

export interface Scenario {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface TestCase {
  name: string;
  type: "unit" | "integration" | "e2e" | "regression";
  description: string;
  steps: string[];
  expectedResult: string;
  priority: "P0" | "P1" | "P2" | "P3";
  preconditions: string[];
  automationSuggestion: string;
}

export interface Subtask {
  title: string;
  description: string;
  estimate?: string;
  storyPoints: number;
  approach: string;
  codeInsights: string[];
  labels: string[];
}

export interface ImplementationHint {
  file: string;
  description: string;
  codeSnippet?: string;
}

export interface RiskItem {
  risk: string;
  mitigation: string;
}

export interface GroomingSummary {
  totalStoryPoints: number;
  fibonacciEstimate: number;
  risks: RiskItem[];
  definitionOfDone: string[];
  sprintReadinessScore: number;
  improvementsNeeded: string[];
}

// ─── Parsing helpers ───

interface ParsedStory {
  asA: string;
  iNeedTo: string;
  soThat: string;
  existingAC: string[];
  bodyRaw: string;
  shortTitle: string;
  jiraKey: string;
}

function parseUserStory(title: string, body: string, jiraKey?: string): ParsedStory {
  const text = body || "";

  // Extract "As a / I need to / So that"
  const asAMatch = text.match(/\*?As\s+a\*?\s+(.+?)(?:\n|\*I\s+need)/is);
  const needMatch = text.match(/\*?I\s+need\s+to\*?\s+(.+?)(?:\n|\*So\s+that)/is);
  const soThatMatch = text.match(/\*?So\s+that\*?\s+(.+?)(?:\n\n|\n\*|$)/is);

  const asA = clean(asAMatch?.[1] || "");
  const iNeedTo = clean(needMatch?.[1] || "");
  const soThat = clean(soThatMatch?.[1] || "");

  // Extract existing acceptance criteria (bullet points after "Acceptance Criteria")
  const acSection = text.match(/Acceptance\s+Criteria[:\s]*\n([\s\S]*?)(?:\n\n|$)/i);
  const existingAC: string[] = [];
  if (acSection) {
    const lines = acSection[1].split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\s*[\*\-•]\s*/, "").trim();
      if (cleaned) existingAC.push(cleaned);
    }
  }

  // Short title — strip common prefixes like "Cards - CI/CD and ... - "
  const shortTitle = title.replace(/^Cards\s*-\s*/i, "")
    .replace(/^[^-]+-\s*/, "") // strip first "Category - " prefix
    .trim() || title;

  return { asA, iNeedTo, soThat, existingAC, bodyRaw: text, shortTitle, jiraKey: jiraKey || "" };
}

function clean(s: string): string {
  return s.replace(/[\*_]/g, "").replace(/\s+/g, " ").trim();
}

// ─── Comment extraction helpers ───

/** Extract actionable/noteworthy lines from Jira/GitHub comments */
function extractNoteworthyComments(comments: string[]): string[] {
  const notes: string[] = [];
  const actionPatterns = [
    /\b(must|should|shall|need to|require|ensure|verify|confirm)\b/i,
    /\b(blocker|risk|concern|issue|question|clarif|decision|agreed|approved)\b/i,
    /\b(deadline|timeline|sprint|release|priority|critical|urgent)\b/i,
    /\bGIVEN\s/i,
    /\b(edge case|corner case|boundary|constraint|limitation|dependency)\b/i,
    /\b(TODO|FIXME|HACK|NOTE|NB|FYI|IMPORTANT|WARNING|CAVEAT)\b/i,
  ];

  for (const comment of comments) {
    for (const line of comment.split("\n")) {
      const trimmed = line.trim().replace(/^[\*\-•]\s*/, "");
      if (trimmed.length < 10 || trimmed.length > 300) continue;
      if (actionPatterns.some((re) => re.test(trimmed))) {
        notes.push(trimmed.length > 150 ? trimmed.slice(0, 147) + "..." : trimmed);
      }
    }
  }
  return [...new Set(notes)].slice(0, 8);
}

// ─── Repo-aware naming ───

function deriveRepoName(title: string, labels: string[]): string {
  const titleLower = title.toLowerCase();
  const labelStr = labels.join(" ").toLowerCase();
  if (titleLower.includes("endpoint")) return "banking-endpoints";
  if (titleLower.includes("mfe") || titleLower.includes("micro-frontend")) return "banking-mfe";
  if (titleLower.includes("tool")) return "banking-be-tools";
  if (labelStr.includes("mfe")) return "banking-mfe";
  return "banking-be";
}

// ─── Story type detection ───

interface StoryContext {
  type: "cicd" | "api" | "ui" | "security" | "infra" | "data" | "bug" | "feature";
  domain: string;
  keywords: string[];
  hasUI: boolean;
  repoName: string;
  crudVerb: "create" | "read" | "update" | "delete" | "crud" | "";
  entityName: string;
}

function analyzeStory(title: string, body: string, labels: string[]): StoryContext {
  const all = (title + " " + body + " " + labels.join(" ")).toLowerCase();

  const keywords: string[] = [];
  const kwMap: Record<string, string[]> = {
    pipeline: ["pipeline", "jenkins", "jenkinsfile", "ci/cd", "ci cd", "build"],
    helm: ["helm", "chart", "charts", "nexus", "artifact"],
    container: ["container", "docker", "kubernetes", "k8s", "aks", "pod"],
    branch: ["branch", "trunk", "main", "master", "develop", "merge"],
    api: ["api", "endpoint", "rest", "openapi", "swagger"],
    crud: ["crud", "create", "read", "update", "delete", "put", "post", "get", "patch"],
    card: ["card", "limit", "issuer", "acquirer", "prefix", "instrument"],
    base24: ["base24", "base24-eps", "aci connetic", "uiserver", "aci desktop", "backward compatible"],
    dto: ["dto", "model", "schema", "payload", "request", "response"],
    auth: ["auth", "sso", "keycloak", "oidc", "token", "secret"],
    database: ["database", "migration", "sql", "schema", "table"],
    ui: ["ui", "frontend", "component", "page", "form", "button"],
    deploy: ["deploy", "deployment", "release", "publish", "rollout"],
    config: ["config", "configuration", "setting", "property", "env"],
    test: ["test", "testing", "qa", "automation", "e2e"],
    monitor: ["monitor", "log", "alert", "metric", "observability"],
  };

  for (const [category, words] of Object.entries(kwMap)) {
    for (const w of words) {
      if (all.includes(w)) { keywords.push(category); break; }
    }
  }

  let type: StoryContext["type"] = "feature";
  if (keywords.includes("pipeline") || keywords.includes("deploy") || keywords.includes("helm")) type = "cicd";
  else if (all.includes("bug") || all.includes("fix") || all.includes("defect")) type = "bug";
  else if (keywords.includes("auth") && !keywords.includes("crud") && !keywords.includes("card")) type = "security";
  else if (keywords.includes("api") || keywords.includes("crud")) type = "api";
  else if (keywords.includes("ui")) type = "ui";
  else if (keywords.includes("container") || keywords.includes("config")) type = "infra";
  else if (keywords.includes("database")) type = "data";

  let domain = "Domain Services";
  if (all.includes("endpoint")) domain = "Endpoints";
  if (all.includes("ui") || all.includes("frontend")) domain = "UI";
  if (all.includes("transaction")) domain = "Transaction Services";
  if (keywords.includes("card")) domain = "Card Configuration";

  const hasUI = keywords.includes("ui") || type === "ui";
  const repoName = deriveRepoName(title, labels);

  // Detect CRUD verb from title
  let crudVerb: StoryContext["crudVerb"] = "";
  const titleLower = title.toLowerCase();
  if (titleLower.includes("crud")) crudVerb = "crud";
  else if (titleLower.includes("put") || titleLower.includes("update")) crudVerb = "update";
  else if (titleLower.includes("post") || titleLower.includes("create")) crudVerb = "create";
  else if (titleLower.includes("delete") || titleLower.includes("remove")) crudVerb = "delete";
  else if (titleLower.includes("get") || titleLower.includes("read") || titleLower.includes("fetch")) crudVerb = "read";

  // Detect entity name from title
  let entityName = "";
  const entityMatch = title.match(/(?:for|-)\s+(\w[\w\s]*?)(?:\s*-\s*(?:CRUD|PUT|POST|GET|DELETE|Create|Read|Update|Delete))/i);
  if (entityMatch) entityName = entityMatch[1].trim();
  const tailMatch = title.match(/(?:PUT|POST|GET|DELETE|CRUD)\s*-\s*(\w[\w\s]*?)$/i);
  if (tailMatch) {
    const tail = tailMatch[1].trim();
    entityName = entityName ? `${entityName} ${tail}` : tail;
  }
  if (!entityName) {
    if (all.includes("card") && all.includes("limit")) entityName = "Card Limits";
    else if (all.includes("card") && all.includes("account")) entityName = "Card Accounts";
    else if (all.includes("card")) entityName = "Card";
  }

  return { type, domain, keywords: [...new Set(keywords)], hasUI, repoName, crudVerb, entityName };
}

// ─── Main entry point ───

import {
  isAIEnabled,
  getProviderInfo,
  type AIGroomingContext,
  generateAIUnderstanding,
  generateAIScenarios,
  generateAIAcceptanceCriteria,
  generateAITestCases,
  generateAISubtasks,
  generateAISpikes,
  generateAIExpectedBehavior,
  generateAIImplementationHints,
  generateAIRisks,
} from "./ai-provider";

export async function expandStory(input: GroomingInput, codeAnalysis?: CodeAnalysisResult): Promise<GroomingResult> {
  // Merge additional context and comments into story body
  let enrichedBody = input.storyBody;
  if (input.comments.length > 0) {
    enrichedBody += `\n\n--- Comments ---\n${input.comments.join("\n")}`;
  }
  if (input.repoContext) {
    enrichedBody += `\n\n--- Additional Context ---\n${input.repoContext}`;
  }

  const parsed = parseUserStory(input.storyTitle, enrichedBody, input.jiraKey);
  const ctx = analyzeStory(input.storyTitle, enrichedBody, input.storyLabels);
  const noteworthyComments = extractNoteworthyComments(input.comments);

  // ─── Build AI context ───
  const aiCtx: AIGroomingContext = {
    storyTitle: input.storyTitle,
    storyBody: enrichedBody,
    storyType: ctx.type,
    keywords: ctx.keywords,
    crudVerb: ctx.crudVerb,
    entityName: ctx.entityName,
    repoName: ctx.repoName,
    hasUI: ctx.hasUI,
    jiraKey: input.jiraKey || "",
    parsedStory: {
      asA: parsed.asA,
      iNeedTo: parsed.iNeedTo,
      soThat: parsed.soThat,
      existingAC: parsed.existingAC,
      shortTitle: parsed.shortTitle,
      bodyRaw: parsed.bodyRaw,
    },
    comments: input.comments,
    noteworthyComments,
    codeAnalysis: codeAnalysis ? {
      repoSlug: codeAnalysis.repoSlug,
      filesChecked: codeAnalysis.filesChecked,
      alreadyDone: codeAnalysis.alreadyDone,
      needsChange: codeAnalysis.needsChange,
      newWork: codeAnalysis.newWork,
    } : undefined,
    repoContext: input.repoContext,
  };

  // ─── AI-first grooming ───
  if (isAIEnabled()) {
    try {
      const [
        aiUnderstanding,
        aiScenarios,
        aiCriteria,
        aiTestCases,
        aiSubtasks,
        aiSpikes,
        aiExpectedBehavior,
        aiHints,
        aiRisks,
      ] = await Promise.all([
        generateAIUnderstanding(aiCtx),
        generateAIScenarios(aiCtx),
        generateAIAcceptanceCriteria(aiCtx),
        generateAITestCases(aiCtx),
        generateAISubtasks(aiCtx),
        generateAISpikes(aiCtx),
        generateAIExpectedBehavior(aiCtx),
        generateAIImplementationHints(aiCtx),
        generateAIRisks(aiCtx),
      ]);

      const understanding = aiUnderstanding || fallbackUnderstanding(parsed, ctx);
      const scenarios = (aiScenarios || []).map((s) => ({
        name: s.name.slice(0, 60),
        given: s.given,
        when: s.when,
        then: s.then,
      }));
      const acceptanceCriteria = [
        ...parsed.existingAC,
        ...(aiCriteria || []),
      ];
      const testCases = (aiTestCases || []).map((tc) => ({
        name: tc.name,
        type: (tc.type || "integration") as "unit" | "integration" | "e2e" | "regression",
        description: tc.description,
        steps: Array.isArray(tc.steps) ? tc.steps : [tc.description],
        expectedResult: tc.expectedResult || tc.description,
        priority: (tc.priority || "P1") as "P0" | "P1" | "P2" | "P3",
        preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
        automationSuggestion: tc.automationSuggestion || "",
      }));
      const subtasks = (aiSubtasks || []).map((st) => ({
        title: st.title,
        description: st.description,
        estimate: st.estimate || "2h",
        storyPoints: st.storyPoints || 2,
        approach: st.approach || "",
        codeInsights: Array.isArray(st.codeInsights) ? st.codeInsights : [],
        labels: Array.isArray(st.labels) ? st.labels : ["development"],
      }));
      const spikes = aiSpikes || ["No spikes identified — story requirements are well-defined"];
      const expectedBehavior = aiExpectedBehavior || fallbackExpectedBehavior(parsed);
      const implementationHints = (aiHints || []).map((h) => ({
        file: h.file,
        description: h.description,
        ...(h.codeSnippet ? { codeSnippet: h.codeSnippet } : {}),
      }));
      const uiSnapshots: string[] = [];
      const totalEstimate = computeTotalEstimate(subtasks);
      const groomingSummary = generateGroomingSummary(subtasks, spikes, parsed, ctx, codeAnalysis, aiRisks || undefined);

      return { understanding, scenarios, acceptanceCriteria, testCases, expectedBehavior, spikes, subtasks, totalEstimate, implementationHints, uiSnapshots, groomingSummary };
    } catch (err) {
      console.error("AI grooming failed, using fallback:", err);
    }
  }

  // ─── Fallback: minimal structure when AI is unavailable ───
  const understanding = fallbackUnderstanding(parsed, ctx);
  return {
    understanding,
    scenarios: [],
    acceptanceCriteria: parsed.existingAC,
    testCases: [],
    expectedBehavior: fallbackExpectedBehavior(parsed),
    spikes: ["AI provider not configured — enable Ollama, OpenAI, or GitHub Models for full grooming analysis"],
    subtasks: [],
    totalEstimate: "0h → 0 story points (AI unavailable)",
    implementationHints: [],
    uiSnapshots: [],
    groomingSummary: {
      totalStoryPoints: 0,
      fibonacciEstimate: 0,
      risks: [{ risk: "AI provider not configured", mitigation: "Configure AI_PROVIDER in .env (ollama, openai, or github-models)" }],
      definitionOfDone: ["Configure AI provider and re-run grooming"],
      sprintReadinessScore: 0,
      improvementsNeeded: ["AI provider must be configured for grooming analysis"],
    },
  };
}

function fallbackUnderstanding(p: ParsedStory, ctx: StoryContext): string {
  const lines: string[] = [];
  if (p.asA && p.iNeedTo) {
    lines.push(`${p.asA} needs to ${p.iNeedTo.toLowerCase()}.`);
  }
  if (p.soThat) lines.push(`Business value: ${p.soThat}`);
  lines.push(`Story type: ${ctx.type}. Repository: ${ctx.repoName}.`);
  if (ctx.entityName) lines.push(`Entity: ${ctx.entityName}.`);
  return lines.join(" ") || "Story details could not be parsed.";
}

function fallbackExpectedBehavior(p: ParsedStory): string {
  const lines: string[] = [];
  if (p.asA && p.iNeedTo && p.soThat) {
    lines.push(`As ${p.asA}, the system enables: ${p.iNeedTo}`);
    lines.push(`Business value: ${p.soThat}`);
  }
  lines.push("All acceptance criteria are met and verified by tests");
  return lines.join("\n") || "Expected behavior not determinable without AI.";
}

// Exported context for repo analysis
export function getStoryContext(input: GroomingInput) {
  const ctx = analyzeStory(input.storyTitle, input.storyBody, input.storyLabels);
  return {
    entityName: ctx.entityName,
    crudVerb: ctx.crudVerb,
    domain: ctx.domain,
    repoSlug: input.repoSlug || ctx.repoName,
    storyTitle: input.storyTitle,
    keywords: ctx.keywords,
    additionalContext: input.repoContext,
  };
}

// ─── Total Estimate ───

function hoursToFibonacci(hours: number): number {
  if (hours <= 2) return 1;
  if (hours <= 4) return 2;
  if (hours <= 8) return 3;
  if (hours <= 16) return 5;
  if (hours <= 24) return 8;
  return 13;
}

function computeTotalEstimate(subtasks: Subtask[]): string {
  let totalHours = 0;
  let totalSP = 0;
  for (const st of subtasks) {
    if (st.estimate) {
      const match = st.estimate.match(/(\d+(?:\.\d+)?)\s*h/i);
      if (match) totalHours += parseFloat(match[1]);
    }
    totalSP += st.storyPoints;
  }
  const fibSequence = [1, 2, 3, 5, 8, 13, 21];
  const fibEstimate = fibSequence.find(f => f >= totalSP) || totalSP;
  return `~${totalHours}h → ${fibEstimate} story points (Fibonacci)`;
}

// ─── Grooming Summary ───

function generateGroomingSummary(
  subtasks: Subtask[],
  spikes: string[],
  p: ParsedStory,
  ctx: StoryContext,
  codeAnalysis?: CodeAnalysisResult,
  aiRisks?: Array<{ risk: string; mitigation: string }>
): GroomingSummary {
  // Story Points
  let totalSP = 0;
  for (const st of subtasks) totalSP += st.storyPoints;
  const fibSequence = [1, 2, 3, 5, 8, 13, 21];
  const fibEstimate = fibSequence.find(f => f >= totalSP) || totalSP;

  // Risks from AI
  const risks: RiskItem[] = [];
  if (aiRisks && aiRisks.length > 0) {
    for (const ar of aiRisks) {
      risks.push({ risk: ar.risk, mitigation: ar.mitigation });
    }
  }
  if (risks.length === 0) {
    risks.push({ risk: "Low risk — well-defined requirements", mitigation: "Standard development and review process" });
  }

  // Code-analysis-derived risks
  if (codeAnalysis) {
    if (codeAnalysis.needsChange.length > 0) {
      risks.push({
        risk: `${codeAnalysis.needsChange.length} existing file(s) need modification`,
        mitigation: "Run existing test suite before and after changes",
      });
    }
  }

  // Definition of Done
  const definitionOfDone: string[] = [
    "Code is implemented and compiles without errors",
    "All acceptance criteria are met and verified",
    "Unit tests written and passing (>80% coverage on new code)",
    "Integration/E2E tests written and passing",
    "Code review completed and all feedback addressed",
    "No critical or high-severity bugs outstanding",
    "Documentation updated (API specs, README, inline comments where needed)",
  ];
  if (ctx.type === "api" || ctx.type === "security" || ctx.keywords.includes("card")) {
    definitionOfDone.push("Security review completed — no OWASP Top 10 vulnerabilities");
  }
  if (ctx.type === "cicd") {
    definitionOfDone.push("Pipeline runs end-to-end for both feature branch and trunk builds");
  }
  if (ctx.hasUI) {
    definitionOfDone.push("UI is responsive and accessible (WCAG 2.1 AA)");
  }
  definitionOfDone.push("Merged to trunk and deployed to test environment");

  // Sprint Readiness Score (1-10)
  let score = 10;
  const improvementsNeeded: string[] = [];

  if (!p.asA && !p.iNeedTo) {
    score -= 2;
    improvementsNeeded.push("Story lacks a clear 'As a / I need to / So that' structure");
  }
  if (p.existingAC.length === 0) {
    score -= 2;
    improvementsNeeded.push("No acceptance criteria defined in Jira — add measurable AC before sprint planning");
  } else if (p.existingAC.length < 3) {
    score -= 1;
    improvementsNeeded.push("Only " + p.existingAC.length + " acceptance criteria — consider adding more");
  }
  if (spikes.some(s => s.toLowerCase().includes("spike:") || s.toLowerCase().includes("clarify"))) {
    score -= 1;
    improvementsNeeded.push("Open spikes need resolution before sprint commitment");
  }
  if (ctx.entityName === "" && ctx.type === "api") {
    score -= 1;
    improvementsNeeded.push("Entity/resource name is unclear from the story title");
  }
  if (fibEstimate > 8) {
    score -= 1;
    improvementsNeeded.push("Story is large (>" + fibEstimate + " SP) — consider splitting");
  }

  if (codeAnalysis) {
    const total = codeAnalysis.filesChecked.length;
    const doneCount = codeAnalysis.alreadyDone.length;
    const doneRatio = doneCount / Math.max(1, total);
    if (doneRatio >= 0.7) {
      score += 1;
      improvementsNeeded.push(`Code analysis: ${Math.round(doneRatio * 100)}% already done — reduced effort`);
    } else if (codeAnalysis.newWork.length > 3) {
      score -= 1;
      improvementsNeeded.push(`Code analysis: ${codeAnalysis.newWork.length} new files/areas needed`);
    }
  }

  if (improvementsNeeded.length === 0) {
    improvementsNeeded.push("Story is well-defined and ready for sprint");
  }

  score = Math.max(1, Math.min(10, score));

  return {
    totalStoryPoints: totalSP,
    fibonacciEstimate: fibEstimate,
    risks,
    definitionOfDone,
    sprintReadinessScore: score,
    improvementsNeeded,
  };
}
