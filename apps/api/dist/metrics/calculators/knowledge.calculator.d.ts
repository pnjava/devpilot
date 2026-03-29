/**
 * Knowledge capture rate: ratio of completed stories with linked wiki docs (0-1).
 */
export declare function computeKnowledgeCaptureRate(storiesWithLinkedDocs: number, completedStories: number): number;
/**
 * Documentation lag: median days between story completion
 * and the latest linked wiki edit.
 */
export declare function computeDocumentationLag(pairs: Array<{
    resolvedAt: Date;
    latestDocEdit: Date;
}>): number;
//# sourceMappingURL=knowledge.calculator.d.ts.map