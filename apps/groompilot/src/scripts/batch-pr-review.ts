#!/usr/bin/env tsx
/**
 * Batch PR Review Harness
 *
 * Fetches all open PRs from a Bitbucket repo, runs each through
 * GroomPilot's review engine, and writes a timestamped comparison
 * report to backend/batch-reports/.
 *
 * Usage:
 *   cd backend
 *   npx tsx src/scripts/batch-pr-review.ts [repoSlug]
 *
 * Defaults to "banking-be" if no repo slug is supplied.
 * Reads credentials from the project root .env (BITBUCKET_URL,
 * BITBUCKET_TOKEN, BITBUCKET_PROJECT).
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load root .env (has BITBUCKET_URL, BITBUCKET_TOKEN, etc.)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import { getPullRequests, getPRChanges, getPRActivities, type BBPullRequest } from "../services/bitbucket-server";
import { reviewPR, type PRReviewResult, type PRFile } from "../services/pr-review";

// ─── Config ──────────────────────────────────────────────────────────────────

const repoSlug = process.argv[2] || "banking-be";
const MAX_PRS = Number(process.env.BATCH_MAX_PRS || 20);
const REPORT_DIR = path.resolve(__dirname, "../../batch-reports");

// ─── Types ───────────────────────────────────────────────────────────────────

interface PRReviewReport {
  prId: number;
  title: string;
  author: string;
  url: string;
  branch: string;
  filesChanged: number;
  reviewDurationMs: number;
  verdict: string;
  complianceScore: number;
  totalFindings: number;
  blockers: number;
  warnings: number;
  suggestions: number;
  riskLabel: string;
  riskScore: number;
  changeType: string;
  dimensions: Record<string, { score: number; label: string; findingCount: number }>;
  findings: Array<{
    id: string;
    title: string;
    severity: string;
    dimension: string;
    category: string;
    file: string;
    line?: number;
    confidence: string;
  }>;
  error?: string;
}

interface BatchReport {
  generatedAt: string;
  repoSlug: string;
  reviewMode: string;
  totalPRs: number;
  reviewed: number;
  failed: number;
  totalDurationMs: number;
  summary: {
    avgComplianceScore: number;
    avgFindings: number;
    avgBlockers: number;
    avgDurationMs: number;
    verdictDistribution: Record<string, number>;
    riskDistribution: Record<string, number>;
  };
  reviews: PRReviewReport[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrUrl(pr: BBPullRequest): string {
  const bbUrl = process.env.BITBUCKET_URL || "";
  const project = process.env.BITBUCKET_PROJECT || "BMN";
  return `${bbUrl}/projects/${project}/repos/${repoSlug}/pull-requests/${pr.id}`;
}

function commentsToPrBody(pr: BBPullRequest, comments: Awaited<ReturnType<typeof getPRActivities>>): string {
  const parts: string[] = [];
  if (pr.description) parts.push(pr.description);
  if (comments.length > 0) {
    parts.push("\n--- Existing Reviewer Comments ---");
    for (const c of comments.slice(0, 30)) {
      parts.push(`[${c.author}]: ${c.text}`);
    }
  }
  return parts.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(80));
  console.log(`  BATCH PR REVIEW — ${repoSlug}`);
  console.log(`  Mode: ${process.env.REVIEW_MODE || "hybrid_strict"}`);
  console.log(`  Max PRs: ${MAX_PRS}`);
  console.log("═".repeat(80));

  // 1. Fetch open PRs
  console.log("\n📡 Fetching open PRs…");
  const allPRs = await getPullRequests(repoSlug, "OPEN");
  const prs = allPRs.slice(0, MAX_PRS);
  console.log(`   Found ${allPRs.length} open PRs, reviewing ${prs.length}\n`);

  if (prs.length === 0) {
    console.log("✅ No open PRs to review.");
    return;
  }

  const reviews: PRReviewReport[] = [];
  const batchStart = Date.now();

  // 2. Review each PR sequentially (avoids overloading the AI provider)
  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    const prUrl = buildPrUrl(pr);
    console.log(`\n[${i + 1}/${prs.length}] PR #${pr.id}: ${pr.title}`);
    console.log(`   Author: ${pr.author.user.displayName} | Branch: ${pr.fromRef.displayId}`);

    const start = Date.now();
    try {
      // Fetch file changes and comments
      const [{ files: rawFiles }, comments] = await Promise.all([
        getPRChanges(repoSlug, pr.id),
        getPRActivities(repoSlug, pr.id),
      ]);

      const prFiles: PRFile[] = rawFiles.map((f) => ({
        filename: f.filename,
        status: f.status as PRFile["status"],
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
        previousFilename: f.previousFilename,
      }));

      const prBody = commentsToPrBody(pr, comments);

      // Run GroomPilot review
      const result: PRReviewResult = await reviewPR({
        repoSlug,
        prTitle: pr.title,
        prBody,
        files: prFiles,
        existingComments: comments.map((c) => ({ author: c.author, text: c.text, severity: c.severity, state: c.state, filePath: c.filePath, lineNumber: c.lineNumber })),
      });

      const durationMs = Date.now() - start;
      const summary = result.summary;

      const report: PRReviewReport = {
        prId: pr.id,
        title: pr.title,
        author: pr.author.user.displayName,
        url: prUrl,
        branch: pr.fromRef.displayId,
        filesChanged: prFiles.length,
        reviewDurationMs: durationMs,
        verdict: summary?.verdict || "unknown",
        complianceScore: result.complianceScore ?? 0,
        totalFindings: result.findings?.length || 0,
        blockers: summary?.blockers || 0,
        warnings: summary?.warnings || 0,
        suggestions: summary?.suggestions || 0,
        riskLabel: result.riskProfile?.label || "unknown",
        riskScore: result.riskProfile?.overallScore || 0,
        changeType: summary?.changeType || "unknown",
        dimensions: Object.fromEntries(
          (result.dimensionScores || []).map((d) => [
            d.dimension,
            { score: d.score, label: d.label, findingCount: d.findingCount },
          ]),
        ),
        findings: (result.findings || []).map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          dimension: f.dimension,
          category: f.category,
          file: f.file,
          line: f.line,
          confidence: f.confidence,
        })),
      };

      reviews.push(report);
      console.log(`   ✅ ${durationMs}ms | Score: ${report.complianceScore}% | ${report.verdict} | Findings: ${report.totalFindings} (${report.blockers} blockers)`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`   ❌ ${durationMs}ms | Error: ${message}`);
      reviews.push({
        prId: pr.id,
        title: pr.title,
        author: pr.author.user.displayName,
        url: prUrl,
        branch: pr.fromRef.displayId,
        filesChanged: 0,
        reviewDurationMs: durationMs,
        verdict: "error",
        complianceScore: 0,
        totalFindings: 0,
        blockers: 0,
        warnings: 0,
        suggestions: 0,
        riskLabel: "unknown",
        riskScore: 0,
        changeType: "unknown",
        dimensions: {},
        findings: [],
        error: message,
      });
    }
  }

  const totalDurationMs = Date.now() - batchStart;

  // 3. Build summary
  const successful = reviews.filter((r) => !r.error);
  const verdictDist: Record<string, number> = {};
  const riskDist: Record<string, number> = {};
  for (const r of successful) {
    verdictDist[r.verdict] = (verdictDist[r.verdict] || 0) + 1;
    riskDist[r.riskLabel] = (riskDist[r.riskLabel] || 0) + 1;
  }

  const batchReport: BatchReport = {
    generatedAt: new Date().toISOString(),
    repoSlug,
    reviewMode: process.env.REVIEW_MODE || "hybrid_strict",
    totalPRs: prs.length,
    reviewed: successful.length,
    failed: reviews.length - successful.length,
    totalDurationMs,
    summary: {
      avgComplianceScore: successful.length ? Math.round(successful.reduce((s, r) => s + r.complianceScore, 0) / successful.length) : 0,
      avgFindings: successful.length ? +(successful.reduce((s, r) => s + r.totalFindings, 0) / successful.length).toFixed(1) : 0,
      avgBlockers: successful.length ? +(successful.reduce((s, r) => s + r.blockers, 0) / successful.length).toFixed(1) : 0,
      avgDurationMs: successful.length ? Math.round(successful.reduce((s, r) => s + r.reviewDurationMs, 0) / successful.length) : 0,
      verdictDistribution: verdictDist,
      riskDistribution: riskDist,
    },
    reviews,
  };

  // 4. Write report
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportFile = path.join(REPORT_DIR, `${repoSlug}_${ts}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(batchReport, null, 2));

  // 5. Print summary
  console.log("\n" + "═".repeat(80));
  console.log("  BATCH REVIEW COMPLETE");
  console.log("═".repeat(80));
  console.log(`  Repo:            ${repoSlug}`);
  console.log(`  PRs reviewed:    ${successful.length}/${prs.length}`);
  console.log(`  Failed:          ${reviews.length - successful.length}`);
  console.log(`  Total time:      ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Avg time/PR:     ${(batchReport.summary.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Avg score:       ${batchReport.summary.avgComplianceScore}%`);
  console.log(`  Avg findings:    ${batchReport.summary.avgFindings}`);
  console.log(`  Avg blockers:    ${batchReport.summary.avgBlockers}`);
  console.log(`  Verdicts:        ${JSON.stringify(verdictDist)}`);
  console.log(`  Risk levels:     ${JSON.stringify(riskDist)}`);
  console.log(`\n  📄 Report: ${reportFile}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
