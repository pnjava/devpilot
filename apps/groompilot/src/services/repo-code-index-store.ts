import { v4 as uuidv4 } from "uuid";
import db from "../db";

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface DbIndexRun {
  id: string;
  repoSlug: string;
  commitSha: string | null;
  status: "running" | "completed" | "failed";
  filesIndexed: number;
  symbolsExtracted: number;
  dependenciesMapped: number;
  annotationsFound: number;
  guardsDetected: number;
  aiSummariesGenerated: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
}

export interface DbCodeFile {
  id: number;
  repoSlug: string;
  filePath: string;
  commitSha: string;
  language: string;
  lineCount: number;
  subsystem: string | null;
  sensitivity: string[];
  isGenerated: boolean;
  isInfraConfig: boolean;
  isTest: boolean;
  contentHash: string;
  indexedAt: string;
}

export interface DbCodeSymbol {
  id: number;
  repoSlug: string;
  filePath: string;
  symbolName: string;
  symbolType: string;
  visibility: string | null;
  isStatic: boolean;
  isAbstract: boolean;
  lineStart: number | null;
  lineEnd: number | null;
  parentSymbol: string | null;
  signature: string | null;
  returnType: string | null;
  parameterTypes: string | null;
  indexedAt: string;
}

export interface DbCodeDependency {
  id: number;
  repoSlug: string;
  sourceFile: string;
  sourceSymbol: string | null;
  targetFile: string | null;
  targetSymbol: string | null;
  dependencyType: string;
  isDirect: boolean;
  metadata: Record<string, unknown> | null;
  indexedAt: string;
}

export interface DbCodeAnnotation {
  id: number;
  repoSlug: string;
  filePath: string;
  targetSymbol: string;
  annotationName: string;
  annotationParams: string | null;
  classification: string;
  lineNumber: number | null;
  indexedAt: string;
}

export interface DbCodeGuard {
  id: number;
  repoSlug: string;
  filePath: string;
  protectingSymbol: string | null;
  guardType: string;
  scope: string | null;
  evidence: string | null;
  lineNumber: number | null;
  indexedAt: string;
}

export interface DbAISummary {
  id: number;
  repoSlug: string;
  filePath: string;
  summary: string;
  keyResponsibilities: string | null;
  inputsOutputs: string | null;
  implicitContracts: string | null;
  contentHash: string;
  provider: string;
  model: string;
  generatedAt: string;
}

export interface DbBaselineVuln {
  id: number;
  repoSlug: string;
  filePath: string;
  lineNumber: number | null;
  patternType: string;
  severity: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledged: boolean;
}

// ─── Input types ───────────────────────────────────────────────────────────────

export interface UpsertCodeFileInput {
  filePath: string;
  commitSha: string;
  language: string;
  lineCount: number;
  subsystem?: string;
  sensitivity?: string[];
  isGenerated?: boolean;
  isInfraConfig?: boolean;
  isTest?: boolean;
  contentHash: string;
}

export interface InsertSymbolInput {
  filePath: string;
  symbolName: string;
  symbolType: string;
  visibility?: string;
  isStatic?: boolean;
  isAbstract?: boolean;
  lineStart?: number;
  lineEnd?: number;
  parentSymbol?: string;
  signature?: string;
  returnType?: string;
  parameterTypes?: string;
}

export interface InsertDependencyInput {
  sourceFile: string;
  sourceSymbol?: string;
  targetFile?: string;
  targetSymbol?: string;
  dependencyType: string;
  isDirect?: boolean;
  metadata?: Record<string, unknown>;
}

export interface InsertAnnotationInput {
  filePath: string;
  targetSymbol: string;
  annotationName: string;
  annotationParams?: string;
  classification: string;
  lineNumber?: number;
}

export interface InsertGuardInput {
  filePath: string;
  protectingSymbol?: string;
  guardType: string;
  scope?: string;
  evidence?: string;
  lineNumber?: number;
}

export interface UpsertAISummaryInput {
  filePath: string;
  summary: string;
  keyResponsibilities?: string;
  inputsOutputs?: string;
  implicitContracts?: string;
  contentHash: string;
  provider: string;
  model: string;
}

export interface UpsertBaselineVulnInput {
  filePath: string;
  lineNumber?: number;
  patternType: string;
  severity: string;
  fingerprint: string;
}

