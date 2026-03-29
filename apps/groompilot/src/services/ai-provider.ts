// ─── AI Provider Service ───
// Pluggable AI backend: Ollama (local) | OpenAI | GitHub Models
// Falls back gracefully when no provider is configured.
//
// Model Configuration (via .env):
//   OLLAMA_MODEL           : Primary model for code review (e.g., qwen2.5-coder:7b-instruct)
//   OLLAMA_FALLBACK_MODEL  : Fallback model if primary fails (e.g., llama2:7b)
//   AI_FALLBACK_PROVIDER   : Fallback provider if primary provider fails (e.g., openai)
//
// To switch models, update .env:
//   1. Primary model only:   Set OLLAMA_MODEL, leave OLLAMA_FALLBACK_MODEL empty
//   2. Two models:           Set both OLLAMA_MODEL and OLLAMA_FALLBACK_MODEL
//   3. Popular Ollama models: qwen2.5-coder, llama2, mistral, neural-chat, codellama
//
// Example configurations:
//   - Fast/lightweight:  qwen2.5-coder:7b-instruct (primary), llama2:7b (fallback)
//   - Balanced:          mistral:7b (primary), qwen2.5-coder:7b-instruct (fallback)
//   - Code-focused:      codellama:7b (primary), qwen2.5-coder:7b-instruct (fallback)

// ─── Types ───

export type AIProvider = "ollama" | "openai" | "github-models" | "none";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AICompletionOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResult {
  content: string;
  provider: AIProvider;
  model: string;
  tokensUsed?: number;
}

// ─── Config (lazy — reads env after dotenv.config) ───

function config() {
  return {
    provider: (process.env.AI_PROVIDER || "none") as AIProvider,
    fallbackProvider: (process.env.AI_FALLBACK_PROVIDER || "none") as AIProvider,
    // Ollama
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
    ollamaFallbackModel: process.env.OLLAMA_FALLBACK_MODEL || process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
    // OpenAI
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openaiUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    openaiFallbackModel: process.env.OPENAI_FALLBACK_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
    // GitHub Models (uses GitHub PAT with models scope)
    githubToken: process.env.GITHUB_MODELS_TOKEN || "",
    githubModel: process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini",
    githubFallbackModel: process.env.GITHUB_MODELS_FALLBACK_MODEL || process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini",
    maxRetries: Math.max(0, Number(process.env.AI_MAX_RETRIES || 1)),
  };
}

// ─── Main API ───

export async function complete(opts: AICompletionOptions): Promise<AICompletionResult> {
  const cfg = config();

  const run = async (provider: AIProvider, useFallbackModel = false): Promise<AICompletionResult> => {
    switch (provider) {
      case "ollama":
        return completeOllama({
          ...cfg,
          ollamaModel: useFallbackModel ? cfg.ollamaFallbackModel : cfg.ollamaModel,
        }, opts);
      case "openai":
        return completeOpenAI({
          ...cfg,
          openaiModel: useFallbackModel ? cfg.openaiFallbackModel : cfg.openaiModel,
        }, opts);
      case "github-models":
        return completeGitHubModels({
          ...cfg,
          githubModel: useFallbackModel ? cfg.githubFallbackModel : cfg.githubModel,
        }, opts);
      case "none":
      default:
        console.warn("[ai-provider] AI_PROVIDER is 'none' — returning empty completion");
        return { content: "", provider: "none", model: "none" };
    }
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
    try {
      return await run(cfg.provider, attempt > 0);
    } catch (error) {
      lastError = error;
    }
  }

  if (cfg.fallbackProvider && cfg.fallbackProvider !== "none" && cfg.fallbackProvider !== cfg.provider) {
    return await run(cfg.fallbackProvider, true);
  }

  throw lastError instanceof Error ? lastError : new Error("AI completion failed");
}

// ─── Structured Completion ───

export interface StructuredCompletionOptions<T> {
  messages: AIMessage[];
  /** JSON Schema describing the expected output type */
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  /** Validation function — return null/undefined for valid, or error message */
  validate?: (parsed: T) => string | null | undefined;
}

