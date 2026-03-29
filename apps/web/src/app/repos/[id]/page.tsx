'use client';

import { useRepo } from '@/lib/hooks';
import { useParams } from 'next/navigation';
import { MetricCard } from '@/components/metric-card';
import { DataTable } from '@/components/data-table';

export default function RepoDetailPage() {
  const params = useParams();
  const repoId = params.id as string;
  const { data, isLoading } = useRepo(repoId);

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading repository...</div>;

  const d = data?.data;
  if (!d) return <div className="text-red-500 p-4">Repository not found</div>;

  return (
    <div className="space-y-8 max-w-6xl">
      <header>
        <h1 className="text-2xl font-bold">{d.repo.name}</h1>
        <p className="text-sm text-gray-500">{d.repo.externalUrl}</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard label="Open PRs" value={d.openPRs?.length ?? 0} />
        <MetricCard label="Merged PRs (period)" value={d.mergedPRCount ?? 0} />
        <MetricCard label="Stale Branches" value={d.staleBranchCount ?? 0} />
      </div>

      {/* Open PRs */}
      {d.openPRs?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Open Pull Requests</h2>
          <DataTable
            keyField="id"
            data={d.openPRs}
            columns={[
              { key: 'externalId', header: '#', render: (row: any) => `#${row.externalId}` },
              { key: 'title', header: 'Title' },
              { key: 'author', header: 'Author', render: (row: any) => row.author?.displayName ?? '—' },
              {
                key: 'createdAt',
                header: 'Opened',
                render: (row: any) => new Date(row.createdAt).toLocaleDateString(),
              },
              {
                key: 'reviews',
                header: 'Reviews',
                render: (row: any) => row.reviews?.length ?? 0,
              },
            ]}
          />
        </section>
      )}

      {/* Recent Commits */}
      {d.recentCommits?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent Commits</h2>
          <DataTable
            keyField="id"
            data={d.recentCommits.slice(0, 20)}
            columns={[
              {
                key: 'sha',
                header: 'SHA',
                render: (row: any) => (
                  <span className="font-mono text-xs">{row.sha?.slice(0, 8)}</span>
                ),
              },
              { key: 'message', header: 'Message', render: (row: any) => row.message?.slice(0, 80) },
              {
                key: 'authoredAt',
                header: 'Date',
                render: (row: any) => new Date(row.authoredAt).toLocaleDateString(),
              },
            ]}
          />
        </section>
      )}
    </div>
  );
}
