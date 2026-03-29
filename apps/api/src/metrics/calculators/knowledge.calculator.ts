// ──────────────────────────────────────────────────────────────
// Knowledge Calculator
// Documentation capture, lag, and cross-team contribution.
// ──────────────────────────────────────────────────────────────

/**
 * Knowledge capture rate: ratio of completed stories with linked wiki docs (0-1).
 */
export function computeKnowledgeCaptureRate(
  storiesWithLinkedDocs: number,
  completedStories: number,
): number {
  if (completedStories <= 0) return 0;
  return storiesWithLinkedDocs / completedStories;
}

/**
 * Documentation lag: median days between story completion
 * and the latest linked wiki edit.
 */
export function computeDocumentationLag(
  pairs: Array<{ resolvedAt: Date; latestDocEdit: Date }>,
): number {
  if (pairs.length === 0) return 0;

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
