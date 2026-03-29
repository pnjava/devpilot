// ──────────────────────────────────────────────────────────────
// Quality Calculator
// Reopen rate, escaped bugs, bug-per-story ratio.
// ──────────────────────────────────────────────────────────────

export function computeReopenRate(
  reopenedCount: number,
  completedCount: number,
): number {
  if (completedCount <= 0) return 0;
  return reopenedCount / completedCount;
}

export function computeEscapedBugRate(
  escapedBugs: number,
  completedStories: number,
): number {
  if (completedStories <= 0) return 0;
  return escapedBugs / completedStories;
}

export function computeBugPerStoryRatio(
  linkedBugs: number,
  completedStories: number,
): number {
  if (completedStories <= 0) return 0;
  return linkedBugs / completedStories;
}

/**
 * Quality Risk Trend: rule-based score combining multiple signals.
 * Higher = more risk.
 */
export function computeQualityRiskScore(inputs: {
  reopenRate: number;
  escapedBugRate: number;
  churnScore: number;
  reworkRate: number;
}): number {
  // Each factor contributes 0-25 points
  const reopenContrib = Math.min(25, inputs.reopenRate);
  const bugContrib = Math.min(25, inputs.escapedBugRate * 2);
  const churnContrib = Math.min(25, inputs.churnScore / 4);
  const reworkContrib = Math.min(25, inputs.reworkRate / 4);

  return Math.round(reopenContrib + bugContrib + churnContrib + reworkContrib);
}
