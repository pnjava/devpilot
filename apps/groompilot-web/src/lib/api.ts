const API_BASE = "/api";

function getHeaders(): HeadersInit {
  const token = localStorage.getItem("gp_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: getHeaders(),
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

// Auth
export const api = {
  getAuthUrl: () => request<{ url: string }>("/auth/github"),
  authCallback: (code: string) =>
    request<{ token: string; user: { id: string; username: string; avatarUrl: string } }>(
      "/auth/github/callback",
      { method: "POST", body: JSON.stringify({ code }) }
    ),
  devLogin: () =>
    request<{ token: string; user: { id: string; username: string; avatarUrl: string } }>(
      "/auth/dev-login",
      { method: "POST" }
    ),
  getMe: () => request<{ id: string; username: string; avatarUrl: string }>("/auth/me"),

  // Repos
  getRepos: () => request<Array<{
    id: number; name: string; full_name: string; owner: string; description: string | null;
  }>>("/repos"),
  getIssues: (owner: string, repo: string) =>
    request<Array<{
      number: number; title: string; state: string;
      labels: Array<{ name: string; color: string }>;
      pull_request?: unknown;
    }>>(`/repos/${owner}/${repo}/issues`),
  getStory: (owner: string, repo: string, number: number) =>
    request<{ issue: any; comments: any[] }>(`/repos/${owner}/${repo}/issues/${number}`),

  // Grooming
  groomStory: (data: { owner?: string; repo?: string; issueNumber?: number; jiraKey?: string; additionalContext?: string; repoSlug?: string }) =>
    request<any>("/groom/start", { method: "POST", body: JSON.stringify(data) }),
  getSubtasks: (sessionId: string) =>
    request<{ subtasks: any[] }>("/groom/subtasks", { method: "POST", body: JSON.stringify({ sessionId }) }),
  getSession: (id: string) => request<any>(`/groom/session/${id}`),
  getSessions: () => request<any[]>("/groom/sessions"),
  saveSnapshot: (sessionId: string, snapshotData: any) =>
    request<{ id: string }>("/groom/snapshot", { method: "POST", body: JSON.stringify({ sessionId, snapshotData }) }),

  // PR Review
  estimatePRReview: (prUrl: string, forceRefresh?: boolean) =>
    request<{
      estimatedSeconds: number;
      confidence: "low" | "medium" | "high";
      source: "cache-hit" | "historical-signals";
      factors: {
        predictedChangeType: string;
        targetBranch: string;
        changedFiles: number;
        churn: number;
        fileFactor: number;
        churnFactor: number;
        branchFactor: number;
        repoSampleSize: number;
        typeSampleSize: number;
      };
    }>("/pr/review-estimate", { method: "POST", body: JSON.stringify({ prUrl, forceRefresh }) }),
  reviewPR: (prUrl: string, specs?: string, sessionId?: string, forceRefresh?: boolean) =>
    request<any>("/pr/review", { method: "POST", body: JSON.stringify({ prUrl, specs, sessionId, forceRefresh }) }),
  linkGroomToPR: (prUrl: string, sessionId: string, notes?: string) =>
    request<{ linked: boolean; link: any }>("/pr/link-groom", {
      method: "POST",
      body: JSON.stringify({ prUrl, sessionId, notes }),
    }),
  getPRGroomLinks: (prUrl: string) =>
    request<{ pr: { project: string; repo: string; prId: number }; links: any[] }>(
      `/pr/groom-links?prUrl=${encodeURIComponent(prUrl)}`
    ),
  unlinkGroomFromPR: (linkId: string) =>
    request<{ deleted: boolean; id: string }>(`/pr/link-groom/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
    }),
  getPRGroomLinkIndex: (repoSlug: string, projectKey = "BMN") =>
    request<{ provider: "bitbucket"; projectKey: string; repoSlug: string; count: number; links: Array<{ prNumber: number; linkCount: number; latestLinkedAt: string }> }>(
      `/pr/groom-link-index?repoSlug=${encodeURIComponent(repoSlug)}&projectKey=${encodeURIComponent(projectKey)}`
    ),
  sendReviewEmail: (reviewRunId: string, recipients: string[], complianceScore?: number) =>
    request<{ sent: boolean; message: string; reviewRunId: string; repoSlug: string; recipients: string[]; completedAt: string }>(
      "/pr/review-email",
      { method: "POST", body: JSON.stringify({ reviewRunId, recipients, complianceScore }) }
    ),
  submitReviewFeedback: (
    repoSlug: string,
    payload: {
      reviewRunId: string;
      findingId: string;
      outcome: "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved";
      subsystem?: string;
      severity?: string;
      incidentLinked?: boolean;
      revertLinked?: boolean;
      notes?: string;
    }
  ) => request<{ status: string; repoSlug: string; reviewRunId: string; findingId: string; outcome: string }>(
    `/pr/review-feedback/${encodeURIComponent(repoSlug)}`,
    { method: "POST", body: JSON.stringify(payload) }
  ),
  getReviewMetrics: (repoSlug: string, windowDays = 180) =>
    request<{ repoSlug: string; windowDays: number; summary: {
      findingPrecision: number;
      blockerPrecision: number;
      falsePositiveRate: number;
      hallucinationProxyRate: number;
      duplicateFindingRate: number;
      reviewerAcceptanceRate: number;
      developerTrustSignal: number;
      auditTraceCompleteness: number;
      reviewLatencyMs: number;
      subsystemCoverageQuality: number;
      totals: {
        reviews: number;
        findings: number;
        blockers: number;
        accepted: number;
        rejected: number;
        falsePositives: number;
        duplicates: number;
      };
    } }>(`/pr/metrics/${encodeURIComponent(repoSlug)}?windowDays=${encodeURIComponent(String(windowDays))}`),
  searchPRs: (q: string) =>
    request<{ query: string; count: number; returned?: number; source?: string; hint?: string; jiraIssue?: {
      key: string;
      summary: string;
      status: string;
      url: string;
    }; results: Array<{
      id: number | string;
      repoSlug: string;
      projectKey?: string;
      title: string;
      description: string;
      author: string;
      sourceBranch: string;
      targetBranch: string;
      state: string;
      url: string;
    }> }>(`/pr/search?q=${encodeURIComponent(q)}&state=ALL`),
  getSessionSpecs: (sessionId: string) =>
    request<{ specs: string }>(`/groom/session/${sessionId}/specs`),
  getSuppressionReasons: () =>
    request<{ reasonCodes: string[] }>("/pr/suppression-reasons"),
  getSuppressions: (repoSlug: string, includeInactive = false) =>
    request<{ repoSlug: string; includeInactive: boolean; count: number; suppressions: Array<{
      id: number;
      repoSlug: string;
      fingerprint: string;
      reasonCode: string;
      reasonDetail?: string;
      owner: string;
      createdBy?: string;
      expiresAt: string;
      status: "active" | "expired";
      createdAt: string;
      updatedAt: string;
      lastAppliedAt?: string;
      appliedCount: number;
    }> }>(`/pr/suppressions/${encodeURIComponent(repoSlug)}?includeInactive=${includeInactive ? "true" : "false"}`),
  createSuppression: (
    repoSlug: string,
    payload: {
      fingerprint?: string;
      finding?: { file: string; title: string; category: string; dimension: string; line?: number };
      reasonCode: string;
      reasonDetail?: string;
      owner?: string;
      expiresAt?: string;
    }
  ) => request<any>(`/pr/suppressions/${encodeURIComponent(repoSlug)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  }),
  expireSuppression: (repoSlug: string, id: number, notes?: string) =>
    request<void>(`/pr/suppressions/${encodeURIComponent(repoSlug)}/${id}`, {
      method: "DELETE",
      body: JSON.stringify(notes ? { notes } : {}),
    }),

  // Email
  sendEmail: (sessionId: string, recipients: string[]) =>
    request<{ sent: boolean; message: string }>("/email/send", { method: "POST", body: JSON.stringify({ sessionId, recipients }) }),
  previewEmail: (sessionId: string) =>
    request<{ html: string }>("/email/preview", { method: "POST", body: JSON.stringify({ sessionId }) }),

  // Jira
  getJiraEpics: () =>
    request<Array<{
      key: string; summary: string; status: string; labels: string[]; assignee: string | null;
    }>>("/jira/epics"),
  getJiraStories: (epicKey?: string) =>
    request<Array<{
      key: string; summary: string; status: string; type: string;
      labels: string[]; priority: string | null; assignee: string | null;
    }>>(`/jira/stories${epicKey ? `?epicKey=${epicKey}` : ""}`),
  searchJiraStories: (q: string) =>
    request<Array<{
      key: string; summary: string; status: string; type: string; labels: string[];
    }>>(`/jira/search?q=${encodeURIComponent(q)}`),
  getJiraIssue: (key: string) =>
    request<{
      key: string; summary: string; description: string | null;
      status: string; type: string; priority: string | null;
      assignee: string | null; labels: string[];
      comments: Array<{ body: string; author: string }>;
      subtasks: Array<{ key: string; summary: string; status: string }>;
      url: string;
    }>(`/jira/issue/${key}`),

  // Bitbucket
  getBitbucketRepos: () =>
    request<Array<{
      id: number; slug: string; name: string; description: string; project: string; url: string;
    }>>("/bitbucket/repos"),
  getBitbucketPRs: (repoSlug: string, teamOnly = false) =>
    request<Array<{
      id: number; title: string; description: string; state: string;
      author: string; branch: string; target: string;
      reviewers: Array<{ name: string; status: string }>;
      createdDate: number; url: string;
    }>>(`/bitbucket/repos/${repoSlug}/pull-requests?teamOnly=${teamOnly}`),

  // PR Readiness
  getReadinessSnapshot: (projectKey: string, repoSlug: string, prId: number) =>
    request<{ snapshot: any }>(`/pr-readiness/${projectKey}/${repoSlug}/${prId}`).catch(() => null),
  getReadinessStatuses: (projectKey: string, repoSlug: string) =>
    request<{ statuses: Record<number, { state: string; risk: string; blockers: number }> }>(
      `/pr-readiness/${projectKey}/${repoSlug}/batch`
    ).catch(() => null),

  // AI
  getAIStatus: () =>
    request<{ enabled: boolean; provider: string; model: string }>("/ai/status"),

  // Team Members
  getTeamMembers: () =>
    request<Array<{
      id: string; display_name: string; email: string;
      bitbucket_name: string | null; organisation: string;
      active: number; created_at: string; updated_at: string;
    }>>("/team-members"),
  addTeamMember: (data: { display_name: string; email: string; bitbucket_name?: string; organisation?: string }) =>
    request<{ id: string; display_name: string; email: string; bitbucket_name: string | null; organisation: string; active: number }>(
      "/team-members",
      { method: "POST", body: JSON.stringify(data) }
    ),
  updateTeamMember: (id: string, data: { display_name?: string; email?: string; bitbucket_name?: string; organisation?: string; active?: boolean }) =>
    request<{ id: string; display_name: string; email: string; bitbucket_name: string | null; organisation: string; active: number }>(
      `/team-members/${id}`,
      { method: "PUT", body: JSON.stringify(data) }
    ),
  deleteTeamMember: (id: string) =>
    request<{ ok: boolean }>(`/team-members/${id}`, { method: "DELETE" }),

  // Story Readiness
  analyzeStoryReadiness: (data: {
    jiraKey: string; title: string; description?: string; acceptanceCriteria?: string;
    epicKey?: string; issueType?: string; labels?: string[]; assignee?: string;
    reporter?: string; status?: string; componentTags?: string[]; storyLinks?: string[];
    linkedConfluenceUrls?: string[]; manualContextText?: string; runMode?: string;
  }) =>
    request<{
      snapshot: any;
      persisted: boolean;
      knowledgeContextUsed: boolean;
    }>("/story-readiness/analyze", { method: "POST", body: JSON.stringify(data) }),
  getStoryReadiness: (jiraKey: string) =>
    request<any>(`/story-readiness/${encodeURIComponent(jiraKey)}`),
  getStoryReadinessHistory: (jiraKey: string, limit = 10) =>
    request<{ jiraKey: string; snapshots: any[]; count: number }>(
      `/story-readiness/${encodeURIComponent(jiraKey)}/history?limit=${limit}`
    ),
  refreshStoryReadiness: (jiraKey: string, data: { title: string; description?: string; acceptanceCriteria?: string; [k: string]: any }) =>
    request<{ snapshot: any; persisted: boolean; knowledgeContextUsed: boolean }>(
      `/story-readiness/refresh/${encodeURIComponent(jiraKey)}`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  prepareJiraUpdate: (jiraKey: string, data?: { selectedSubtaskIds?: string[]; includeComment?: boolean; includeSubtasks?: boolean }) =>
    request<{ jiraKey: string; commentBody: string; subtaskPayloads: any[]; dryRun: boolean }>(
      `/story-readiness/${encodeURIComponent(jiraKey)}/prepare-jira-update`,
      { method: "POST", body: JSON.stringify(data || {}) }
    ),
  submitReadinessFeedback: (jiraKey: string, data: { snapshotId: string; feedbackType?: string; feedbackText?: string; acceptedQuestionIds?: string[]; acceptedSubtaskIds?: string[] }) =>
    request<{ id: string; jiraKey: string; snapshotId: string }>(
      `/story-readiness/${encodeURIComponent(jiraKey)}/feedback`,
      { method: "POST", body: JSON.stringify(data) }
    ),
};
