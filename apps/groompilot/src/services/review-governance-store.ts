import { v4 as uuidv4 } from "uuid";
import db from "../db";

export interface ReviewRunRecordInput {
  repoSlug: string;
  prUrl?: string;
  prTitle: string;
  provider: string;
  model: string;
  changeType: string;
  riskLabel: string;
  riskScore: number;
  verdict: string;
  blockers: number;
  warnings: number;
  suggestions: number;
  informational: number;
  totalFindings: number;
  duplicateFindings: number;
  suppressedFindings: number;
  schemaAdjusted: number;
  highRiskCategories: string[];
  subsystems: string[];
  sensitivity: string[];
  blastRadius: string;
  auditTraceComplete: boolean;
  promptInjectionGuardsApplied: boolean;
  secretRedactionsApplied: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summaryJson: string;
  findingsJson: string;
  createdBy?: string;
}

export interface ReviewFindingFeedbackInput {
  repoSlug: string;
  reviewRunId: string;
  findingId: string;
  reviewer: string;
  outcome: "accepted" | "rejected" | "false_positive" | "duplicate" | "resolved";
  subsystem?: string;
  severity?: string;
  incidentLinked?: boolean;
  revertLinked?: boolean;
  notes?: string;
}

export interface ReviewFeedbackSignals {
  acceptedCount: number;
  rejectedCount: number;
  falsePositiveCount: number;
  duplicateCount: number;
  resolvedCount: number;
  incidentLinkedCount: number;
  revertLinkedCount: number;
  reviewerWeights: Record<string, number>;
}

export interface ReviewMetricsSummary {
  findingPrecision: number;
  blockerPrecision: number;
  falsePositiveRate: number;
  hallucinationProxyRate: number;
  duplicateFindingRate: number;
  reviewerAcceptanceRate: number;
  developerTrustSignal: number;
  auditTraceCompleteness: number;
  reviewLatencyMs: number;
  subsystemCoverageQuality: number;
  totals: {
    reviews: number;
    findings: number;
    blockers: number;
    accepted: number;
    rejected: number;
    falsePositives: number;
    duplicates: number;
  };
}

export function createReviewRun(record: ReviewRunRecordInput): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO review_runs (
      id, repo_slug, pr_url, pr_title, provider, model, change_type, risk_label, risk_score,
      verdict, blockers, warnings, suggestions, informational, total_findings, duplicate_findings,
      suppressed_findings, schema_adjusted, high_risk_categories, subsystems, sensitivity,
      blast_radius, audit_trace_complete, prompt_injection_guards_applied, secret_redactions_applied,
      started_at, completed_at, duration_ms, summary_json, findings_json, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.repoSlug,
    record.prUrl || null,
    record.prTitle,
    record.provider,
    record.model,
    record.changeType,
    record.riskLabel,
    record.riskScore,
    record.verdict,
    record.blockers,
    record.warnings,
    record.suggestions,
    record.informational,
    record.totalFindings,
    record.duplicateFindings,
    record.suppressedFindings,
    record.schemaAdjusted,
    JSON.stringify(record.highRiskCategories || []),
    JSON.stringify(record.subsystems || []),
    JSON.stringify(record.sensitivity || []),
    record.blastRadius,
    record.auditTraceComplete ? 1 : 0,
    record.promptInjectionGuardsApplied ? 1 : 0,
    record.secretRedactionsApplied,
    record.startedAt,
    record.completedAt,
    record.durationMs,
    record.summaryJson,
    record.findingsJson,
    record.createdBy || null,
  );
  return id;
}

