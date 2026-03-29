/**
 * Repository Code Intelligence Engine — Delta Resolver
 *
 * At PR review time, compares changed files against the pre-indexed codebase
 * to produce enriched context that reduces false positives and enables
 * smarter AI analysis.
 */

import {
  getIndexedContext, getReverseDependencies, getRepoIndexStats,
  type DbCodeFile, type DbCodeSymbol, type DbCodeGuard,
  type DbCodeDependency, type DbCodeAnnotation, type DbAISummary,
  type DbBaselineVuln,
} from "./repo-code-index-store";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DeltaFileContext {
  filePath: string;
  /** Pre-indexed symbol map for this file */
  indexedSymbols: DbCodeSymbol[];
  /** Guards/safeguards already present in the indexed version */
  existingGuards: DbCodeGuard[];
  /** Annotations already present */
  existingAnnotations: DbCodeAnnotation[];
  /** Dependencies from this file */
  outgoingDependencies: DbCodeDependency[];
  /** Files/symbols that depend on this file (reverse deps) */
  incomingDependencies: DbCodeDependency[];
  /** AI-generated summary (if available) */
  aiSummary: DbAISummary | null;
  /** Baseline vulnerabilities already known */
  baselineVulns: DbBaselineVuln[];
  /** Symbols affected by the change (subset of indexedSymbols near changed lines) */
  affectedIndexedSymbols: DbCodeSymbol[];
  /** Delta analysis notes for the AI prompt */
  deltaInsights: string[];
}

export interface DeltaResolution {
  /** Whether indexed context was available */
  indexed: boolean;
  /** Per-file delta contexts */
  fileContexts: Map<string, DeltaFileContext>;
  /** Baseline-filtered vulns (known vulns to exclude from findings) */
  baselineFingerprints: Set<string>;
  /** Cross-file impact analysis: files that depend on changed files */
  impactedFiles: string[];
  /** Summary text for the AI prompt */
  promptEnrichment: string;
}

// ─── Delta resolution ──────────────────────────────────────────────────────────

/**
 * For each changed file in a PR, retrieves the pre-indexed context and computes
 * deltas that enrich the review.
 */
