import { browseRepo, getFileContent } from "./bitbucket-server";
import { complete, isAIEnabled } from "./ai-provider";

export interface FileStatus {
  path: string;
  exists: boolean;
  status: "done" | "needs-change" | "new";
  detail: string;
  snippet?: string;
}

export interface RepoAnalysis {
  repoSlug: string;
  filesChecked: FileStatus[];
  summary: string;
  alreadyDone: string[];
  needsChange: string[];
  newWork: string[];
}

interface AnalysisContext {
  entityName: string;
  crudVerb: string;
  domain: string;
  repoSlug: string;
  storyTitle: string;
  keywords: string[];
  additionalContext?: string;
}

// ─── Main entry: AI-driven repo analysis ───
export async function analyzeRepo(
  repoSlug: string,
  ctx: AnalysisContext
): Promise<RepoAnalysis> {
  // 1. Gather the repo file tree (2 levels deep)
  const repoTree = await gatherRepoTree(repoSlug, "", 2);

  // 2. Ask AI which files are relevant to this story and what to check
  const filesToCheck = await aiIdentifyRelevantFiles(repoSlug, ctx, repoTree);

  // 3. Fetch content for each file and let AI assess status
  const files: FileStatus[] = [];
  const alreadyDone: string[] = [];
  const needsChange: string[] = [];
  const newWork: string[] = [];

  for (const candidate of filesToCheck) {
    const content = await safeGetContent(repoSlug, candidate.path);
    const exists = content !== null;

    if (!exists) {
      files.push({ path: candidate.path, exists: false, status: "new", detail: candidate.ifMissing || `${candidate.path} does not exist — needs to be created` });
      newWork.push(candidate.ifMissing || `Create ${candidate.path}`);
    } else {
      // Ask AI to assess the file content against the story
      const assessment = await aiAssessFile(candidate, content!, ctx);
      files.push({ path: candidate.path, exists: true, status: assessment.status, detail: assessment.detail, snippet: content!.slice(0, 200) });
      if (assessment.status === "done") alreadyDone.push(assessment.detail);
      else if (assessment.status === "needs-change") needsChange.push(assessment.detail);
      else newWork.push(assessment.detail);
    }
  }

  const summary = buildSummary(alreadyDone, needsChange, newWork);
  return { repoSlug, filesChecked: files, summary, alreadyDone, needsChange, newWork };
}