export function upsertFindingFeedback(input: ReviewFindingFeedbackInput): void {
  const normalizedOutcome = input.outcome;
  db.prepare(`
    INSERT INTO review_finding_feedback (
      repo_slug, review_run_id, finding_id, reviewer, outcome, subsystem, severity,
      accepted, resolved, false_positive, duplicate_flag, incident_linked, revert_linked, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(review_run_id, finding_id, reviewer)
    DO UPDATE SET
      outcome = excluded.outcome,
      subsystem = excluded.subsystem,
      severity = excluded.severity,
      accepted = excluded.accepted,
      resolved = excluded.resolved,
      false_positive = excluded.false_positive,
      duplicate_flag = excluded.duplicate_flag,
      incident_linked = excluded.incident_linked,
      revert_linked = excluded.revert_linked,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).run(
    input.repoSlug,
    input.reviewRunId,
    input.findingId,
    input.reviewer,
    normalizedOutcome,
    input.subsystem || null,
    input.severity || null,
    normalizedOutcome === "accepted" ? 1 : 0,
    normalizedOutcome === "resolved" ? 1 : 0,
    normalizedOutcome === "false_positive" ? 1 : 0,
    normalizedOutcome === "duplicate" ? 1 : 0,
    input.incidentLinked ? 1 : 0,
    input.revertLinked ? 1 : 0,
    input.notes || null,
  );
}

export function getReviewFeedbackSignals(repoSlug: string, windowDays = 180): ReviewFeedbackSignals {
  const rows = db.prepare(`
    SELECT reviewer,
           SUM(accepted) AS accepted_count,
           SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
           SUM(false_positive) AS false_positive_count,
           SUM(duplicate_flag) AS duplicate_count,
           SUM(resolved) AS resolved_count,
           SUM(incident_linked) AS incident_linked_count,
           SUM(revert_linked) AS revert_linked_count
    FROM review_finding_feedback
    WHERE repo_slug = ?
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY reviewer
  `).all(repoSlug, Math.max(1, windowDays)) as Array<Record<string, unknown>>;

  const aggregate: ReviewFeedbackSignals = {
    acceptedCount: 0,
    rejectedCount: 0,
    falsePositiveCount: 0,
    duplicateCount: 0,
    resolvedCount: 0,
    incidentLinkedCount: 0,
    revertLinkedCount: 0,
    reviewerWeights: {},
  };

  for (const row of rows) {
    const reviewer = String(row.reviewer || "unknown");
    const accepted = Number(row.accepted_count || 0);
    const rejected = Number(row.rejected_count || 0);
    const falsePositive = Number(row.false_positive_count || 0);
    const duplicate = Number(row.duplicate_count || 0);
    const resolved = Number(row.resolved_count || 0);
    const incidentLinked = Number(row.incident_linked_count || 0);
    const revertLinked = Number(row.revert_linked_count || 0);

    aggregate.acceptedCount += accepted;
    aggregate.rejectedCount += rejected;
    aggregate.falsePositiveCount += falsePositive;
    aggregate.duplicateCount += duplicate;
    aggregate.resolvedCount += resolved;
    aggregate.incidentLinkedCount += incidentLinked;
    aggregate.revertLinkedCount += revertLinked;

    const signalTotal = accepted + rejected + falsePositive + duplicate;
    const weight = signalTotal === 0
      ? 1
      : Math.max(0.4, Math.min(1.6, ((accepted + resolved + (incidentLinked * 0.5)) - (falsePositive + duplicate + (revertLinked * 0.25))) / signalTotal + 1));
    aggregate.reviewerWeights[reviewer] = Number(weight.toFixed(3));
  }

  return aggregate;
}

export function getReviewMetricsSummary(repoSlug: string, windowDays = 180): ReviewMetricsSummary {
  const reviews = db.prepare(`
    SELECT *
    FROM review_runs
    WHERE repo_slug = ?
      AND completed_at >= datetime('now', '-' || ? || ' days')
    ORDER BY completed_at DESC
  `).all(repoSlug, Math.max(1, windowDays)) as Array<Record<string, unknown>>;

  const feedback = getReviewFeedbackSignals(repoSlug, windowDays);

  const totals = reviews.reduce<{
    reviews: number;
    findings: number;
    blockers: number;
    duration: number;
    auditComplete: number;
    duplicates: number;
    subsystems: Set<string>;
  }>((acc, row) => {
    acc.reviews += 1;
    const safeNum = (v: unknown) => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };
    acc.findings += safeNum(row.total_findings);
    acc.blockers += safeNum(row.blockers);
    acc.duration += safeNum(row.duration_ms);
    acc.auditComplete += safeNum(row.audit_trace_complete);
    acc.duplicates += safeNum(row.duplicate_findings);
    try {
      const subsystems = JSON.parse(String(row.subsystems || "[]")) as string[];
      for (const subsystem of subsystems) acc.subsystems.add(subsystem);
    } catch {
      // malformed subsystems JSON — skip rather than crash
    }
    return acc;
  }, {
    reviews: 0,
    findings: 0,
    blockers: 0,
    duration: 0,
    auditComplete: 0,
    duplicates: 0,
    subsystems: new Set<string>(),
  });

  const accepted = feedback.acceptedCount;
  const rejected = feedback.rejectedCount;
  const falsePositives = feedback.falsePositiveCount;
  const duplicates = feedback.duplicateCount + totals.duplicates;
  const denom = Math.max(1, accepted + rejected + falsePositives);
  const findingPrecision = accepted / denom;
  const blockerPrecision = accepted / Math.max(1, totals.blockers);
  const falsePositiveRate = falsePositives / denom;
  const hallucinationProxyRate = (falsePositives + feedback.duplicateCount) / denom;
  const duplicateFindingRate = duplicates / Math.max(1, totals.findings);
  const reviewerAcceptanceRate = accepted / Math.max(1, accepted + rejected);
  const auditTraceCompleteness = totals.auditComplete / Math.max(1, totals.reviews);
  const reviewLatencyMs = totals.duration / Math.max(1, totals.reviews);
  const subsystemCoverageQuality = totals.subsystems.size / Math.max(1, totals.reviews);
  const developerTrustSignal = Math.max(0, Math.min(1, reviewerAcceptanceRate - (falsePositiveRate * 0.5) - (duplicateFindingRate * 0.25) + (auditTraceCompleteness * 0.2)));

  return {
    findingPrecision: Number(findingPrecision.toFixed(4)),
    blockerPrecision: Number(blockerPrecision.toFixed(4)),
    falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
    hallucinationProxyRate: Number(hallucinationProxyRate.toFixed(4)),
    duplicateFindingRate: Number(duplicateFindingRate.toFixed(4)),
    reviewerAcceptanceRate: Number(reviewerAcceptanceRate.toFixed(4)),
    developerTrustSignal: Number(developerTrustSignal.toFixed(4)),
    auditTraceCompleteness: Number(auditTraceCompleteness.toFixed(4)),
    reviewLatencyMs: Math.round(reviewLatencyMs),
    subsystemCoverageQuality: Number(subsystemCoverageQuality.toFixed(4)),
    totals: {
      reviews: totals.reviews,
      findings: totals.findings,
      blockers: totals.blockers,
      accepted,
      rejected,
      falsePositives,
      duplicates,
    },
  };
}