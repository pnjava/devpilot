"use strict";
// ──────────────────────────────────────────────────────────────
// Narrative Insight Service
// Generates deterministic, evidence-backed explanations.
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsightsService = void 0;
const common_1 = require("@nestjs/common");
const TEAM_INSIGHT_RULES = [
    {
        check: (m) => m.blockedRatio > 0.3 && m.averageChurnScore > 40,
        template: '{teamName} is slowed more by blocker time ({blockedRatio}% of cycle) and requirement churn (avg score {churnScore}) than by coding throughput ({throughput} items completed).',
        severity: 'WARNING',
        metrics: (m) => ({
            blockedRatio: Math.round(m.blockedRatio * 100),
            churnScore: m.averageChurnScore,
            throughput: m.throughput,
        }),
    },
    {
        check: (m) => m.escapedBugRate > 15,
        template: '{teamName} has a high escaped bug rate ({escapedBugRate}%) relative to delivery volume, indicating quality issues reaching production.',
        severity: 'CRITICAL',
        metrics: (m) => ({ escapedBugRate: m.escapedBugRate }),
    },
    {
        check: (m) => m.readyAtStartPct < 50,
        template: 'Only {readyPct}% of stories in {teamName} were ready when work started. This correlates with higher rework and review delays.',
        severity: 'WARNING',
        metrics: (m) => ({ readyPct: m.readyAtStartPct }),
    },
    {
        check: (m) => m.knowledgeCaptureRate < 30,
        template: '{teamName} has low knowledge capture ({captureRate}%). Many completed stories lack linked documentation, increasing handoff risk.',
        severity: 'INFO',
        metrics: (m) => ({ captureRate: m.knowledgeCaptureRate }),
    },
    {
        check: (m) => m.wipLoad > 15,
        template: '{teamName} has {wipLoad} items in progress simultaneously, which may indicate context-switching overhead.',
        severity: 'WARNING',
        metrics: (m) => ({ wipLoad: m.wipLoad }),
    },
    {
        check: (m) => m.commitTraceabilityPct < 60,
        template: '{teamName} has {tracePct}% commit traceability — a significant portion of engineering work cannot be tied to specific stories.',
        severity: 'WARNING',
        metrics: (m) => ({ tracePct: m.commitTraceabilityPct }),
    },
    {
        check: (m) => m.reopenRate > 20,
        template: '{teamName} has a {reopenRate}% reopen rate, suggesting stories are being marked done prematurely or acceptance criteria are unclear.',
        severity: 'WARNING',
        metrics: (m) => ({ reopenRate: m.reopenRate }),
    },
];
let InsightsService = class InsightsService {
    generateTeamInsights(metrics) {
        const insights = [];
        for (const rule of TEAM_INSIGHT_RULES) {
            if (rule.check(metrics)) {
                const metricValues = rule.metrics(metrics);
                let text = rule.template.replace('{teamName}', metrics.teamName);
                for (const [key, val] of Object.entries(metricValues)) {
                    text = text.replace(`{${key}}`, String(val));
                }
                insights.push({
                    id: `insight-${metrics.teamId}-${insights.length}`,
                    scope: 'TEAM',
                    scopeId: metrics.teamId,
                    template: rule.template,
                    renderedText: text,
                    supportingMetrics: metricValues,
                    severity: rule.severity,
                    createdAt: new Date().toISOString(),
                });
            }
        }
        return insights;
    }
    generateStoryInsight(metrics) {
        const insights = [];
        if (metrics.readinessScore < 40 && metrics.churnScore > 30) {
            insights.push({
                id: `insight-${metrics.issueKey}-readiness-churn`,
                scope: 'STORY',
                scopeId: metrics.issueKey,
                template: 'This story started with low readiness and experienced significant requirement churn.',
                renderedText: `${metrics.issueKey} started with a readiness score of ${metrics.readinessScore}/100 and accumulated a churn score of ${metrics.churnScore}. This suggests requirements were unclear when development began.`,
                supportingMetrics: {
                    readinessScore: metrics.readinessScore,
                    churnScore: metrics.churnScore,
                },
                severity: 'WARNING',
                createdAt: new Date().toISOString(),
            });
        }
        if (metrics.blockedTimeHours > 24 && metrics.blockedRatio > 0.3) {
            insights.push({
                id: `insight-${metrics.issueKey}-blocked`,
                scope: 'STORY',
                scopeId: metrics.issueKey,
                template: 'This story spent a significant portion of its cycle time blocked.',
                renderedText: `${metrics.issueKey} was blocked for ${Math.round(metrics.blockedTimeHours)} hours (${Math.round(metrics.blockedRatio * 100)}% of cycle time). This is a process bottleneck, not a developer performance issue.`,
                supportingMetrics: {
                    blockedHours: metrics.blockedTimeHours,
                    blockedRatio: metrics.blockedRatio,
                },
                severity: 'WARNING',
                createdAt: new Date().toISOString(),
            });
        }
        if (metrics.clarificationIntensity > 50 &&
            metrics.firstCommitDelayHours != null &&
            metrics.firstCommitDelayHours > 24) {
            insights.push({
                id: `insight-${metrics.issueKey}-discovery`,
                scope: 'STORY',
                scopeId: metrics.issueKey,
                template: 'Significant discovery effort was required before coding could begin.',
                renderedText: `${metrics.issueKey} had ${Math.round(metrics.firstCommitDelayHours)} hours before the first commit with high clarification intensity (${metrics.clarificationIntensity}/100). This hidden effort contributed to overall cycle time.`,
                supportingMetrics: {
                    firstCommitDelayHours: metrics.firstCommitDelayHours,
                    clarificationIntensity: metrics.clarificationIntensity,
                },
                severity: 'INFO',
                createdAt: new Date().toISOString(),
            });
        }
        return insights;
    }
};
exports.InsightsService = InsightsService;
exports.InsightsService = InsightsService = __decorate([
    (0, common_1.Injectable)()
], InsightsService);
//# sourceMappingURL=insights.service.js.map