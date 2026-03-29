// Read env vars lazily — dotenv.config() runs after all require() calls are hoisted
function bbEnv() {
  return {
    url: process.env.BITBUCKET_URL || "",
    token: process.env.BITBUCKET_TOKEN || "",
    project: process.env.BITBUCKET_PROJECT || "BMN",
  };
}

function headers() {
  return {
    Authorization: `Bearer ${bbEnv().token}`,
    Accept: "application/json",
  };
}

const BB_MAX_RETRIES = Number(process.env.BITBUCKET_MAX_RETRIES || 2);
const BB_RETRY_BASE_MS = 1000;
const BB_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

async function bbRequest<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= BB_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = BB_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const controller = new AbortController();
    const timeoutMs = Number(process.env.BITBUCKET_TIMEOUT_MS || 30000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      const method = options?.method || "GET";
      const hasBody = typeof options?.body !== "undefined";
      const requestHeaders = {
        ...headers(),
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      };

      res = await fetch(`${bbEnv().url}${path}`, {
        method,
        headers: requestHeaders,
        body: hasBody ? JSON.stringify(options?.body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        lastError = new Error(`Bitbucket request timed out after ${timeoutMs}ms`);
        if (attempt < BB_MAX_RETRIES) {
          console.warn(`[bitbucket] timeout on attempt ${attempt + 1}, retrying…`);
          continue;
        }
        throw lastError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (BB_RETRYABLE_STATUS.has(res.status) && attempt < BB_MAX_RETRIES) {
      console.warn(`[bitbucket] ${res.status} on attempt ${attempt + 1} for ${path}, retrying…`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Bitbucket API ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json() as Promise<T>;
    }

    return (await res.text()) as unknown as T;
  }

  throw lastError || new Error(`Bitbucket request failed after ${BB_MAX_RETRIES + 1} attempts`);
}

async function bbFetch<T>(path: string): Promise<T> {
  return bbRequest<T>(path, { method: "GET" });
}

interface BBPage<T> {
  size: number;
  limit: number;
  start: number;
  isLastPage: boolean;
  values: T[];
}

interface BBProject {
  key: string;
  name: string;
}

export interface BBRepo {
  id: number;
  slug: string;
  name: string;
  description: string;
  project: { key: string; name: string };
  links: { clone: Array<{ href: string; name: string }>; self: Array<{ href: string }> };
}

export interface BBWebhook {
  id: number;
  name: string;
  url: string;
  active: boolean;
  events: string[];
  configuration?: Record<string, string>;
}

export interface BBPullRequest {
  id: number;
  title: string;
  description: string;
  state: string;
  createdDate: number;
  updatedDate: number;
  author: { user: { displayName: string; slug: string } };
  reviewers: Array<{ user: { displayName: string }; status: string }>;
  fromRef: { displayId: string; repository: { slug: string } };
  toRef: { displayId: string };
  links: { self: Array<{ href: string }> };
}

async function getProjects(): Promise<BBProject[]> {
  const limit = 100;
  let start = 0;
  const projects: BBProject[] = [];

  while (true) {
    const data = await bbFetch<BBPage<BBProject>>(
      `/rest/api/1.0/projects?limit=${limit}&start=${start}`
    );

    projects.push(...(data.values || []));
    if (data.isLastPage || !(data.values || []).length) break;
    const nextStart = data.start + data.limit;
    if (!Number.isFinite(nextStart) || nextStart <= start || data.limit <= 0) break;
    start = nextStart;
  }

  return projects;
}

// List repositories in a project (all pages)
export async function getRepos(projectKey = bbEnv().project): Promise<BBRepo[]> {
  const limit = 100;
  let start = 0;
  const repos: BBRepo[] = [];

  while (true) {
    const data = await bbFetch<BBPage<BBRepo>>(
      `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos?limit=${limit}&start=${start}`
    );

    repos.push(...(data.values || []));
    if (data.isLastPage || !(data.values || []).length) break;
    const nextStart = data.start + data.limit;
    if (!Number.isFinite(nextStart) || nextStart <= start || data.limit <= 0) break;
    start = nextStart;
  }

  return repos;
}

export async function listRepoWebhooks(
  repoSlug: string,
  projectKey = bbEnv().project,
): Promise<BBWebhook[]> {
  const data = await bbFetch<BBPage<BBWebhook>>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/webhooks?limit=100`
  );
  return data.values || [];
}

export async function createRepoWebhook(
  repoSlug: string,
  input: {
    name: string;
    url: string;
    active?: boolean;
    events: string[];
    configuration?: Record<string, string>;
  },
  projectKey = bbEnv().project,
): Promise<BBWebhook> {
  return bbRequest<BBWebhook>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/webhooks`,
    {
      method: "POST",
      body: {
        name: input.name,
        url: input.url,
        active: input.active ?? true,
        events: input.events,
        configuration: input.configuration || {},
      },
    }
  );
}

export async function updateRepoWebhook(
  repoSlug: string,
  webhookId: number,
  input: {
    name: string;
    url: string;
    active?: boolean;
    events: string[];
    configuration?: Record<string, string>;
  },
  projectKey = bbEnv().project,
): Promise<BBWebhook> {
  return bbRequest<BBWebhook>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/webhooks/${webhookId}`,
    {
      method: "PUT",
      body: {
        name: input.name,
        url: input.url,
        active: input.active ?? true,
        events: input.events,
        configuration: input.configuration || {},
      },
    }
  );
}

// List repositories across all visible projects (best effort)
export async function getReposAcrossProjects(): Promise<BBRepo[]> {
  const projects = await getProjects();
  const allRepos: BBRepo[] = [];

  for (const project of projects) {
    try {
      const repos = await getRepos(project.key);
      allRepos.push(...repos);
    } catch {
      // ignore project-level permission failures
    }
  }

  return allRepos;
}

// List open pull requests for a repo
export async function getPullRequestsPage(
  repoSlug: string,
  state = "OPEN",
  limit = 25,
  start = 0,
  projectKey = bbEnv().project,
): Promise<BBPage<BBPullRequest>> {
  return bbFetch<BBPage<BBPullRequest>>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/pull-requests?state=${state}&limit=${limit}&start=${start}&order=NEWEST`
  );
}

// Server-side filtered PR search for a repo
export async function searchPullRequestsPage(
  repoSlug: string,
  query: string,
  state = "OPEN",
  limit = 25,
  start = 0,
  projectKey = bbEnv().project,
): Promise<BBPage<BBPullRequest>> {
  return bbFetch<BBPage<BBPullRequest>>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/pull-requests?state=${state}&limit=${limit}&start=${start}&order=NEWEST&filterText=${encodeURIComponent(query)}`
  );
}

export async function getPullRequests(repoSlug: string, state = "OPEN"): Promise<BBPullRequest[]> {
  const data = await getPullRequestsPage(repoSlug, state, 25, 0);
  return data.values;
}

// Get a single pull request with details
export async function getPullRequest(repoSlug: string, prId: number): Promise<BBPullRequest> {
  return bbFetch<BBPullRequest>(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/pull-requests/${prId}`
  );
}

