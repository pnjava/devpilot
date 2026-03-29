import { useState, useCallback } from "react";
import { api } from "../lib/api";

// ── Types ──────────────────────────────────────────────────

interface ReadinessDimension {
  key: string;
  name: string;
  score: number;
  weight: number;
  rationale: string;
  missingSignals: string[];
  confidence: string;
}

interface BlockingGap {
  id: string;
  description: string;
  dimension: string;
  severity: string;
}

interface ClarificationQuestion {
  id: string;
  category: string;
  questionText: string;
  whyThisMatters: string;
  severity: string;
  triggeredBy: string;
  confidence: string;
  suggestedOwner: string;
}

interface SuggestedSubtask {
  id: string;
  title: string;
  description: string;
  category: string;
  whyNeeded: string;
  dependencyHints: string[];
  confidence: string;
  optionalAssigneeType?: string;
  isDraft: boolean;
}

interface Snapshot {
  snapshotId: string;
  jiraKey: string;
  title: string;
  storyType: string;
  readinessState: string;
  readinessScoreOverall: number;
  readinessDimensions: ReadinessDimension[];
  blockingGaps: BlockingGap[];
  clarificationQuestions: ClarificationQuestion[];
  suggestedSubtasks: SuggestedSubtask[];
  knowledgeConfidence: string;
  sourceCoverage: Record<string, boolean>;
  generatedAt: string;
  version: number;
}

// ── Helpers ────────────────────────────────────────────────

function stateColor(state: string) {
  switch (state) {
    case "READY": return "text-green-400";
    case "READY_WITH_QUESTIONS": return "text-yellow-400";
    case "NEEDS_CLARIFICATION": return "text-orange-400";
    case "BLOCKED_BY_MISSING_INFO": return "text-red-400";
    default: return "text-gray-400";
  }
}

function stateLabel(state: string) {
  switch (state) {
    case "READY": return "Ready";
    case "READY_WITH_QUESTIONS": return "Ready with Questions";
    case "NEEDS_CLARIFICATION": return "Needs Clarification";
    case "BLOCKED_BY_MISSING_INFO": return "Blocked — Missing Info";
    default: return state;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "blocker": return "bg-red-900/50 text-red-300 border-red-700";
    case "important": return "bg-yellow-900/50 text-yellow-300 border-yellow-700";
    case "optional": return "bg-gray-700/50 text-gray-300 border-gray-600";
    default: return "bg-gray-700/50 text-gray-300 border-gray-600";
  }
}

