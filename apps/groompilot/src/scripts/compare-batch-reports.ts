#!/usr/bin/env tsx
/**
 * Compare two batch PR review reports
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/compare-batch-reports.ts batch-reports/report-A.json batch-reports/report-B.json
 */

import fs from "fs";
import path from "path";

interface FindingSummary {
  id: string;
  title: string;
  severity: string;
  dimension: string;
  category: string;
  file: string;
}

interface PRReport {
  prId: number;
  title: string;
  verdict: string;
  complianceScore: number;
  totalFindings: number;
  blockers: number;
  riskLabel: string;
  findings: FindingSummary[];
  error?: string;
}

interface BatchReport {
  generatedAt: string;
  repoSlug: string;
  reviewMode: string;
  summary: {
    avgComplianceScore: number;
    avgFindings: number;
    avgBlockers: number;
    avgDurationMs: number;
    verdictDistribution: Record<string, number>;
  };
  reviews: PRReport[];
}

function loadReport(filePath: string): BatchReport {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, "utf-8"));
}

function main() {
  const [, , fileA, fileB] = process.argv;
  if (!fileA || !fileB) {
    console.error("Usage: compare-batch-reports.ts <report-A.json> <report-B.json>");
    process.exit(1);
  }

  const a = loadReport(fileA);
  const b = loadReport(fileB);

  console.log("═".repeat(80));
  console.log("  BATCH REPORT COMPARISON");
  console.log("═".repeat(80));
  console.log(`  A: ${path.basename(fileA)} (${a.generatedAt}) mode=${a.reviewMode}`);
  console.log(`  B: ${path.basename(fileB)} (${b.generatedAt}) mode=${b.reviewMode}`);
  console.log("");

  // Overall summary delta
  const delta = (label: string, va: number, vb: number) => {
    const d = vb - va;
    const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "=";
    console.log(`  ${label.padEnd(22)} A: ${String(va).padStart(6)}    B: ${String(vb).padStart(6)}    ${arrow} ${Math.abs(d)}`);
  };

  console.log("── Summary ──");
  delta("Avg Compliance %", a.summary.avgComplianceScore, b.summary.avgComplianceScore);
  delta("Avg Findings", a.summary.avgFindings, b.summary.avgFindings);
  delta("Avg Blockers", a.summary.avgBlockers, b.summary.avgBlockers);
  delta("Avg Duration (ms)", a.summary.avgDurationMs, b.summary.avgDurationMs);
  console.log("");

  // Per-PR comparison
  const prMapA = new Map(a.reviews.map((r) => [r.prId, r]));
  const prMapB = new Map(b.reviews.map((r) => [r.prId, r]));
  const allPrIds = [...new Set([...prMapA.keys(), ...prMapB.keys()])].sort((x, y) => x - y);

  console.log("── Per-PR Delta ──");
  console.log(`  ${"PR".padEnd(8)} ${"Score A".padStart(8)} ${"Score B".padStart(8)} ${"Δ".padStart(4)}  ${"Verdict A".padEnd(22)} ${"Verdict B".padEnd(22)} ${"Find A".padStart(7)} ${"Find B".padStart(7)}`);
  console.log("  " + "─".repeat(96));

  for (const prId of allPrIds) {
    const ra = prMapA.get(prId);
    const rb = prMapB.get(prId);
    if (!ra && rb) {
      console.log(`  ${String(prId).padEnd(8)} ${"—".padStart(8)} ${String(rb.complianceScore).padStart(8)}       ${"(new in B)".padEnd(22)} ${rb.verdict.padEnd(22)} ${"—".padStart(7)} ${String(rb.totalFindings).padStart(7)}`);
      continue;
    }
    if (ra && !rb) {
      console.log(`  ${String(prId).padEnd(8)} ${String(ra.complianceScore).padStart(8)} ${"—".padStart(8)}       ${ra.verdict.padEnd(22)} ${"(missing in B)".padEnd(22)} ${String(ra.totalFindings).padStart(7)} ${"—".padStart(7)}`);
      continue;
    }
    if (ra && rb) {
      const d = rb.complianceScore - ra.complianceScore;
      const arrow = d > 0 ? "+" : d < 0 ? "" : " ";
      console.log(`  ${String(prId).padEnd(8)} ${String(ra.complianceScore).padStart(8)} ${String(rb.complianceScore).padStart(8)} ${(arrow + d).padStart(4)}  ${ra.verdict.padEnd(22)} ${rb.verdict.padEnd(22)} ${String(ra.totalFindings).padStart(7)} ${String(rb.totalFindings).padStart(7)}`);

      // Finding diff
      const findA = new Set(ra.findings.map((f) => `${f.category}::${f.file}`));
      const findB = new Set(rb.findings.map((f) => `${f.category}::${f.file}`));
      const added = [...findB].filter((x) => !findA.has(x));
      const removed = [...findA].filter((x) => !findB.has(x));
      if (added.length) console.log(`           + ${added.length} new findings in B`);
      if (removed.length) console.log(`           - ${removed.length} findings removed in B`);
    }
  }

  // Write comparison to file
  const outDir = path.dirname(path.resolve(fileA));
  const outFile = path.join(outDir, `comparison_${Date.now()}.txt`);
  console.log(`\n  📄 (To save: redirect stdout to a file)`);
  console.log("");
}

main();
