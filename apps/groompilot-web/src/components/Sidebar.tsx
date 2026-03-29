import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const hasToken = () => !!localStorage.getItem("gp_token");

interface Props {
  onSelectStory: (storyKey: string) => void;
  onSelectPR?: (prUrl: string) => void;
  selectedStory: string | null;
  activeTab: string;
}

const statusColors: Record<string, string> = {
  Open: "text-blue-400",
  "In Progress": "text-yellow-400",
  Resolved: "text-green-400",
  "To Do": "text-gray-400",
};

export default function Sidebar({ onSelectStory, onSelectPR, selectedStory, activeTab }: Props) {
  const [expandedEpics, setExpandedEpics] = useState<Record<string, boolean>>({});
  const [expandedRepos, setExpandedRepos] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");

  // Jira Epics
  const { data: epics, isLoading: epicsLoading } = useQuery({
    queryKey: ["jira-epics"],
    queryFn: api.getJiraEpics,
  });

  // Stories for expanded epic
  const expandedEpicKey = Object.entries(expandedEpics).find(([, v]) => v)?.[0];
  const { data: stories, isLoading: storiesLoading } = useQuery({
    queryKey: ["jira-stories", expandedEpicKey],
    queryFn: () => api.getJiraStories(expandedEpicKey),
    enabled: !!expandedEpicKey,
  });

  const showBitbucket = activeTab === "pr-review";

  // Bitbucket repos — only fetch when on PR review tab and authenticated
  const { data: bbRepos, isLoading: bbLoading, isError: bbError, refetch: bbRefetch, error: bbErrorObj } = useQuery({
    queryKey: ["bb-repos"],
    queryFn: api.getBitbucketRepos,
    enabled: showBitbucket && hasToken(),
    retry: 1,
    staleTime: 60_000,
  });

  // PRs for expanded repo
  const expandedRepoSlug = Object.entries(expandedRepos).find(([, v]) => v)?.[0];
  const { data: prs } = useQuery({
    queryKey: ["bb-prs", expandedRepoSlug],
    queryFn: () => api.getBitbucketPRs(expandedRepoSlug!),
    enabled: !!expandedRepoSlug && hasToken(),
  });

  // Readiness statuses for visible PRs — single batch call
  const { data: readinessStatuses } = useQuery({
    queryKey: ["bb-readiness", expandedRepoSlug],
    queryFn: async () => {
      if (!expandedRepoSlug) return {};
      const result = await api.getReadinessStatuses("BMN", expandedRepoSlug);
      return result?.statuses ?? {};
    },
    enabled: !!expandedRepoSlug && hasToken(),
    staleTime: 30_000,
  });

  const { data: prLinkIndex } = useQuery({
    queryKey: ["bb-pr-link-index", expandedRepoSlug],
    queryFn: () => api.getPRGroomLinkIndex(expandedRepoSlug!, "BMN"),
    enabled: !!expandedRepoSlug && hasToken(),
    staleTime: 30_000,
  });

  const linkedPrCountByNumber = new Map<number, number>(
    (prLinkIndex?.links || []).map((entry: any) => [Number(entry.prNumber), Number(entry.linkCount || 0)]),
  );

  // Search results
  // Enable search at 2 chars for keys like "EP" or numbers, 3 for text
  const isKeySearch = /^[A-Z]{1,}-\d|^\d+$/i.test(searchQuery.trim());
  const { data: searchResults } = useQuery({
    queryKey: ["jira-search", searchQuery],
    queryFn: () => api.searchJiraStories(searchQuery),
    enabled: isKeySearch ? searchQuery.trim().length >= 2 : searchQuery.trim().length >= 3,
  });

  const showJira = activeTab === "groom" || activeTab === "activity";

  return (
    <aside className="w-72 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full shrink-0">
      {/* Search */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={showBitbucket ? "Search repos..." : "Key (EPP-9130) or description..."}
          className="w-full px-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {/* Search results */}
        {((isKeySearch && searchQuery.trim().length >= 2) || searchQuery.trim().length >= 3) && searchResults && (
          <div>
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase">
              Search Results
            </div>
            {searchResults.map((s) => (
              <button
                key={s.key}
                onClick={() => { onSelectStory(s.key); setSearchQuery(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                  selectedStory === s.key ? "bg-blue-50 dark:bg-blue-900/20" : ""
                }`}
              >
                <span className="text-blue-500 font-mono text-xs">{s.key}</span>
                <span className="ml-2 truncate">{s.summary}</span>
              </button>
            ))}
          </div>
        )}

        {/* Jira Epics & Stories */}
        {showJira && !((isKeySearch && searchQuery.trim().length >= 2) || searchQuery.trim().length >= 3) && (
          <div>
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Jira Epics (EPP)
            </div>
            {epicsLoading && (
              <div className="px-4 py-2 text-sm text-gray-500">Loading epics...</div>
            )}
            {epics?.map((epic) => (
              <div key={epic.key}>
                <button
                  onClick={() =>
                    setExpandedEpics((prev) => {
                      const next: Record<string, boolean> = {};
                      next[epic.key] = !prev[epic.key];
                      return next;
                    })
                  }
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 ${
                    expandedEpics[epic.key] ? "bg-gray-50 dark:bg-gray-700/30" : ""
                  }`}
                >
                  <span className="text-xs">{expandedEpics[epic.key] ? "▼" : "▶"}</span>
                  <span className="text-purple-500 text-xs">⚡</span>
                  <span className="truncate font-medium flex-1">{epic.summary}</span>
                  <span className={`text-xs ${statusColors[epic.status] || "text-gray-400"}`}>
                    {epic.status}
                  </span>
                </button>

                {expandedEpics[epic.key] && (
                  <div className="ml-4 border-l border-gray-200 dark:border-gray-700">
                    {storiesLoading && (
                      <div className="px-3 py-1 text-xs text-gray-500">Loading stories...</div>
                    )}
                    {stories?.map((story) => (
                      <button
                        key={story.key}
                        onClick={() => onSelectStory(story.key)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 ${
                          selectedStory === story.key ? "bg-blue-50 dark:bg-blue-900/20" : ""
                        }`}
                      >
                        <span className={statusColors[story.status] || "text-gray-400"}>●</span>
                        <span className="text-blue-500 font-mono">{story.key}</span>
                        <span className="truncate flex-1">{story.summary}</span>
                      </button>
                    ))}
                    {!storiesLoading && stories?.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-500">No stories in this epic</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!epicsLoading && epics?.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-500">No epics found</div>
            )}
          </div>
        )}

        {/* Bitbucket Repos & PRs */}
        {showBitbucket && !((isKeySearch && searchQuery.trim().length >= 2) || searchQuery.trim().length >= 3) && (
          <div>
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Bitbucket Repos (BMN)
            </div>
            {bbLoading && (
              <div className="px-4 py-2 text-sm text-gray-500">Loading repos...</div>
            )}
            {bbError && (
              <div className="px-4 py-3">
                <p className="text-xs text-red-500 mb-1">Failed to load repos: {(bbErrorObj as Error)?.message || "unknown error"}</p>
                <button onClick={() => bbRefetch()} className="text-xs text-blue-500 underline">Retry</button>
              </div>
            )}
            {bbRepos?.map((repo) => (
              <div key={repo.slug}>
                <button
                  onClick={() =>
                    setExpandedRepos((prev) => {
                      const next: Record<string, boolean> = {};
                      next[repo.slug] = !prev[repo.slug];
                      return next;
                    })
                  }
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 ${
                    expandedRepos[repo.slug] ? "bg-gray-50 dark:bg-gray-700/30" : ""
                  }`}
                >
                  <span className="text-xs">{expandedRepos[repo.slug] ? "▼" : "▶"}</span>
                  <span className="truncate font-medium">{repo.name}</span>
                </button>

                {expandedRepos[repo.slug] && (
                  <div className="ml-4 border-l border-gray-200 dark:border-gray-700">
                    {prs?.map((pr) => {
                      const rs = readinessStatuses?.[pr.id];
                      const statusDot = rs
                        ? rs.state === "ready"
                          ? "text-green-500"
                          : rs.state === "blocked"
                            ? "text-red-500"
                            : "text-yellow-500"
                        : "text-gray-400";
                      const statusTitle = rs
                        ? `${rs.state} | risk: ${rs.risk}${rs.blockers ? ` | ${rs.blockers} blocker(s)` : ""}`
                        : "Not reviewed yet";
                      return (
                      <button
                        key={pr.id}
                        onClick={() => onSelectPR?.(pr.url)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      >
                        <div className="flex items-center gap-1">
                          <span className={statusDot} title={statusTitle}>●</span>
                          <span className="truncate font-medium">{pr.title}</span>
                          {linkedPrCountByNumber.get(Number(pr.id)) ? (
                            <span
                              className="ml-1 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              title="This PR has linked grooming session(s)"
                            >
                              linked {linkedPrCountByNumber.get(Number(pr.id))}
                            </span>
                          ) : null}
                          {rs && (
                            <span
                              className={`ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                rs.state === "ready"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  : rs.state === "blocked"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                              }`}
                            >
                              {rs.state}
                            </span>
                          )}
                        </div>
                        <div className="text-gray-500 ml-4 mt-0.5">
                          {pr.author} → {pr.target}
                        </div>
                      </button>
                      );
                    })}
                    {prs?.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-500">No open PRs</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!bbLoading && bbRepos?.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-500">No repos found</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
