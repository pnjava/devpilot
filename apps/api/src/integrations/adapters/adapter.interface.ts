// ──────────────────────────────────────────────────────────────
// Integration Adapter Interface
// All source adapters (Jira, Bitbucket, Wiki) implement this.
// ──────────────────────────────────────────────────────────────

export interface SyncOptions {
  fullSync: boolean;
  cursor?: string;        // last sync checkpoint
  since?: Date;           // for incremental sync
  projectKeys?: string[]; // filter to specific projects
  repoSlugs?: string[];   // filter to specific repos
  spaceKeys?: string[];   // filter to specific wiki spaces
}

export interface SyncResult {
  itemsSynced: number;
  errors: string[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface RawJiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  changelog?: { histories: Array<{ items: Array<Record<string, unknown>>; created: string; author?: Record<string, unknown> }> };
}

export interface RawBitbucketPR {
  id: number;
  title: string;
  description?: string;
  author: { display_name: string; uuid: string };
  state: string;
  source: { branch: { name: string } };
  destination: { branch: { name: string } };
  created_on: string;
  updated_on: string;
  merge_commit?: { hash: string };
  closed_on?: string;
  comment_count: number;
  participants: Array<{ user: Record<string, unknown>; role: string; approved: boolean }>;
}

export interface RawBitbucketCommit {
  hash: string;
  message: string;
  author: { raw: string; user?: { display_name: string; uuid: string } };
  date: string;
  parents?: Array<{ hash: string }>;
}

export interface RawWikiPage {
  id: string;
  title: string;
  space?: { key: string };
  version?: { number: number; when: string; by: { displayName: string; accountId?: string } };
  history?: { createdBy: { displayName: string; accountId?: string }; createdDate: string };
  metadata?: { labels?: { results: Array<{ name: string }> } };
  _links?: { webui?: string };
  ancestors?: Array<{ id: string }>;
}

export interface IJiraAdapter {
  testConnection(): Promise<boolean>;
  syncIssues(options: SyncOptions): Promise<SyncResult>;
  syncProjects(): Promise<SyncResult>;
  syncSprints(projectKey: string): Promise<SyncResult>;
}

export interface IBitbucketAdapter {
  testConnection(): Promise<boolean>;
  syncRepositories(options: SyncOptions): Promise<SyncResult>;
  syncCommits(repoSlug: string, options: SyncOptions): Promise<SyncResult>;
  syncPullRequests(repoSlug: string, options: SyncOptions): Promise<SyncResult>;
  syncBranches(repoSlug: string): Promise<SyncResult>;
}

export interface IWikiAdapter {
  testConnection(): Promise<boolean>;
  syncPages(options: SyncOptions): Promise<SyncResult>;
  syncEdits(pageId: string): Promise<SyncResult>;
}

// Token used for dependency injection
export const JIRA_ADAPTER = 'JIRA_ADAPTER';
export const BITBUCKET_ADAPTER = 'BITBUCKET_ADAPTER';
export const WIKI_ADAPTER = 'WIKI_ADAPTER';
