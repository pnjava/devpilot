// ──────────────────────────────────────────────────────────────
// Traceability Calculator
// Measures how well engineering work maps to stories.
// ──────────────────────────────────────────────────────────────

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
  links: Array<{ artifactType: string }>;
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
export function computeTraceabilityCoverage(input: TraceabilityCounts): CountsResult;
export function computeTraceabilityCoverage(input: IssueWithLinks[]): IssuesResult;
export function computeTraceabilityCoverage(input: TraceabilityCounts | IssueWithLinks[]): CountsResult | IssuesResult {
  if (Array.isArray(input)) {
    return computeFromIssues(input);
  }
  return computeFromCounts(input);
}

function computeFromIssues(issues: IssueWithLinks[]) {
  const total = issues.length;
  if (total === 0) {
    return {
      commitLinkedRatio: 0,
      branchLinkedRatio: 0,
      prLinkedRatio: 0,
      unlinkedRatio: 0,
      overallLinkedRatio: 0,
    };
  }

  const hasType = (issue: IssueWithLinks, type: string) =>
    issue.links.some((l) => l.artifactType === type);

  const commitLinked = issues.filter((i) => hasType(i, 'COMMIT')).length;
  const branchLinked = issues.filter((i) => hasType(i, 'BRANCH')).length;
  const prLinked = issues.filter((i) => hasType(i, 'PULL_REQUEST')).length;
  const anyLinked = issues.filter((i) => i.links.length > 0).length;

  return {
    commitLinkedRatio: commitLinked / total,
    branchLinkedRatio: branchLinked / total,
    prLinkedRatio: prLinked / total,
    unlinkedRatio: (total - anyLinked) / total,
    overallLinkedRatio: anyLinked / total,
  };
}

function computeFromCounts(counts: TraceabilityCounts) {
  const pct = (linked: number, total: number) =>
    total > 0 ? Math.round((linked / total) * 100) : 100;

  const commitPct = pct(counts.linkedCommits, counts.totalCommits);
  const prPct = pct(counts.linkedPRs, counts.totalPRs);
  const branchPct = pct(counts.linkedBranches, counts.totalBranches);
  const wikiPct = pct(counts.linkedWikiPages, counts.totalWikiPages);

  const totalArts = counts.totalCommits + counts.totalPRs + counts.totalBranches + counts.totalWikiPages;
  const linkedArts = counts.linkedCommits + counts.linkedPRs + counts.linkedBranches + counts.linkedWikiPages;
  const unlinkedRatio = totalArts > 0 ? Math.round(((totalArts - linkedArts) / totalArts) * 100) : 0;

  return {
    commitTraceabilityPct: commitPct,
    prTraceabilityPct: prPct,
    branchTraceabilityPct: branchPct,
    wikiTraceabilityPct: wikiPct,
    unlinkedWorkRatio: unlinkedRatio,
  };
}
