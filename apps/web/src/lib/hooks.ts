import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: api.overview });
}

export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: api.teams });
}

export function useTeam(id: string) {
  return useQuery({ queryKey: ['team', id], queryFn: () => api.team(id), enabled: !!id });
}

export function useStory(key: string) {
  return useQuery({ queryKey: ['story', key], queryFn: () => api.story(key), enabled: !!key });
}

export function usePerson(id: string) {
  return useQuery({ queryKey: ['person', id], queryFn: () => api.person(id), enabled: !!id });
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: api.people });
}

export function useRepos() {
  return useQuery({ queryKey: ['repos'], queryFn: api.repos });
}

export function useRepo(id: string) {
  return useQuery({ queryKey: ['repo', id], queryFn: () => api.repo(id), enabled: !!id });
}

export function useAlerts(teamId?: string) {
  return useQuery({ queryKey: ['alerts', teamId], queryFn: () => api.alerts(teamId) });
}

export function useIntegrationStatus() {
  return useQuery({ queryKey: ['integration-status'], queryFn: api.integrationStatus });
}

export function useAdminSettings(orgId?: string) {
  return useQuery({ queryKey: ['admin-settings', orgId], queryFn: () => api.adminSettings(orgId) });
}
