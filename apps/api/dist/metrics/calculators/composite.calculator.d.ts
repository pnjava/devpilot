/**
 * Generic weighted composite scorer.
 * Each input value is already 0-100 (or normalized to that range).
 * Returns { score, breakdown }.
 * invertKeys can be a Set or an Array of keys where lower raw value = better.
 */
export declare function weightedComposite(values: Record<string, number>, weights: Record<string, number>, invertKeys?: Set<string> | string[]): {
    score: number;
    breakdown: Record<string, number>;
};
export declare function computeDeliveryHealthIndex(inputs: Record<string, number>, weights?: Record<string, number>): {
    score: number;
    breakdown: Record<string, number>;
};
export declare function computeStoryFrictionScore(inputs: Record<string, number>, weights?: Record<string, number>): {
    score: number;
    breakdown: Record<string, number>;
};
export declare function computeTeamRiskScore(inputs: Record<string, number>, weights?: Record<string, number>): {
    score: number;
    breakdown: Record<string, number>;
};
//# sourceMappingURL=composite.calculator.d.ts.map