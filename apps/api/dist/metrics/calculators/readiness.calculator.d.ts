import type { ReadinessFactors } from '@devpilot/shared';
export interface ReadinessInput {
    title?: string | null;
    summary?: string | null;
    description?: string | null;
    hasDescription?: boolean;
    acceptanceCriteria?: string | null;
    hasAcceptanceCriteria?: boolean;
    storyPoints?: number | null;
    hasEstimate?: boolean;
    assigneeId?: string | null;
    epicKey?: string | null;
    parentKey?: string | null;
    priority?: string | null;
    labels?: unknown;
    customFields?: unknown;
    hasDesignDoc?: boolean;
    hasDefinitionOfDone?: boolean;
    hasDependencies?: boolean;
}
export declare function computeReadinessFactors(input: ReadinessInput): ReadinessFactors;
export declare function computeReadinessScore(factors: ReadinessFactors, weights?: Record<string, number>): number;
//# sourceMappingURL=readiness.calculator.d.ts.map