// ─── Row mappers ───────────────────────────────────────────────────────────────

function mapIndexRunRow(row: any): DbIndexRun {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    commitSha: row.commit_sha || null,
    status: row.status,
    filesIndexed: Number(row.files_indexed || 0),
    symbolsExtracted: Number(row.symbols_extracted || 0),
    dependenciesMapped: Number(row.dependencies_mapped || 0),
    annotationsFound: Number(row.annotations_found || 0),
    guardsDetected: Number(row.guards_detected || 0),
    aiSummariesGenerated: Number(row.ai_summaries_generated || 0),
    error: row.error || null,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
    durationMs: Number(row.duration_ms || 0),
  };
}

function mapCodeFileRow(row: any): DbCodeFile {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    commitSha: row.commit_sha,
    language: row.language,
    lineCount: Number(row.line_count || 0),
    subsystem: row.subsystem || null,
    sensitivity: JSON.parse(row.sensitivity || "[]"),
    isGenerated: Number(row.is_generated || 0) === 1,
    isInfraConfig: Number(row.is_infra_config || 0) === 1,
    isTest: Number(row.is_test || 0) === 1,
    contentHash: row.content_hash,
    indexedAt: row.indexed_at,
  };
}

function mapSymbolRow(row: any): DbCodeSymbol {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    symbolName: row.symbol_name,
    symbolType: row.symbol_type,
    visibility: row.visibility || null,
    isStatic: Number(row.is_static || 0) === 1,
    isAbstract: Number(row.is_abstract || 0) === 1,
    lineStart: row.line_start != null ? Number(row.line_start) : null,
    lineEnd: row.line_end != null ? Number(row.line_end) : null,
    parentSymbol: row.parent_symbol || null,
    signature: row.signature || null,
    returnType: row.return_type || null,
    parameterTypes: row.parameter_types || null,
    indexedAt: row.indexed_at,
  };
}

function mapDependencyRow(row: any): DbCodeDependency {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    sourceFile: row.source_file,
    sourceSymbol: row.source_symbol || null,
    targetFile: row.target_file || null,
    targetSymbol: row.target_symbol || null,
    dependencyType: row.dependency_type,
    isDirect: Number(row.is_direct || 0) === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    indexedAt: row.indexed_at,
  };
}

function mapAnnotationRow(row: any): DbCodeAnnotation {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    targetSymbol: row.target_symbol,
    annotationName: row.annotation_name,
    annotationParams: row.annotation_params || null,
    classification: row.classification,
    lineNumber: row.line_number != null ? Number(row.line_number) : null,
    indexedAt: row.indexed_at,
  };
}

function mapGuardRow(row: any): DbCodeGuard {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    protectingSymbol: row.protecting_symbol || null,
    guardType: row.guard_type,
    scope: row.scope || null,
    evidence: row.evidence || null,
    lineNumber: row.line_number != null ? Number(row.line_number) : null,
    indexedAt: row.indexed_at,
  };
}

function mapAISummaryRow(row: any): DbAISummary {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    summary: row.summary,
    keyResponsibilities: row.key_responsibilities || null,
    inputsOutputs: row.inputs_outputs || null,
    implicitContracts: row.implicit_contracts || null,
    contentHash: row.content_hash,
    provider: row.provider,
    model: row.model,
    generatedAt: row.generated_at,
  };
}

function mapBaselineVulnRow(row: any): DbBaselineVuln {
  return {
    id: row.id,
    repoSlug: row.repo_slug,
    filePath: row.file_path,
    lineNumber: row.line_number != null ? Number(row.line_number) : null,
    patternType: row.pattern_type,
    severity: row.severity,
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    acknowledged: Number(row.acknowledged || 0) === 1,
  };
}

// ─── Index Run CRUD ────────────────────────────────────────────────────────────

export function startIndexRun(repoSlug: string, commitSha?: string): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO repo_index_runs (id, repo_slug, commit_sha, status)
    VALUES (?, ?, ?, 'running')
  `).run(id, repoSlug, commitSha || null);
  return id;
}

export function completeIndexRun(id: string, stats: {
  filesIndexed: number;
  symbolsExtracted: number;
  dependenciesMapped: number;
  annotationsFound: number;
  guardsDetected: number;
  aiSummariesGenerated: number;
  durationMs: number;
}): void {
  db.prepare(`
    UPDATE repo_index_runs
    SET status = 'completed',
        files_indexed = ?, symbols_extracted = ?, dependencies_mapped = ?,
        annotations_found = ?, guards_detected = ?, ai_summaries_generated = ?,
        duration_ms = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(
    stats.filesIndexed, stats.symbolsExtracted, stats.dependenciesMapped,
    stats.annotationsFound, stats.guardsDetected, stats.aiSummariesGenerated,
    stats.durationMs, id,
  );
}

