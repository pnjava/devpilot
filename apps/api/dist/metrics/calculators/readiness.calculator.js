"use strict";
// ──────────────────────────────────────────────────────────────
// Readiness Calculator
// Computes Story Readiness Score (0-100) from field presence.
// ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeReadinessFactors = computeReadinessFactors;
exports.computeReadinessScore = computeReadinessScore;
const shared_1 = require("@devpilot/shared");
function computeReadinessFactors(input) {
    const cf = (input.customFields ?? {});
    const labels = Array.isArray(input.labels) ? input.labels : [];
    const titleStr = input.title ?? input.summary;
    return {
        hasTitle: Boolean(titleStr && titleStr.trim().length > 3),
        hasDescription: input.hasDescription !== undefined
            ? Boolean(input.hasDescription)
            : Boolean(input.description && input.description.trim().length > 20),
        hasAcceptanceCriteria: input.hasAcceptanceCriteria !== undefined
            ? Boolean(input.hasAcceptanceCriteria)
            : Boolean(input.acceptanceCriteria && input.acceptanceCriteria.trim().length > 10),
        hasEstimate: input.hasEstimate !== undefined
            ? Boolean(input.hasEstimate)
            : (input.storyPoints != null && input.storyPoints > 0),
        hasAssignee: Boolean(input.assigneeId),
        hasEpicLink: Boolean(input.epicKey || input.parentKey),
        hasPriority: Boolean(input.priority && input.priority !== 'NONE'),
        hasDesignDoc: input.hasDesignDoc !== undefined
            ? Boolean(input.hasDesignDoc)
            : Boolean(cf['designDoc'] || cf['designReference'] || labels.some((l) => l.toLowerCase().includes('design'))),
        hasDefinitionOfDone: input.hasDefinitionOfDone !== undefined
            ? Boolean(input.hasDefinitionOfDone)
            : Boolean(cf['definitionOfDone'] || cf['testNotes'] || input.acceptanceCriteria),
        hasDependenciesMapped: input.hasDependencies !== undefined
            ? Boolean(input.hasDependencies)
            : Boolean(cf['dependencies'] || cf['blockedBy'] || labels.some((l) => l.toLowerCase().includes('dependency'))),
    };
}
function computeReadinessScore(factors, weights = shared_1.DEFAULT_READINESS_WEIGHTS) {
    const maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
        if (factors[key]) {
            score += weight;
        }
    }
    return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}
//# sourceMappingURL=readiness.calculator.js.map