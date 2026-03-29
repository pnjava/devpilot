/**
 * Count requirement-relevant changes.
 * When inProgressDate is provided, only counts changes after that date.
 * When omitted, counts all matching churn events.
 */
export declare function computeChurnCount(events: any[], inProgressDate?: Date | null): number;
/**
 * Weighted churn score (0-100). Late-cycle changes weigh more.
 */
export declare function computeChurnScore(events: any[], inProgressDate: Date | null, resolvedDate?: Date | null): number;
/**
 * Clarification intensity – a heuristic combining comments, wiki edits,
 * and time before first code.
 */
export declare function computeClarificationIntensity(commentCount: number, wikiEditCount: number, firstCommitDelayHours: number | null, churnCount: number): number;
//# sourceMappingURL=churn.calculator.d.ts.map