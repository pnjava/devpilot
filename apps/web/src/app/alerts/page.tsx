'use client';

import { useAlerts } from '@/lib/hooks';
import { AlertCard } from '@/components/alert-card';

export default function AlertsPage() {
  const { data, isLoading } = useAlerts();

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading alerts...</div>;

  const alerts = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold">Alerts</h1>
      {alerts.length === 0 ? (
        <p className="text-gray-400">No alerts</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a: any) => (
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
      )}
    </div>
  );
}