/**
 * Request structured JSON output from the LLM.
 *
 * - Ollama: uses the native `format` parameter with JSON schema.
 * - OpenAI/GitHub Models: injects JSON instruction into system prompt
 *   and parses the response.
 *
 * Returns the parsed/validated object, or throws on failure.
 */
export async function completeStructured<T>(
  opts: StructuredCompletionOptions<T>,
): Promise<{ data: T; provider: AIProvider; model: string; tokensUsed?: number }> {
  const cfg = config();

  if (cfg.provider === "ollama") {
    return completeStructuredOllama<T>(cfg, opts);
  }

  // For OpenAI / GitHub Models: inject JSON schema into system prompt
  const schemaHint = `\n\nYou MUST respond with a JSON object conforming to this schema:\n${JSON.stringify(opts.jsonSchema, null, 2)}\nOutput ONLY valid JSON, no markdown fences or other text.`;

  const augmentedMessages = opts.messages.map((m, i) =>
    i === 0 && m.role === "system"
      ? { ...m, content: m.content + schemaHint }
      : m,
  );

  const result = await complete({
    messages: augmentedMessages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  });

  const parsed = parseAIJson<T>(result.content, null as unknown as T);
  if (parsed == null) {
    throw new Error(`Failed to parse structured response as JSON: ${result.content.slice(0, 200)}`);
  }

  if (opts.validate) {
    const err = opts.validate(parsed);
    if (err) throw new Error(`Structured response validation failed: ${err}`);
  }

  return {
    data: parsed,
    provider: result.provider,
    model: result.model,
    tokensUsed: result.tokensUsed,
  };
}

async function completeStructuredOllama<T>(
  cfg: ReturnType<typeof config>,
  opts: StructuredCompletionOptions<T>,
): Promise<{ data: T; provider: AIProvider; model: string; tokensUsed?: number }> {
  const body = {
    model: cfg.ollamaModel,
    messages: opts.messages,
    stream: false,
    format: opts.jsonSchema,
    options: {
      temperature: opts.temperature ?? 0.1,
      num_predict: opts.maxTokens ?? 4096,
      num_ctx: llmContextWindow(),
      num_thread: llmThreadCount() || undefined,
    },
  };

  const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama structured ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    eval_count?: number;
    prompt_eval_count?: number;
  };

  const raw = data.message?.content?.trim() || "";
  const parsed = parseAIJson<T>(raw, null as unknown as T);
  if (parsed == null) {
    throw new Error(`Ollama returned non-JSON: ${raw.slice(0, 200)}`);
  }

  if (opts.validate) {
    const err = opts.validate(parsed);
    if (err) throw new Error(`Structured response validation failed: ${err}`);
  }

  return {
    data: parsed,
    provider: "ollama",
    model: cfg.ollamaModel,
    tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
  };
}

// ─── LLM Resource Configuration ───

/** Context window size for Ollama models (tokens). Default 8192. */
export function llmContextWindow(): number {
  return Number(process.env.LLM_CONTEXT_WINDOW) || 8192;
}

/** Max CPU threads for Ollama inference. Default 0 (auto). */
export function llmThreadCount(): number {
  return Number(process.env.LLM_THREAD_COUNT) || 0;
}

/** Model name override for review pass. Falls back to OLLAMA_MODEL. */
export function llmReviewModel(): string {
  return process.env.LLM_REVIEW_MODEL || config().ollamaModel;
}

/** Whether async Llama refinement is enabled (non-blocking post-review). */
export function llmAsyncRefinementEnabled(): boolean {
  return process.env.LLM_ASYNC_REFINEMENT !== "false";
}

// Check if AI is enabled
export function isAIEnabled(): boolean {
  return config().provider !== "none";
}

// Get current provider info
export function getProviderInfo(): { provider: AIProvider; model: string } {
  const cfg = config();
  switch (cfg.provider) {
    case "ollama":
      return { provider: "ollama", model: cfg.ollamaModel };
    case "openai":
      return { provider: "openai", model: cfg.openaiModel };
    case "github-models":
      return { provider: "github-models", model: cfg.githubModel };
    default:
      return { provider: "none", model: "none" };
  }
}

// ─── Ollama Backend ───