// Get PR diff (raw unified diff object)
export async function getPRDiff(repoSlug: string, prId: number): Promise<any> {
  return bbFetch(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/pull-requests/${prId}/diff?contextLines=5`
  );
}

// Get PR changes — returns per-file change info suitable for review
export interface BBPRChange {
  filename: string;
  status: string;
  patch: string;
  additions: number;
  deletions: number;
  previousFilename?: string;
}

export async function getPRChanges(repoSlug: string, prId: number): Promise<{ pr: BBPullRequest; files: BBPRChange[] }> {
  const pr = await getPullRequest(repoSlug, prId);
  const diff = await getPRDiff(repoSlug, prId);

  const files: BBPRChange[] = [];
  if (diff && diff.diffs) {
    for (const d of diff.diffs) {
      const dst = d.destination?.toString || d.source?.toString || "unknown";
      const src = d.source?.toString || "";
      let status = "modified";
      if (!src) status = "added";
      else if (!d.destination?.toString) status = "removed";

      // Build a patch string from hunks
      let patch = "";
      let additions = 0;
      let deletions = 0;
      if (d.hunks) {
        for (const hunk of d.hunks) {
          patch += `@@ -${hunk.sourceLine || 0},${hunk.sourceSpan || 0} +${hunk.destinationLine || 0},${hunk.destinationSpan || 0} @@\n`;
          if (hunk.segments) {
            for (const seg of hunk.segments) {
              const prefix = seg.type === "ADDED" ? "+" : seg.type === "REMOVED" ? "-" : " ";
              if (seg.lines) {
                for (const line of seg.lines) {
                  patch += `${prefix}${line.line}\n`;
                  if (seg.type === "ADDED") additions++;
                  else if (seg.type === "REMOVED") deletions++;
                }
              }
            }
          }
        }
      }

      files.push({
        filename: dst,
        status,
        patch,
        additions,
        deletions,
        previousFilename: src && src !== dst ? src : undefined,
      });
    }
  }

  return { pr, files };
}

// ─── PR Activities (comments/reviews) ────────────────────────────────────────

export interface BBPRComment {
  id: number;
  author: string;
  text: string;
  severity: string; // BLOCKER | NORMAL
  state: string;    // OPEN | RESOLVED | etc.
  createdDate: number;
  filePath?: string;
  lineNumber?: number;
}

export async function getPRActivities(repoSlug: string, prId: number): Promise<BBPRComment[]> {
  const data = await bbFetch<BBPage<any>>(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/pull-requests/${prId}/activities?limit=50`
  );

  const comments: BBPRComment[] = [];
  for (const activity of data.values || []) {
    // action can be COMMENTED, REVIEWED, APPROVED, etc.
    if (activity.action === "COMMENTED" && activity.comment) {
      const c = activity.comment;
      comments.push({
        id: c.id,
        author: c.author?.displayName || "unknown",
        text: c.text || "",
        severity: c.severity || "NORMAL",
        state: c.state || "OPEN",
        createdDate: c.createdDate || 0,
        filePath: activity.commentAnchor?.path || undefined,
        lineNumber: activity.commentAnchor?.line || undefined,
      });
    }
  }
  return comments;
}

