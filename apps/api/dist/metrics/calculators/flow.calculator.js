"use strict";
// ──────────────────────────────────────────────────────────────
// Flow Calculator
// Computes lead time, cycle time, blocked time, etc.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractStatusTransitions = extractStatusTransitions;
exports.findFirstTransitionTo = findFirstTransitionTo;
exports.findLastTransitionTo = findLastTransitionTo;
exports.computeLeadTime = computeLeadTime;
exports.computeCycleTime = computeCycleTime;
exports.computeBlockedTime = computeBlockedTime;
exports.computeBlockedRatio = computeBlockedRatio;
exports.computeFirstCommitDelay = computeFirstCommitDelay;
exports.percentile = percentile;
exports.median = median;
exports.countReopens = countReopens;
const shared_1 = require("@devpilot/shared");
/** Normalize event property access for both Prisma and test-style events. */
function getField(e) {
    return e.field ?? e.fieldName ?? '';
}
function getFromValue(e) {
    return e.fromValue ?? e.oldValue ?? null;
}
function getToValue(e) {
    return e.toValue ?? e.newValue ?? null;
}
function getTimestamp(e) {
    return new Date(e.timestamp ?? e.occurredAt);
}
/**
 * Extract status transitions from issue events, optionally mapping through canonical states.
 */
function extractStatusTransitions(events, statusMap) {
    return events
        .filter((e) => getField(e) === 'status')
        .sort((a, b) => getTimestamp(a).getTime() - getTimestamp(b).getTime())
        .map((e) => {
        const from = getFromValue(e);
        const to = getToValue(e) ?? '';
        const mappedFrom = from ? (statusMap?.get(from) ?? from) : null;
        const mappedTo = statusMap?.get(to) ?? to;
        return {
            fromState: mappedFrom,
            toState: mappedTo,
            timestamp: getTimestamp(e),
            oldValue: mappedFrom,
            newValue: mappedTo,
        };
    });
}
/**
 * Find the first time a story entered a given canonical state.
 */
function findFirstTransitionTo(transitions, state) {
    const t = transitions.find((t) => t.toState === state);
    return t?.timestamp ?? null;
}
/**
 * Find the last time a story entered a given canonical state.
 */
function findLastTransitionTo(transitions, state) {
    const matching = transitions.filter((t) => t.toState === state);
    return matching.length > 0 ? matching[matching.length - 1].timestamp : null;
}
/**
 * Lead time: created -> DONE (hours)
 * Accepts either (createdAt, doneDate) or ({ createdAt, resolvedAt }).
 */
function computeLeadTime(createdAtOrIssue, doneDate) {
    let created;
    let done;
    if (createdAtOrIssue instanceof Date) {
        created = createdAtOrIssue;
        done = doneDate;
    }
    else {
        created = createdAtOrIssue.createdAt;
        done = createdAtOrIssue.resolvedAt;
    }
    if (!done)
        return null;
    return (done.getTime() - created.getTime()) / (1000 * 60 * 60);
}
/**
 * Cycle time: first IN_PROGRESS -> DONE (hours)
 * Accepts either (inProgressDate, doneDate) or an array of events.
 */
function computeCycleTime(inProgressOrEvents, doneDate) {
    if (Array.isArray(inProgressOrEvents)) {
        const transitions = extractStatusTransitions(inProgressOrEvents);
        const ipDate = findFirstTransitionTo(transitions, 'IN_PROGRESS');
        const dDate = findLastTransitionTo(transitions, 'DONE');
        if (!ipDate || !dDate)
            return null;
        return (dDate.getTime() - ipDate.getTime()) / (1000 * 60 * 60);
    }
    if (!inProgressOrEvents || !doneDate)
        return null;
    return (doneDate.getTime() - inProgressOrEvents.getTime()) / (1000 * 60 * 60);
}
/**
 * Calculate total time spent in BLOCKED state(s) (hours).
 * Accepts either StatusTransition[] or raw events[].
 */
function computeBlockedTime(transitionsOrEvents) {
    // If these look like raw events (have fieldName or field property), convert first
    let transitions;
    if (transitionsOrEvents.length > 0 && (transitionsOrEvents[0].fieldName || transitionsOrEvents[0].field)) {
        transitions = extractStatusTransitions(transitionsOrEvents);
    }
    else {
        transitions = transitionsOrEvents;
    }
    let total = 0;
    let blockedSince = null;
    for (const t of transitions) {
        const state = t.toState;
        if (state === shared_1.CanonicalState.BLOCKED || state === 'BLOCKED') {
            blockedSince = t.timestamp;
        }
        else if (blockedSince) {
            total += t.timestamp.getTime() - blockedSince.getTime();
            blockedSince = null;
        }
    }
    // If still blocked
    if (blockedSince) {
        total += Date.now() - blockedSince.getTime();
    }
    return total / (1000 * 60 * 60);
}
/**
 * Blocked ratio = blocked time / cycle time
 */
function computeBlockedRatio(blockedHours, cycleTimeHours) {
    if (!cycleTimeHours || cycleTimeHours <= 0)
        return 0;
    return Math.min(1, blockedHours / cycleTimeHours);
}
/**
 * First commit delay: IN_PROGRESS -> first linked commit (hours)
 */
function computeFirstCommitDelay(inProgressDate, firstCommitDate) {
    if (!inProgressDate || !firstCommitDate)
        return null;
    const delay = (firstCommitDate.getTime() - inProgressDate.getTime()) / (1000 * 60 * 60);
    return Math.max(0, delay);
}
/**
 * Compute percentiles from a sorted array of values.
 */
function percentile(sortedValues, p) {
    if (sortedValues.length === 0)
        return 0;
    const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, idx)];
}
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return percentile(sorted, 50);
}
/**
 * Count reopens: DONE -> anything active.
 */
function countReopens(transitions) {
    let reopens = 0;
    for (let i = 1; i < transitions.length; i++) {
        if (transitions[i - 1].toState === shared_1.CanonicalState.DONE &&
            transitions[i].toState !== shared_1.CanonicalState.DONE) {
            reopens++;
        }
    }
    return reopens;
}
//# sourceMappingURL=flow.calculator.js.map