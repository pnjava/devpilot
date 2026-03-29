// ──────────────────────────────────────────────────────────────
// Unit Tests – Metric Calculators
// Run: npx vitest run
// ──────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  computeReadinessFactors,
  computeReadinessScore,
} from '../src/metrics/calculators/readiness.calculator';
import {
  computeChurnCount,
  computeChurnScore,
} from '../src/metrics/calculators/churn.calculator';
import {
  extractStatusTransitions,
  computeLeadTime,
  computeCycleTime,
  computeBlockedTime,
  percentile,
} from '../src/metrics/calculators/flow.calculator';
import {
  computeTraceabilityCoverage,
} from '../src/metrics/calculators/traceability.calculator';
import {
  computeFirstReviewDelay,
  computeReviewCoverage,
  computeReworkRate,
} from '../src/metrics/calculators/review.calculator';
import {
  computeReopenRate,
  computeBugPerStoryRatio,
} from '../src/metrics/calculators/quality.calculator';
import {
  computeKnowledgeCaptureRate,
} from '../src/metrics/calculators/knowledge.calculator';
import {
  weightedComposite,
  computeDeliveryHealthIndex,
} from '../src/metrics/calculators/composite.calculator';

// ═══════════════════════════════════════════════════════════
// READINESS
// ═══════════════════════════════════════════════════════════
describe('Readiness Calculator', () => {
  it('returns all true factors for a fully-specified issue', () => {
    const issue = {
      title: 'Implement feature X',
      hasDescription: true,
      hasAcceptanceCriteria: true,
      hasEstimate: true,
      storyPoints: 5,
      assigneeId: 'person-1',
      epicKey: 'EPIC-1',
      priority: 'HIGH',
      hasDesignDoc: true,
      hasDefinitionOfDone: true,
      hasDependencies: true,
    };
    const factors = computeReadinessFactors(issue as any);
    expect(factors.hasTitle).toBe(true);
    expect(factors.hasDescription).toBe(true);
    expect(factors.hasAcceptanceCriteria).toBe(true);
    expect(factors.hasEstimate).toBe(true);
    expect(factors.hasAssignee).toBe(true);
    expect(factors.hasEpicLink).toBe(true);
    expect(factors.hasPriority).toBe(true);
    expect(factors.hasDesignDoc).toBe(true);
    expect(factors.hasDefinitionOfDone).toBe(true);
    expect(factors.hasDependenciesMapped).toBe(true);
  });

  it('computes 100% score for a fully ready issue', () => {
    const factors = {
      hasTitle: true,
      hasDescription: true,
      hasAcceptanceCriteria: true,
      hasEstimate: true,
      hasAssignee: true,
      hasEpicLink: true,
      hasPriority: true,
      hasDesignDoc: true,
      hasDefinitionOfDone: true,
      hasDependenciesMapped: true,
    };
    const score = computeReadinessScore(factors);
    expect(score).toBe(100);
  });

  it('computes partial score when some factors missing', () => {
    const factors = {
      hasTitle: true,
      hasDescription: true,
      hasAcceptanceCriteria: false,
      hasEstimate: false,
      hasAssignee: true,
      hasEpicLink: false,
      hasPriority: true,
      hasDesignDoc: false,
      hasDefinitionOfDone: false,
      hasDependenciesMapped: false,
    };
    const score = computeReadinessScore(factors);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════
// CHURN
// ═══════════════════════════════════════════════════════════
describe('Churn Calculator', () => {
  it('counts churn events from description/AC/scope changes', () => {
    const events = [
      { fieldName: 'description', occurredAt: new Date(), oldValue: 'a', newValue: 'b' },
      { fieldName: 'acceptance_criteria', occurredAt: new Date(), oldValue: 'x', newValue: 'y' },
      { fieldName: 'status', occurredAt: new Date(), oldValue: 'TODO', newValue: 'IN_PROGRESS' },
    ];
    const count = computeChurnCount(events as any);
    expect(count).toBe(2); // only description + AC changes
  });

  it('returns 0 for no churn events', () => {
    const events = [
      { fieldName: 'status', occurredAt: new Date(), oldValue: 'TODO', newValue: 'IP' },
    ];
    expect(computeChurnCount(events as any)).toBe(0);
  });

  it('computes weighted churn score', () => {
    const devStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const events = [
      { fieldName: 'description', occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), oldValue: 'a', newValue: 'b' },
    ];
    const score = computeChurnScore(events as any, devStart);
    expect(score).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// FLOW
// ═══════════════════════════════════════════════════════════
describe('Flow Calculator', () => {
  it('extracts status transitions from events', () => {
    const events = [
      { fieldName: 'status', oldValue: 'TODO', newValue: 'IN_PROGRESS', occurredAt: new Date('2025-01-01') },
      { fieldName: 'description', oldValue: 'a', newValue: 'b', occurredAt: new Date('2025-01-02') },
      { fieldName: 'status', oldValue: 'IN_PROGRESS', newValue: 'DONE', occurredAt: new Date('2025-01-03') },
    ];
    const transitions = extractStatusTransitions(events as any);
    expect(transitions).toHaveLength(2);
    expect(transitions[0].newValue).toBe('IN_PROGRESS');
    expect(transitions[1].newValue).toBe('DONE');
  });

  it('computes lead time from created to resolved', () => {
    const issue = {
      createdAt: new Date('2025-01-01'),
      resolvedAt: new Date('2025-01-11'),
    };
    const hours = computeLeadTime(issue as any);
    expect(hours).toBeCloseTo(240, -1); // ~10 days = 240 hrs
  });

  it('returns null lead time for unresolved issue', () => {
    const issue = { createdAt: new Date(), resolvedAt: null };
    expect(computeLeadTime(issue as any)).toBeNull();
  });

  it('computes cycle time from first IN_PROGRESS to DONE', () => {
    const events = [
      { fieldName: 'status', oldValue: 'TODO', newValue: 'IN_PROGRESS', occurredAt: new Date('2025-01-05') },
      { fieldName: 'status', oldValue: 'IN_PROGRESS', newValue: 'DONE', occurredAt: new Date('2025-01-08') },
    ];
    const hours = computeCycleTime(events as any);
    expect(hours).toBeCloseTo(72, -1); // 3 days
  });

  it('computes blocked time', () => {
    const events = [
      { fieldName: 'status', oldValue: 'IN_PROGRESS', newValue: 'BLOCKED', occurredAt: new Date('2025-01-05') },
      { fieldName: 'status', oldValue: 'BLOCKED', newValue: 'IN_PROGRESS', occurredAt: new Date('2025-01-07') },
    ];
    const hours = computeBlockedTime(events as any);
    expect(hours).toBeCloseTo(48, -1); // 2 days
  });

  it('computes percentile correctly', () => {
    const data = [10, 20, 30, 40, 50];
    expect(percentile(data, 50)).toBe(30);
    expect(percentile(data, 0)).toBe(10);
    expect(percentile(data, 100)).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════
// TRACEABILITY
// ═══════════════════════════════════════════════════════════
describe('Traceability Calculator', () => {
  it('computes coverage ratios', () => {
    const issues = [
      { id: '1', links: [{ artifactType: 'COMMIT' }, { artifactType: 'BRANCH' }] },
      { id: '2', links: [{ artifactType: 'COMMIT' }] },
      { id: '3', links: [] },
    ];
    const coverage = computeTraceabilityCoverage(issues as any);
    expect(coverage.commitLinkedRatio).toBeCloseTo(2 / 3);
    expect(coverage.branchLinkedRatio).toBeCloseTo(1 / 3);
    expect(coverage.prLinkedRatio).toBe(0);
    expect(coverage.unlinkedRatio).toBeCloseTo(1 / 3);
  });

  it('handles empty issue list', () => {
    const coverage = computeTraceabilityCoverage([]);
    expect(coverage.overallLinkedRatio).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// REVIEW
// ═══════════════════════════════════════════════════════════
describe('Review Calculator', () => {
  it('computes first review delay', () => {
    const pr = { createdAt: new Date('2025-01-01') };
    const reviews = [
      { submittedAt: new Date('2025-01-03') },
      { submittedAt: new Date('2025-01-04') },
    ];
    const hours = computeFirstReviewDelay(pr as any, reviews as any);
    expect(hours).toBeCloseTo(48, -1);
  });

  it('returns null for no reviews', () => {
    const pr = { createdAt: new Date() };
    expect(computeFirstReviewDelay(pr as any, [])).toBeNull();
  });

  it('computes review coverage', () => {
    const prs = [
      { reviews: [{ state: 'APPROVED' }] },
      { reviews: [] },
      { reviews: [{ state: 'CHANGES_REQUESTED' }] },
    ];
    const ratio = computeReviewCoverage(prs as any);
    expect(ratio).toBeCloseTo(2 / 3);
  });

  it('computes rework rate', () => {
    const prs = [
      { reviews: [{ state: 'CHANGES_REQUESTED' }, { state: 'APPROVED' }] },
      { reviews: [{ state: 'APPROVED' }] },
    ];
    const rate = computeReworkRate(prs as any);
    expect(rate).toBeCloseTo(0.5); // 1 of 2 PRs had rework
  });
});

// ═══════════════════════════════════════════════════════════
// QUALITY
// ═══════════════════════════════════════════════════════════
describe('Quality Calculator', () => {
  it('computes reopen rate', () => {
    // Issue reopened once among 4 resolved
    const rate = computeReopenRate(1, 4);
    expect(rate).toBeCloseTo(0.25);
  });

  it('computes bug per story ratio', () => {
    expect(computeBugPerStoryRatio(3, 10)).toBeCloseTo(0.3);
    expect(computeBugPerStoryRatio(0, 10)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// KNOWLEDGE
// ═══════════════════════════════════════════════════════════
describe('Knowledge Calculator', () => {
  it('computes capture rate', () => {
    // 3 of 5 stories have wiki links
    const rate = computeKnowledgeCaptureRate(3, 5);
    expect(rate).toBeCloseTo(0.6);
  });

  it('returns 0 for no stories', () => {
    expect(computeKnowledgeCaptureRate(0, 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// COMPOSITE
// ═══════════════════════════════════════════════════════════
describe('Composite Calculator', () => {
  it('computes weighted composite correctly', () => {
    const values = { a: 80, b: 60, c: 100 };
    const weights = { a: 0.5, b: 0.3, c: 0.2 };
    const { score } = weightedComposite(values, weights);
    expect(score).toBeCloseTo(80 * 0.5 + 60 * 0.3 + 100 * 0.2); // 40 + 18 + 20 = 78
  });

  it('inverts values when specified', () => {
    const values = { a: 80 };
    const weights = { a: 1.0 };
    const { score } = weightedComposite(values, weights, ['a']);
    expect(score).toBeCloseTo(20); // 100 - 80
  });

  it('computes delivery health index', () => {
    const inputs = {
      readiness: 80,
      traceability: 70,
      reviewCoverage: 90,
      quality: 85,
      knowledge: 60,
      flow: 75,
    };
    const result = computeDeliveryHealthIndex(inputs);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toBeDefined();
  });
});
