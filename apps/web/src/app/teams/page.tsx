'use client';

import { useTeams } from '@/lib/hooks';
import { DataTable } from '@/components/data-table';
import { useRouter } from 'next/navigation';
import { healthLabel, healthColor } from '@/lib/utils';

export default function TeamsPage() {
  const { data, isLoading } = useTeams();
  const router = useRouter();

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading teams...</div>;

  const teams = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold">Teams</h1>
      <DataTable
        keyField="id"
        data={teams}
        onRowClick={(row) => router.push(`/teams/${row.id}`)}
        columns={[
          { key: 'name', header: 'Team' },
          {
            key: '_count',
            header: 'Members',
            render: (row) => row._count?.memberships ?? '—',
          },
          {
            key: '_count',
            header: 'Issues',
            render: (row) => row._count?.issues ?? '—',
          },
        ]}
      />
    </div>
  );
}