export function failIndexRun(id: string, error: string): void {
  db.prepare(`
    UPDATE repo_index_runs
    SET status = 'failed', error = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(error, id);
}

export function getLatestIndexRun(repoSlug: string): DbIndexRun | null {
  const row = db.prepare(`
    SELECT * FROM repo_index_runs
    WHERE repo_slug = ?
    ORDER BY started_at DESC LIMIT 1
  `).get(repoSlug) as any;
  return row ? mapIndexRunRow(row) : null;
}

export function getIndexRunHistory(repoSlug: string, limit = 10): DbIndexRun[] {
  const rows = db.prepare(`
    SELECT * FROM repo_index_runs
    WHERE repo_slug = ?
    ORDER BY started_at DESC LIMIT ?
  `).all(repoSlug, limit) as any[];
  return rows.map(mapIndexRunRow);
}

// ─── Code Files CRUD ───────────────────────────────────────────────────────────

export function upsertCodeFiles(repoSlug: string, files: UpsertCodeFileInput[]): void {
  if (files.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_files
      (repo_slug, file_path, commit_sha, language, line_count, subsystem, sensitivity,
       is_generated, is_infra_config, is_test, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, file_path) DO UPDATE SET
      commit_sha = excluded.commit_sha,
      language = excluded.language,
      line_count = excluded.line_count,
      subsystem = excluded.subsystem,
      sensitivity = excluded.sensitivity,
      is_generated = excluded.is_generated,
      is_infra_config = excluded.is_infra_config,
      is_test = excluded.is_test,
      content_hash = excluded.content_hash,
      indexed_at = datetime('now')
  `);

  const tx = db.transaction((rows: UpsertCodeFileInput[]) => {
    for (const f of rows) {
      stmt.run(
        repoSlug, f.filePath, f.commitSha, f.language, f.lineCount,
        f.subsystem || null, JSON.stringify(f.sensitivity || []),
        f.isGenerated ? 1 : 0, f.isInfraConfig ? 1 : 0, f.isTest ? 1 : 0,
        f.contentHash,
      );
    }
  });

  tx(files);
}

export function getCodeFile(repoSlug: string, filePath: string): DbCodeFile | null {
  const row = db.prepare(`
    SELECT * FROM repo_code_files WHERE repo_slug = ? AND file_path = ?
  `).get(repoSlug, filePath) as any;
  return row ? mapCodeFileRow(row) : null;
}

export function getCodeFilesBySubsystem(repoSlug: string, subsystem: string): DbCodeFile[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_files
    WHERE repo_slug = ? AND subsystem = ?
    ORDER BY file_path
  `).all(repoSlug, subsystem) as any[];
  return rows.map(mapCodeFileRow);
}

export function getAllCodeFiles(repoSlug: string): DbCodeFile[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_files WHERE repo_slug = ? ORDER BY file_path
  `).all(repoSlug) as any[];
  return rows.map(mapCodeFileRow);
}

export function getCodeFileCount(repoSlug: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM repo_code_files WHERE repo_slug = ?",
  ).get(repoSlug) as { count: number };
  return Number(row?.count || 0);
}

export function deleteCodeFilesForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_files WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Symbols CRUD ──────────────────────────────────────────────────────────────