// ─── Gather repo tree (recursive browse) ───
async function gatherRepoTree(repoSlug: string, basePath: string, maxDepth: number, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];
  try {
    const entries = await browseRepo(repoSlug, basePath);
    const paths: string[] = [];
    for (const entry of entries) {
      const fullPath = basePath ? `${basePath}/${entry.path.toString}` : entry.path.toString;
      if (entry.type === "FILE") {
        paths.push(fullPath);
      } else if (entry.type === "DIRECTORY") {
        paths.push(fullPath + "/");
        const children = await gatherRepoTree(repoSlug, fullPath, maxDepth, depth + 1);
        paths.push(...children);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

// ─── AI: identify which files are relevant to the story ───
interface FileCandidate {
  path: string;
  reason: string;
  ifMissing: string;
  whatToCheck: string;
}

async function aiIdentifyRelevantFiles(
  repoSlug: string,
  ctx: AnalysisContext,
  repoTree: string[]
): Promise<FileCandidate[]> {
  if (!isAIEnabled()) {
    return fallbackIdentifyFiles(ctx, repoTree);
  }

  // Limit tree size to avoid token overflow — send first 500 paths
  const treeSample = repoTree.slice(0, 500).join("\n");

  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content: `You are a senior software engineer at ACI Worldwide analyzing a Bitbucket repository for a Jira story.
Given a story and the repo file tree, identify 5-10 files that are MOST RELEVANT to this story.
For each file, explain WHY it's relevant, what to check in it, and what to say if it doesn't exist.

IMPORTANT: Match files to the ACTUAL STORY TYPE by examining the file tree — do NOT assume any specific CI/CD tool, framework, or language.
Look at what actually exists in the repo and pick files relevant to the story.

If the user provides ADDITIONAL CONTEXT or GUIDANCE below, treat it as the highest priority signal for narrowing your file selection. Focus on the specific files/areas the user mentions.

Return JSON array:
[{"path":"exact/path/from/tree","reason":"why relevant","ifMissing":"what if file doesn't exist","whatToCheck":"what to look for in content"}]

Only return files that appear in the provided file tree OR files that SHOULD exist for this story type.
Return ONLY the JSON array, no markdown fences.`,
        },
        {
          role: "user",
          content: `Story: ${ctx.storyTitle}
Keywords: ${ctx.keywords.join(", ")}
Entity: ${ctx.entityName || "N/A"}
CRUD verb: ${ctx.crudVerb || "N/A"}
Repo: ${repoSlug}
${ctx.additionalContext ? `\nUser Guidance (IMPORTANT — narrow your file selection to match this):\n${ctx.additionalContext}` : ""}

File tree:
${treeSample}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 2000,
    });

    const parsed = parseJsonArray<FileCandidate>(result.content);
    if (parsed && parsed.length > 0) return parsed.slice(0, 12);
  } catch (err) {
    console.error("[repo-analysis] AI file identification failed:", err);
  }

  return fallbackIdentifyFiles(ctx, repoTree);
}

// ─── AI: assess a file's content against the story ───
async function aiAssessFile(
  candidate: FileCandidate,
  content: string,
  ctx: AnalysisContext
): Promise<{ status: "done" | "needs-change" | "new"; detail: string }> {
  if (!isAIEnabled()) {
    return { status: "needs-change", detail: `${candidate.path} exists — review for: ${candidate.whatToCheck}` };
  }

  // Truncate large files to first 3000 chars for AI
  const contentSample = content.length > 3000 ? content.slice(0, 3000) + "\n... (truncated)" : content;

  try {
    const result = await complete({
      messages: [
        {
          role: "system",
          content: `You are assessing whether a file already satisfies the requirements of a Jira story.
Assess the file content and return a JSON object:
{"status":"done|needs-change|new","detail":"brief explanation of what exists or what's missing"}

Rules:
- "done" = file already has what the story needs (method exists, config present, test covers it, etc.)
- "needs-change" = file exists but needs modifications for this story
- "new" = significant new work needed (shouldn't normally happen for existing files)

Be specific in the detail — mention exact method names, config keys, or sections found/missing.
Return ONLY the JSON object, no markdown fences.`,
        },
        {
          role: "user",
          content: `Story: ${ctx.storyTitle}${ctx.additionalContext ? `\nUser Guidance: ${ctx.additionalContext}` : ""}
What to check: ${candidate.whatToCheck}
File: ${candidate.path}

Content:
${contentSample}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 300,
    });

    const parsed = parseJsonObject<{ status: string; detail: string }>(result.content);
    if (parsed && ["done", "needs-change", "new"].includes(parsed.status)) {
      return { status: parsed.status as "done" | "needs-change" | "new", detail: parsed.detail };
    }
  } catch (err) {
    console.error("[repo-analysis] AI file assessment failed for", candidate.path, err);
  }

  return { status: "needs-change", detail: `${candidate.path} exists — manual review needed for: ${candidate.whatToCheck}` };
}

// ─── Fallback: minimal file identification when AI is unavailable ───
function fallbackIdentifyFiles(ctx: AnalysisContext, repoTree: string[]): FileCandidate[] {
  const candidates: FileCandidate[] = [];
  const kw = ctx.keywords;

  // Always check build/CI files
  for (const f of ["Jenkinsfile", "Jenkinsfile-helm-publish", "build.gradle", "settings.gradle"]) {
    if (repoTree.some((t) => t === f || t.endsWith("/" + f))) {
      candidates.push({ path: f, reason: "Build/CI config", ifMissing: `${f} not found`, whatToCheck: "Check for relevant pipeline or build config" });
    }
  }

  // Check deployment files if keywords suggest it
  if (kw.some((k) => ["helm", "deploy", "pipeline", "jenkins", "docker", "kubernetes", "devops", "ci", "cd"].includes(k))) {
    for (const f of repoTree.filter((t) => /^deployment\//.test(t) || /Dockerfile/.test(t) || /\.ya?ml$/.test(t)).slice(0, 5)) {
      candidates.push({ path: f.replace(/\/$/, ""), reason: "Deployment config", ifMissing: `${f} not found`, whatToCheck: "Check for deployment configuration relevant to the story" });
    }
  }

  return candidates.slice(0, 10);
}

// ─── Helpers ───

async function safeGetContent(repoSlug: string, path: string): Promise<string | null> {
  try {
    const content = await getFileContent(repoSlug, path);
    return content || null;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(raw: string): T[] | null {
  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseJsonObject<T>(raw: string): T | null {
  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildSummary(done: string[], change: string[], fresh: string[]): string {
  const total = done.length + change.length + fresh.length;
  const lines: string[] = [];
  lines.push(`Analyzed ${total} areas: ${done.length} already done, ${change.length} need changes, ${fresh.length} new work required.`);
  if (done.length > 0) {
    lines.push("");
    lines.push("ALREADY DONE:");
    for (const d of done) lines.push(`  ✅ ${d}`);
  }
  if (change.length > 0) {
    lines.push("");
    lines.push("NEEDS CHANGES:");
    for (const c of change) lines.push(`  🔧 ${c}`);
  }
  if (fresh.length > 0) {
    lines.push("");
    lines.push("NEW WORK:");
    for (const n of fresh) lines.push(`  🆕 ${n}`);
  }
  return lines.join("\n");
}
