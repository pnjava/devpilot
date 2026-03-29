import fs from "fs";
import path from "path";
import { reviewPR, PRFile } from "../services/pr-review";

interface ReplayFixtureExpectations {
  minFindings?: number;
  maxBlockers?: number;
  maxNeedsMoreContextRate?: number;
  mustIncludeCategory?: string[];
}

interface ReplayFixture {
  id: string;
  title?: string;
  repoSlug?: string;
  prTitle: string;
  prBody?: string;
  files: PRFile[];
  specs?: string;
  expect?: ReplayFixtureExpectations;
}

interface ReplayFixtureResult {
  id: string;
  passed: boolean;
  skipped: boolean;
  findings: number;
  blockers: number;
  needsMoreContextRate: number;
  failures: string[];
  headline: string;
}

function loadFixtures(dir: string): ReplayFixture[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Fixture directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error(`No fixture files found in ${dir}`);
  }

  return files.map((file) => {
    const fullPath = path.join(dir, file);
    const raw = fs.readFileSync(fullPath, "utf8");
    const parsed = JSON.parse(raw) as ReplayFixture;

    if (!parsed.id || !parsed.prTitle || !Array.isArray(parsed.files)) {
      throw new Error(`Invalid fixture schema in ${file}`);
    }

    return parsed;
  });
}

function evaluateFixture(result: any, fixture: ReplayFixture): ReplayFixtureResult {
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const blockers = findings.filter((f: any) => f.action === "block").length;
  const needsMoreContextCount = findings.filter((f: any) => f.reviewStatus === "needs_more_context").length;
  const needsMoreContextRate = findings.length > 0 ? needsMoreContextCount / findings.length : 0;
  const failures: string[] = [];
  const expect = fixture.expect || {};
  const headline = String(result.summary?.headline || "");

  if (headline.toLowerCase().includes("ai provider not configured")) {
    return {
      id: fixture.id,
      passed: true,
      skipped: true,
      findings: findings.length,
      blockers,
      needsMoreContextRate,
      failures: ["skipped: ai provider not configured"],
      headline,
    };
  }

  if (typeof expect.minFindings === "number" && findings.length < expect.minFindings) {
    failures.push(`expected minFindings=${expect.minFindings}, got ${findings.length}`);
  }

  if (typeof expect.maxBlockers === "number" && blockers > expect.maxBlockers) {
    failures.push(`expected maxBlockers=${expect.maxBlockers}, got ${blockers}`);
  }

  if (typeof expect.maxNeedsMoreContextRate === "number" && needsMoreContextRate > expect.maxNeedsMoreContextRate) {
    failures.push(
      `expected maxNeedsMoreContextRate=${expect.maxNeedsMoreContextRate}, got ${needsMoreContextRate.toFixed(3)}`,
    );
  }

  if (Array.isArray(expect.mustIncludeCategory) && expect.mustIncludeCategory.length > 0) {
    const categories = new Set(findings.map((f: any) => String(f.category || "").toLowerCase()));
    for (const expectedCategory of expect.mustIncludeCategory) {
      if (!categories.has(expectedCategory.toLowerCase())) {
        failures.push(`expected category not found: ${expectedCategory}`);
      }
    }
  }

  return {
    id: fixture.id,
    passed: failures.length === 0,
    skipped: false,
    findings: findings.length,
    blockers,
    needsMoreContextRate,
    failures,
    headline,
  };
}

async function run(): Promise<void> {
  const fixtureDir = process.env.REPLAY_FIXTURE_DIR || path.join(process.cwd(), "replay-fixtures");
  const outputPath = process.env.REPLAY_REPORT_PATH || path.join(process.cwd(), "replay-report.json");

  const fixtures = loadFixtures(fixtureDir);
  const results: ReplayFixtureResult[] = [];

  for (const fixture of fixtures) {
    const review = await reviewPR({
      prTitle: fixture.prTitle,
      prBody: fixture.prBody || "",
      files: fixture.files,
      specs: fixture.specs,
      repoSlug: fixture.repoSlug,
    });

    results.push(evaluateFixture(review, fixture));
  }

  const passed = results.filter((r) => r.passed && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.passed).length;
  const avgNeedsMoreContextRate = results.length > 0
    ? results.reduce((acc, row) => acc + row.needsMoreContextRate, 0) / results.length
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    fixtureDir,
    summary: {
      total: results.length,
      passed,
      skipped,
      failed,
      avgNeedsMoreContextRate: Number(avgNeedsMoreContextRate.toFixed(4)),
    },
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log("Replay harness completed");
  console.log(`Fixtures: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Report: ${outputPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("Replay harness failed:", err);
  process.exit(1);
});
