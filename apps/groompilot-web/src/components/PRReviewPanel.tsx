import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import CollapsibleSection from "./CollapsibleSection";

// ─── Colour helpers ─────────────────────────────────────────────────────────

const verdictStyle: Record<string, { bg: string; text: string; label: string }> = {
  block:                { bg: "bg-red-600",    text: "text-white",   label: "BLOCKED" },
  "require-human-review": { bg: "bg-orange-500", text: "text-white",   label: "NEEDS HUMAN REVIEW" },
  warning:              { bg: "bg-yellow-500", text: "text-gray-900", label: "WARNINGS" },
  suggestion:           { bg: "bg-blue-500",   text: "text-white",   label: "SUGGESTIONS ONLY" },
  informational:        { bg: "bg-gray-400",   text: "text-white",   label: "INFO" },
  "auto-approve":       { bg: "bg-green-500",  text: "text-white",   label: "AUTO-APPROVE ELIGIBLE" },
};

const sevColor: Record<string, string> = {
  critical: "bg-red-600 text-white",
  error:    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  info:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  suggestion: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};

const gradeColor: Record<string, string> = {
  excellent: "bg-emerald-500 text-white ring-emerald-300/40",
  good: "bg-lime-500 text-white ring-lime-300/40",
  fair: "bg-amber-400 text-amber-950 ring-amber-200/50",
  poor: "bg-orange-500 text-white ring-orange-300/40",
  critical: "bg-rose-600 text-white ring-rose-300/40",
};

const gradeTextColor: Record<string, string> = {
  excellent: "text-emerald-300",
  good: "text-lime-300",
  fair: "text-amber-300",
  poor: "text-orange-300",
  critical: "text-rose-300",
};

const riskColor: Record<string, string> = {
  low: "text-green-500",
  medium: "text-yellow-500",
  high: "text-orange-500",
  critical: "text-red-600",
};

// ─── Component ──────────────────────────────────────────────────────────────

interface PRReviewPanelProps {
  initialPrUrl?: string | null;
  onPrUrlConsumed?: () => void;
}

