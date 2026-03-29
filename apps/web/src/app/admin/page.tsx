'use client';

import { useIntegrationStatus, useAdminSettings } from '@/lib/hooks';
import { DataTable } from '@/components/data-table';

export default function AdminPage() {
  const { data: intData, isLoading: intLoading } = useIntegrationStatus();
  const { data: settingsData, isLoading: settingsLoading } = useAdminSettings();

  return (
    <div className="space-y-8 max-w-5xl">
      <h1 className="text-2xl font-bold">Admin</h1>

      {/* Integration Connections */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Integrations</h2>
        {intLoading ? (
          <div className="animate-pulse text-gray-400">Loading...</div>
        ) : (
          <>
            <DataTable
              keyField="id"
              data={intData?.data?.connections ?? []}
              columns={[
                { key: 'type', header: 'Type' },
                { key: 'baseUrl', header: 'URL' },
                {
                  key: 'isActive',
                  header: 'Active',
                  render: (row: any) => (row.isActive ? '✅' : '❌'),
                },
              ]}
            />

            {intData?.data?.recentJobs?.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2 text-gray-600">Recent Sync Jobs</h3>
                <DataTable
                  keyField="id"
                  data={intData.data.recentJobs}
                  columns={[
                    { key: 'type', header: 'Type' },
                    { key: 'status', header: 'Status' },
                    {
                      key: 'startedAt',
                      header: 'Started',
                      render: (row: any) => new Date(row.startedAt).toLocaleString(),
                    },
                    {
                      key: 'finishedAt',
                      header: 'Finished',
                      render: (row: any) =>
                        row.finishedAt ? new Date(row.finishedAt).toLocaleString() : '—',
                    },
                    { key: 'itemsSynced', header: 'Items' },
                  ]}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* Settings */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Settings</h2>
        {settingsLoading ? (
          <div className="animate-pulse text-gray-400">Loading...</div>
        ) : (
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Status Mappings</h3>
            {settingsData?.data?.statusMappings?.length > 0 ? (
              <DataTable
                keyField="id"
                data={settingsData.data.statusMappings}
                columns={[
                  { key: 'externalStatus', header: 'External Status' },
                  { key: 'canonicalState', header: 'Canonical State' },
                  { key: 'issueType', header: 'Issue Type' },
                ]}
              />
            ) : (
              <p className="text-sm text-gray-400">No status mappings configured</p>
            )}

            <h3 className="text-sm font-semibold text-gray-600 mt-4 mb-2">Thresholds</h3>
            {settingsData?.data?.thresholds?.length > 0 ? (
              <DataTable
                keyField="id"
                data={settingsData.data.thresholds}
                columns={[
                  { key: 'metricKey', header: 'Metric' },
                  { key: 'green', header: 'Green ≥' },
                  { key: 'amber', header: 'Amber ≥' },
                  { key: 'red', header: 'Red <' },
                ]}
              />
            ) : (
              <p className="text-sm text-gray-400">Using default thresholds</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