export function resolveDelta(
  repoSlug: string,
  changedFiles: Array<{ filename: string; patch?: string; additions: number; deletions: number }>,
): DeltaResolution {
  const stats = getRepoIndexStats(repoSlug);
  if (stats.fileCount === 0 || !stats.latestRun || stats.latestRun.status !== "completed") {
    return {
      indexed: false,
      fileContexts: new Map(),
      baselineFingerprints: new Set(),
      impactedFiles: [],
      promptEnrichment: "",
    };
  }

  const fileContexts = new Map<string, DeltaFileContext>();
  const baselineFingerprints = new Set<string>();
  const impactedFileSet = new Set<string>();
  const deltaInsightsAll: string[] = [];

  for (const file of changedFiles) {
    const ctx = getIndexedContext(repoSlug, file.filename);
    if (!ctx.file) continue;

    // Collect baseline fingerprints to suppress known vulns
    for (const vuln of ctx.baselineVulns) {
      baselineFingerprints.add(vuln.fingerprint);
    }

    // Find reverse dependencies (files that import/call this file)
    const reverseDeps = getReverseDependencies(repoSlug, file.filename);
    for (const rd of reverseDeps) {
      impactedFileSet.add(rd.sourceFile);
    }

    // Detect which indexed symbols are affected by the change
    const changedLineRanges = extractChangedLineRanges(file.patch || "");
    const affectedSymbols = ctx.symbols.filter((sym) =>
      changedLineRanges.some((range) =>
        sym.lineStart != null && sym.lineEnd != null &&
        range.start <= (sym.lineEnd + 5) && range.end >= (sym.lineStart - 5),
      ),
    );

    // Generate delta insights
    const insights: string[] = [];

    // Rule 1: Guard-protected changes — tell AI about existing guards
    if (ctx.guards.length > 0 && affectedSymbols.length > 0) {
      const guardTypes = [...new Set(ctx.guards.map((g) => g.guardType))];
      insights.push(
        `INDEXED_GUARDS: The file already has ${ctx.guards.length} guard(s) of types [${guardTypes.join(", ")}]. ` +
        `Review changes in the context of these existing protections — avoid flagging issues already covered by guards.`,
      );
    }

    // Rule 2: Annotation coverage — tell AI about validation annotations
    const validationAnnotations = ctx.annotations.filter((a) =>
      a.classification === "validation" || a.classification === "security",
    );
    if (validationAnnotations.length > 0) {
      const annotNames = [...new Set(validationAnnotations.map((a) => a.annotationName))];
      insights.push(
        `INDEXED_ANNOTATIONS: File is protected by [${annotNames.join(", ")}] annotations. ` +
        `Consider these when assessing validation/security gaps.`,
      );
    }

    // Rule 2b: Lombok code-generation — warn AI about hidden generated methods
    const lombokAnnotations = ctx.annotations.filter((a) => a.classification === "lombok");
    if (lombokAnnotations.length > 0) {
      const lombokNames = [...new Set(lombokAnnotations.map((a) => a.annotationName))];
      insights.push(
        `LOMBOK: File uses [${lombokNames.join(", ")}] — these generate hidden constructors, getters/setters, builders, or toString/equals. ` +
        `Do NOT flag missing methods that Lombok auto-generates.`,
      );
    }

    // Rule 2c: ORM mapping — inform AI about entity relationships
    const ormAnnotations = ctx.annotations.filter((a) => a.classification === "orm");
    if (ormAnnotations.length > 0) {
      const ormNames = [...new Set(ormAnnotations.map((a) => a.annotationName))];
      insights.push(
        `ORM_MAPPING: File has JPA/Hibernate annotations [${ormNames.join(", ")}] defining entity persistence and relationships. ` +
        `Field changes may cascade through ORM-managed relationships.`,
      );
    }

    // Rule 2d: AOP cross-cutting advice
    const aopAnnotations = ctx.annotations.filter((a) => a.classification === "aop");
    if (aopAnnotations.length > 0) {
      const aopNames = [...new Set(aopAnnotations.map((a) => a.annotationName))];
      insights.push(
        `AOP_ADVICE: File contains aspect-oriented programming annotations [${aopNames.join(", ")}]. ` +
        `Changes may silently affect methods matched by pointcut expressions.`,
      );
    }

    // Rule 3: Dependency awareness
    if (ctx.dependencies.length > 0) {
      const serviceCallDeps = ctx.dependencies.filter((d) =>
        d.dependencyType === "injection" || d.dependencyType === "method-call" ||
        d.dependencyType === "aop-advice",
      );
      if (serviceCallDeps.length > 0) {
        const targets = [...new Set(serviceCallDeps.map((d) => d.targetSymbol).filter(Boolean))];
        insights.push(
          `DEPENDENCIES: This file depends on [${targets.join(", ")}]. ` +
          `Changes may affect downstream consumers.`,
        );
      }

      // Config-driven dependencies
      const configDeps = ctx.dependencies.filter((d) =>
        d.dependencyType === "config-class-ref" || d.dependencyType === "config-bean-ref" ||
        d.dependencyType === "config-resource",
      );
      if (configDeps.length > 0) {
        const configTargets = [...new Set(configDeps.map((d) => d.targetSymbol).filter(Boolean))];
        insights.push(
          `CONFIG_WIRING: File references config-defined beans/resources [${configTargets.slice(0, 5).join(", ")}]. ` +
          `Changes to configuration files may alter runtime behavior.`,
        );
      }
    }

    // Rule 4: Reverse dependency impact
    if (reverseDeps.length > 0) {
      insights.push(
        `IMPACTED_FILES: ${reverseDeps.length} other file(s) depend on this file: ` +
        `[${reverseDeps.slice(0, 5).map((d) => d.sourceFile).join(", ")}${reverseDeps.length > 5 ? "..." : ""}]. ` +
        `Changes may have ripple effects.`,
      );
    }

    // Rule 5: AI summary context
    if (ctx.summary) {
      insights.push(
        `FILE_PURPOSE: ${ctx.summary.summary}` +
        (ctx.summary.implicitContracts ? ` CONTRACTS: ${ctx.summary.implicitContracts}` : ""),
      );
    }

    // Rule 6: Baseline vulnerabilities
    if (ctx.baselineVulns.length > 0) {
      const acknowledged = ctx.baselineVulns.filter((v) => v.acknowledged).length;
      const unacknowledged = ctx.baselineVulns.length - acknowledged;
      if (unacknowledged > 0) {
        insights.push(
          `BASELINE_VULNS: ${ctx.baselineVulns.length} known vulnerability pattern(s) in this file ` +
          `(${acknowledged} acknowledged). Only flag NEW issues, not pre-existing baseline patterns.`,
        );
      }
    }

    fileContexts.set(file.filename, {
      filePath: file.filename,
      indexedSymbols: ctx.symbols,
      existingGuards: ctx.guards,
      existingAnnotations: ctx.annotations,
      outgoingDependencies: ctx.dependencies,
      incomingDependencies: reverseDeps,
      aiSummary: ctx.summary,
      baselineVulns: ctx.baselineVulns,
      affectedIndexedSymbols: affectedSymbols,
      deltaInsights: insights,
    });

    deltaInsightsAll.push(...insights);
  }

  // Remove changed files from impacted list (they're already being reviewed)
  const changedPaths = new Set(changedFiles.map((f) => f.filename));
  const impactedFiles = [...impactedFileSet].filter((f) => !changedPaths.has(f));

  // Build prompt enrichment
  const promptEnrichment = buildPromptEnrichment(fileContexts, impactedFiles, stats.latestRun?.completedAt);

  return {
    indexed: true,
    fileContexts,
    baselineFingerprints,
    impactedFiles,
    promptEnrichment,
  };
}