function scoreBar(score: number) {
  const color = score >= 70 ? "bg-green-500" : score >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{score}</span>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────

export default function StoryReadiness() {
  const [jiraKey, setJiraKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [knowledgeUsed, setKnowledgeUsed] = useState(false);
  const [jiraPayload, setJiraPayload] = useState<any>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<string>>(new Set());
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!jiraKey.trim()) return;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setJiraPayload(null);
    setShowPayload(false);

    try {
      // Fetch story details from Jira first
      const issue = await api.getJiraIssue(jiraKey.trim().toUpperCase());
      const result = await api.analyzeStoryReadiness({
        jiraKey: issue.key,
        title: issue.summary,
        description: issue.description || "",
        acceptanceCriteria: "", // Jira API doesn't separate AC — it's in description
        issueType: issue.type,
        labels: issue.labels || [],
        assignee: issue.assignee || undefined,
        status: issue.status,
        runMode: "analyze_and_persist",
      });
      setSnapshot(result.snapshot);
      setKnowledgeUsed(result.knowledgeContextUsed);
      // Pre-select all non-draft subtasks
      const ids = new Set<string>(
        (result.snapshot.suggestedSubtasks || [])
          .filter((st: SuggestedSubtask) => !st.isDraft)
          .map((st: SuggestedSubtask) => st.id),
      );
      setSelectedSubtaskIds(ids);
    } catch (err: any) {
      setError(err.message || "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [jiraKey]);

  const refresh = useCallback(async () => {
    if (!snapshot) return;
    setLoading(true);
    setError(null);
    try {
      const issue = await api.getJiraIssue(snapshot.jiraKey);
      const result = await api.refreshStoryReadiness(snapshot.jiraKey, {
        title: issue.summary,
        description: issue.description || "",
        issueType: issue.type,
        labels: issue.labels || [],
        assignee: issue.assignee || undefined,
        status: issue.status,
      });
      setSnapshot(result.snapshot);
      setKnowledgeUsed(result.knowledgeContextUsed);
    } catch (err: any) {
      setError(err.message || "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, [snapshot]);

  const prepareJira = useCallback(async () => {
    if (!snapshot) return;
    try {
      const payload = await api.prepareJiraUpdate(snapshot.jiraKey, {
        selectedSubtaskIds: Array.from(selectedSubtaskIds),
      });
      setJiraPayload(payload);
      setShowPayload(true);
    } catch (err: any) {
      setError(err.message || "Failed to prepare Jira payload");
    }
  }, [snapshot, selectedSubtaskIds]);

  const loadHistory = useCallback(async () => {
    if (!snapshot) return;
    try {
      const result = await api.getStoryReadinessHistory(snapshot.jiraKey, 10);
      setHistory(result.snapshots || []);
      setShowHistory(true);
    } catch (err: any) {
      setError(err.message || "Failed to load history");
    }
  }, [snapshot]);

  const submitFeedback = useCallback(async () => {
    if (!snapshot) return;
    try {
      await api.submitReadinessFeedback(snapshot.jiraKey, {
        snapshotId: snapshot.snapshotId,
        feedbackType: "general",
        feedbackText,
        acceptedQuestionIds: snapshot.clarificationQuestions
          .filter((q) => expandedQuestions.has(q.id))
          .map((q) => q.id),
        acceptedSubtaskIds: Array.from(selectedSubtaskIds),
      });
      setFeedbackSent(true);
      setFeedbackText("");
      setTimeout(() => setFeedbackSent(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to submit feedback");
    }
  }, [snapshot, feedbackText, expandedQuestions, selectedSubtaskIds]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyMsg(`${label} copied!`);
      setTimeout(() => setCopyMsg(null), 2000);
    });
  }, []);

  const exportSummary = useCallback(() => {
    if (!snapshot) return;
    const lines = [
      `# Story Readiness: ${snapshot.jiraKey}`,
      `**${snapshot.title}**`,
      ``,
      `**Score:** ${snapshot.readinessScoreOverall}/100 — ${snapshot.readinessState.replace(/_/g, " ")}`,
      `**Type:** ${snapshot.storyType.replace(/_/g, " ")}`,
      `**Knowledge Confidence:** ${snapshot.knowledgeConfidence}`,
      ``,
      `## Dimensions`,
      ...snapshot.readinessDimensions.map((d) => `- ${d.name}: ${d.score}/100 (${d.confidence})`),
      ``,
    ];
    if (snapshot.blockingGaps.length > 0) {
      lines.push(`## Blocking Gaps`);
      lines.push(...snapshot.blockingGaps.map((g) => `- [${g.severity}] ${g.description}`));
      lines.push(``);
    }
    if (snapshot.clarificationQuestions.length > 0) {
      lines.push(`## Clarification Questions`);
      lines.push(...snapshot.clarificationQuestions.map((q) => `- [${q.severity}] [${q.category}] ${q.questionText}`));
      lines.push(``);
    }
    if (snapshot.suggestedSubtasks.length > 0) {
      lines.push(`## Suggested Subtasks`);
      lines.push(...snapshot.suggestedSubtasks.map((s) => `- ${s.isDraft ? "(draft) " : ""}${s.title} [${s.category}]`));
    }
    copyToClipboard(lines.join("\n"), "Summary");
  }, [snapshot, copyToClipboard]);

  const toggleSubtask = (id: string) => {
    setSelectedSubtaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleQuestion = (id: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Search Bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={jiraKey}
          onChange={(e) => setJiraKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && analyze()}
          placeholder="Enter Jira key (e.g. EPP-1234)"
          className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={analyze}
          disabled={loading || !jiraKey.trim()}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {snapshot && (
        <>
          {/* Overview Card */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm font-mono text-blue-400">{snapshot.jiraKey}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-700 rounded text-gray-300">{snapshot.storyType.replace(/_/g, " ")}</span>
                  {knowledgeUsed && (
                    <span className="text-xs px-2 py-0.5 bg-purple-900/40 border border-purple-700 rounded text-purple-300">Knowledge Enriched</span>
                  )}
                </div>
                <h2 className="text-lg font-semibold text-white">{snapshot.title}</h2>
              </div>
              <button
                onClick={refresh}
                disabled={loading}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
              >
                ↻ Refresh
              </button>
            </div>

            {/* Readiness State + Score */}
            <div className="flex items-center gap-4 p-3 bg-gray-900/50 rounded-lg">
              <div className="text-center">
                <div className={`text-3xl font-bold ${stateColor(snapshot.readinessState)}`}>
                  {snapshot.readinessScoreOverall}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">/ 100</div>
              </div>
              <div className="flex-1">
                <div className={`text-sm font-medium ${stateColor(snapshot.readinessState)}`}>
                  {stateLabel(snapshot.readinessState)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  v{snapshot.version} · {new Date(snapshot.generatedAt).toLocaleString()} · Confidence: {snapshot.knowledgeConfidence}
                </div>
              </div>
            </div>
          </div>

          {/* Dimensions */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Readiness Dimensions</h3>
            <div className="space-y-2.5">
              {snapshot.readinessDimensions.map((dim) => (
                <div key={dim.key} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-40 truncate" title={dim.name}>{dim.name}</span>
                  {scoreBar(dim.score)}
                  <span className="text-xs text-gray-500 w-12">{dim.weight}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Blocking Gaps */}
          {snapshot.blockingGaps.length > 0 && (
            <div className="bg-gray-800 border border-red-800/50 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-red-400 mb-3">
                Blocking Gaps ({snapshot.blockingGaps.length})
              </h3>
              <div className="space-y-2">
                {snapshot.blockingGaps.map((gap) => (
                  <div key={gap.id} className="flex items-start gap-2 text-sm">
                    <span className={`px-1.5 py-0.5 text-xs rounded border ${severityBadge(gap.severity)}`}>
                      {gap.severity}
                    </span>
                    <span className="text-gray-300">{gap.description}</span>
                    <span className="text-xs text-gray-600 ml-auto">{gap.dimension.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clarification Questions */}
          {snapshot.clarificationQuestions.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Clarification Questions ({snapshot.clarificationQuestions.length})
              </h3>
              <div className="space-y-2">
                {snapshot.clarificationQuestions.map((q) => (
                  <div key={q.id} className="border border-gray-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleQuestion(q.id)}
                      className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-700/50 transition-colors"
                    >
                      <span className={`px-1.5 py-0.5 text-xs rounded border shrink-0 ${severityBadge(q.severity)}`}>
                        {q.severity}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">[{q.category}]</span>
                      <span className="text-sm text-gray-200 flex-1">{q.questionText}</span>
                      <span className="text-xs text-gray-600 shrink-0">{expandedQuestions.has(q.id) ? "▲" : "▼"}</span>
                    </button>
                    {expandedQuestions.has(q.id) && (
                      <div className="px-3 pb-3 space-y-1 text-xs text-gray-400 border-t border-gray-700 pt-2 ml-4">
                        <div><strong>Why:</strong> {q.whyThisMatters}</div>
                        <div><strong>Triggered by:</strong> {q.triggeredBy}</div>
                        <div><strong>Suggested owner:</strong> {q.suggestedOwner}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested Subtasks */}
          {snapshot.suggestedSubtasks.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Suggested Subtasks ({snapshot.suggestedSubtasks.length})
              </h3>
              <div className="space-y-2">
                {snapshot.suggestedSubtasks.map((st) => (
                  <div key={st.id} className="flex items-start gap-3 p-3 border border-gray-700 rounded-lg">
                    <input
                      type="checkbox"
                      checked={selectedSubtaskIds.has(st.id)}
                      onChange={() => toggleSubtask(st.id)}
                      className="mt-1 rounded bg-gray-700 border-gray-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-200">{st.title}</span>
                        {st.isDraft && (
                          <span className="text-xs px-1.5 py-0.5 bg-orange-900/40 border border-orange-700 rounded text-orange-300">draft</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mb-1">{st.description}</div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{st.category}</span>
                        {st.optionalAssigneeType && <span>→ {st.optionalAssigneeType}</span>}
                        <span className="ml-auto">{st.confidence}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Coverage */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Source Coverage</h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(snapshot.sourceCoverage).map(([key, val]) => (
                <span
                  key={key}
                  className={`text-xs px-2.5 py-1 rounded-lg border ${
                    val
                      ? "bg-green-900/30 border-green-700 text-green-300"
                      : "bg-gray-900/30 border-gray-700 text-gray-500"
                  }`}
                >
                  {val ? "✓" : "✗"} {key.replace(/([A-Z])/g, " $1").trim()}
                </span>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={prepareJira}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium text-white transition-colors"
            >
              Preview Jira Update ({selectedSubtaskIds.size} subtasks)
            </button>
            <button
              onClick={() =>
                copyToClipboard(
                  snapshot.clarificationQuestions.map((q) => `[${q.severity}] ${q.questionText}`).join("\n"),
                  "Questions",
                )
              }
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
            >
              Copy Questions
            </button>
            <button
              onClick={() =>
                copyToClipboard(
                  snapshot.suggestedSubtasks
                    .filter((s) => selectedSubtaskIds.has(s.id))
                    .map((s) => `${s.title} — ${s.description}`)
                    .join("\n"),
                  "Subtasks",
                )
              }
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
            >
              Copy Subtasks
            </button>
            <button
              onClick={exportSummary}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
            >
              Export Summary
            </button>
            <button
              onClick={loadHistory}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition-colors"
            >
              View History
            </button>
            {copyMsg && <span className="text-xs text-green-400">{copyMsg}</span>}
          </div>

          {/* Feedback Panel */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Feedback</h3>
            <p className="text-xs text-gray-500 mb-2">
              Help improve future suggestions. Selected subtasks and expanded questions are recorded as accepted.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Optional: notes on what was helpful or missing..."
                className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={submitFeedback}
                disabled={feedbackSent}
                className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium text-white transition-colors"
              >
                {feedbackSent ? "Sent ✓" : "Submit"}
              </button>
            </div>
          </div>

          {/* History Panel */}
          {showHistory && history.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">Analysis History ({history.length})</h3>
                <button onClick={() => setShowHistory(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
              </div>
              <div className="space-y-2">
                {history.map((h) => (
                  <div key={h.snapshotId} className="flex items-center gap-3 p-2 bg-gray-900 rounded text-xs">
                    <span className="font-mono text-gray-400">v{h.version}</span>
                    <span className={`font-medium ${stateColor(h.readinessState)}`}>{h.readinessScoreOverall}</span>
                    <span className="text-gray-500">{stateLabel(h.readinessState)}</span>
                    <span className="text-gray-600 ml-auto">{new Date(h.generatedAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Jira Payload Preview */}
          {showPayload && jiraPayload && (
            <div className="bg-gray-800 border border-indigo-700/50 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-indigo-300">Jira Payload Preview (Dry Run)</h3>
                <button onClick={() => setShowPayload(false)} className="text-xs text-gray-500 hover:text-gray-300">Close</button>
              </div>
              {jiraPayload.commentBody && (
                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">Comment:</div>
                  <pre className="text-xs text-gray-300 bg-gray-900 p-3 rounded overflow-auto max-h-60 whitespace-pre-wrap">
                    {jiraPayload.commentBody}
                  </pre>
                </div>
              )}
              {jiraPayload.subtaskPayloads?.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Subtasks ({jiraPayload.subtaskPayloads.length}):</div>
                  <div className="space-y-2">
                    {jiraPayload.subtaskPayloads.map((st: any, i: number) => (
                      <div key={i} className="p-2 bg-gray-900 rounded text-xs">
                        <div className="font-medium text-gray-200">{st.summary}</div>
                        <pre className="text-gray-400 mt-1 whitespace-pre-wrap">{st.description}</pre>
                        <div className="text-gray-600 mt-1">Labels: {st.labels?.join(", ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!snapshot && !loading && !error && (
        <div className="text-center py-20 text-gray-500">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-lg font-medium">Story Readiness Copilot</div>
          <div className="text-sm mt-1">Enter a Jira key to analyze readiness, generate questions, and suggest subtasks.</div>
        </div>
      )}
    </div>
  );
}
