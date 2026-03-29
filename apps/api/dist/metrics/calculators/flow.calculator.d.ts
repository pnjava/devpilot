interface StatusTransition {
    fromState: string | null;
    toState: string;
    timestamp: Date;
    oldValue?: string | null;
    newValue?: string;
}
/**
 * Extract status transitions from issue events, optionally mapping through canonical states.
 */
export declare function extractStatusTransitions(events: any[], statusMap?: Map<string, string>): StatusTransition[];
/**
 * Find the first time a story entered a given canonical state.
 */
export declare function findFirstTransitionTo(transitions: StatusTransition[], state: string): Date | null;
/**
 * Find the last time a story entered a given canonical state.
 */
export declare function findLastTransitionTo(transitions: StatusTransition[], state: string): Date | null;
/**
 * Lead time: created -> DONE (hours)
 * Accepts either (createdAt, doneDate) or ({ createdAt, resolvedAt }).
 */
export declare function computeLeadTime(createdAtOrIssue: Date | {
    createdAt: Date;
    resolvedAt?: Date | null;
}, doneDate?: Date | null): number | null;
/**
 * Cycle time: first IN_PROGRESS -> DONE (hours)
 * Accepts either (inProgressDate, doneDate) or an array of events.
 */
export declare function computeCycleTime(inProgressOrEvents: Date | null | any[], doneDate?: Date | null): number | null;
/**
 * Calculate total time spent in BLOCKED state(s) (hours).
 * Accepts either StatusTransition[] or raw events[].
 */
export declare function computeBlockedTime(transitionsOrEvents: any[]): number;
/**
 * Blocked ratio = blocked time / cycle time
 */
export declare function computeBlockedRatio(blockedHours: number, cycleTimeHours: number | null): number;
/**
 * First commit delay: IN_PROGRESS -> first linked commit (hours)
 */
export declare function computeFirstCommitDelay(inProgressDate: Date | null, firstCommitDate: Date | null): number | null;
/**
 * Compute percentiles from a sorted array of values.
 */
export declare function percentile(sortedValues: number[], p: number): number;
export declare function median(values: number[]): number;
/**
 * Count reopens: DONE -> anything active.
 */
export declare function countReopens(transitions: StatusTransition[]): number;
export {};
//# sourceMappingURL=flow.calculator.d.ts.map