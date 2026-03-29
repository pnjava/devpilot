"use strict";
// ──────────────────────────────────────────────────────────────
// Review / Execution Calculator
// PR review health, rework rate, participation.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFirstReviewDelay = computeFirstReviewDelay;
exports.computeMergeTime = computeMergeTime;
exports.computeReviewCoverage = computeReviewCoverage;
exports.computeReworkRate = computeReworkRate;
exports.computeMedianCommentResolutionTime = computeMedianCommentResolutionTime;
/**
 * First review delay: PR created -> first review (hours)
 * Accepts either (pr) where pr.reviews is populated, or (pr, reviews) separately.
 */
function computeFirstReviewDelay(pr, reviews) {
    const revs = reviews ?? pr.reviews ?? [];
    if (revs.length === 0)
        return null;
    const sorted = [...revs]
        .filter((r) => {
        // If reviewer info available, exclude self-reviews
        if (pr.authorId && r.reviewerId)
            return r.reviewerId !== pr.authorId;
        return true;
    })
        .sort((a, b) => {
        const aTime = (a.submittedAt ?? a.createdAt ?? new Date(0)).getTime();
        const bTime = (b.submittedAt ?? b.createdAt ?? new Date(0)).getTime();
        return aTime - bTime;
    });
    if (sorted.length === 0)
        return null;
    const firstReviewTime = (sorted[0].submittedAt ?? sorted[0].createdAt ?? new Date(0)).getTime();
    return (firstReviewTime - pr.createdAt.getTime()) / (1000 * 60 * 60);
}
/**
 * Merge time: PR created -> merged (hours)
 */
function computeMergeTime(createdAt, mergedAt) {
    if (!mergedAt)
        return null;
    return (mergedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
}
/**
 * PR review coverage: ratio of PRs with at least one review (0-1).
 */
function computeReviewCoverage(prs) {
    if (prs.length === 0)
        return 1;
    const reviewed = prs.filter((pr) => {
        const reviews = pr.reviews ?? [];
        return reviews.length > 0;
    });
    return reviewed.length / prs.length;
}
/**
 * PR rework rate: ratio of PRs with rework (changes_requested) (0-1).
 */
function computeReworkRate(prs) {
    if (prs.length === 0)
        return 0;
    const reworked = prs.filter((pr) => {
        const reviews = pr.reviews ?? [];
        // Check for commits after first review or CHANGES_REQUESTED state
        if (pr.commitsAfterFirstReview > 0)
            return true;
        return reviews.some((r) => r.state === 'CHANGES_REQUESTED');
    });
    return reworked.length / prs.length;
}
/**
 * Median PR comment resolution time (hours)
 */
function computeMedianCommentResolutionTime(prs) {
    const durations = [];
    for (const pr of prs) {
        for (const c of (pr.comments ?? [])) {
            if (c.resolvedAt) {
                const hours = (c.resolvedAt.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60);
                durations.push(hours);
            }
        }
    }
    if (durations.length === 0)
        return 0;
    durations.sort((a, b) => a - b);
    const mid = Math.floor(durations.length / 2);
    return durations.length % 2 === 0
        ? (durations[mid - 1] + durations[mid]) / 2
        : durations[mid];
}
//# sourceMappingURL=review.calculator.js.map