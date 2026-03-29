'use client';

import { useStory } from '@/lib/hooks';
import { useParams } from 'next/navigation';
import { MetricCard } from '@/components/metric-card';
import { InsightCard } from '@/components/insight-card';
import { cn, healthColor } from '@/lib/utils';

export default function StoryDetailPage() {
  const params = useParams();
  const issueKey = params.issueKey as string;
  const { data, isLoading } = useStory(issueKey);

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading story...</div>;

  const d = data?.data;
  if (!d) return <div className="text-red-500 p-4">Story not found</div>;

  const m = d.metrics;

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <div className="flex items-center gap-3">
          <span className="font-mono text-brand-600 text-sm">{d.issue.issueKey}</span>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              d.issue.canonicalState === 'DONE'
                ? 'bg-green-100 text-green-700'
                : d.issue.canonicalState === 'BLOCKED'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-blue-100 text-blue-700',
            )}
          >
            {d.issue.canonicalState}
          </span>
        </div>
        <h1 className="text-2xl font-bold mt-1">{d.issue.title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {d.issue.team?.name} · Sprint: {d.issue.sprint?.name ?? 'Unassigned'} ·
          Assignee: {d.issue.assignee?.displayName ?? 'Unassigned'}
        </p>
      </header>

      {/* Metrics grid */}
      {m && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MetricCard label="Readiness" value={m.readiness?.score ?? 0} unit="%" score={m.readiness?.score ?? 0} />
            <MetricCard label="Churn Count" value={m.churnCount ?? 0} />
            <MetricCard label="Cycle Time" value={m.cycleTimeHours ?? 0} unit="hrs" />
            <MetricCard label="Blocked Time" value={m.blockedTimeHours ?? 0} unit="hrs" />
            <MetricCard label="First Commit Delay" value={m.firstCommitDelayHours ?? 0} unit="hrs" />
            <MetricCard label="First Review Delay" value={m.firstReviewDelayHours ?? 0} unit="hrs" />
            <MetricCard label="Merge Time" value={m.mergeTimeHours ?? 0} unit="hrs" />
            <MetricCard label="Friction Score" value={m.frictionScore?.score ?? 0} score={100 - (m.frictionScore?.score ?? 0)} />
          </div>
        </section>
      )}

      {/* Friction Breakdown */}
      {m?.frictionScore?.breakdown && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Friction Breakdown</h2>
          <div className="rounded-lg border bg-white p-4 shadow-sm space-y-2">
            {Object.entries(m.frictionScore.breakdown).map(([key, val]: [string, any]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: `${Math.min(100, (val as number) * 10)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">
                    {typeof val === 'number' ? Math.round(val * 10) / 10 : val}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      {d.timeline?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Timeline</h2>
          <div className="space-y-0 border-l-2 border-gray-200 ml-3">
            {d.timeline.map((event: any, i: number) => (
              <div key={i} className="relative pl-6 pb-4">
                <div
                  className={cn(
                    'absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white',
                    event.type === 'transition'
                      ? 'bg-brand-500'
                      : event.type === 'comment'
                        ? 'bg-gray-400'
                        : 'bg-green-500',
                  )}
                />
                <p className="text-xs text-gray-400">
                  {new Date(event.timestamp).toLocaleString()} · {event.type}
                </p>
                <p className="text-sm text-gray-700 mt-0.5">{event.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Linked Artifacts */}
      {d.linkedArtifacts?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Linked Artifacts</h2>
          <div className="space-y-2">
            {d.linkedArtifacts.map((link: any) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm text-sm"
              >
                <div>
                  <span className="font-mono text-xs text-brand-600">{link.artifactType}</span>
                  <span className="ml-2 text-gray-700">{link.artifactId}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{link.linkMethod}</span>
                  <span>
                    Confidence:{' '}
                    <span className={healthColor(link.confidence)}>{link.confidence}%</span>
                  </span>
                </div>
              </div>
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

      {/* Annotations */}
      {d.annotations?.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Annotations</h2>
          <div className="space-y-2">
            {d.annotations.map((a: any) => (
              <div key={a.id} className="rounded-lg border bg-white p-3 shadow-sm text-sm">
                <p className="text-gray-700">{a.note}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {a.author?.displayName} · {new Date(a.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