export async function postPRComment(
  repoSlug: string,
  prId: number,
  text: string,
  projectKey = bbEnv().project,
): Promise<{ id?: number; text?: string }> {
  const payload = await bbRequest<{ id?: number; text?: string }>(
    `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repoSlug)}/pull-requests/${prId}/comments`,
    {
      method: "POST",
      body: { text },
    },
  );

  return payload || {};
}

interface BBPRActivity {
  action: string;
  comment?: {
    id?: number;
    text?: string;
    severity?: string;
  };
}

async function getPRActivitiesRaw(repoSlug: string, prId: number): Promise<BBPRActivity[]> {
  const data = await bbFetch<BBPage<BBPRActivity>>(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/pull-requests/${prId}/activities?limit=100`
  );
  return data.values || [];
}

export interface BBHistoricalPRSignal {
  prId: number;
  title: string;
  author: string;
  state: string;
  mergedAt: string;
  approvalCount: number;
  needsWorkCount: number;
  commentCount: number;
  blockerCount: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  topPaths: string[];
  commentSamples: string[];
}

function pathBucket(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function topPathBuckets(changes: BBPRChange[], topN = 5): string[] {
  const counts = new Map<string, number>();
  for (const change of changes) {
    const bucket = pathBucket(change.filename.toLowerCase());
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([bucket]) => bucket);
}

export async function getMergedPRReviewSignals(
  repoSlug: string,
  limit = Number(process.env.BPE_HISTORY_LIMIT || 12),
): Promise<BBHistoricalPRSignal[]> {
  const maxLimit = Math.max(30, Number(process.env.BPE_HISTORY_MAX_LIMIT || 500));
  const target = Math.max(0, Math.min(limit, maxLimit));
  if (target === 0) return [];

  const mergedPRs: BBPullRequest[] = [];
  let start = 0;
  const pageSize = 25;

  while (mergedPRs.length < target) {
    const page = await getPullRequestsPage(repoSlug, "MERGED", pageSize, start);
    mergedPRs.push(...(page.values || []));
    if (page.isLastPage || !(page.values || []).length) break;
    const nextStart = page.start + page.limit;
    if (!Number.isFinite(nextStart) || nextStart <= start || page.limit <= 0) break;
    start = nextStart;
  }

  const selected = mergedPRs.slice(0, target);
  const signals = await Promise.all(
    selected.map(async (pr) => {
      const [activities, changesResult] = await Promise.all([
        getPRActivitiesRaw(repoSlug, pr.id).catch(() => [] as BBPRActivity[]),
        getPRChanges(repoSlug, pr.id).catch(() => ({ pr, files: [] as BBPRChange[] })),
      ]);

      const approvalCount = activities.filter((a) => a.action === "APPROVED").length;
      const needsWorkCount = activities.filter((a) => a.action === "NEEDS_WORK" || a.action === "UNAPPROVED").length;

      const comments = activities
        .filter((a) => a.action === "COMMENTED" && !!a.comment)
        .map((a) => a.comment!);

      const blockerCount = comments.filter((c) => (c.severity || "NORMAL") === "BLOCKER").length;
      const commentSamples = comments
        .map((c) => (c.text || "").trim())
        .filter(Boolean)
        .slice(0, 4);

      const additions = changesResult.files.reduce((sum, f) => sum + f.additions, 0);
      const deletions = changesResult.files.reduce((sum, f) => sum + f.deletions, 0);
      const topPaths = topPathBuckets(changesResult.files);

      const signal: BBHistoricalPRSignal = {
        prId: pr.id,
        title: pr.title || "",
        author: pr.author?.user?.displayName || "unknown",
        state: pr.state || "MERGED",
        mergedAt: pr.updatedDate ? new Date(pr.updatedDate).toISOString() : new Date().toISOString(),
        approvalCount,
        needsWorkCount,
        commentCount: comments.length,
        blockerCount,
        additions,
        deletions,
        changedFiles: changesResult.files.length,
        topPaths,
        commentSamples,
      };

      return signal;
    })
  );

  return signals;
}

// ─── File browsing APIs ───

export interface BBFileEntry {
  path: { toString: string; name: string; extension?: string };
  type: "FILE" | "DIRECTORY";
  size?: number;
}

interface BBBrowsePage {
  path: { toString: string };
  children?: { size: number; values: BBFileEntry[] };
  lines?: Array<{ text: string }>;
}

// Browse directory contents
export async function browseRepo(repoSlug: string, path = "", at?: string): Promise<BBFileEntry[]> {
  const safePath = path.replace(/^\/+/, "");
  const ref = at ? `&at=${encodeURIComponent(at)}` : "";
  const data = await bbFetch<BBBrowsePage>(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/browse/${safePath}?limit=500${ref}`
  );
  return data.children?.values || [];
}

