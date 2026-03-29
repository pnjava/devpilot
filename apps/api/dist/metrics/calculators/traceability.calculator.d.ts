export interface TraceabilityCounts {
    totalCommits: number;
    linkedCommits: number;
    totalPRs: number;
    linkedPRs: number;
    totalBranches: number;
    linkedBranches: number;
    totalWikiPages: number;
    linkedWikiPages: number;
}
interface IssueWithLinks {
    id: string;
    links: Array<{
        artifactType: string;
    }>;
}
interface CountsResult {
    commitTraceabilityPct: number;
    prTraceabilityPct: number;
    branchTraceabilityPct: number;
    wikiTraceabilityPct: number;
    unlinkedWorkRatio: number;
}
interface IssuesResult {
    commitLinkedRatio: number;
    branchLinkedRatio: number;
    prLinkedRatio: number;
    unlinkedRatio: number;
    overallLinkedRatio: number;
}
/**
 * Compute traceability coverage.
 * Accepts either a TraceabilityCounts object or an array of issues with links.
 */
export declare function computeTraceabilityCoverage(input: TraceabilityCounts): CountsResult;
export declare function computeTraceabilityCoverage(input: IssueWithLinks[]): IssuesResult;
export {};
//# sourceMappingURL=traceability.calculator.d.ts.map