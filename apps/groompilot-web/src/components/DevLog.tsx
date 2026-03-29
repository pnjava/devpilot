import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function DevLog() {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: api.getSessions,
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">📊 Activity Feed</h2>

        {isLoading && <p className="text-gray-500 text-sm">Loading activity...</p>}

        {!isLoading && (!sessions || sessions.length === 0) && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <p>No grooming sessions yet</p>
            <p className="text-sm mt-1">Select a story and click "Groom & Generate" to get started</p>
          </div>
        )}

        <div className="space-y-3">
          {sessions?.map((session: any) => (
            <div
              key={session.id}
              className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-md"
            >
              <div className="text-2xl">🧹</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{session.title}</div>
                <div className="text-xs text-gray-500">
                  {session.repo_owner}/{session.repo_name} · #{session.story_id}
                </div>
              </div>
              <div className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(session.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