export function insertSymbols(repoSlug: string, symbols: InsertSymbolInput[]): void {
  if (symbols.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_symbols
      (repo_slug, file_path, symbol_name, symbol_type, visibility, is_static, is_abstract,
       line_start, line_end, parent_symbol, signature, return_type, parameter_types)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, file_path, symbol_name, line_start) DO UPDATE SET
      symbol_type = excluded.symbol_type,
      visibility = excluded.visibility,
      is_static = excluded.is_static,
      is_abstract = excluded.is_abstract,
      line_end = excluded.line_end,
      parent_symbol = excluded.parent_symbol,
      signature = excluded.signature,
      return_type = excluded.return_type,
      parameter_types = excluded.parameter_types,
      indexed_at = datetime('now')
  `);

  const tx = db.transaction((rows: InsertSymbolInput[]) => {
    for (const s of rows) {
      stmt.run(
        repoSlug, s.filePath, s.symbolName, s.symbolType,
        s.visibility || null, s.isStatic ? 1 : 0, s.isAbstract ? 1 : 0,
        s.lineStart ?? null, s.lineEnd ?? null, s.parentSymbol || null,
        s.signature || null, s.returnType || null, s.parameterTypes || null,
      );
    }
  });

  tx(symbols);
}

export function getSymbolsForFile(repoSlug: string, filePath: string): DbCodeSymbol[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_symbols
    WHERE repo_slug = ? AND file_path = ?
    ORDER BY line_start
  `).all(repoSlug, filePath) as any[];
  return rows.map(mapSymbolRow);
}

export function findSymbolByName(repoSlug: string, symbolName: string): DbCodeSymbol[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_symbols
    WHERE repo_slug = ? AND symbol_name = ?
    ORDER BY file_path, line_start
  `).all(repoSlug, symbolName) as any[];
  return rows.map(mapSymbolRow);
}

export function getSymbolCountForRepo(repoSlug: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM repo_code_symbols WHERE repo_slug = ?",
  ).get(repoSlug) as { count: number };
  return Number(row?.count || 0);
}

export function deleteSymbolsForFile(repoSlug: string, filePath: string): number {
  return db.prepare(
    "DELETE FROM repo_code_symbols WHERE repo_slug = ? AND file_path = ?",
  ).run(repoSlug, filePath).changes;
}

export function deleteSymbolsForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_symbols WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Dependencies CRUD ─────────────────────────────────────────────────────────

export function insertDependencies(repoSlug: string, deps: InsertDependencyInput[]): void {
  if (deps.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_dependencies
      (repo_slug, source_file, source_symbol, target_file, target_symbol,
       dependency_type, is_direct, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: InsertDependencyInput[]) => {
    for (const d of rows) {
      stmt.run(
        repoSlug, d.sourceFile, d.sourceSymbol || null,
        d.targetFile || null, d.targetSymbol || null,
        d.dependencyType, d.isDirect !== false ? 1 : 0,
        d.metadata ? JSON.stringify(d.metadata) : null,
      );
    }
  });

  tx(deps);
}

export function getDependenciesFrom(repoSlug: string, sourceFile: string): DbCodeDependency[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_dependencies
    WHERE repo_slug = ? AND source_file = ?
    ORDER BY dependency_type, target_file
  `).all(repoSlug, sourceFile) as any[];
  return rows.map(mapDependencyRow);
}

export function getDependenciesTo(repoSlug: string, targetFile: string): DbCodeDependency[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_dependencies
    WHERE repo_slug = ? AND target_file = ?
    ORDER BY dependency_type, source_file
  `).all(repoSlug, targetFile) as any[];
  return rows.map(mapDependencyRow);
}

export function getDependencyCountForRepo(repoSlug: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM repo_code_dependencies WHERE repo_slug = ?",
  ).get(repoSlug) as { count: number };
  return Number(row?.count || 0);
}

export function deleteDependenciesForFile(repoSlug: string, filePath: string): number {
  return db.prepare(
    "DELETE FROM repo_code_dependencies WHERE repo_slug = ? AND (source_file = ? OR target_file = ?)",
  ).run(repoSlug, filePath, filePath).changes;
}

export function deleteDependenciesForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_dependencies WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Annotations CRUD ──────────────────────────────────────────────────────────

export function insertAnnotations(repoSlug: string, annotations: InsertAnnotationInput[]): void {
  if (annotations.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_annotations
      (repo_slug, file_path, target_symbol, annotation_name, annotation_params,
       classification, line_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: InsertAnnotationInput[]) => {
    for (const a of rows) {
      stmt.run(
        repoSlug, a.filePath, a.targetSymbol, a.annotationName,
        a.annotationParams || null, a.classification, a.lineNumber ?? null,
      );
    }
  });

  tx(annotations);
}

export function getAnnotationsForFile(repoSlug: string, filePath: string): DbCodeAnnotation[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_annotations
    WHERE repo_slug = ? AND file_path = ?
    ORDER BY line_number
  `).all(repoSlug, filePath) as any[];
  return rows.map(mapAnnotationRow);
}

