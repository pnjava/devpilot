// ──────────────────────────────────────────────────────────────
// GroomPilot Jira service – thin wrapper over @devpilot/jira.
// Re-exports types so existing callers don't break.
// ──────────────────────────────────────────────────────────────

import { JiraClient } from '@devpilot/jira';
import type { JiraIssue, JiraLinkedPullRequest } from '@devpilot/jira';

export type { JiraIssue, JiraLinkedPullRequest };

/**
 * Extract plain text from a Jira description field.
 * API v3 returns Atlassian Document Format (ADF) objects; v2 returns strings.
 */
export function descriptionToString(desc: string | Record<string, unknown> | null | undefined): string {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  // ADF – extract text nodes recursively
  return extractAdfText(desc);
}

function extractAdfText(node: Record<string, unknown>): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  const content = node.content as Record<string, unknown>[] | undefined;
  if (Array.isArray(content)) return content.map(extractAdfText).join('');
  return '';
}

/**
 * Extract plain text from a Jira comment body (string or ADF).
 */
export function commentBodyToString(body: string | Record<string, unknown>): string {
  if (typeof body === 'string') return body;
  return extractAdfText(body);
}

// Lazy singleton – created on first call so dotenv has time to load
let _client: JiraClient | null = null;
function client(): JiraClient {
  if (!_client) _client = JiraClient.fromEnv();
  return _client;
}

export async function getEpics(): Promise<JiraIssue[]> {
  return client().getEpics();
}

export async function getStories(epicKey?: string): Promise<JiraIssue[]> {
  return client().getStories({ epicKey });
}

export async function searchStories(query: string): Promise<JiraIssue[]> {
  return client().searchStoriesByText(query);
}

export async function getIssueDetail(issueKey: string): Promise<JiraIssue> {
  return client().getIssue(
    issueKey,
    'summary,description,status,issuetype,priority,assignee,labels,comment,subtasks',
  );
}

export async function getLinkedPullRequests(issueKey: string): Promise<JiraLinkedPullRequest[]> {
  return client().getLinkedPullRequests(issueKey);
}