export default function PRReviewPanel({ initialPrUrl, onPrUrlConsumed }: PRReviewPanelProps = {}) {
  const [prUrl, setPrUrl] = useState("");

  // Auto-fill PR URL when selected from sidebar and auto-trigger review
  useEffect(() => {
    if (initialPrUrl) {
      setPrUrl(initialPrUrl);
      onPrUrlConsumed?.();
    }
  }, [initialPrUrl]);

  // Auto-trigger review when PR URL is set from sidebar selection
  const [autoTriggerUrl, setAutoTriggerUrl] = useState<string | null>(null);
  useEffect(() => {
    if (initialPrUrl) {
      setAutoTriggerUrl(initialPrUrl);
    }
  }, [initialPrUrl]);
  useEffect(() => {
    if (autoTriggerUrl && prUrl === autoTriggerUrl && !reviewMutation.isPending) {
      setAutoTriggerUrl(null);
      setResult(null);
      setDimFilter(null);
      reviewMutation.mutate({ forceRefreshOverride: false });
    }
  }, [autoTriggerUrl, prUrl]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchMeta, setSearchMeta] = useState<{ source?: string; hint?: string; jiraIssue?: { key: string; summary: string; status: string; url: string } } | null>(null);
  const [specs, setSpecs] = useState("");
  const [selectedSession, setSelectedSession] = useState("");
  const [linkNotice, setLinkNotice] = useState("");
  const [result, setResult] = useState<any>(null);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [dimFilter, setDimFilter] = useState<string | null>(null);
  const [suppressionDrafts, setSuppressionDrafts] = useState<Record<string, { reasonCode: string; reasonDetail: string; expiresAt: string }>>({});
  const [suppressionNotice, setSuppressionNotice] = useState<string>("");
  const [reviewEmailRecipients, setReviewEmailRecipients] = useState("");
  const [reviewEmailNotice, setReviewEmailNotice] = useState<string>("");
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, {
    outcome: "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved";
    notes: string;
    incidentLinked: boolean;
    revertLinked: boolean;
  }>>({});
  const [feedbackNotice, setFeedbackNotice] = useState<string>("");
  const [metricsWindowDays, setMetricsWindowDays] = useState(180);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [loadingDialogOpen, setLoadingDialogOpen] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Analyzing PR...");
  const [estimatedTimeSeconds, setEstimatedTimeSeconds] = useState(45);
  const [estimateMeta, setEstimateMeta] = useState<{
    source: "cache-hit" | "historical-signals";
    confidence: "low" | "medium" | "high";
    predictedChangeType: string;
    targetBranch: string;
    repoSampleSize: number;
  } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const queryClient = useQueryClient();

  // Track elapsed time during analysis
  useEffect(() => {
    if (!loadingDialogOpen) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loadingDialogOpen]);

  // Load grooming sessions for the dropdown
  const sessionsQuery = useQuery({
    queryKey: ["groom-sessions"],
    queryFn: () => api.getSessions(),
    staleTime: 60_000,
  });

  const prGroomLinksQuery = useQuery({
    queryKey: ["pr-groom-links", prUrl],
    queryFn: () => api.getPRGroomLinks(prUrl.trim()),
    enabled: !!prUrl.trim(),
    staleTime: 30_000,
  });

  useEffect(() => {
    const latestLinked = prGroomLinksQuery.data?.links?.[0];
    if (!selectedSession && latestLinked?.sessionId) {
      setSelectedSession(String(latestLinked.sessionId));
      setLinkNotice("Loaded latest linked grooming session for this PR.");
    }
  }, [prGroomLinksQuery.data, selectedSession]);

  // When a grooming session is selected, load its formatted specs
  useEffect(() => {
    if (!selectedSession) return;
    api.getSessionSpecs(selectedSession).then((res) => {
      if (res.specs) setSpecs(res.specs);
    }).catch(() => {});
  }, [selectedSession]);

  const linkSessionMutation = useMutation({
    mutationFn: () => {
      if (!prUrl.trim() || !selectedSession) {
        throw new Error("PR URL and grooming session are required");
      }
      return api.linkGroomToPR(prUrl.trim(), selectedSession);
    },
    onSuccess: () => {
      setLinkNotice("Grooming session linked to PR successfully.");
      queryClient.invalidateQueries({ queryKey: ["pr-groom-links", prUrl] });
    },
    onError: (err: Error) => {
      setLinkNotice(`Link failed: ${err.message}`);
    },
  });

  const unlinkSessionMutation = useMutation({
    mutationFn: (linkId: string) => api.unlinkGroomFromPR(linkId),
    onSuccess: () => {
      setLinkNotice("Link removed.");
      queryClient.invalidateQueries({ queryKey: ["pr-groom-links", prUrl] });
    },
    onError: (err: Error) => {
      setLinkNotice(`Unlink failed: ${err.message}`);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (opts?: { forceRefreshOverride?: boolean }) => {
      const trimmedPrUrl = prUrl.trim();
      const forceRefreshRequested = typeof opts?.forceRefreshOverride === "boolean"
        ? opts.forceRefreshOverride
        : forceRefresh;

      // Keep UX snappy: start with a fallback estimate immediately.
      let fallbackSeconds = 45;
      if (result?.pr?.changedFiles) {
        fallbackSeconds = Math.min(120, Math.max(20, result.pr.changedFiles * 2));
      }
      setEstimatedTimeSeconds(fallbackSeconds);
      setEstimateMeta(null);
      setElapsedSeconds(0);
      setLoadingDialogOpen(true);
      setLoadingMessage("Analyzing PR...");

      // Fetch a smarter estimate in parallel; do not block review start.
      void api.estimatePRReview(trimmedPrUrl, forceRefreshRequested)
        .then((estimate) => {
          if (typeof estimate?.estimatedSeconds === "number" && estimate.estimatedSeconds > 0) {
            setEstimatedTimeSeconds(Math.round(estimate.estimatedSeconds));
            setEstimateMeta({
              source: estimate.source,
              confidence: estimate.confidence,
              predictedChangeType: estimate.factors?.predictedChangeType || "unknown",
              targetBranch: estimate.factors?.targetBranch || "",
              repoSampleSize: Number(estimate.factors?.repoSampleSize || 0),
            });
          }
        })
        .catch(() => {
          // Best effort: keep fallback estimate.
        });

      return api.reviewPR(trimmedPrUrl, specs || undefined, selectedSession || undefined, forceRefreshRequested);
    },
    onSuccess: (data) => {
      setResult(data);
      setReviewEmailNotice("");
      setLoadingDialogOpen(false);
      setForceRefresh(false);
    },
    onError: (err: Error) => {
      setLoadingDialogOpen(false);
      setForceRefresh(false);
    },
  });

  const sendReviewEmailMutation = useMutation({
    mutationFn: ({ reviewRunId, recipients }: { reviewRunId: string; recipients: string[] }) =>
      api.sendReviewEmail(reviewRunId, recipients, typeof review?.complianceScore === "number" ? review.complianceScore : undefined),
    onSuccess: (resp) => {
      setReviewEmailNotice(resp?.message || "Email sent");
    },
    onError: (err: Error) => {
      setReviewEmailNotice(`Email failed: ${err.message}`);
    },
  });

  const searchMutation = useMutation({
    mutationFn: () => api.searchPRs(searchQuery),
    onSuccess: (data) => {
      setSearchResults(data.results || []);
      setSearchMeta({ source: data.source, hint: data.hint, jiraIssue: data.jiraIssue });
    },
  });

  const review = result?.review;
  const cacheMeta = result?.cache;
  const isCachedResult = !!cacheMeta?.hit;
  const reasonCodes = useQuery({
    queryKey: ["suppression-reasons"],
    queryFn: () => api.getSuppressionReasons(),
    staleTime: 5 * 60_000,
  });

  function extractRepoSlugFromPrUrl(rawUrl: string): string {
    if (!rawUrl) return "";
    const trimmed = rawUrl.trim();
    const bb = trimmed.match(/\/repos\/([^/]+)(?:\/pull-requests\/\d+)?/i)?.[1];
    if (bb) return decodeURIComponent(bb);
    const gh = trimmed.match(/github\.com\/[^/]+\/([^/]+)\/pull\/\d+/i)?.[1];
    if (gh) return decodeURIComponent(gh);
    return "";
  }

  function toDateInputValue(input?: string): string {
    if (!input) {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    }
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return toDateInputValue();
    return parsed.toISOString().slice(0, 10);
  }

  function toIsoFromDateInput(dateText: string): string {
    return new Date(`${dateText}T23:59:59.000Z`).toISOString();
  }

  const activeRepoSlug = (result?.pr?.repoSlug || extractRepoSlugFromPrUrl(prUrl)).trim();
  const reviewRunId = String(result?.reviewRunId || "");
  const reviewEmailList = reviewEmailRecipients
    .split(/[;,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const suppressionsQuery = useQuery({
    queryKey: ["suppressions", activeRepoSlug],
    queryFn: () => api.getSuppressions(activeRepoSlug),
    enabled: !!activeRepoSlug,
    staleTime: 60_000,
  });

  const metricsQuery = useQuery({
    queryKey: ["review-metrics", activeRepoSlug, metricsWindowDays],
    queryFn: () => api.getReviewMetrics(activeRepoSlug, metricsWindowDays),
    enabled: !!activeRepoSlug,
    staleTime: 60_000,
  });

  const createSuppressionMutation = useMutation({
    mutationFn: (payload: {
      findingId: string;
      file: string;
      title: string;
      category: string;
      dimension: string;
      line?: number;
      reasonCode: string;
      reasonDetail?: string;
      expiresAt: string;
    }) => api.createSuppression(activeRepoSlug, {
      finding: {
        file: payload.file,
        title: payload.title,
        category: payload.category,
        dimension: payload.dimension,
        line: payload.line,
      },
      reasonCode: payload.reasonCode,
      reasonDetail: payload.reasonDetail,
      expiresAt: payload.expiresAt,
    }),
    onSuccess: (_data, vars) => {
      setSuppressionNotice(`Suppressed finding ${vars.findingId} until ${vars.expiresAt.slice(0, 10)}.`);
      queryClient.invalidateQueries({ queryKey: ["suppressions", activeRepoSlug] });
      setSuppressionDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.findingId];
        return next;
      });
    },
    onError: (err: Error) => {
      setSuppressionNotice(`Suppression failed: ${err.message}`);
    },
  });

  const expireSuppressionMutation = useMutation({
    mutationFn: (id: number) => api.expireSuppression(activeRepoSlug, id, "Expired from PR review panel"),
    onSuccess: () => {
      setSuppressionNotice("Suppression expired.");
      queryClient.invalidateQueries({ queryKey: ["suppressions", activeRepoSlug] });
    },
    onError: (err: Error) => {
      setSuppressionNotice(`Expire failed: ${err.message}`);
    },
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: (payload: {
      findingId: string;
      outcome: "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved";
      notes?: string;
      incidentLinked?: boolean;
      revertLinked?: boolean;
      subsystem?: string;
      severity?: string;
    }) => api.submitReviewFeedback(activeRepoSlug, {
      reviewRunId,
      findingId: payload.findingId,
      outcome: payload.outcome,
      notes: payload.notes,
      incidentLinked: payload.incidentLinked,
      revertLinked: payload.revertLinked,
      subsystem: payload.subsystem,
      severity: payload.severity,
    }),
    onSuccess: (_data, vars) => {
      setFeedbackNotice(`Recorded ${vars.outcome} for ${vars.findingId}.`);
      queryClient.invalidateQueries({ queryKey: ["review-metrics", activeRepoSlug] });
    },
    onError: (err: Error) => {
      setFeedbackNotice(`Feedback failed: ${err.message}`);
    },
  });

  const fallbackBlockingIssues = (review?.findings || [])
    .filter((f: any) => f?.action === "block")
    .map((f: any) => ({
      title: f.title,
      description: f.message,
      file: f.file,
      line: f.line,
      severity: f.severity || "error",
      suggestedFix: f.suggestedFix,
    }));
  const blockingIssues = (review?.report?.blockingIssues?.length ?? 0) > 0
    ? review.report.blockingIssues
    : fallbackBlockingIssues;
  const blockersCount = typeof review?.summary?.blockers === "number"
    ? review.summary.blockers
    : blockingIssues.length;
  const filteredFindings = review?.findings?.filter(
    (f: any) => !dimFilter || f.dimension === dimFilter
  );
  const linkedSessions = prGroomLinksQuery.data?.links || [];

  const suppressedFromRun = review?.governance?.suppressedFindings || [];
  const schemaAdjusted = review?.governance?.schemaAdjusted || 0;

  function getDraftForFinding(findingId: string) {
    if (suppressionDrafts[findingId]) return suppressionDrafts[findingId];
    return {
      reasonCode: reasonCodes.data?.reasonCodes?.[0] || "false_positive",
      reasonDetail: "",
      expiresAt: toDateInputValue(),
    };
  }

  function updateFindingDraft(findingId: string, patch: Partial<{ reasonCode: string; reasonDetail: string; expiresAt: string }>) {
    setSuppressionDrafts((prev) => ({
      ...prev,
      [findingId]: {
        ...getDraftForFinding(findingId),
        ...prev[findingId],
        ...patch,
      },
    }));
  }

  function getFeedbackDraft(findingId: string) {
    return feedbackDrafts[findingId] || {
      outcome: "accepted" as const,
      notes: "",
      incidentLinked: false,
      revertLinked: false,
    };
  }

  function updateFeedbackDraft(
    findingId: string,
    patch: Partial<{ outcome: "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved"; notes: string; incidentLinked: boolean; revertLinked: boolean }>,
  ) {
    setFeedbackDrafts((prev) => ({
      ...prev,
      [findingId]: {
        ...getFeedbackDraft(findingId),
        ...prev[findingId],
        ...patch,
      },
    }));
  }

  function fmtPct(value?: number): string {
    if (typeof value !== "number" || Number.isNaN(value)) return "-";
    return `${(value * 100).toFixed(1)}%`;
  }

  // Normalize Bitbucket URLs so both browser PR URLs and REST self links work.
  function toBitbucketBrowseBase(rawUrl: string): string | null {
    if (!rawUrl) return null;
    try {
      const trimmed = rawUrl.trim();
      const m = trimmed.match(/^(https?:\/\/[^/]+)(?:\/rest\/api\/1\.0)?\/projects\/([^/]+)\/repos\/([^/]+)/i);
      if (!m) return null;
      const host = m[1];
      const project = m[2];
      const repo = m[3];
      return `${host}/projects/${project}/repos/${repo}`;
    } catch {
      return null;
    }
  }

  function toBitbucketBrowserPrUrl(rawUrl: string): string {
    const base = toBitbucketBrowseBase(rawUrl);
    if (!base) return rawUrl;
    const prId = rawUrl.match(/\/pull-requests\/(\d+)/i)?.[1];
    return prId ? `${base}/pull-requests/${prId}` : rawUrl;
  }

  function normalizeBrowsePath(filePath: string): string {
    const normalized = String(filePath || "")
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
    if (activeRepoSlug && normalized.startsWith(`${activeRepoSlug}/`)) {
      return normalized.slice(activeRepoSlug.length + 1);
    }
    return normalized;
  }

  // Build a Bitbucket "browse" URL for a file path + optional line number.
  // PR URL format: https://host/projects/PRJ/repos/REPO/pull-requests/123
  // Browse URL format: https://host/projects/PRJ/repos/REPO/browse/path/to/File.java#LINE
  function buildFileUrl(filePath: string, line?: number): string | null {
    if (!prUrl || !filePath) return null;
    try {
      const base = toBitbucketBrowseBase(prUrl);
      if (!base) return null;
      const normalizedPath = normalizeBrowsePath(filePath);
      if (!normalizedPath) return null;
      const encoded = normalizedPath.split("/").map(encodeURIComponent).join("/");
      const sourceCommit = typeof result?.pr?.sourceCommit === "string" ? result.pr.sourceCommit.trim() : "";
      const sourceBranch = typeof result?.pr?.sourceBranch === "string"
        ? result.pr.sourceBranch.trim()
        : typeof result?.pr?.head === "string"
          ? result.pr.head.trim()
          : typeof result?.pr?.branch === "string"
            ? result.pr.branch.trim()
            : "";

      // Always anchor file links to PR source ref so they do not drift to default/target branch.
      const at = sourceCommit
        ? sourceCommit
        : sourceBranch
          ? `refs/heads/${sourceBranch}`
          : "";
      const ref = at ? `?at=${encodeURIComponent(at)}` : "";
      return `${base}/browse/${encoded}${ref}${line ? `#${line}` : ""}`;
    } catch {
      return null;
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* ── Input Form ─────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">🔍 PR Review — Risk-Aware Engine</h2>
        <p className="text-sm text-gray-500 mb-4">
          Paste a GitHub or Bitbucket PR URL, or search by JIRA number / description.
          The engine analyses 10 dimensions
          (correctness, security, reliability, performance, maintainability, test-quality,
          API-contract, observability, compliance, business-domain), computes risk scores,
          and routes to the right reviewers.
        </p>
        <div className="space-y-4">
          <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
            <label className="block text-sm font-medium mb-1">Search Bitbucket PRs (JIRA number or description)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="EPP-123 or race condition in steps"
                className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={() => {
                  setSearchResults([]);
                  setSearchMeta(null);
                  searchMutation.mutate();
                }}
                disabled={!searchQuery.trim() || searchMutation.isPending}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
              >
                {searchMutation.isPending ? "Searching..." : "Search"}
              </button>
            </div>
            {searchMutation.isError && (
              <p className="text-red-500 text-sm mt-2">Search error: {(searchMutation.error as Error).message}</p>
            )}
            {searchMeta?.source === "jira-linked" && searchResults.length > 0 && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                Results linked from Jira development metadata.
              </div>
            )}
            {searchMeta?.hint && searchResults.length === 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                {searchMeta.hint}
              </div>
            )}
            {searchMeta?.jiraIssue && searchResults.length === 0 && (
              <a
                href={searchMeta.jiraIssue.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200 dark:hover:bg-blue-900/30"
              >
                Jira: {searchMeta.jiraIssue.key} ({searchMeta.jiraIssue.status}) - {searchMeta.jiraIssue.summary}
              </a>
            )}
            {searchResults.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto space-y-2">
                {searchResults.map((r: any) => (
                  <button
                    key={`${r.repoSlug}-${r.id}`}
                    onClick={() => setPrUrl(toBitbucketBrowserPrUrl(r.url || ""))}
                    className="w-full text-left p-2 rounded border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
                  >
                    <div className="text-sm font-medium">[{r.repoSlug}] PR #{r.id}: {r.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{r.description || "No description"}</div>
                    <div className="text-[11px] text-gray-400 mt-1">{r.sourceBranch} → {r.targetBranch} · by {r.author}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">PR URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://bitbucket.example.com/projects/PRJ/repos/my-repo/pull-requests/123"
                className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {prUrl && (
                <a
                  href={toBitbucketBrowserPrUrl(prUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm rounded-md transition-colors flex items-center gap-1 shrink-0"
                  title="Open PR in browser"
                >
                  🔗 Open
                </a>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Load from Grooming Session</label>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— None (manual specs) —</option>
              {sessionsQuery.data?.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.story_id || s.id} — {new Date(s.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Select a grooming session to auto-populate acceptance criteria, scenarios &amp; expected behavior
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setLinkNotice("");
                  linkSessionMutation.mutate();
                }}
                disabled={!prUrl.trim() || !selectedSession || linkSessionMutation.isPending}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
              >
                {linkSessionMutation.isPending ? "Linking..." : "Link Session to PR"}
              </button>
              <button
                onClick={() => prGroomLinksQuery.refetch()}
                disabled={!prUrl.trim() || prGroomLinksQuery.isFetching}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-xs font-medium rounded-md transition-colors"
              >
                Refresh PR Links
              </button>
            </div>
            {linkNotice && (
              <p className="text-xs mt-2 text-blue-600 dark:text-blue-300">{linkNotice}</p>
            )}
            {linkedSessions.length > 0 && (
              <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-2">
                <div className="text-xs font-medium mb-1">Linked Sessions for This PR</div>
                <div className="space-y-1 max-h-28 overflow-auto">
                  {linkedSessions.map((link: any) => (
                    <div key={link.id} className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedSession(String(link.sessionId))}
                        className="flex-1 text-left text-xs p-1.5 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        title="Click to load this linked session"
                      >
                        <span className="font-medium">{link.sessionTitle || link.sessionId}</span>
                        <span className="text-gray-500">{" · "}{new Date(link.createdAt).toLocaleString()}</span>
                      </button>
                      <button
                        onClick={() => {
                          setLinkNotice("");
                          unlinkSessionMutation.mutate(String(link.id));
                        }}
                        className="px-2 py-1 text-[11px] rounded bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/40"
                        disabled={unlinkSessionMutation.isPending}
                        title="Unlink this session from PR"
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Grooming Specs (optional)</label>
            <textarea
              value={specs}
              onChange={(e) => setSpecs(e.target.value)}
              placeholder="Paste acceptance criteria or grooming email..."
              className="w-full h-28 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="forceRefresh"
              checked={forceRefresh}
              onChange={(e) => setForceRefresh(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
            />
            <label htmlFor="forceRefresh" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              Force Fresh Analysis (skip cache, slower but always up-to-date)
            </label>
          </div>
          <button
            onClick={() => { setResult(null); setDimFilter(null); reviewMutation.mutate(undefined); }}
            disabled={!prUrl || reviewMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {reviewMutation.isPending ? "⏳ Analyzing..." : "🔍 Review PR"}
          </button>
          {reviewMutation.isError && (
            <p className="text-red-500 text-sm">Error: {(reviewMutation.error as Error).message}</p>
          )}

          {/* Loading Dialog */}
          {loadingDialogOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 space-y-4">
                <div className="text-center">
                  <div className="inline-block">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-center">{loadingMessage}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Elapsed</span>
                    <span>{Math.floor(elapsedSeconds / 60)}:{String(elapsedSeconds % 60).padStart(2, "0")}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                    <span>Estimated total</span>
                    <span>{Math.floor(estimatedTimeSeconds / 60)}:{String(estimatedTimeSeconds % 60).padStart(2, "0")}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (elapsedSeconds / estimatedTimeSeconds) * 100)}%` }}
                    />
                  </div>
                </div>
                {estimateMeta && (
                  <div className="rounded-md border border-gray-200 dark:border-gray-700 p-2 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                    <div className="flex justify-between gap-2">
                      <span>Estimate source</span>
                      <span className="font-medium">{estimateMeta.source === "cache-hit" ? "Cache hit" : "Historical model"}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Confidence</span>
                      <span className="font-medium capitalize">{estimateMeta.confidence}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Predicted type</span>
                      <span className="font-medium">{estimateMeta.predictedChangeType}</span>
                    </div>
                    {estimateMeta.targetBranch && (
                      <div className="flex justify-between gap-2">
                        <span>Target branch</span>
                        <span className="font-medium truncate max-w-[14rem]" title={estimateMeta.targetBranch}>{estimateMeta.targetBranch}</span>
                      </div>
                    )}
                    {estimateMeta.source === "historical-signals" && estimateMeta.repoSampleSize > 0 && (
                      <div className="flex justify-between gap-2">
                        <span>History sample</span>
                        <span className="font-medium">{estimateMeta.repoSampleSize} runs</span>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  {forceRefresh ? "Running fresh analysis..." : "Checking cache and analyzing..."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Results ───────────────────────────────── */}
      {result && review && (
        <div className="space-y-5">
          {/* PR Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <h3 className="text-lg font-semibold">PR: {result.pr.title}</h3>
              {isCachedResult && (
                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 dark:border-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">
                  Cached result
                </span>
              )}
            </div>
            {isCachedResult && (
              <div className="mb-3 text-xs text-cyan-700 dark:text-cyan-300">
                Source: {cacheMeta.source || "pr-readiness"}
                {cacheMeta.readinessState ? ` · State: ${cacheMeta.readinessState}` : ""}
                {cacheMeta.snapshotUpdatedAt ? ` · Snapshot: ${new Date(cacheMeta.snapshotUpdatedAt).toLocaleString()}` : ""}
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              <span><span className="text-gray-500">Author:</span> {result.pr.author}</span>
              <span><span className="text-gray-500">Branch:</span> {result.pr.branch || result.pr.head}</span>
              <span><span className="text-gray-500">Files:</span> {result.pr.changedFiles}</span>
              <span className="text-green-600">+{result.pr.additions}</span>
              <span className="text-red-600">-{result.pr.deletions}</span>
            </div>
            {result.groomingContext?.usedSessionId && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                <span className="font-semibold">Groom linked</span>
                <span>session: {result.groomingContext.usedSessionId}</span>
                <span>source: {result.groomingContext.specsSource}</span>
              </div>
            )}
          </div>

          {/* Verdict Banner */}
          {review.summary && (
            <div className={`rounded-lg p-5 ${verdictStyle[review.summary.verdict]?.bg || "bg-gray-500"} ${verdictStyle[review.summary.verdict]?.text || "text-white"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold tracking-wider opacity-80">VERDICT</div>
                  <div className="text-2xl font-bold">{verdictStyle[review.summary.verdict]?.label || review.summary.verdict}</div>
                  <div className="mt-1 text-sm opacity-90">{review.summary.headline}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs opacity-80">Change Type</div>
                  <div className="text-sm font-semibold">{review.summary.changeType}</div>
                  <div className="mt-2 text-xs opacity-80">Score</div>
                  <div className="text-3xl font-bold">{review.complianceScore}%</div>
                </div>
              </div>
              {/* Counts row */}
              <div className="flex gap-4 mt-3 text-xs font-medium opacity-90">
                <span>Total: {review.summary.totalFindings}</span>
                <span>🔴 Blockers: {blockersCount}</span>
                {review.summary.warnings > 0 && <span>🟡 Warnings: {review.summary.warnings}</span>}
                {review.summary.suggestions > 0 && <span>💡 Suggestions: {review.summary.suggestions}</span>}
                {review.summary.informational > 0 && <span>ℹ️ Info: {review.summary.informational}</span>}
              </div>
            </div>
          )}

          {blockersCount > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-4 py-3">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                Blocking issues found: {blockersCount}. This PR should not be merged yet.
              </p>
            </div>
          )}

          {/* Dimension Heatmap */}
          {review.dimensionScores?.length > 0 && (
            <CollapsibleSection title="Dimension Scores" badge={review.dimensionScores.length}>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {review.dimensionScores.map((d: any) => (
                  <button
                    key={d.dimension}
                    onClick={() => setDimFilter(dimFilter === d.dimension ? null : d.dimension)}
                    className={`rounded-xl p-4 text-center transition border ${dimFilter === d.dimension ? "border-blue-500 bg-blue-500/5 shadow-[0_0_0_2px_rgba(59,130,246,0.2)]" : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-400"}`}
                  >
                    <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ring-4 ${gradeColor[d.label] || "bg-gray-400 text-white ring-gray-300/30"}`}>
                      {d.score}
                    </div>
                    <div className={`mt-3 text-sm font-semibold capitalize ${gradeTextColor[d.label] || "text-gray-300"}`}>
                      {d.label}
                    </div>
                    <div className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{d.dimension}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{d.findingCount} finding{d.findingCount !== 1 ? "s" : ""}</div>
                  </button>
                ))}
              </div>
              {dimFilter && <p className="text-xs text-blue-500 mt-2">Filtering findings by: {dimFilter} — click again to clear</p>}
            </CollapsibleSection>
          )}

          {/* Findings */}
          {filteredFindings?.length > 0 ? (
            <CollapsibleSection title={`Findings ${dimFilter ? `(${dimFilter})` : ""}`} badge={filteredFindings.length}>
              <div className="space-y-2">
                {filteredFindings.map((f: any) => {
                  const open = expandedFinding === f.id;
                  return (
                    <div key={f.id} className="border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
                      <button onClick={() => setExpandedFinding(open ? null : f.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sevColor[f.severity]}`}>{f.severity.toUpperCase()}</span>
                        <span className="font-medium flex-1 truncate">{f.title}</span>
                        <span className="text-[10px] text-gray-400">{f.dimension} · {f.confidence}</span>
                        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
                      </button>
                      {open && (
                        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 text-sm space-y-2 border-t border-gray-200 dark:border-gray-700">
                          <p>{f.message}</p>
                          <div className="text-xs text-gray-500">
                            {(() => { const url = buildFileUrl(f.file, f.line); return url ? <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">{f.file}{f.line ? `:${f.line}` : ""}</a> : <>{f.file}{f.line ? `:${f.line}` : ""}</>; })()} · {f.category}
                          </div>
                          {f.evidence && <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded font-mono text-xs overflow-x-auto">{f.evidence}</div>}
                          {f.suggestedFix && <div className="text-green-600 dark:text-green-400 text-xs">Fix: {f.suggestedFix}</div>}
                          {f.suggestedTest && <div className="text-blue-600 dark:text-blue-400 text-xs">Test: {f.suggestedTest}</div>}
                          {f.cweId && <span className="inline-block px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[10px] rounded">{f.cweId}</span>}
                          <div className="mt-2 rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
                            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Suppress Finding</p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <select
                                value={getDraftForFinding(f.id).reasonCode}
                                onChange={(e) => updateFindingDraft(f.id, { reasonCode: e.target.value })}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                disabled={!activeRepoSlug || createSuppressionMutation.isPending}
                              >
                                {(reasonCodes.data?.reasonCodes || ["false_positive"]).map((code: string) => (
                                  <option key={code} value={code}>{code}</option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={getDraftForFinding(f.id).expiresAt}
                                onChange={(e) => updateFindingDraft(f.id, { expiresAt: e.target.value })}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                disabled={!activeRepoSlug || createSuppressionMutation.isPending}
                              />
                              <button
                                onClick={() => {
                                  const draft = getDraftForFinding(f.id);
                                  createSuppressionMutation.mutate({
                                    findingId: f.id,
                                    file: f.file,
                                    title: f.title,
                                    category: f.category,
                                    dimension: f.dimension,
                                    line: f.line,
                                    reasonCode: draft.reasonCode,
                                    reasonDetail: draft.reasonDetail,
                                    expiresAt: toIsoFromDateInput(draft.expiresAt),
                                  });
                                }}
                                disabled={!activeRepoSlug || createSuppressionMutation.isPending}
                                className="px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
                              >
                                {createSuppressionMutation.isPending ? "Saving..." : "Suppress"}
                              </button>
                            </div>
                            <input
                              type="text"
                              placeholder="Reason detail (optional)"
                              value={getDraftForFinding(f.id).reasonDetail}
                              onChange={(e) => updateFindingDraft(f.id, { reasonDetail: e.target.value })}
                              className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                              disabled={!activeRepoSlug || createSuppressionMutation.isPending}
                            />
                          </div>
                          <div className="mt-2 rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
                            <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Reviewer Feedback</p>
                            {!reviewRunId && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-300">Feedback is available after a persisted review run id is returned.</p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                              <select
                                value={getFeedbackDraft(f.id).outcome}
                                onChange={(e) => updateFeedbackDraft(f.id, { outcome: e.target.value as "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved" })}
                                className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                                disabled={!activeRepoSlug || !reviewRunId || submitFeedbackMutation.isPending}
                              >
                                <option value="accepted">accepted</option>
                                <option value="rejected">rejected</option>
                                <option value="false_positive">false_positive</option>
                                <option value="duplicate">duplicate</option>
                                <option value="resolved">resolved</option>
                              </select>
                              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={getFeedbackDraft(f.id).incidentLinked}
                                  onChange={(e) => updateFeedbackDraft(f.id, { incidentLinked: e.target.checked })}
                                  disabled={!activeRepoSlug || !reviewRunId || submitFeedbackMutation.isPending}
                                />
                                incident linked
                              </label>
                              <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={getFeedbackDraft(f.id).revertLinked}
                                  onChange={(e) => updateFeedbackDraft(f.id, { revertLinked: e.target.checked })}
                                  disabled={!activeRepoSlug || !reviewRunId || submitFeedbackMutation.isPending}
                                />
                                revert linked
                              </label>
                            </div>
                            <input
                              type="text"
                              placeholder="Feedback notes (optional)"
                              value={getFeedbackDraft(f.id).notes}
                              onChange={(e) => updateFeedbackDraft(f.id, { notes: e.target.value })}
                              className="w-full px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                              disabled={!activeRepoSlug || !reviewRunId || submitFeedbackMutation.isPending}
                            />
                            <button
                              onClick={() => {
                                const draft = getFeedbackDraft(f.id);
                                submitFeedbackMutation.mutate({
                                  findingId: f.id,
                                  outcome: draft.outcome,
                                  notes: draft.notes,
                                  incidentLinked: draft.incidentLinked,
                                  revertLinked: draft.revertLinked,
                                  subsystem: f.dimension,
                                  severity: f.severity,
                                });
                              }}
                              disabled={!activeRepoSlug || !reviewRunId || submitFeedbackMutation.isPending}
                              className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                            >
                              {submitFeedbackMutation.isPending ? "Submitting..." : "Submit Feedback"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          ) : (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 p-4">
              <span className="text-lg">✅</span>
              <span className="font-medium">No findings — this PR scored 100%. Clean review!</span>
            </div>
          )}

          {/* ── Review Report (CONTRIBUTING.md format) ─────────────────── */}
          {review.report && (
            <CollapsibleSection title="Review Report" icon="📋">
              <div className="space-y-5">
              <div className="flex items-center justify-end flex-wrap gap-3">
                <span className={`px-4 py-1.5 rounded-full text-sm font-bold tracking-wide ${
                  review.report.recommendation === "APPROVE"
                    ? "bg-green-500 text-white"
                    : review.report.recommendation === "APPROVE WITH CONDITIONS"
                    ? "bg-yellow-400 text-gray-900"
                    : "bg-red-500 text-white"
                }`}>
                  {review.report.recommendation}
                </span>
              </div>

              {/* Existing reviewer feedback */}
              {review.report.existingFeedbackSummary && review.report.existingFeedbackSummary !== "No existing reviewer comments found." && (
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 p-4">
                  <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-300 mb-2">💬 Existing Reviewer Feedback</h4>
                  <pre className="text-xs text-blue-800 dark:text-blue-200 whitespace-pre-wrap font-sans">{review.report.existingFeedbackSummary}</pre>
                </div>
              )}

              {/* Blocking Issues */}
              {blockingIssues.length > 0 ? (
                <div>
                  <h4 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-2">🚫 Blocking Issues — must fix before merge</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                          <th className="p-2 text-left border border-red-200 dark:border-red-800">Issue</th>
                          <th className="p-2 text-left border border-red-200 dark:border-red-800">File / Line</th>
                          <th className="p-2 text-left border border-red-200 dark:border-red-800">Severity</th>
                          <th className="p-2 text-left border border-red-200 dark:border-red-800">Suggested Fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blockingIssues.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="p-2 border border-gray-200 dark:border-gray-700">
                              <div className="font-medium text-gray-900 dark:text-gray-100">{item.title}</div>
                              <div className="text-gray-500 dark:text-gray-400 mt-0.5">{item.description}</div>
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                              {item.file ? (() => { const url = buildFileUrl(item.file, item.line); return url ? <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">{item.file}{item.line ? `:${item.line}` : ""}</a> : <>{item.file}{item.line ? `:${item.line}` : ""}</>; })() : "—"}
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700">
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 font-medium">
                                {item.severity || "error"}
                              </span>
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                              {item.suggestedFix || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <span>✅</span><span>No blocking issues found.</span>
                </div>
              )}

              {/* Non-Blocking Issues */}
              {review.report.nonBlockingIssues?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-yellow-600 dark:text-yellow-400 mb-2">⚠️ Non-Blocking Issues — improvements for follow-up</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300">
                          <th className="p-2 text-left border border-yellow-200 dark:border-yellow-800">Issue</th>
                          <th className="p-2 text-left border border-yellow-200 dark:border-yellow-800">File / Line</th>
                          <th className="p-2 text-left border border-yellow-200 dark:border-yellow-800">Type</th>
                          <th className="p-2 text-left border border-yellow-200 dark:border-yellow-800">Suggestion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {review.report.nonBlockingIssues.map((item: any, i: number) => (
                          <tr key={i} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="p-2 border border-gray-200 dark:border-gray-700">
                              <div className="font-medium text-gray-900 dark:text-gray-100">{item.title}</div>
                              <div className="text-gray-500 dark:text-gray-400 mt-0.5">{item.description}</div>
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 font-mono">
                              {item.file ? (() => { const url = buildFileUrl(item.file, item.line); return url ? <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">{item.file}{item.line ? `:${item.line}` : ""}</a> : <>{item.file}{item.line ? `:${item.line}` : ""}</>; })() : "—"}
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700">
                              <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 font-medium">
                                {item.severity || "warning"}
                              </span>
                            </td>
                            <td className="p-2 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                              {item.suggestedFix || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Positive Observations */}
              {review.report.positiveObservations?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-green-600 dark:text-green-400 mb-2">✅ Positive Observations</h4>
                  <ul className="space-y-1">
                    {review.report.positiveObservations.map((obs: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <span className="text-green-500 mt-0.5">•</span>{obs}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Follow-Up Actions */}
              {review.report.followUpActions?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm text-blue-600 dark:text-blue-400 mb-2">🔖 Follow-Up Actions — create tickets for deferred work</h4>
                  <ul className="space-y-1">
                    {review.report.followUpActions.map((action: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <span className="text-blue-400 mt-0.5">{i + 1}.</span>{action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            </CollapsibleSection>
          )}

          {/* Strengths & Risks */}
          {review.summary && (review.summary.strengths?.length > 0 || review.summary.topRisks?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {review.summary.strengths?.length > 0 && (
                <div className="bg-green-50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-800 p-4">
                  <h4 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">✅ Strengths</h4>
                  <ul className="text-sm space-y-1">{review.summary.strengths.map((s: string, i: number) => <li key={i}>• {s}</li>)}</ul>
                </div>
              )}
              {review.summary.topRisks?.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800 p-4">
                  <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">⚠️ Top Risks</h4>
                  <ul className="text-sm space-y-1">{review.summary.topRisks.map((r: string, i: number) => <li key={i}>• {r}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Active Suppressions */}
          {(suppressionsQuery.data?.suppressions?.length || 0) > 0 && (
            <CollapsibleSection title="Active Suppressions" icon="📌" defaultOpen={false} badge={suppressionsQuery.data!.suppressions.length}>
              <div className="space-y-2">
                {suppressionsQuery.data!.suppressions.map((s: any) => (
                  <div key={s.id} className="rounded border border-gray-200 dark:border-gray-700 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-mono text-gray-600 dark:text-gray-300">{s.fingerprint}</div>
                      <button
                        onClick={() => expireSuppressionMutation.mutate(s.id)}
                        disabled={expireSuppressionMutation.isPending}
                        className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                      >
                        Expire
                      </button>
                    </div>
                    <div className="mt-1 text-gray-500 dark:text-gray-400">
                      reason: {s.reasonCode} · owner: {s.owner} · expires: {String(s.expiresAt).slice(0, 10)} · applied: {s.appliedCount}
                    </div>
                    {s.reasonDetail && <div className="mt-1 text-gray-500 dark:text-gray-400">note: {s.reasonDetail}</div>}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Reviewer Routing */}
          {review.reviewerRouting?.length > 0 && (
            <CollapsibleSection title="Reviewer Routing" icon="👥" defaultOpen={false}>
              <div className="flex flex-wrap gap-2">
                {review.reviewerRouting.map((r: string, i: number) => (
                  <span key={i} className="px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full text-xs font-medium">{r}</span>
                ))}
              </div>
              {review.autoApprovalEligible && (
                <p className="mt-2 text-green-600 dark:text-green-400 text-sm font-medium">✅ Auto-approval eligible — low risk, no blockers</p>
              )}
            </CollapsibleSection>
          )}

          {/* Specs Alignment */}
          {review.specsAlignment?.length > 0 && (
            <CollapsibleSection title="Specs Alignment" icon="📐" defaultOpen={false}>
              <div className="space-y-2">
                {review.specsAlignment.map((sa: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className={`px-2 py-0.5 text-xs rounded font-medium ${
                      sa.status === "met" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : sa.status === "partial" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                        : sa.status === "not-applicable" ? "bg-gray-100 text-gray-500"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                    }`}>{sa.status}</span>
                    <div className="flex-1">
                      <div className="truncate">{sa.spec}</div>
                      <div className="text-[10px] text-gray-400">{sa.evidence} · {sa.confidence} confidence</div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Knowledge Context */}
          {review.knowledgeContext?.length > 0 && (
            <CollapsibleSection title="Knowledge Context Applied" icon="📚" defaultOpen={false}>
              <div className="space-y-2">
                {review.knowledgeContext.map((k: any, i: number) => (
                  <div key={i} className="rounded border border-gray-200 dark:border-gray-700 p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 text-[10px] rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{k.source}</span>
                      <span className="font-medium">{k.title}</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300">{k.guidance}</p>
                    {k.appliesTo?.length > 0 && (
                      <p className="text-[11px] text-gray-400 mt-1">Applies to: {k.appliesTo.join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Risk Profile */}
          {review.riskProfile && (
            <CollapsibleSection title="Risk Profile" defaultOpen={false} badge={`${review.riskProfile.overallScore}/100 ${review.riskProfile.label.toUpperCase()}`}>
              {review.riskProfile.factors?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {review.riskProfile.factors.map((f: any, i: number) => (
                    <span key={i} className={`px-2 py-1 rounded text-xs font-medium ${f.weight >= 6 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : f.weight < 0 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"}`}>
                      {f.factor}: {f.detail}
                    </span>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* Governance Summary */}
          <CollapsibleSection title="Governance" icon="🛡️" defaultOpen={false}>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                Schema Adjusted: {schemaAdjusted}
              </span>
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                Suppressed In This Run: {suppressedFromRun.length}
              </span>
              <span className="px-2 py-1 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                Active Suppressions: {suppressionsQuery.data?.count ?? 0}
              </span>
            </div>
            {suppressionNotice && (
              <p className="mt-3 text-xs text-indigo-600 dark:text-indigo-300">{suppressionNotice}</p>
            )}
            {feedbackNotice && (
              <p className="mt-1 text-xs text-blue-600 dark:text-blue-300">{feedbackNotice}</p>
            )}
            {!activeRepoSlug && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                Unable to infer repository slug from PR URL, suppression actions are disabled.
              </p>
            )}
            {!!activeRepoSlug && (
              <div className="mt-4 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <p className="text-xs font-semibold">Review Metrics</p>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-gray-500">Window</label>
                    <select
                      value={String(metricsWindowDays)}
                      onChange={(e) => setMetricsWindowDays(Number(e.target.value))}
                      className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded"
                    >
                      <option value="30">30d</option>
                      <option value="90">90d</option>
                      <option value="180">180d</option>
                      <option value="365">365d</option>
                    </select>
                  </div>
                </div>
                {metricsQuery.isError && (
                  <p className="text-xs text-red-500">Metrics error: {(metricsQuery.error as Error).message}</p>
                )}
                {metricsQuery.data?.summary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Precision: <span className="font-semibold">{fmtPct(metricsQuery.data.summary.findingPrecision)}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">FP Rate: <span className="font-semibold">{fmtPct(metricsQuery.data.summary.falsePositiveRate)}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Trust: <span className="font-semibold">{fmtPct(metricsQuery.data.summary.developerTrustSignal)}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Audit Complete: <span className="font-semibold">{fmtPct(metricsQuery.data.summary.auditTraceCompleteness)}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Avg Latency: <span className="font-semibold">{metricsQuery.data.summary.reviewLatencyMs} ms</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Reviews: <span className="font-semibold">{metricsQuery.data.summary.totals.reviews}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Findings: <span className="font-semibold">{metricsQuery.data.summary.totals.findings}</span></div>
                    <div className="rounded bg-gray-50 dark:bg-gray-900 px-2 py-1">Duplicates: <span className="font-semibold">{metricsQuery.data.summary.totals.duplicates}</span></div>
                  </div>
                )}
              </div>
            )}
            {suppressedFromRun.length > 0 && (
              <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs font-semibold mb-2">Suppressed during this review:</p>
                <div className="space-y-1">
                  {suppressedFromRun.slice(0, 8).map((s: any, idx: number) => (
                    <div key={`${s.findingId}-${idx}`} className="text-xs text-gray-600 dark:text-gray-300">
                      {s.findingId}: {s.file} · {s.reasonCode} · owner: {s.owner} · expires {String(s.expiresAt).slice(0, 10)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleSection>

          {/* Review Email */}
          <CollapsibleSection title="Send Review Email" icon="✉️" defaultOpen={false}>
            <p className="text-xs text-gray-500 mb-3">
              Send this peer review summary to stakeholders after analysis completes.
            </p>
            {!reviewRunId ? (
              <p className="text-xs text-amber-600 dark:text-amber-300">
                Email becomes available once a persisted review run id is returned.
              </p>
            ) : (
              <>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    type="text"
                    value={reviewEmailRecipients}
                    onChange={(e) => setReviewEmailRecipients(e.target.value)}
                    placeholder="dev1@company.com, dev2@company.com"
                    className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      if (!reviewRunId || reviewEmailList.length === 0) {
                        setReviewEmailNotice("Please add at least one recipient email.");
                        return;
                      }
                      sendReviewEmailMutation.mutate({ reviewRunId, recipients: reviewEmailList });
                    }}
                    disabled={!reviewRunId || reviewEmailList.length === 0 || sendReviewEmailMutation.isPending}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
                  >
                    {sendReviewEmailMutation.isPending ? "Sending..." : "Send Email"}
                  </button>
                </div>
                {reviewEmailNotice && (
                  <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">{reviewEmailNotice}</p>
                )}
              </>
            )}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