export function getAnnotationsByClassification(repoSlug: string, classification: string): DbCodeAnnotation[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_annotations
    WHERE repo_slug = ? AND classification = ?
    ORDER BY file_path, line_number
  `).all(repoSlug, classification) as any[];
  return rows.map(mapAnnotationRow);
}

export function deleteAnnotationsForFile(repoSlug: string, filePath: string): number {
  return db.prepare(
    "DELETE FROM repo_code_annotations WHERE repo_slug = ? AND file_path = ?",
  ).run(repoSlug, filePath).changes;
}

export function deleteAnnotationsForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_annotations WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Guards CRUD ───────────────────────────────────────────────────────────────

export function insertGuards(repoSlug: string, guards: InsertGuardInput[]): void {
  if (guards.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_guards
      (repo_slug, file_path, protecting_symbol, guard_type, scope, evidence, line_number)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: InsertGuardInput[]) => {
    for (const g of rows) {
      stmt.run(
        repoSlug, g.filePath, g.protectingSymbol || null,
        g.guardType, g.scope || null, g.evidence || null,
        g.lineNumber ?? null,
      );
    }
  });

  tx(guards);
}

export function getGuardsForFile(repoSlug: string, filePath: string): DbCodeGuard[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_guards
    WHERE repo_slug = ? AND file_path = ?
    ORDER BY line_number
  `).all(repoSlug, filePath) as any[];
  return rows.map(mapGuardRow);
}

export function getGuardsByType(repoSlug: string, guardType: string): DbCodeGuard[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_guards
    WHERE repo_slug = ? AND guard_type = ?
    ORDER BY file_path, line_number
  `).all(repoSlug, guardType) as any[];
  return rows.map(mapGuardRow);
}

export function deleteGuardsForFile(repoSlug: string, filePath: string): number {
  return db.prepare(
    "DELETE FROM repo_code_guards WHERE repo_slug = ? AND file_path = ?",
  ).run(repoSlug, filePath).changes;
}

export function deleteGuardsForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_guards WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── AI Summaries CRUD ─────────────────────────────────────────────────────────

export function upsertAISummaries(repoSlug: string, summaries: UpsertAISummaryInput[]): void {
  if (summaries.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_ai_summaries
      (repo_slug, file_path, summary, key_responsibilities, inputs_outputs,
       implicit_contracts, content_hash, provider, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, file_path) DO UPDATE SET
      summary = excluded.summary,
      key_responsibilities = excluded.key_responsibilities,
      inputs_outputs = excluded.inputs_outputs,
      implicit_contracts = excluded.implicit_contracts,
      content_hash = excluded.content_hash,
      provider = excluded.provider,
      model = excluded.model,
      generated_at = datetime('now')
  `);

  const tx = db.transaction((rows: UpsertAISummaryInput[]) => {
    for (const s of rows) {
      stmt.run(
        repoSlug, s.filePath, s.summary,
        s.keyResponsibilities || null, s.inputsOutputs || null,
        s.implicitContracts || null, s.contentHash, s.provider, s.model,
      );
    }
  });

  tx(summaries);
}

export function getAISummary(repoSlug: string, filePath: string): DbAISummary | null {
  const row = db.prepare(`
    SELECT * FROM repo_code_ai_summaries WHERE repo_slug = ? AND file_path = ?
  `).get(repoSlug, filePath) as any;
  return row ? mapAISummaryRow(row) : null;
}

export function getAISummariesForRepo(repoSlug: string): DbAISummary[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_ai_summaries WHERE repo_slug = ? ORDER BY file_path
  `).all(repoSlug) as any[];
  return rows.map(mapAISummaryRow);
}

export function deleteAISummariesForFile(repoSlug: string, filePath: string): number {
  return db.prepare(
    "DELETE FROM repo_code_ai_summaries WHERE repo_slug = ? AND file_path = ?",
  ).run(repoSlug, filePath).changes;
}

export function deleteAISummariesForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_ai_summaries WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Baseline Vulnerabilities CRUD ─────────────────────────────────────────────

export function upsertBaselineVulns(repoSlug: string, vulns: UpsertBaselineVulnInput[]): void {
  if (vulns.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_baseline_vulns
      (repo_slug, file_path, line_number, pattern_type, severity, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, fingerprint) DO UPDATE SET
      file_path = excluded.file_path,
      line_number = excluded.line_number,
      severity = excluded.severity,
      last_seen_at = datetime('now')
  `);

  const tx = db.transaction((rows: UpsertBaselineVulnInput[]) => {
    for (const v of rows) {
      stmt.run(
        repoSlug, v.filePath, v.lineNumber ?? null,
        v.patternType, v.severity, v.fingerprint,
      );
    }
  });

  tx(vulns);
}

