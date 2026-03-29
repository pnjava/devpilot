export declare function computeReopenRate(reopenedCount: number, completedCount: number): number;
export declare function computeEscapedBugRate(escapedBugs: number, completedStories: number): number;
export declare function computeBugPerStoryRatio(linkedBugs: number, completedStories: number): number;
/**
 * Quality Risk Trend: rule-based score combining multiple signals.
 * Higher = more risk.
 */
export declare function computeQualityRiskScore(inputs: {
    reopenRate: number;
    escapedBugRate: number;
    churnScore: number;
    reworkRate: number;
}): number;
//# sourceMappingURL=quality.calculator.d.ts.map