// ─── Changed line extraction (mirrored from pr-review) ─────────────────────────

function extractChangedLineRanges(patch: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(patch)) !== null) {
    const start = Number(match[1] || 0);
    const span = Number(match[2] || 1);
    ranges.push({ start, end: start + Math.max(0, span - 1) });
  }
  return ranges;
}

// ─── Prompt enrichment builder ─────────────────────────────────────────────────

function buildPromptEnrichment(
  fileContexts: Map<string, DeltaFileContext>,
  impactedFiles: string[],
  indexedAt?: string | null,
): string {
  if (fileContexts.size === 0) return "";

  const sections: string[] = [];
  sections.push("=== REPOSITORY CODE INTELLIGENCE (Pre-indexed context) ===");
  if (indexedAt) {
    sections.push(`Index last updated: ${indexedAt}`);
  }

  for (const [filePath, ctx] of fileContexts) {
    if (ctx.deltaInsights.length === 0) continue;

    sections.push(`\n--- ${filePath} ---`);
    for (const insight of ctx.deltaInsights) {
      sections.push(`  • ${insight}`);
    }

    // Symbol map
    if (ctx.affectedIndexedSymbols.length > 0) {
      sections.push("  Affected symbols (pre-indexed):");
      for (const sym of ctx.affectedIndexedSymbols.slice(0, 8)) {
        sections.push(
          `    ${sym.symbolType} ${sym.symbolName}` +
          (sym.parentSymbol ? ` in ${sym.parentSymbol}` : "") +
          ` L${sym.lineStart}-L${sym.lineEnd}`,
        );
      }
    }

    // Guard inventory
    if (ctx.existingGuards.length > 0) {
      sections.push("  Existing guards:");
      for (const guard of ctx.existingGuards.slice(0, 6)) {
        sections.push(
          `    [${guard.guardType}]${guard.protectingSymbol ? ` in ${guard.protectingSymbol}` : ""} L${guard.lineNumber}`,
        );
      }
    }
  }

  if (impactedFiles.length > 0) {
    sections.push(`\n--- Ripple impact: ${impactedFiles.length} dependent file(s) ---`);
    for (const f of impactedFiles.slice(0, 10)) {
      sections.push(`  • ${f}`);
    }
  }

  sections.push("=== END REPOSITORY CODE INTELLIGENCE ===");
  return sections.join("\n");
}

// ─── Baseline filtering helper ─────────────────────────────────────────────────

/**
 * Given a set of findings and baseline fingerprints, marks pre-existing
 * vulnerability patterns so they can be downgraded or suppressed.
 */
export function filterBaselineVulns(
  findings: Array<{ file: string; line?: number; category: string; title: string; severity: string }>,
  baselineFingerprints: Set<string>,
): Array<{ file: string; line?: number; category: string; title: string; severity: string; isBaseline: boolean }> {
  return findings.map((f) => {
    const lineBucket = f.line ? Math.floor(f.line / 10) * 10 : 0;
    const fp = `${f.file}|${f.category}|${lineBucket}`;
    return { ...f, isBaseline: baselineFingerprints.has(fp) };
  });
}