export function getBaselineVulnsForFile(repoSlug: string, filePath: string): DbBaselineVuln[] {
  const rows = db.prepare(`
    SELECT * FROM repo_code_baseline_vulns
    WHERE repo_slug = ? AND file_path = ?
    ORDER BY line_number
  `).all(repoSlug, filePath) as any[];
  return rows.map(mapBaselineVulnRow);
}

export function getBaselineVulnByFingerprint(repoSlug: string, fingerprint: string): DbBaselineVuln | null {
  const row = db.prepare(`
    SELECT * FROM repo_code_baseline_vulns
    WHERE repo_slug = ? AND fingerprint = ?
  `).get(repoSlug, fingerprint) as any;
  return row ? mapBaselineVulnRow(row) : null;
}

export function acknowledgeBaselineVuln(repoSlug: string, fingerprint: string): boolean {
  return db.prepare(`
    UPDATE repo_code_baseline_vulns
    SET acknowledged = 1
    WHERE repo_slug = ? AND fingerprint = ?
  `).run(repoSlug, fingerprint).changes > 0;
}

export function deleteBaselineVulnsForRepo(repoSlug: string): number {
  return db.prepare("DELETE FROM repo_code_baseline_vulns WHERE repo_slug = ?").run(repoSlug).changes;
}

// ─── Bulk cleanup for re-indexing a file ───────────────────────────────────────

export function clearFileIndex(repoSlug: string, filePath: string): void {
  const tx = db.transaction(() => {
    deleteSymbolsForFile(repoSlug, filePath);
    deleteDependenciesForFile(repoSlug, filePath);
    deleteAnnotationsForFile(repoSlug, filePath);
    deleteGuardsForFile(repoSlug, filePath);
  });
  tx();
}

export function clearRepoIndex(repoSlug: string): void {
  const tx = db.transaction(() => {
    deleteCodeFilesForRepo(repoSlug);
    deleteSymbolsForRepo(repoSlug);
    deleteDependenciesForRepo(repoSlug);
    deleteAnnotationsForRepo(repoSlug);
    deleteGuardsForRepo(repoSlug);
    deleteAISummariesForRepo(repoSlug);
    deleteBaselineVulnsForRepo(repoSlug);
  });
  tx();
}

// ─── Query helpers for delta resolution ────────────────────────────────────────

export function getIndexedContext(repoSlug: string, filePath: string): {
  file: DbCodeFile | null;
  symbols: DbCodeSymbol[];
  dependencies: DbCodeDependency[];
  annotations: DbCodeAnnotation[];
  guards: DbCodeGuard[];
  summary: DbAISummary | null;
  baselineVulns: DbBaselineVuln[];
} {
  return {
    file: getCodeFile(repoSlug, filePath),
    symbols: getSymbolsForFile(repoSlug, filePath),
    dependencies: getDependenciesFrom(repoSlug, filePath),
    annotations: getAnnotationsForFile(repoSlug, filePath),
    guards: getGuardsForFile(repoSlug, filePath),
    summary: getAISummary(repoSlug, filePath),
    baselineVulns: getBaselineVulnsForFile(repoSlug, filePath),
  };
}

export function getReverseDependencies(repoSlug: string, filePath: string): DbCodeDependency[] {
  return getDependenciesTo(repoSlug, filePath);
}

export function getRepoIndexStats(repoSlug: string): {
  fileCount: number;
  symbolCount: number;
  dependencyCount: number;
  latestRun: DbIndexRun | null;
} {
  return {
    fileCount: getCodeFileCount(repoSlug),
    symbolCount: getSymbolCountForRepo(repoSlug),
    dependencyCount: getDependencyCountForRepo(repoSlug),
    latestRun: getLatestIndexRun(repoSlug),
  };
}
