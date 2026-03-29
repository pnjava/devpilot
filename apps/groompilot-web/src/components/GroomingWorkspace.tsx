import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import EmailPreview from "./EmailPreview";

interface Props {
  selectedStory: string | null;
}

export default function GroomingWorkspace({ selectedStory }: Props) {
  const [additionalContext, setAdditionalContext] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [groomingResult, setGroomingResult] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  // Fetch Bitbucket repos for dropdown
  const { data: bbRepos } = useQuery({
    queryKey: ["bb-repos"],
    queryFn: api.getBitbucketRepos,
  });

  // Fetch AI status
  const { data: aiStatus } = useQuery({
    queryKey: ["ai-status"],
    queryFn: api.getAIStatus,
  });

  // Fetch Jira story details
  const { data: storyData } = useQuery({
    queryKey: ["jira-issue", selectedStory],
    queryFn: () => api.getJiraIssue(selectedStory!),
    enabled: !!selectedStory,
  });

  // Groom mutation
  const groomMutation = useMutation({
    mutationFn: () =>
      api.groomStory({
        jiraKey: selectedStory!,
        additionalContext: additionalContext || undefined,
        repoSlug: selectedRepo || undefined,
      }),
    onSuccess: (data) => {
      setGroomingResult(data);
      setSessionId(data.sessionId);
    },
  });

  if (!selectedStory) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-lg font-medium">Select a story to groom</p>
          <p className="text-sm mt-1">Choose an epic and story from the sidebar</p>
        </div>
      </div>
    );
  }

  const issue = storyData;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Story Header */}
      {issue && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                <span className="text-blue-500 font-mono mr-2">{issue.key}</span>
                {issue.summary}
              </h2>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {issue.status}
                </span>
                <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
                  {issue.type}
                </span>
                {issue.priority && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-300">
                    {issue.priority}
                  </span>
                )}
                {issue.labels?.map((label) => (
                  <span
                    key={label}
                    className="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300"
                  >
                    {label}
                  </span>
                ))}
              </div>
              {issue.assignee && (
                <div className="mt-2 text-sm text-gray-500">Assignee: {issue.assignee}</div>
              )}
            </div>
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline shrink-0"
            >
              View in Jira ↗
            </a>
          </div>
          {issue.description && (
            <div className="mt-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border-t border-gray-100 dark:border-gray-700 pt-4">
              {issue.description}
            </div>
          )}

          {/* Existing subtasks */}
          {issue.subtasks && issue.subtasks.length > 0 && (
            <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
              <h4 className="text-sm font-semibold text-gray-500 mb-2">Existing Subtasks</h4>
              <div className="space-y-1">
                {issue.subtasks.map((st) => (
                  <div key={st.key} className="flex items-center gap-2 text-sm">
                    <span className={st.status === "Done" ? "text-green-500" : "text-gray-400"}>●</span>
                    <span className="font-mono text-xs text-blue-500">{st.key}</span>
                    <span>{st.summary}</span>
                    <span className="text-xs text-gray-400">({st.status})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {issue.comments && issue.comments.length > 0 && (
            <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
              <h4 className="text-sm font-semibold text-gray-500 mb-2">
                Comments ({issue.comments.length})
              </h4>
              <div className="space-y-2 max-h-48 overflow-auto">
                {issue.comments.slice(-5).map((c, i) => (
                  <div key={i} className="text-sm bg-gray-50 dark:bg-gray-900 rounded p-2">
                    <span className="font-medium text-xs">{c.author}:</span>
                    <p className="mt-0.5 text-gray-600 dark:text-gray-400 whitespace-pre-wrap text-xs">
                      {c.body?.slice(0, 300)}{c.body?.length > 300 ? "..." : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Additional Context + Repo Selector */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex gap-4 mb-3">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Git Repository (optional)</label>
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- No repo (skip code analysis) --</option>
              {bbRepos?.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.project}/{r.slug} — {r.name}
                </option>
              ))}
            </select>
            {selectedRepo && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                🔍 Will scan <span className="font-mono">{selectedRepo}</span> to check what's already done
              </p>
            )}
          </div>
        </div>
        <label className="block text-sm font-medium mb-2">Additional Context (optional)</label>
        <textarea
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          placeholder="Add any extra context, constraints, or notes for grooming..."
          className="w-full h-24 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => groomMutation.mutate()}
            disabled={groomMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {groomMutation.isPending ? "⏳ Grooming..." : "🧹 Groom & Generate"}
          </button>
          {aiStatus?.enabled && (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </span>
              AI: {aiStatus.provider}/{aiStatus.model}
            </span>
          )}
        </div>
        {groomMutation.isError && (
          <p className="text-red-500 text-sm mt-2">
            Error: {(groomMutation.error as Error).message}
          </p>
        )}
      </div>

      {/* Grooming Results */}
      {groomingResult && (
        <div className="space-y-4">
          {/* Understanding */}
          {groomingResult.understanding && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-3">
                🧠 Understanding
                {(groomingResult.understanding?.includes('AI insights') || groomingResult.understanding?.includes('AI-Enhanced')) && (
                  <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                    ✨ AI-Enhanced
                  </span>
                )}
              </h3>
              <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {groomingResult.understanding?.split(/\n\nAdditional AI insights[^:]*:?\s*\n?|--- AI-Enhanced Analysis/).map((part: string, idx: number) =>
                  idx === 0 ? (
                    <div key={idx}>{part}</div>
                  ) : (
                    <div key={idx} className="mt-4 p-4 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/10 dark:to-blue-900/10 border border-purple-200 dark:border-purple-800">
                      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
                        ✨ AI Insights
                      </div>
                      <div className="text-sm">{part.replace(/^\s*\([^)]*\):\s*/, '').replace(/^\s*\n/, '').trim()}</div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Expected Behavior */}
          {groomingResult.expectedBehavior && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-3">🎯 Expected Behavior</h3>
              <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {groomingResult.expectedBehavior}
              </div>
            </div>
          )}

          {/* Code Analysis */}
          {groomingResult.codeAnalysis && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-3">
                🔍 Code Analysis
                <span className="text-sm font-normal text-gray-500 ml-2">
                  (repo: <span className="font-mono">{groomingResult.codeAnalysis.repoSlug}</span>)
                </span>
              </h3>

              {/* Summary counts */}
              <div className="flex gap-3 mb-4">
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  ✅ {groomingResult.codeAnalysis.alreadyDone?.length || 0} Done
                </span>
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                  🔧 {groomingResult.codeAnalysis.needsChange?.length || 0} Needs Changes
                </span>
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  🆕 {groomingResult.codeAnalysis.newWork?.length || 0} New Work
                </span>
              </div>

              {/* Files checked */}
              <div className="space-y-2">
                {groomingResult.codeAnalysis.filesChecked?.map((f: any, i: number) => (
                  <div
                    key={i}
                    className={`rounded-md p-3 text-sm border-l-4 ${
                      f.status === "done"
                        ? "border-green-500 bg-green-50 dark:bg-green-900/10"
                        : f.status === "needs-change"
                        ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10"
                        : "border-blue-500 bg-blue-50 dark:bg-blue-900/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>
                        {f.status === "done" ? "✅" : f.status === "needs-change" ? "🔧" : "🆕"}
                      </span>
                      <span className="font-mono text-xs text-blue-600 dark:text-blue-400 truncate flex-1">
                        {f.path}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          f.status === "done"
                            ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200"
                            : f.status === "needs-change"
                            ? "bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200"
                            : "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200"
                        }`}
                      >
                        {f.status === "done" ? "EXISTS" : f.status === "needs-change" ? "MODIFY" : "CREATE"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-6">{f.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scenarios */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold mb-4">
              📋 Scenarios
              <span className="text-sm font-normal text-gray-400 ml-2">
                ({groomingResult.scenarios?.length || 0} total{groomingResult.scenarios?.filter((s: any) => s.name?.startsWith('AI:')).length > 0 ? `, ${groomingResult.scenarios.filter((s: any) => s.name?.startsWith('AI:')).length} AI` : ''})
              </span>
            </h3>
            <div className="space-y-3">
              {groomingResult.scenarios?.map((s: any, i: number) => (
                <div key={i} className={`rounded-md p-4 text-sm ${s.name?.startsWith('AI:') ? 'bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800' : 'bg-gray-50 dark:bg-gray-900'}`}>
                  <div className="font-semibold text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-2">
                    {s.name}
                    {s.name?.startsWith('AI:') && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">✨ AI</span>
                    )}
                  </div>
                  <div><span className="font-medium text-gray-500">Given:</span> {s.given}</div>
                  <div><span className="font-medium text-gray-500">When:</span> {s.when}</div>
                  <div><span className="font-medium text-gray-500">Then:</span> {s.then}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Acceptance Criteria (V4: Gherkin highlighting) */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold mb-4">
              ✅ Acceptance Criteria <span className="text-xs font-normal text-gray-400">(Gherkin / SMART)</span>
              <span className="text-sm font-normal text-gray-400 ml-2">
                ({groomingResult.acceptanceCriteria?.length || 0} total{groomingResult.acceptanceCriteria?.filter((ac: string) => ac.includes('[AI-suggested]')).length > 0 ? `, ${groomingResult.acceptanceCriteria.filter((ac: string) => ac.includes('[AI-suggested]')).length} AI` : ''})
              </span>
            </h3>
            <ul className="space-y-3">
              {groomingResult.acceptanceCriteria?.map((ac: string, i: number) => {
                const isAI = ac.includes('[AI-suggested]');
                const cleanAC = ac.replace(' [AI-suggested]', '');
                return (
                <li key={i} className={`flex items-start gap-2 text-sm ${isAI ? 'pl-3 border-l-2 border-purple-400 dark:border-purple-600' : ''}`}>
                  <span className={`mt-0.5 shrink-0 ${isAI ? 'text-purple-500' : 'text-green-500'}`}>{isAI ? '✨' : '✓'}</span>
                  <span className="leading-relaxed">
                    {cleanAC.split(/(GIVEN|WHEN|THEN|AND)\s/g).map((part: string, j: number) =>
                      ["GIVEN", "WHEN", "THEN", "AND"].includes(part)
                        ? <span key={j} className="font-bold text-purple-600 dark:text-purple-400">{part} </span>
                        : <span key={j}>{part}</span>
                    )}
                    {isAI && <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">AI</span>}
                  </span>
                </li>
                );
              })}
            </ul>
          </div>

          {/* Test Cases (V4: priority, preconditions, automation) */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold mb-2">🧪 QA Test Scenarios</h3>
            <p className="text-xs text-gray-500 mb-4">{groomingResult.testCases?.length || 0} test cases — covering happy path, edge cases, security, and performance</p>
            <div className="space-y-3">
              {groomingResult.testCases?.map((tc: any, i: number) => {
                const priorityColors: Record<string, string> = {
                  P0: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
                  P1: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
                  P2: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
                  P3: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
                };
                return (
                  <div key={i} className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{tc.name}</span>
                      {tc.priority && (
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${priorityColors[tc.priority] || priorityColors.P3}`}>
                          {tc.priority}
                        </span>
                      )}
                      <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        {tc.type}
                      </span>
                    </div>
                    <div className="mt-2 text-gray-600 dark:text-gray-400">{tc.description}</div>

                    {/* Preconditions */}
                    {tc.preconditions?.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs font-medium text-gray-500">Preconditions:</span>
                        <ul className="ml-4 mt-0.5">
                          {tc.preconditions.map((pre: string, j: number) => (
                            <li key={j} className="text-xs text-gray-500 dark:text-gray-400 list-disc">{pre}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Steps (Given/When/Then) */}
                    <div className="mt-2 space-y-1">
                      {tc.steps?.map((step: string, j: number) => (
                        <div key={j} className="text-xs">
                          {step.split(/(GIVEN|WHEN|THEN|AND)\s/g).map((part: string, k: number) =>
                            ["GIVEN", "WHEN", "THEN", "AND"].includes(part)
                              ? <span key={k} className="font-bold text-purple-600 dark:text-purple-400">{part} </span>
                              : <span key={k} className="text-gray-600 dark:text-gray-400">{part}</span>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Automation Suggestion */}
                    {tc.automationSuggestion && (
                      <div className="mt-2 flex items-center gap-1">
                        <span className="text-xs text-gray-400">🤖</span>
                        <span className="text-xs text-green-600 dark:text-green-400 italic">{tc.automationSuggestion}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Subtasks (V4: story points, approach, code insights) */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                📦 Developer Tasks & Approach
                <span className="text-sm font-normal text-gray-400 ml-2">
                  ({groomingResult.subtasks?.length || 0} total{groomingResult.subtasks?.filter((s: any) => s.title?.includes('[AI-suggested]')).length > 0 ? `, ${groomingResult.subtasks.filter((s: any) => s.title?.includes('[AI-suggested]')).length} AI` : ''})
                </span>
              </h3>
              {groomingResult.totalEstimate && (
                <span className="text-sm font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full">
                  {groomingResult.totalEstimate}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {groomingResult.subtasks?.map((st: any, i: number) => {
                const isAISub = st.title?.includes('[AI-suggested]');
                const cleanTitle = st.title?.replace(' [AI-suggested]', '') || st.title;
                return (
                <div key={i} className={`rounded-md p-4 text-sm ${isAISub ? 'bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800' : 'bg-gray-50 dark:bg-gray-900'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{cleanTitle}</span>
                      {isAISub && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">✨ AI</span>
                      )}
                      {st.labels?.map((label: string) => (
                        <span key={label} className="px-1.5 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {label}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {st.storyPoints != null && (
                        <span className="text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                          {st.storyPoints} SP
                        </span>
                      )}
                      {st.estimate && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                          {st.estimate}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-gray-500 text-xs mt-1">{st.description}</p>

                  {/* Approach */}
                  {st.approach && (
                    <div className="mt-2 bg-white dark:bg-gray-800 rounded p-2 border-l-2 border-blue-400">
                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Approach: </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400">{st.approach}</span>
                    </div>
                  )}

                  {/* Code Insights */}
                  {st.codeInsights?.length > 0 && (
                    <div className="mt-2">
                      <span className="text-xs font-medium text-gray-500">Code Insights:</span>
                      <ul className="ml-4 mt-0.5">
                        {st.codeInsights.map((insight: string, j: number) => (
                          <li key={j} className="text-xs text-gray-500 dark:text-gray-400 list-disc">{insight}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-3 italic">
              Preview only — subtasks are not auto-created in Jira
            </p>
          </div>

          {/* Spikes */}
          {groomingResult.spikes?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-4">⚡ Spikes</h3>
              <ul className="space-y-1 text-sm">
                {groomingResult.spikes.map((spike: string, i: number) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-yellow-500">⚠</span> {spike}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Implementation Hints */}
          {groomingResult.implementationHints?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-4">💡 Implementation Hints</h3>
              <p className="text-xs text-gray-500 mb-3">Looking at the repo structure, the relevant files are likely:</p>
              <div className="space-y-3">
                {groomingResult.implementationHints.map((hint: any, i: number) => (
                  <div key={i} className="bg-gray-50 dark:bg-gray-900 rounded-md p-4 text-sm">
                    <div className="font-mono text-blue-600 dark:text-blue-400 font-medium">{hint.file}</div>
                    <div className="text-gray-600 dark:text-gray-400 mt-1">{hint.description}</div>
                    {hint.codeSnippet && (
                      <pre className="mt-2 bg-gray-900 dark:bg-gray-950 text-green-400 p-3 rounded text-xs overflow-auto">
                        {hint.codeSnippet}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* UI Snapshots */}
          {groomingResult.uiSnapshots?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold mb-4">🖼️ UI Snapshots (ASCII)</h3>
              {groomingResult.uiSnapshots.map((snap: string, i: number) => (
                <pre key={i} className="ascii-snapshot bg-gray-50 dark:bg-gray-900 p-4 rounded-md overflow-auto">
                  {snap}
                </pre>
              ))}
            </div>
          )}

          {/* Grooming Summary (V4) */}
          {groomingResult.groomingSummary && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border-2 border-blue-200 dark:border-blue-800 p-6">
              <h3 className="text-lg font-semibold mb-4">📊 Grooming Summary</h3>

              {/* AI Contribution Metrics */}
              {(() => {
                const aiACs = groomingResult.acceptanceCriteria?.filter((ac: string) => ac.includes('[AI-suggested]')).length || 0;
                const aiSubs = groomingResult.subtasks?.filter((s: any) => s.title?.includes('[AI-suggested]')).length || 0;
                const aiRisks = groomingResult.groomingSummary?.risks?.filter((r: any) => r.risk?.includes('[AI-identified]')).length || 0;
                const aiScenarios = groomingResult.scenarios?.filter((s: any) => s.name?.startsWith('AI:')).length || 0;
                const aiUnderstanding = (groomingResult.understanding?.includes('AI insights') || groomingResult.understanding?.includes('AI-Enhanced')) ? 1 : 0;
                const totalAI = aiACs + aiSubs + aiRisks + aiScenarios + aiUnderstanding;
                if (totalAI === 0) return null;
                return (
                  <div className="mb-5 p-4 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">✨ AI Contributions</span>
                      <span className="text-xs text-purple-500 dark:text-purple-400">({aiStatus?.provider}/{aiStatus?.model})</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {aiUnderstanding > 0 && <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">Understanding enhanced</span>}
                      {aiACs > 0 && <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{aiACs} acceptance criteria</span>}
                      {aiSubs > 0 && <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{aiSubs} subtasks</span>}
                      {aiScenarios > 0 && <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{aiScenarios} scenarios</span>}
                      {aiRisks > 0 && <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{aiRisks} risks identified</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Sprint Readiness Score */}
              <div className="flex items-center gap-4 mb-5">
                <div className="flex flex-col items-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${
                    groomingResult.groomingSummary.sprintReadinessScore >= 8 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" :
                    groomingResult.groomingSummary.sprintReadinessScore >= 5 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300" :
                    "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                  }`}>
                    {groomingResult.groomingSummary.sprintReadinessScore}
                  </div>
                  <span className="text-xs text-gray-500 mt-1">/ 10</span>
                </div>
                <div>
                  <div className="text-sm font-medium">Sprint Readiness Score</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {groomingResult.groomingSummary.sprintReadinessScore >= 8 ? "Ready for sprint" :
                     groomingResult.groomingSummary.sprintReadinessScore >= 5 ? "Needs minor improvements" :
                     "Not ready — address improvements below"}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{groomingResult.groomingSummary.fibonacciEstimate}</div>
                    <div className="text-xs text-gray-500">Story Points</div>
                  </div>
                </div>
              </div>

              {/* Improvements Needed */}
              {groomingResult.groomingSummary.improvementsNeeded?.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-sm font-semibold text-gray-500 mb-2">Improvements Needed</h4>
                  <ul className="space-y-1">
                    {groomingResult.groomingSummary.improvementsNeeded.map((imp: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-orange-500 mt-0.5 shrink-0">⚠</span>
                        <span className="text-gray-600 dark:text-gray-400">{imp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Risks & Mitigations */}
              {groomingResult.groomingSummary.risks?.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-sm font-semibold text-gray-500 mb-2">Risks & Mitigations</h4>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 pr-4 text-gray-500 font-medium">Risk</th>
                          <th className="text-left py-2 text-gray-500 font-medium">Mitigation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groomingResult.groomingSummary.risks.map((r: any, i: number) => {
                          const isAIRisk = r.risk?.includes('[AI-identified]');
                          const cleanRisk = r.risk?.replace(' [AI-identified]', '') || r.risk;
                          return (
                          <tr key={i} className={`border-b ${isAIRisk ? 'border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/10' : 'border-gray-100 dark:border-gray-800'}`}>
                            <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                              {cleanRisk}
                              {isAIRisk && <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">✨ AI</span>}
                            </td>
                            <td className="py-2 text-green-600 dark:text-green-400">{r.mitigation}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Definition of Done */}
              {groomingResult.groomingSummary.definitionOfDone?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 mb-2">Definition of Done Checklist</h4>
                  <ul className="space-y-1">
                    {groomingResult.groomingSummary.definitionOfDone.map((dod: string, i: number) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-4 h-4 rounded border border-gray-300 dark:border-gray-600 shrink-0" />
                        <span className="text-gray-600 dark:text-gray-400">{dod}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap gap-3">
            <button
              onClick={() => setShowEmail(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md"
            >
              📧 Email Summary
            </button>
            <button
              onClick={() => {
                const md = formatMarkdown(groomingResult, issue);
                navigator.clipboard.writeText(md);
              }}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md"
            >
              📋 Copy Markdown
            </button>
            <button
              onClick={() => {
                const md = formatMarkdown(groomingResult, issue);
                const blob = new Blob([md], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `grooming-${selectedStory}.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-md"
            >
              💾 Export .md
            </button>
          </div>
        </div>
      )}

      {/* Email Modal */}
      {showEmail && sessionId && (
        <EmailPreview sessionId={sessionId} onClose={() => setShowEmail(false)} />
      )}
    </div>
  );
}

// Helper: strip internal tags from text for clean export
function cleanTag(text: string): string {
  return text
    .replace(/\s*\[AI-suggested\]/g, "")
    .replace(/\s*\[AI-identified\]/g, "")
    .replace(/^\[DONE in repo\]\s*/i, "");
}

function gwtToDeclarative(ac: string): string {
  const m = ac.match(/^GIVEN\s+.+?,?\s+WHEN\s+.+?,?\s+THEN\s+(.+)$/i);
  if (m) {
    let stmt = m[1].trim().replace(/\.$/, "");
    stmt = stmt.replace(/^it /i, "API ");
    stmt = stmt.replace(/^they /i, "Existing operations ");
    stmt = stmt.replace(/^the input /i, "Input ");
    return stmt.charAt(0).toUpperCase() + stmt.slice(1);
  }
  return ac;
}

function scenarioPriority(s: any): string {
  const text = `${s.name || ""} ${s.given || ""} ${s.when || ""} ${s.then || ""}`.toLowerCase();
  // Check P1 first so edge-case keywords aren't accidentally caught by P3's broader patterns
  if (/invalid|malform|negative|missing|error|reject|not.?found|edge|boundary|empty|exceed|injection|xss/.test(text)) return "P1";
  if (/concurrent|performance|load|latency|p95|p99|throughput|non-func/.test(text)) return "P2";
  if (/\bbackward\b|\bcompat|\blegacy\b|\bdesktop\b|\bmigrat|\bdocument|\bspec\b|\bopenapi\b/.test(text)) return "P3";
  return "P0";
}

function formatMarkdown(result: any, issue: any): string {
  const key = issue?.key || "";
  const summary = issue?.summary || issue?.title || "Story";
  let md = `Grooming: ${key} — ${summary}\n(Jira: ${key})\n\n`;

  // ─── Understanding (clean paragraphs only) ───
  if (result.understanding) {
    md += `## Understanding\n\n`;
    let text = result.understanding;
    text = text.replace(/\n?\nCode analysis:.*$/gm, "");
    // Keep AI insights as a separate subsection
    const parts = text.split(/\n\nAdditional AI insights[^:\n]*:?\s*\n?|--- AI-Enhanced Analysis/i);
    md += `${parts[0].trim()}\n\n`;
    if (parts.length > 1 && parts[1].trim()) {
      // Clean any residual provider tags or markdown headers from AI content
      const aiContent = parts[1].replace(/^\s*\([^)]*\):\s*/, '').replace(/^\s*\n/, '').trim();
      if (aiContent) {
        md += `### AI Insights\n\n${aiContent}\n\n`;
      }
    }
  }

  // ─── Expected Behavior ───
  if (result.expectedBehavior) {
    md += `## Expected Behavior\n\n${result.expectedBehavior.trim()}\n\n`;
  }

  // ─── Acceptance Criteria (declarative form) ───
  if (result.acceptanceCriteria?.length > 0) {
    md += `## Acceptance Criteria\n\n`;
    for (const ac of result.acceptanceCriteria) {
      md += `- ${gwtToDeclarative(cleanTag(ac))}\n`;
    }
    md += "\n";
  }

  // ─── Scenarios grouped by priority ───
  if (result.scenarios?.length > 0) {
    md += `## Scenarios (Given/When/Then)\n\n`;
    const labels: Record<string, string> = {
      P0: "P0 — Core Functionality",
      P1: "P1 — Edge Cases & Validation",
      P2: "P2 — Non-functional / Performance",
      P3: "P3 — Compatibility & Docs",
    };
    const groups: Record<string, any[]> = { P0: [], P1: [], P2: [], P3: [] };
    for (const s of result.scenarios) groups[scenarioPriority(s)].push(s);
    let n = 1;
    for (const p of ["P0", "P1", "P2", "P3"]) {
      if (groups[p].length === 0) continue;
      md += `${labels[p]}\n`;
      for (const s of groups[p]) {
        const name = (s.name || `Scenario ${n}`).replace(/^AI:\s*/i, "");
        md += `  ${n}. ${name}\n`;
        md += `     Given ${s.given}\n`;
        md += `     When ${s.when}\n`;
        md += `     Then ${s.then}\n`;
        n++;
      }
      md += "\n";
    }
  }

  // ─── Test Cases (compact table) ───
  if (result.testCases?.length > 0) {
    md += `## Test Cases\n\n`;
    md += `| # | Name | Type | Key Checks |\n|---|------|------|------------|\n`;
    for (let i = 0; i < result.testCases.length; i++) {
      const tc = result.testCases[i];
      // Strip redundant "TC-N: " prefix from name
      const name = cleanTag(tc.name || `Test ${i + 1}`).replace(/^TC-\d+:\s*/i, "");
      const checks = (tc.expectedResult || tc.description || "").replace(/\|/g, "/").slice(0, 80);
      md += `| TC-${i + 1} | ${name} | ${tc.type || "integration"} | ${checks} |\n`;
    }
    md += "\n";
  }

  // ─── Subtasks (clean table with status) ───
  if (result.subtasks?.length > 0) {
    md += `## Subtasks\n\n`;
    md += `| # | Task | Estimate | Status |\n|---|------|----------|--------|\n`;
    for (let i = 0; i < result.subtasks.length; i++) {
      const st = result.subtasks[i];
      const raw = st.title || "";
      let status = "new";
      if (/\[DONE in repo\]/i.test(raw)) status = "✅ done";
      else if (/\[AI-suggested\]/i.test(raw)) status = "AI";
      const title = raw
        .replace(/\s*\[AI-suggested\]/g, "")
        .replace(/\s*\[AI-identified\]/g, "")
        .replace(/^\[DONE in repo\]\s*/i, "");
      md += `| ${i + 1} | ${title} | ${st.estimate || "-"} | ${status} |\n`;
    }
    md += "\n";
    // Use totalEstimate as-is if it already contains SP info
    const total = result.totalEstimate || "";
    if (/story point/i.test(total)) {
      md += `Total: ${total}\n\n`;
    } else {
      const sp = result.groomingSummary?.fibonacciEstimate;
      md += `Total: ${total}${sp ? ` → ${sp} story points (Fibonacci)` : ""}\n\n`;
    }
  }

  // ─── Spikes / Risks ───
  if (result.spikes?.length > 0) {
    md += `## Spikes / Risks\n\n`;
    for (const spike of result.spikes) md += `- ${cleanTag(spike)}\n`;
    md += "\n";
  }

  md += `---\n*Generated by GroomPilot V4*\n`;
  return md;
}
