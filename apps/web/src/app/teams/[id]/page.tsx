'use client';

import { useTeam } from '@/lib/hooks';
import { useParams } from 'next/navigation';
import { MetricCard } from '@/components/metric-card';
import { InsightCard } from '@/components/insight-card';
import { DataTable } from '@/components/data-table';
import { HealthGauge } from '@/components/health-gauge';
import Link from 'next/link';

export default function TeamDetailPage() {
  const params = useParams();
  const teamId = params.id as string;
  const { data, isLoading } = useTeam(teamId);

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading team...</div>;

  const d = data?.data;
  if (!d) return <div className="text-red-500 p-4">Team not found</div>;

  const m = d.metrics;

  return (
    <div className="space-y-8 max-w-7xl">
      <header>
        <h1 className="text-2xl font-bold">{d.team.name}</h1>
        <p className="text-sm text-gray-500">
          {d.team.memberships?.length ?? 0} members
        </p>
      </header>

      {/* Health gauge + top-level metrics */}
      <div className="flex flex-wrap gap-6 items-start">
        {m && <HealthGauge score={m.deliveryHealthIndex?.score ?? 0} label="Delivery Health" />}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 flex-1">
          {m && (
            <>
              <MetricCard label="Throughput" value={m.throughput ?? 0} unit="stories" />
              <MetricCard label="Med. Cycle Time" value={m.medianCycleTimeHours ?? 0} unit="hrs" />
              <MetricCard label="WIP" value={m.wipCount ?? 0} unit="items" />
              <MetricCard label="Readiness" value={m.averageReadinessScore ?? 0} unit="%" score={m.averageReadinessScore ?? 0} />
              <MetricCard label="Churn Rate" value={m.averageChurnCount ?? 0} unit="changes" />
              <MetricCard label="Traceability" value={m.traceabilityCoverage?.overallLinkedRatio != null ? Math.round(m.traceabilityCoverage?.overallLinkedRatio * 100) : 0} unit="%" score={(m.traceabilityCoverage?.overallLinkedRatio ?? 0) * 100} />
            </>
          )}
        </div>
      </div>

      {/* Insights */}
      {d.insights?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Insights</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.insights.map((ins: any, i: number) => (
              <InsightCard
                key={i}
                title={ins.title}
                body={ins.body}
                severity={ins.severity}
                recommendation={ins.recommendation}
              />
            ))}
          </div>
        </section>
      )}

      {/* Aging Stories */}
      {d.agingStories?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Aging Work Items</h2>
          <DataTable
            keyField="id"
            data={d.agingStories}
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
              {
                key: 'ageDays',
                header: 'Age (days)',
                render: (row: any) => (
                  <span className={row.ageDays > 14 ? 'text-health-red font-medium' : ''}>
                    {row.ageDays}
                  </span>
                ),
              },
            ]}
          />
        </section>
      )}

      {/* Team Members */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Members</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {d.team.memberships?.map((mem: any) => (
            <Link
              key={mem.person.id}
              href={`/people/${mem.person.id}`}
              className="rounded-lg border bg-white p-3 shadow-sm hover:shadow transition text-sm"
            >
              <p className="font-medium">{mem.person.displayName}</p>
              <p className="text-xs text-gray-400">{mem.role}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
