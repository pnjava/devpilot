'use client';

import { useRepos } from '@/lib/hooks';
import { DataTable } from '@/components/data-table';
import { useRouter } from 'next/navigation';

export default function ReposPage() {
  const { data, isLoading } = useRepos();
  const router = useRouter();

  if (isLoading)
    return <div className="animate-pulse text-gray-400 p-8">Loading repositories...</div>;

  const repos = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold">Repositories</h1>
      <DataTable
        keyField="id"
        data={repos}
        onRowClick={(row) => router.push(`/repos/${row.id}`)}
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'provider', header: 'Provider' },
          {
            key: '_count',
            header: 'Branches',
            render: (row) => row._count?.branches ?? '—',
          },
          {
            key: '_count',
            header: 'Commits',
            render: (row) => row._count?.commits ?? '—',
          },
          {
            key: '_count',
            header: 'PRs',
            render: (row) => row._count?.pullRequests ?? '—',
          },
        ]}
      />
    </div>
  );
}
