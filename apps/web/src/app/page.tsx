'use client';

import { useOverview } from '@/lib/hooks';
import { MetricCard } from '@/components/metric-card';
import { HealthGauge } from '@/components/health-gauge';
import { InsightCard } from '@/components/insight-card';
import { AlertCard } from '@/components/alert-card';
import Link from 'next/link';

export default function OverviewPage() {
  const { data, isLoading, error } = useOverview();

  if (isLoading) return <Loader />;
  if (error) return <ErrorMsg message={String(error)} />;

  const d = data?.data;
  if (!d) return <ErrorMsg message="No data returned" />;

  return (
    <div className="space-y-8 max-w-7xl">
      <header>
        <h1 className="text-2xl font-bold">Delivery Overview</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cross-team health at a glance
        </p>
      </header>

      {/* Health gauges per team */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Team Health</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {d.teamHealthScores?.map((t: any) => (
            <Link key={t.teamId} href={`/teams/${t.teamId}`}>
              <HealthGauge score={t.deliveryHealth ?? 0} label={t.teamName} />
            </Link>
          ))}
        </div>
      </section>

      {/* Top risk stories */}
      {d.topRiskStories?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Top Risk Stories</h2>
          <div className="space-y-2">
            {d.topRiskStories.map((s: any) => (
              <Link
                key={s.issueKey}
                href={`/stories/${s.issueKey}`}
                className="block rounded-lg border bg-white p-3 shadow-sm hover:shadow transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono text-brand-600">{s.issueKey}</span>
                    <span className="ml-2 text-sm text-gray-700">{s.title}</span>
                  </div>
                  <MetricCard
                    label="Friction"
                    value={s.frictionScore ?? 0}
                    score={100 - (s.frictionScore ?? 0)}
                    className="border-0 shadow-none p-0"
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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

      {/* Recent alerts */}
      {d.recentAlerts?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Recent Alerts</h2>
          <div className="space-y-2">
            {d.recentAlerts.map((a: any) => (
              <AlertCard
                key={a.id}
                type={a.type}
                message={a.message}
                severity={a.severity ?? 'warning'}
                teamName={a.team?.name}
                issueKey={a.issue?.issueKey}
                createdAt={a.createdAt}
                acknowledgedAt={a.acknowledgedAt}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-pulse text-gray-400">Loading...</div>
    </div>
  );
}

function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
      {message}
    </div>
  );
}
