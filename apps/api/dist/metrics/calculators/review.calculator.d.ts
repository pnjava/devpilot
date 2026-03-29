export interface PRMetricsInput {
    id?: string;
    authorId?: string | null;
    createdAt: Date;
    mergedAt?: Date | null;
    reviews?: Array<{
        reviewerId?: string;
        createdAt?: Date;
        submittedAt?: Date;
        state?: string;
    }>;
    commitsAfterFirstReview?: number;
    totalCommits?: number;
    comments?: Array<{
        createdAt: Date;
        resolvedAt: Date | null;
    }>;
}
/**
 * First review delay: PR created -> first review (hours)
 * Accepts either (pr) where pr.reviews is populated, or (pr, reviews) separately.
 */
export declare function computeFirstReviewDelay(pr: PRMetricsInput, reviews?: Array<{
    submittedAt?: Date;
    createdAt?: Date;
    reviewerId?: string;
}>): number | null;
/**
 * Merge time: PR created -> merged (hours)
 */
export declare function computeMergeTime(createdAt: Date, mergedAt: Date | null): number | null;
/**
 * PR review coverage: ratio of PRs with at least one review (0-1).
 */
export declare function computeReviewCoverage(prs: any[]): number;
/**
 * PR rework rate: ratio of PRs with rework (changes_requested) (0-1).
 */
export declare function computeReworkRate(prs: any[]): number;
/**
 * Median PR comment resolution time (hours)
 */
export declare function computeMedianCommentResolutionTime(prs: PRMetricsInput[]): number;
//# sourceMappingURL=review.calculator.d.ts.map