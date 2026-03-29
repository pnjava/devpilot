"use strict";
// ──────────────────────────────────────────────────────────────
// Quality Calculator
// Reopen rate, escaped bugs, bug-per-story ratio.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeReopenRate = computeReopenRate;
exports.computeEscapedBugRate = computeEscapedBugRate;
exports.computeBugPerStoryRatio = computeBugPerStoryRatio;
exports.computeQualityRiskScore = computeQualityRiskScore;
function computeReopenRate(reopenedCount, completedCount) {
    if (completedCount <= 0)
        return 0;
    return reopenedCount / completedCount;
}
function computeEscapedBugRate(escapedBugs, completedStories) {
    if (completedStories <= 0)
        return 0;
    return escapedBugs / completedStories;
}
function computeBugPerStoryRatio(linkedBugs, completedStories) {
    if (completedStories <= 0)
        return 0;
    return linkedBugs / completedStories;
}
/**
 * Quality Risk Trend: rule-based score combining multiple signals.
 * Higher = more risk.
 */
function computeQualityRiskScore(inputs) {
    // Each factor contributes 0-25 points
    const reopenContrib = Math.min(25, inputs.reopenRate);
    const bugContrib = Math.min(25, inputs.escapedBugRate * 2);
    const churnContrib = Math.min(25, inputs.churnScore / 4);
    const reworkContrib = Math.min(25, inputs.reworkRate / 4);
    return Math.round(reopenContrib + bugContrib + churnContrib + reworkContrib);
}
//# sourceMappingURL=quality.calculator.js.map