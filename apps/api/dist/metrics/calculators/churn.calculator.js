"use strict";
// ──────────────────────────────────────────────────────────────
// Churn Calculator
// Measures requirement changes after work started.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeChurnCount = computeChurnCount;
exports.computeChurnScore = computeChurnScore;
exports.computeClarificationIntensity = computeClarificationIntensity;
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
function getField(e) {
    return e.field ?? e.fieldName ?? '';
}
function getTimestamp(e) {
    return new Date(e.timestamp ?? e.occurredAt);
}
/**
 * Count requirement-relevant changes.
 * When inProgressDate is provided, only counts changes after that date.
 * When omitted, counts all matching churn events.
 */
function computeChurnCount(events, inProgressDate) {
    return events.filter((e) => {
        if (!CHURN_FIELDS.has(getField(e)))
            return false;
        if (inProgressDate) {
            return getTimestamp(e) > inProgressDate;
        }
        return true;
    }).length;
}
/**
 * Weighted churn score (0-100). Late-cycle changes weigh more.
 */
function computeChurnScore(events, inProgressDate, resolvedDate) {
    if (!inProgressDate)
        return 0;
    const churnEvents = events.filter((e) => CHURN_FIELDS.has(getField(e)) && getTimestamp(e) > inProgressDate);
    if (churnEvents.length === 0)
        return 0;
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
function computeClarificationIntensity(commentCount, wikiEditCount, firstCommitDelayHours, churnCount) {
    let score = 0;
    // Comment volume
    if (commentCount > 10)
        score += 30;
    else if (commentCount > 5)
        score += 20;
    else if (commentCount > 2)
        score += 10;
    // Wiki edit activity
    if (wikiEditCount > 3)
        score += 25;
    else if (wikiEditCount > 1)
        score += 15;
    else if (wikiEditCount > 0)
        score += 5;
    // Long delay before first code = discovery work
    if (firstCommitDelayHours != null) {
        if (firstCommitDelayHours > 72)
            score += 30;
        else if (firstCommitDelayHours > 24)
            score += 15;
        else if (firstCommitDelayHours > 8)
            score += 5;
    }
    // Requirement changes
    if (churnCount > 5)
        score += 15;
    else if (churnCount > 2)
        score += 10;
    return Math.min(100, score);
}
//# sourceMappingURL=churn.calculator.js.map