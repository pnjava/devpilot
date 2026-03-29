// ──────────────────────────────────────────────────────────────
// GroomPilot SQLite database (legacy – migrating to Prisma)
//
// New code should use:  import { prisma } from "./prisma-client"
// Existing services continue to work against SQLite until migrated.
// ──────────────────────────────────────────────────────────────
import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "groompilot.db");

const db: DatabaseType = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id INTEGER UNIQUE NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    access_token TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    story_id TEXT,
    repo_owner TEXT,
    repo_name TEXT,
    created_by TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    snapshot_data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS grooming_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS pr_groom_links (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'bitbucket',
    project_key TEXT,
    repo_slug TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    linked_by TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (linked_by) REFERENCES users(id),
    UNIQUE(provider, project_key, repo_slug, pr_number, session_id)
  );

  CREATE TABLE IF NOT EXISTS bpe_pr_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    pr_id INTEGER NOT NULL,
    pr_title TEXT NOT NULL,
    author TEXT NOT NULL,
    merged_at TEXT NOT NULL,
    approval_count INTEGER NOT NULL DEFAULT 0,
    needs_work_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    blocker_count INTEGER NOT NULL DEFAULT 0,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    changed_files INTEGER NOT NULL DEFAULT 0,
    top_paths TEXT NOT NULL DEFAULT '[]',
    comment_samples TEXT NOT NULL DEFAULT '[]',
    fetched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, pr_id)
  );

  CREATE TABLE IF NOT EXISTS bpe_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    guidance TEXT NOT NULL,
    applies_to TEXT NOT NULL DEFAULT '[]',
    severity_signal TEXT NOT NULL DEFAULT 'warning',
    source TEXT NOT NULL DEFAULT 'ai-batch',
    batch_run_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.8,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bpe_batch_runs (
    id TEXT PRIMARY KEY,
    repo_slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    signals_fetched INTEGER NOT NULL DEFAULT 0,
    patterns_derived INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    bitbucket_name TEXT,
    organisation TEXT NOT NULL DEFAULT 'aciworldwide',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS review_suppressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_detail TEXT,
    owner TEXT NOT NULL,
    created_by TEXT,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_applied_at TEXT,
    applied_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(repo_slug, fingerprint, status)
  );

  CREATE TABLE IF NOT EXISTS review_suppression_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suppression_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (suppression_id) REFERENCES review_suppressions(id)
  );

  CREATE TABLE IF NOT EXISTS review_runs (
    id TEXT PRIMARY KEY,
    repo_slug TEXT NOT NULL,
    pr_url TEXT,
    pr_title TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    change_type TEXT NOT NULL DEFAULT 'mixed',
    risk_label TEXT NOT NULL DEFAULT 'medium',
    risk_score INTEGER NOT NULL DEFAULT 0,
    verdict TEXT NOT NULL DEFAULT 'informational',
    blockers INTEGER NOT NULL DEFAULT 0,
    warnings INTEGER NOT NULL DEFAULT 0,
    suggestions INTEGER NOT NULL DEFAULT 0,
    informational INTEGER NOT NULL DEFAULT 0,
    total_findings INTEGER NOT NULL DEFAULT 0,
    duplicate_findings INTEGER NOT NULL DEFAULT 0,
    suppressed_findings INTEGER NOT NULL DEFAULT 0,
    schema_adjusted INTEGER NOT NULL DEFAULT 0,
    high_risk_categories TEXT NOT NULL DEFAULT '[]',
    subsystems TEXT NOT NULL DEFAULT '[]',
    sensitivity TEXT NOT NULL DEFAULT '[]',
    blast_radius TEXT NOT NULL DEFAULT 'low',
    audit_trace_complete INTEGER NOT NULL DEFAULT 0,
    prompt_injection_guards_applied INTEGER NOT NULL DEFAULT 0,
    secret_redactions_applied INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    findings_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS review_finding_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    review_run_id TEXT NOT NULL,
    finding_id TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    outcome TEXT NOT NULL,
    subsystem TEXT,
    severity TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    resolved INTEGER NOT NULL DEFAULT 0,
    false_positive INTEGER NOT NULL DEFAULT 0,
    duplicate_flag INTEGER NOT NULL DEFAULT 0,
    incident_linked INTEGER NOT NULL DEFAULT 0,
    revert_linked INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(review_run_id, finding_id, reviewer)
  );

  CREATE INDEX IF NOT EXISTS idx_bpe_signals_repo_merged
    ON bpe_pr_signals(repo_slug, merged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bpe_patterns_repo_enabled
    ON bpe_patterns(repo_slug, enabled);
  CREATE INDEX IF NOT EXISTS idx_bpe_runs_repo_started
    ON bpe_batch_runs(repo_slug, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_review_suppressions_repo_status_expiry
    ON review_suppressions(repo_slug, status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_review_suppression_events_suppression_id
    ON review_suppression_events(suppression_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_review_runs_repo_completed
    ON review_runs(repo_slug, completed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_review_runs_repo_change_type
    ON review_runs(repo_slug, change_type, completed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_review_feedback_repo_created
    ON review_finding_feedback(repo_slug, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_review_feedback_reviewer
    ON review_finding_feedback(repo_slug, reviewer, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pr_groom_links_lookup
    ON pr_groom_links(provider, project_key, repo_slug, pr_number, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pr_groom_links_session
    ON pr_groom_links(session_id, created_at DESC);

  -- ═══════════════════════════════════════════════════════════════
  -- Repository Code Intelligence Engine (RCIE) Tables
  -- ═══════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS repo_index_runs (
    id TEXT PRIMARY KEY,
    repo_slug TEXT NOT NULL,
    commit_sha TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    files_indexed INTEGER NOT NULL DEFAULT 0,
    symbols_extracted INTEGER NOT NULL DEFAULT 0,
    dependencies_mapped INTEGER NOT NULL DEFAULT 0,
    annotations_found INTEGER NOT NULL DEFAULT 0,
    guards_detected INTEGER NOT NULL DEFAULT 0,
    ai_summaries_generated INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS repo_code_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    language TEXT NOT NULL,
    line_count INTEGER NOT NULL DEFAULT 0,
    subsystem TEXT,
    sensitivity TEXT NOT NULL DEFAULT '[]',
    is_generated INTEGER NOT NULL DEFAULT 0,
    is_infra_config INTEGER NOT NULL DEFAULT 0,
    is_test INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    indexed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, file_path)
  );

  CREATE TABLE IF NOT EXISTS repo_code_symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    symbol_name TEXT NOT NULL,
    symbol_type TEXT NOT NULL,
    visibility TEXT,
    is_static INTEGER NOT NULL DEFAULT 0,
    is_abstract INTEGER NOT NULL DEFAULT 0,
    line_start INTEGER,
    line_end INTEGER,
    parent_symbol TEXT,
    signature TEXT,
    return_type TEXT,
    parameter_types TEXT,
    indexed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, file_path, symbol_name, line_start)
  );

  CREATE TABLE IF NOT EXISTS repo_code_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    source_file TEXT NOT NULL,
    source_symbol TEXT,
    target_file TEXT,
    target_symbol TEXT,
    dependency_type TEXT NOT NULL,
    is_direct INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    indexed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repo_code_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    target_symbol TEXT NOT NULL,
    annotation_name TEXT NOT NULL,
    annotation_params TEXT,
    classification TEXT NOT NULL,
    line_number INTEGER,
    indexed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repo_code_guards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    protecting_symbol TEXT,
    guard_type TEXT NOT NULL,
    scope TEXT,
    evidence TEXT,
    line_number INTEGER,
    indexed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS repo_code_ai_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_responsibilities TEXT,
    inputs_outputs TEXT,
    implicit_contracts TEXT,
    content_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    generated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, file_path)
  );

  CREATE TABLE IF NOT EXISTS repo_code_baseline_vulns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER,
    pattern_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now')),
    acknowledged INTEGER NOT NULL DEFAULT 0,
    UNIQUE(repo_slug, fingerprint)
  );

  CREATE TABLE IF NOT EXISTS repo_code_graph_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    node_key TEXT NOT NULL,
    node_type TEXT NOT NULL,
    file_path TEXT,
    symbol_name TEXT,
    microservice TEXT,
    signature TEXT,
    visibility TEXT,
    return_type TEXT,
    line_start INTEGER,
    line_end INTEGER,
    method_body TEXT,
    annotations TEXT,
    metadata TEXT,
    indexed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, node_key)
  );

  CREATE TABLE IF NOT EXISTS repo_code_graph_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_slug TEXT NOT NULL,
    from_node_key TEXT NOT NULL,
    to_node_key TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    hop_weight INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    indexed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(repo_slug, from_node_key, to_node_key, edge_type)
  );

  -- ═══════════════════════════════════════════════════════════════
  -- Knowledge Warehouse Tables (Confluence / Docs / Image Context)
  -- ═══════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_space TEXT,
    source_page_id TEXT,
    title TEXT NOT NULL,
    url TEXT,
    body_excerpt TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_type, source_page_id)
  );

  CREATE TABLE IF NOT EXISTS knowledge_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    category TEXT NOT NULL,
    heading TEXT,
    content TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
  );

  CREATE TABLE IF NOT EXISTS knowledge_image_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    media_type TEXT,
    caption TEXT,
    ocr_text TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
  );

  CREATE TABLE IF NOT EXISTS knowledge_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id),
    UNIQUE(document_id, tag_type, tag_value)
  );

  CREATE TABLE IF NOT EXISTS knowledge_jira_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_key TEXT NOT NULL,
    document_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.7,
    source TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id),
    UNIQUE(jira_key, document_id)
  );

  CREATE INDEX IF NOT EXISTS idx_rcie_files_repo_path
    ON repo_code_files(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_source
    ON knowledge_documents(source_type, source_space, source_page_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_documents_title
    ON knowledge_documents(title);
  CREATE INDEX IF NOT EXISTS idx_knowledge_facts_document_category
    ON knowledge_facts(document_id, category);
  CREATE INDEX IF NOT EXISTS idx_knowledge_facts_category
    ON knowledge_facts(category);
  CREATE INDEX IF NOT EXISTS idx_knowledge_images_document
    ON knowledge_image_assets(document_id);
  CREATE INDEX IF NOT EXISTS idx_knowledge_tags_type_value
    ON knowledge_tags(tag_type, tag_value);
  CREATE INDEX IF NOT EXISTS idx_knowledge_jira_links_key
    ON knowledge_jira_links(jira_key, confidence DESC);
  CREATE INDEX IF NOT EXISTS idx_rcie_files_repo_subsystem
    ON repo_code_files(repo_slug, subsystem);
  CREATE INDEX IF NOT EXISTS idx_rcie_symbols_repo_file
    ON repo_code_symbols(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_rcie_symbols_repo_name
    ON repo_code_symbols(repo_slug, symbol_name);
  CREATE INDEX IF NOT EXISTS idx_rcie_symbols_repo_parent
    ON repo_code_symbols(repo_slug, parent_symbol);
  CREATE INDEX IF NOT EXISTS idx_rcie_deps_repo_source
    ON repo_code_dependencies(repo_slug, source_file, source_symbol);
  CREATE INDEX IF NOT EXISTS idx_rcie_deps_repo_target
    ON repo_code_dependencies(repo_slug, target_file, target_symbol);
  CREATE INDEX IF NOT EXISTS idx_rcie_deps_repo_type
    ON repo_code_dependencies(repo_slug, dependency_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_annotations_repo_file
    ON repo_code_annotations(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_rcie_annotations_repo_class
    ON repo_code_annotations(repo_slug, classification);
  CREATE INDEX IF NOT EXISTS idx_rcie_guards_repo_file
    ON repo_code_guards(repo_slug, file_path, protecting_symbol);
  CREATE INDEX IF NOT EXISTS idx_rcie_guards_repo_type
    ON repo_code_guards(repo_slug, guard_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_summaries_repo_file
    ON repo_code_ai_summaries(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_rcie_baseline_repo_file
    ON repo_code_baseline_vulns(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_rcie_baseline_repo_fp
    ON repo_code_baseline_vulns(repo_slug, fingerprint);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_nodes_repo_type
    ON repo_code_graph_nodes(repo_slug, node_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_nodes_repo_file
    ON repo_code_graph_nodes(repo_slug, file_path);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_nodes_repo_symbol
    ON repo_code_graph_nodes(repo_slug, symbol_name);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_nodes_repo_microservice
    ON repo_code_graph_nodes(repo_slug, microservice);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_edges_repo_from
    ON repo_code_graph_edges(repo_slug, from_node_key, edge_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_edges_repo_to
    ON repo_code_graph_edges(repo_slug, to_node_key, edge_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_graph_edges_repo_type
    ON repo_code_graph_edges(repo_slug, edge_type);
  CREATE INDEX IF NOT EXISTS idx_rcie_runs_repo_status
    ON repo_index_runs(repo_slug, status, started_at DESC);

  -- ═══════════════════════════════════════════════════════════════
  -- Full PR Review Output Cache
  -- ═══════════════════════════════════════════════════════════════

  CREATE TABLE IF NOT EXISTS pr_review_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pr_url TEXT NOT NULL,
    review_json TEXT NOT NULL,
    pr_meta_json TEXT NOT NULL,
    review_run_id TEXT,
    source_commit TEXT,
    pr_updated_at INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pr_url)
  );

  CREATE INDEX IF NOT EXISTS idx_pr_review_cache_url
    ON pr_review_cache(pr_url);
`);

// Migrate existing pr_review_cache table to add new columns if they don't exist
try { db.exec("ALTER TABLE pr_review_cache ADD COLUMN source_commit TEXT"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE pr_review_cache ADD COLUMN pr_updated_at INTEGER"); } catch { /* already exists */ }

export default db;
