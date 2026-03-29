// ──────────────────────────────────────────────────────────────
// Composite Index Calculator
// Delivery Health Index, Story Friction Score, Team Risk Score.
//
// Each composite is a weighted, normalized combination of
// sub-metrics. The breakdown is always exposed for transparency.
// ──────────────────────────────────────────────────────────────

import {
  DEFAULT_DELIVERY_HEALTH_WEIGHTS,
  DEFAULT_FRICTION_WEIGHTS,
  DEFAULT_TEAM_RISK_WEIGHTS,
} from '@devpilot/shared';

/**
 * Generic weighted composite scorer.
 * Each input value is already 0-100 (or normalized to that range).
 * Returns { score, breakdown }.
 * invertKeys can be a Set or an Array of keys where lower raw value = better.
 */
export function weightedComposite(
  values: Record<string, number>,
  weights: Record<string, number>,
  invertKeys: Set<string> | string[] = new Set(),
): { score: number; breakdown: Record<string, number> } {
  const invertSet = invertKeys instanceof Set ? invertKeys : new Set(invertKeys);
  const breakdown: Record<string, number> = {};
  let total = 0;
  let weightSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const raw = values[key] ?? 0;
    // If key is inverted (e.g. cycle time, blocked ratio), flip so that
    // lower raw = higher contribution to health score
    const normalized = invertSet.has(key) ? Math.max(0, 100 - raw) : raw;
    const weighted = normalized * weight;
    breakdown[key] = Math.round(normalized);
    total += weighted;
    weightSum += weight;
  }

  const score = weightSum > 0 ? Math.round(total / weightSum) : 0;
  return { score, breakdown };
}

// ── Delivery Health Index ──────────────────────────────────────

export function computeDeliveryHealthIndex(
  inputs: Record<string, number>,
  weights?: Record<string, number>,
) {
  const w = weights ?? DEFAULT_DELIVERY_HEALTH_WEIGHTS;
  // Invert metrics where lower = better
  const invert = new Set(['CYCLE_TIME', 'BLOCKED_RATIO', 'REOPEN_RATE']);
  return weightedComposite(inputs, w, invert);
}

// ── Story Friction Score ───────────────────────────────────────

export function computeStoryFrictionScore(
  inputs: Record<string, number>,
  weights?: Record<string, number>,
) {
  const w = weights ?? DEFAULT_FRICTION_WEIGHTS;
  // For friction, HIGHER is worse. We want: low readiness = high friction, high churn = high friction.
  // Input values: readiness 0-100 (higher=better), churn 0-100 (higher=worse), etc.
  // Invert readiness so that low readiness contributes to high friction.
  const invert = new Set(['STORY_READINESS_SCORE']);
  return weightedComposite(inputs, w, invert);
}

// ── Team Risk Score ────────────────────────────────────────────

export function computeTeamRiskScore(
  inputs: Record<string, number>,
  weights?: Record<string, number>,
) {
  const w = weights ?? DEFAULT_TEAM_RISK_WEIGHTS;
  // For risk: higher values = worse. Invert READY_AT_START_PCT (higher = better).
  const invert = new Set(['READY_AT_START_PCT']);
  return weightedComposite(inputs, w, invert);
}