// Get file content as text
export async function getFileContent(repoSlug: string, path: string, at?: string): Promise<string> {
  const safePath = path.replace(/^\/+/, "");
  const ref = at ? `&at=${encodeURIComponent(at)}` : "";
  const data = await bbFetch<BBBrowsePage>(
    `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/browse/${safePath}?limit=5000${ref}`
  );
  return (data.lines || []).map((l) => l.text).join("\n");
}

// Search for files matching a path pattern (recursive browse)
export async function findFiles(repoSlug: string, basePath: string, namePattern: RegExp, maxDepth = 3): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    try {
      const entries = await browseRepo(repoSlug, dir);
      for (const entry of entries) {
        const fullPath = dir ? `${dir}/${entry.path.toString}` : entry.path.toString;
        if (entry.type === "FILE" && namePattern.test(entry.path.toString)) {
          results.push(fullPath);
        } else if (entry.type === "DIRECTORY") {
          await walk(fullPath, depth + 1);
        }
      }
    } catch {
      // directory doesn't exist or permission issue — skip
    }
  }

  await walk(basePath, 0);
  return results;
}

// Get files changed between two commits (for incremental indexing)
export interface BBChangedFile {
  path: { toString: string; name: string };
  type: "ADD" | "MODIFY" | "DELETE" | "MOVE" | "COPY";
}

export async function getChangedFilesSince(
  repoSlug: string,
  fromCommit: string,
  toCommit = "HEAD",
): Promise<BBChangedFile[]> {
  const changes: BBChangedFile[] = [];
  let start = 0;
  let isLastPage = false;

  while (!isLastPage) {
    const data = await bbFetch<{
      values: Array<{ path: { toString: string; name: string }; type: string }>;
      isLastPage: boolean;
      start: number;
      size: number;
    }>(
      `/rest/api/1.0/projects/${bbEnv().project}/repos/${encodeURIComponent(repoSlug)}/compare/changes` +
      `?from=${encodeURIComponent(fromCommit)}&to=${encodeURIComponent(toCommit)}&start=${start}&limit=500`,
    );

    for (const val of data.values || []) {
      changes.push({
        path: val.path,
        type: val.type as BBChangedFile["type"],
      });
    }

    isLastPage = data.isLastPage !== false;
    start += data.values?.length || 0;
  }

  return changes;
}
