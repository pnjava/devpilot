const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  overview: () => apiFetch<any>('/overview'),
  teams: () => apiFetch<any>('/teams'),
  team: (id: string) => apiFetch<any>(`/teams/${encodeURIComponent(id)}`),
  story: (key: string) => apiFetch<any>(`/stories/${encodeURIComponent(key)}`),
  person: (id: string) => apiFetch<any>(`/people/${encodeURIComponent(id)}`),
  people: () => apiFetch<any>('/people'),
  repos: () => apiFetch<any>('/repos'),
  repo: (id: string) => apiFetch<any>(`/repos/${encodeURIComponent(id)}`),
  alerts: (teamId?: string) => apiFetch<any>(`/alerts${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`),
  integrationStatus: () => apiFetch<any>('/integrations/status'),
  triggerSync: (orgId: string, types?: string[]) =>
    apiFetch<any>('/integrations/sync', {
      method: 'POST',
      body: JSON.stringify({ orgId, types }),
    }),
  adminSettings: (orgId?: string) =>
    apiFetch<any>(`/admin/settings${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`),
};
