"use strict";
// ──────────────────────────────────────────────────────────────
// Knowledge Calculator
// Documentation capture, lag, and cross-team contribution.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeKnowledgeCaptureRate = computeKnowledgeCaptureRate;
exports.computeDocumentationLag = computeDocumentationLag;
/**
 * Knowledge capture rate: ratio of completed stories with linked wiki docs (0-1).
 */
function computeKnowledgeCaptureRate(storiesWithLinkedDocs, completedStories) {
    if (completedStories <= 0)
        return 0;
    return storiesWithLinkedDocs / completedStories;
}
/**
 * Documentation lag: median days between story completion
 * and the latest linked wiki edit.
 */
function computeDocumentationLag(pairs) {
    if (pairs.length === 0)
        return 0;
    const lags = pairs.map((p) => {
        const diff = p.latestDocEdit.getTime() - p.resolvedAt.getTime();
        return diff / (1000 * 60 * 60 * 24); // days
    });
    lags.sort((a, b) => a - b);
    const mid = Math.floor(lags.length / 2);
    return lags.length % 2 === 0
        ? Math.round((lags[mid - 1] + lags[mid]) / 2)
        : Math.round(lags[mid]);
}
//# sourceMappingURL=knowledge.calculator.js.map