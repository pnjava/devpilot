// ──────────────────────────────────────────────────────────────
// Readiness Calculator
// Computes Story Readiness Score (0-100) from field presence.
// ──────────────────────────────────────────────────────────────

import { DEFAULT_READINESS_WEIGHTS } from '@devpilot/shared';
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

export function computeReadinessFactors(input: ReadinessInput): ReadinessFactors {
  const cf = (input.customFields ?? {}) as Record<string, unknown>;
  const labels = Array.isArray(input.labels) ? input.labels : [];
  const titleStr = input.title ?? input.summary;

  return {
    hasTitle: Boolean(titleStr && titleStr.trim().length > 3),
    hasDescription: input.hasDescription !== undefined
      ? Boolean(input.hasDescription)
      : Boolean(input.description && (input.description as string).trim().length > 20),
    hasAcceptanceCriteria: input.hasAcceptanceCriteria !== undefined
      ? Boolean(input.hasAcceptanceCriteria)
      : Boolean(input.acceptanceCriteria && (input.acceptanceCriteria as string).trim().length > 10),
    hasEstimate: input.hasEstimate !== undefined
      ? Boolean(input.hasEstimate)
      : (input.storyPoints != null && input.storyPoints > 0),
    hasAssignee: Boolean(input.assigneeId),
    hasEpicLink: Boolean(input.epicKey || input.parentKey),
    hasPriority: Boolean(input.priority && input.priority !== 'NONE'),
    hasDesignDoc: input.hasDesignDoc !== undefined
      ? Boolean(input.hasDesignDoc)
      : Boolean(cf['designDoc'] || cf['designReference'] || labels.some((l: string) => l.toLowerCase().includes('design'))),
    hasDefinitionOfDone: input.hasDefinitionOfDone !== undefined
      ? Boolean(input.hasDefinitionOfDone)
      : Boolean(cf['definitionOfDone'] || cf['testNotes'] || input.acceptanceCriteria),
    hasDependenciesMapped: input.hasDependencies !== undefined
      ? Boolean(input.hasDependencies)
      : Boolean(cf['dependencies'] || cf['blockedBy'] || labels.some((l: string) => l.toLowerCase().includes('dependency'))),
  };
}

export function computeReadinessScore(
  factors: ReadinessFactors,
  weights: Record<string, number> = DEFAULT_READINESS_WEIGHTS,
): number {
  const maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
  let score = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (factors[key as keyof ReadinessFactors]) {
      score += weight;
    }
  }

  return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
}