async function completeOllama(
  cfg: ReturnType<typeof config>,
  opts: AICompletionOptions
): Promise<AICompletionResult> {
  const body = {
    model: cfg.ollamaModel,
    messages: opts.messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.3,
      num_predict: opts.maxTokens ?? 2048,
    },
  };

  const res = await fetch(`${cfg.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    eval_count?: number;
    prompt_eval_count?: number;
  };

  return {
    content: data.message?.content?.trim() || "",
    provider: "ollama",
    model: cfg.ollamaModel,
    tokensUsed: (data.eval_count || 0) + (data.prompt_eval_count || 0),
  };
}

// ─── OpenAI Backend ───

async function completeOpenAI(
  cfg: ReturnType<typeof config>,
  opts: AICompletionOptions
): Promise<AICompletionResult> {
  if (!cfg.openaiKey) throw new Error("OPENAI_API_KEY not set");

  const body = {
    model: cfg.openaiModel,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2048,
  };

  const res = await fetch(`${cfg.openaiUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.openaiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  return {
    content: data.choices?.[0]?.message?.content?.trim() || "",
    provider: "openai",
    model: cfg.openaiModel,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ─── GitHub Models Backend ───
// Uses the Azure AI inference endpoint with a GitHub PAT
// See: https://docs.github.com/en/github-models

async function completeGitHubModels(
  cfg: ReturnType<typeof config>,
  opts: AICompletionOptions
): Promise<AICompletionResult> {
  if (!cfg.githubToken) throw new Error("GITHUB_MODELS_TOKEN not set");

  const body = {
    model: cfg.githubModel,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 2048,
  };

  const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.githubToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`GitHub Models ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  return {
    content: data.choices?.[0]?.message?.content?.trim() || "",
    provider: "github-models",
    model: cfg.githubModel,
    tokensUsed: data.usage?.total_tokens,
  };
}

// ─── AI Grooming Context ───

export interface AIGroomingContext {
  storyTitle: string;
  storyBody: string;
  storyType: string;
  keywords: string[];
  crudVerb: string;
  entityName: string;
  repoName: string;
  hasUI: boolean;
  jiraKey: string;
  parsedStory: {
    asA: string;
    iNeedTo: string;
    soThat: string;
    existingAC: string[];
    shortTitle: string;
    bodyRaw: string;
  };
  comments: string[];
  noteworthyComments: string[];
  codeAnalysis?: {
    repoSlug: string;
    filesChecked: Array<{ path: string; status: string; detail: string }>;
    alreadyDone: string[];
    needsChange: string[];
    newWork: string[];
  };
  repoContext?: string;
}

// ─── JSON parsing helper ───

function parseAIJson<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  // Try direct parse
  try { return JSON.parse(trimmed); } catch {}
  // Try extracting from code block
  const codeBlock = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  // Try finding first [ or { to end
  const start = trimmed.search(/[\[{]/);
  if (start >= 0) {
    const bracket = trimmed[start];
    const end = bracket === "[" ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");
    if (end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
    }
  }
  return fallback;
}

function buildUserPrompt(ctx: AIGroomingContext): string {
  const parts: string[] = [];
  parts.push(`Jira Key: ${ctx.jiraKey}`);
  parts.push(`Title: ${ctx.storyTitle}`);
  if (ctx.parsedStory.asA) parts.push(`As a: ${ctx.parsedStory.asA}`);
  if (ctx.parsedStory.iNeedTo) parts.push(`I need to: ${ctx.parsedStory.iNeedTo}`);
  if (ctx.parsedStory.soThat) parts.push(`So that: ${ctx.parsedStory.soThat}`);
  parts.push(`Story Type: ${ctx.storyType}`);
  parts.push(`Repository: ${ctx.repoName}`);
  if (ctx.crudVerb) parts.push(`CRUD Verb: ${ctx.crudVerb}`);
  if (ctx.entityName) parts.push(`Entity: ${ctx.entityName}`);
  if (ctx.keywords.length) parts.push(`Keywords: ${ctx.keywords.join(", ")}`);
  if (ctx.hasUI) parts.push(`Has UI: yes`);
  if (ctx.parsedStory.existingAC.length > 0)
    parts.push(`\nExisting Acceptance Criteria from Jira:\n${ctx.parsedStory.existingAC.join("\n")}`);
  if (ctx.noteworthyComments.length > 0)
    parts.push(`\nNoteworthy Comments:\n${ctx.noteworthyComments.join("\n")}`);
  if (ctx.repoContext)
    parts.push(`\nRepository Code Analysis:\n${ctx.repoContext.slice(0, 2000)}`);
  if (ctx.codeAnalysis) {
    const ca = ctx.codeAnalysis;
    if (ca.alreadyDone.length) parts.push(`Already done in repo: ${ca.alreadyDone.join(", ")}`);
    if (ca.needsChange.length) parts.push(`Needs changes: ${ca.needsChange.join(", ")}`);
    if (ca.newWork.length) parts.push(`New work needed: ${ca.newWork.join(", ")}`);
  }
  parts.push(`\nDescription:\n${ctx.storyBody.slice(0, 3000)}`);
  return parts.join("\n");
}

const DOMAIN_CONTEXT =
  "You are grooming stories for ACI Worldwide's enterprise payment processing platform. " +
  "Key domain knowledge: banking-be is a Java/Gradle monorepo with Jenkinsfile CI/CD, Helm chart deployments to Kubernetes, " +
  "core-services (cards-auth, transaction-proxy, transaction-distribution, error-log, realtime-fraud-adapter), " +
  "Card CRUD APIs following UIServer framework patterns (specific error format with errorCode/errorMessage), " +
  "BASE24-eps integration for real-time transaction processing, " +
  "OpenAPI specs (CardApi.json, Card.yaml), Bruno test collections, " +
  "build-logic/ for shared Gradle plugins, deployment/ for Helm charts. " +
  "Security: JWT auth, OWASP Top 10 compliance, PCI DSS for card data, data masking for PAN/SSN.";

// ─── AI Grooming Generators ───

export async function generateAIUnderstanding(ctx: AIGroomingContext): Promise<string | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Generate a clear, concise understanding of this user story (150-250 words). Cover:\n" +
            "1. What the story asks for in plain language\n" +
            "2. Technical context and architectural implications\n" +
            "3. Key dependencies and integration points\n" +
            "4. Implicit requirements not stated in the story\n" +
            "5. Potential challenges or areas needing clarification\n\n" +
            "Output plain text paragraphs. No markdown headers, no bullet lists, no numbering.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    return result.content || null;
  } catch (err) {
    console.error("AI generateUnderstanding failed:", err);
    return null;
  }
}

export async function generateAIScenarios(
  ctx: AIGroomingContext
): Promise<Array<{ name: string; given: string; when: string; then: string }> | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Generate 5-8 BDD test scenarios for this user story. Include:\n" +
            "- Happy path (primary success flow)\n" +
            "- Error/failure paths (invalid input, not found, conflict)\n" +
            "- Edge cases (boundary values, concurrent access, empty data)\n" +
            "- Security scenario (unauthorized access, injection attempt)\n" +
            "- Regression scenario (existing functionality not broken)\n\n" +
            "Output a JSON array of objects with: name, given, when, then.\n" +
            'Example: [{"name":"Valid card update","given":"a valid card exists","when":"PUT with valid limits","then":"200 OK with updated limits returned"}]\n' +
            "Keep scenario names short (<60 chars). Output ONLY the JSON array, no other text.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.4,
      maxTokens: 2048,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<Array<{ name: string; given: string; when: string; then: string }>>(result.content, []);
    return parsed.length > 0 ? parsed.slice(0, 10) : null;
  } catch (err) {
    console.error("AI generateScenarios failed:", err);
    return null;
  }
}

export async function generateAIAcceptanceCriteria(ctx: AIGroomingContext): Promise<string[] | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Generate 6-10 Gherkin-style SMART acceptance criteria for this user story.\n" +
            "Each criterion must follow: GIVEN <precondition>, WHEN <action>, THEN <measurable outcome>\n" +
            "Cover: functional requirements, error handling, security, performance (<500ms p95), " +
            "backward compatibility, documentation, and test coverage.\n" +
            "Do NOT repeat criteria already provided in the existing Jira acceptance criteria.\n\n" +
            "Output a JSON array of strings. Each string is one GIVEN/WHEN/THEN criterion.\n" +
            "Output ONLY the JSON array, no other text.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<string[]>(result.content, []);
    return parsed.length > 0 ? parsed.slice(0, 12) : null;
  } catch (err) {
    console.error("AI generateAcceptanceCriteria failed:", err);
    return null;
  }
}

export async function generateAITestCases(
  ctx: AIGroomingContext
): Promise<Array<{
  name: string; type: string; description: string; steps: string[];
  expectedResult: string; priority: string; preconditions: string[];
  automationSuggestion: string;
}> | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Generate 6-10 test cases for this user story with priorities P0-P3.\n" +
            "P0: Critical path / regression tests. P1: Important validations. P2: Edge cases. P3: Nice-to-have.\n" +
            "Types: unit, integration, e2e, regression.\n" +
            "For API/card stories, always include: SQL injection prevention, XSS prevention, " +
            "auth enforcement (401/403), data privacy (PAN masking), API contract validation.\n" +
            "For CI/CD stories, include: regression test for trunk builds, edge case for branch names.\n\n" +
            "Output a JSON array of objects with: name, type, description, steps (array), " +
            "expectedResult, priority, preconditions (array), automationSuggestion.\n" +
            "Prefix names with TC-1, TC-2, etc. Output ONLY the JSON array.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 3072,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<Array<{
      name: string; type: string; description: string; steps: string[];
      expectedResult: string; priority: string; preconditions: string[];
      automationSuggestion: string;
    }>>(result.content, []);
    return parsed.length > 0 ? parsed.slice(0, 12) : null;
  } catch (err) {
    console.error("AI generateTestCases failed:", err);
    return null;
  }
}

export async function generateAISubtasks(
  ctx: AIGroomingContext
): Promise<Array<{
  title: string; description: string; estimate: string;
  storyPoints: number; approach: string; codeInsights: string[];
  labels: string[];
}> | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Break this user story into 4-7 implementation subtasks.\n" +
            "Each subtask needs: title (prefixed with [Analysis], [Implementation], [DTO + Mapper], [Service], " +
            "[Controller], [Testing], [Documentation], [Review], etc.), description, estimate (e.g. '3h'), " +
            "storyPoints (Fibonacci: 1,2,3,5,8,13), approach (how to implement), " +
            "codeInsights (array of specific file paths or patterns to reuse), labels (array from: " +
            "analysis, development, testing, documentation, review, frontend, security).\n" +
            "Always end with a [Review] Code review and QA sign-off subtask (1h, 1 SP).\n" +
            "For Card API stories, subtasks should follow: DTO+Mapper → Service → Controller → Testing → Schema+Docs → Regression.\n" +
            "For CI/CD stories: Analysis → Pipeline changes → Testing → Documentation.\n\n" +
            "Output a JSON array of subtask objects. Output ONLY the JSON array.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 3072,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<Array<{
      title: string; description: string; estimate: string;
      storyPoints: number; approach: string; codeInsights: string[];
      labels: string[];
    }>>(result.content, []);
    if (parsed.length === 0) return null;
    // Ensure storyPoints are valid Fibonacci
    const fibSet = new Set([1, 2, 3, 5, 8, 13, 21]);
    return parsed.slice(0, 8).map((st) => ({
      ...st,
      storyPoints: fibSet.has(st.storyPoints) ? st.storyPoints : hoursToFibonacci(parseEstimateHours(st.estimate)),
      codeInsights: Array.isArray(st.codeInsights) ? st.codeInsights : [],
      labels: Array.isArray(st.labels) ? st.labels : ["development"],
    }));
  } catch (err) {
    console.error("AI generateSubtasks failed:", err);
    return null;
  }
}

export async function generateAISpikes(ctx: AIGroomingContext): Promise<string[] | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Identify 1-4 spikes (knowledge gaps, unknowns, things needing investigation) for this story.\n" +
            "Common spike areas: Nexus artifact cleanup policies, Helm chart name length limits (63 chars), " +
            "backward compatibility with ACI Desktop/UIServer, MLCRD data model field clarification, " +
            "Keycloak/SSO configuration, concurrency handling strategy, performance benchmarking targets.\n" +
            "If the story is well-defined with no gaps, return [\"No spikes identified — story requirements are well-defined\"].\n\n" +
            "Output a JSON array of strings. Each string describes one spike. Output ONLY the JSON array.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 512,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<string[]>(result.content, []);
    return parsed.length > 0 ? parsed : null;
  } catch (err) {
    console.error("AI generateSpikes failed:", err);
    return null;
  }
}

export async function generateAIExpectedBehavior(ctx: AIGroomingContext): Promise<string | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Describe the expected system behavior when this story is fully implemented.\n" +
            "Write 4-8 short sentences. Cover: what the user/system can do, the business value delivered, " +
            "how it integrates with existing functionality, and what remains unchanged.\n" +
            "Output plain text with one sentence per line. No bullet points, no numbering.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 512,
    });
    return result.content || null;
  } catch (err) {
    console.error("AI generateExpectedBehavior failed:", err);
    return null;
  }
}

export async function generateAIImplementationHints(
  ctx: AIGroomingContext
): Promise<Array<{ file: string; description: string; codeSnippet?: string }> | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Suggest 3-6 specific files and code patterns for implementing this story.\n" +
            "For Card API stories, reference: core-services/cards-auth/customermanagement/src/ " +
            "(DTO, Service, Controller, Test paths), cardApi.json routing config, Bruno collections.\n" +
            "For CI/CD stories, reference: Jenkinsfile, Jenkinsfile-helm-publish, deployment/Chart.yaml, " +
            "deployment/values.yaml, build-logic/ directory.\n" +
            "Include code snippets where helpful (Java or Groovy).\n\n" +
            "Output a JSON array of objects with: file (path), description, codeSnippet (optional string).\n" +
            "Output ONLY the JSON array.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<Array<{ file: string; description: string; codeSnippet?: string }>>(result.content, []);
    return parsed.length > 0 ? parsed.slice(0, 6) : null;
  } catch (err) {
    console.error("AI generateImplementationHints failed:", err);
    return null;
  }
}

export async function generateAIRisks(
  ctx: AIGroomingContext
): Promise<Array<{ risk: string; mitigation: string }> | null> {
  if (!isAIEnabled()) return null;
  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            `${DOMAIN_CONTEXT}\n\n` +
            "Identify 2-5 risks for this user story with mitigations.\n" +
            "Focus on: data integrity, API contract breaks, backward compatibility with ACI Desktop/UIServer, " +
            "security vulnerabilities (OWASP Top 10), deployment failures, performance degradation, " +
            "concurrent access issues, and test coverage gaps.\n\n" +
            "Output a JSON array of objects with: risk (string), mitigation (string).\n" +
            "Output ONLY the JSON array.",
        },
        { role: "user", content: buildUserPrompt(ctx) },
      ],
      temperature: 0.3,
      maxTokens: 512,
    });
    if (!result.content) return null;
    const parsed = parseAIJson<Array<{ risk: string; mitigation: string }>>(result.content, []);
    return parsed.length > 0 ? parsed : null;
  } catch (err) {
    console.error("AI generateRisks failed:", err);
    return null;
  }
}

// ─── Helpers ───

function hoursToFibonacci(hours: number): number {
  if (hours <= 2) return 1;
  if (hours <= 4) return 2;
  if (hours <= 8) return 3;
  if (hours <= 16) return 5;
  if (hours <= 24) return 8;
  return 13;
}

function parseEstimateHours(est: string): number {
  const m = est?.match(/(\d+(?:\.\d+)?)\s*h/i);
  return m ? parseFloat(m[1]) : 4;
}

export async function reviewCodeDiff(
  diff: string,
  context: string
): Promise<string> {
  if (!isAIEnabled()) return "";

  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content:
            "You are a senior code reviewer. Analyze the diff for: bugs, security issues, " +
            "performance problems, naming/style issues, and missing error handling. " +
            "Be concise. List only real issues, not style preferences. Max 500 words.",
        },
        {
          role: "user",
          content: `Context: ${context}\n\nDiff:\n${diff.slice(0, 8000)}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });
    return result.content;
  } catch (err) {
    console.error("AI review diff failed:", err);
  }
  return "";
}
