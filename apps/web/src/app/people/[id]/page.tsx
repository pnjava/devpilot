'use client';

import { usePerson } from '@/lib/hooks';
import { useParams } from 'next/navigation';
import { MetricCard } from '@/components/metric-card';
import { DataTable } from '@/components/data-table';
import Link from 'next/link';

export default function PersonDetailPage() {
  const params = useParams();
  const personId = params.id as string;
  const { data, isLoading } = usePerson(personId);

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading person...</div>;

  const d = data?.data;
  if (!d) return <div className="text-red-500 p-4">Person not found</div>;

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <h1 className="text-2xl font-bold">{d.person.displayName}</h1>
        <p className="text-sm text-gray-500">{d.person.email}</p>
        <div className="flex gap-2 mt-2">
          {d.person.memberships?.map((mem: any) => (
            <Link
              key={mem.team.id}
              href={`/teams/${mem.team.id}`}
              className="text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded hover:underline"
            >
              {mem.team.name} ({mem.role})
            </Link>
          ))}
        </div>
      </header>

      {/* Collaboration contributions — NOT surveillance */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Collaboration Contributions</h2>
        <p className="text-xs text-gray-400 mb-3">
          Focus: reviews, documentation, and collaboration. Individual output is not
          measured for surveillance.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Reviews Given" value={d.contributions?.reviewsGiven ?? 0} />
          <MetricCard label="PR Comments" value={d.contributions?.prComments ?? 0} />
          <MetricCard label="Wiki Edits" value={d.contributions?.wikiEdits ?? 0} />
          <MetricCard label="Stories Completed" value={d.contributions?.storiesCompleted ?? 0} />
        </div>
      </section>

      {/* Current work */}
      {d.currentWork?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Current Work</h2>
          <DataTable
            keyField="id"
            data={d.currentWork}
            columns={[
              {
                key: 'issueKey',
                header: 'Key',
                render: (row: any) => (
                  <Link href={`/stories/${row.issueKey}`} className="text-brand-600 hover:underline font-mono text-xs">
                    {row.issueKey}
                  </Link>
                ),
              },
              { key: 'title', header: 'Title' },
              { key: 'canonicalState', header: 'State' },
            ]}
          />
        </section>
      )}
    </div>
  );
}
