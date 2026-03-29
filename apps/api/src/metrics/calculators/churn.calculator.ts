// ──────────────────────────────────────────────────────────────
// Churn Calculator
// Measures requirement changes after work started.
// ──────────────────────────────────────────────────────────────

import type { IssueEvent } from '@prisma/client';

const CHURN_FIELDS = new Set([
  'summary',
  'description',
  'acceptance criteria',
  'acceptance_criteria',
  'Story Points',
  'story_points',
  'labels',
  'Fix Version',
  'Component',
  'Link', // issue links
]);

/** Normalize event field name from either Prisma or test-style events. */
function getField(e: any): string {
  return e.field ?? e.fieldName ?? '';
}

function getTimestamp(e: any): Date {
  return new Date(e.timestamp ?? e.occurredAt);
}

/**
 * Count requirement-relevant changes.
 * When inProgressDate is provided, only counts changes after that date.
 * When omitted, counts all matching churn events.
 */
export function computeChurnCount(events: any[], inProgressDate?: Date | null): number {
  return events.filter((e) => {
    if (!CHURN_FIELDS.has(getField(e))) return false;
    if (inProgressDate) {
      return getTimestamp(e) > inProgressDate;
    }
    return true;
  }).length;
}

/**
 * Weighted churn score (0-100). Late-cycle changes weigh more.
 */
export function computeChurnScore(
  events: any[],
  inProgressDate: Date | null,
  resolvedDate?: Date | null,
): number {
  if (!inProgressDate) return 0;

  const churnEvents = events.filter(
    (e) => CHURN_FIELDS.has(getField(e)) && getTimestamp(e) > inProgressDate,
  );

  if (churnEvents.length === 0) return 0;

  const totalCycleDuration = resolvedDate
    ? resolvedDate.getTime() - inProgressDate.getTime()
    : Date.now() - inProgressDate.getTime();

  let weightedScore = 0;

  for (const evt of churnEvents) {
    const elapsed = getTimestamp(evt).getTime() - inProgressDate.getTime();
    const progressPct = totalCycleDuration > 0 ? elapsed / totalCycleDuration : 0.5;

    // Late changes scored higher: base 10 + up to 15 extra for lateness
    const weight = 10 + progressPct * 15;
    weightedScore += weight;
  }

  // Normalize to 0-100 (cap at 100)
  return Math.min(100, Math.round(weightedScore));
}

/**
 * Clarification intensity – a heuristic combining comments, wiki edits,
 * and time before first code.
 */
export function computeClarificationIntensity(
  commentCount: number,
  wikiEditCount: number,
  firstCommitDelayHours: number | null,
  churnCount: number,
): number {
  let score = 0;

  // Comment volume
  if (commentCount > 10) score += 30;
  else if (commentCount > 5) score += 20;
  else if (commentCount > 2) score += 10;

  // Wiki edit activity
  if (wikiEditCount > 3) score += 25;
  else if (wikiEditCount > 1) score += 15;
  else if (wikiEditCount > 0) score += 5;

  // Long delay before first code = discovery work
  if (firstCommitDelayHours != null) {
    if (firstCommitDelayHours > 72) score += 30;
    else if (firstCommitDelayHours > 24) score += 15;
    else if (firstCommitDelayHours > 8) score += 5;
  }

  // Requirement changes
  if (churnCount > 5) score += 15;
  else if (churnCount > 2) score += 10;

  return Math.min(100, score);
}
