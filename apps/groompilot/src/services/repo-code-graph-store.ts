import db from "../db";
import neo4j, { Driver } from "neo4j-driver";

export type GraphNodeType = "File" | "Class" | "Method" | "Annotation" | "Microservice";

export interface GraphNodeInput {
  nodeKey: string;
  nodeType: GraphNodeType;
  filePath?: string;
  symbolName?: string;
  microservice?: string;
  signature?: string;
  visibility?: string;
  returnType?: string;
  lineStart?: number;
  lineEnd?: number;
  methodBody?: string;
  annotations?: string[];
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeInput {
  fromNodeKey: string;
  toNodeKey: string;
  edgeType: "CALLS" | "USES" | "HAS_ANNOTATION" | "DEPENDS_ON_SERVICE" | "MICROSERVICE_LINK";
  hopWeight?: number;
  metadata?: Record<string, unknown>;
}

type GraphBackendMode = "sqlite" | "neo4j" | "memgraph" | "dual";

function graphBackendMode(): GraphBackendMode {
  const mode = String(process.env.GRAPH_BACKEND || "sqlite").trim().toLowerCase();
  if (mode === "neo4j" || mode === "memgraph" || mode === "dual") return mode;
  return "sqlite";
}

function useSqliteBackend(): boolean {
  const mode = graphBackendMode();
  return mode === "sqlite" || mode === "dual";
}

function useRemoteGraphBackend(): boolean {
  const mode = graphBackendMode();
  return mode === "neo4j" || mode === "memgraph" || mode === "dual";
}

let driverCache: Driver | null = null;

function getDriver(): Driver | null {
  if (!useRemoteGraphBackend()) return null;
  if (driverCache) return driverCache;

  const uri = process.env.GRAPH_DB_URI || "bolt://localhost:7687";
  const user = process.env.GRAPH_DB_USER || "";
  const password = process.env.GRAPH_DB_PASSWORD || "";
  const auth = user ? neo4j.auth.basic(user, password) : neo4j.auth.basic("", "");

  driverCache = neo4j.driver(uri, auth, {
    disableLosslessIntegers: true,
  });

  return driverCache;
}

async function runRemoteWrite(cypher: string, params: Record<string, unknown>): Promise<void> {
  const driver = getDriver();
  if (!driver) return;
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

async function runRemoteReadOne(cypher: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const driver = getDriver();
  if (!driver) return null;
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return (result.records[0]?.toObject() || null) as Record<string, unknown> | null;
  } finally {
    await session.close();
  }
}

function upsertGraphNodesSqlite(repoSlug: string, nodes: GraphNodeInput[]): void {
  if (nodes.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_graph_nodes
      (repo_slug, node_key, node_type, file_path, symbol_name, microservice,
       signature, visibility, return_type, line_start, line_end, method_body,
       annotations, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, node_key) DO UPDATE SET
      node_type = excluded.node_type,
      file_path = excluded.file_path,
      symbol_name = excluded.symbol_name,
      microservice = excluded.microservice,
      signature = excluded.signature,
      visibility = excluded.visibility,
      return_type = excluded.return_type,
      line_start = excluded.line_start,
      line_end = excluded.line_end,
      method_body = excluded.method_body,
      annotations = excluded.annotations,
      metadata = excluded.metadata,
      indexed_at = datetime('now')
  `);

  const tx = db.transaction((rows: GraphNodeInput[]) => {
    for (const n of rows) {
      stmt.run(
        repoSlug,
        n.nodeKey,
        n.nodeType,
        n.filePath || null,
        n.symbolName || null,
        n.microservice || null,
        n.signature || null,
        n.visibility || null,
        n.returnType || null,
        n.lineStart ?? null,
        n.lineEnd ?? null,
        n.methodBody || null,
        n.annotations ? JSON.stringify(n.annotations) : null,
        n.metadata ? JSON.stringify(n.metadata) : null,
      );
    }
  });

  tx(nodes);
}

function upsertGraphEdgesSqlite(repoSlug: string, edges: GraphEdgeInput[]): void {
  if (edges.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO repo_code_graph_edges
      (repo_slug, from_node_key, to_node_key, edge_type, hop_weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_slug, from_node_key, to_node_key, edge_type) DO UPDATE SET
      hop_weight = excluded.hop_weight,
      metadata = excluded.metadata,
      indexed_at = datetime('now')
  `);

  const tx = db.transaction((rows: GraphEdgeInput[]) => {
    for (const e of rows) {
      stmt.run(
        repoSlug,
        e.fromNodeKey,
        e.toNodeKey,
        e.edgeType,
        e.hopWeight ?? 1,
        e.metadata ? JSON.stringify(e.metadata) : null,
      );
    }
  });

  tx(edges);
}

function clearFileGraphSqlite(repoSlug: string, filePath: string): void {
  db.prepare(`
    DELETE FROM repo_code_graph_edges
    WHERE repo_slug = ?
      AND (
        from_node_key IN (SELECT node_key FROM repo_code_graph_nodes WHERE repo_slug = ? AND file_path = ?)
        OR to_node_key IN (SELECT node_key FROM repo_code_graph_nodes WHERE repo_slug = ? AND file_path = ?)
      )
  `).run(repoSlug, repoSlug, filePath, repoSlug, filePath);

  db.prepare(`
    DELETE FROM repo_code_graph_nodes
    WHERE repo_slug = ? AND file_path = ?
  `).run(repoSlug, filePath);
}

function clearRepoGraphSqlite(repoSlug: string): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM repo_code_graph_edges WHERE repo_slug = ?").run(repoSlug);
    db.prepare("DELETE FROM repo_code_graph_nodes WHERE repo_slug = ?").run(repoSlug);
  });
  tx();
}

function getGraphStatsSqlite(repoSlug: string): { nodeCount: number; edgeCount: number } {
  const nodeRow = db.prepare("SELECT COUNT(*) AS count FROM repo_code_graph_nodes WHERE repo_slug = ?").get(repoSlug) as { count: number };
  const edgeRow = db.prepare("SELECT COUNT(*) AS count FROM repo_code_graph_edges WHERE repo_slug = ?").get(repoSlug) as { count: number };
  return {
    nodeCount: Number(nodeRow?.count || 0),
    edgeCount: Number(edgeRow?.count || 0),
  };
}

async function upsertGraphNodesRemote(repoSlug: string, nodes: GraphNodeInput[]): Promise<void> {
  if (nodes.length === 0) return;

  await runRemoteWrite(
    `
    UNWIND $nodes AS row
    MERGE (n:CodeNode {repo_slug: $repoSlug, node_key: row.nodeKey})
    SET n.node_type = row.nodeType,
        n.file_path = row.filePath,
        n.symbol_name = row.symbolName,
        n.microservice = row.microservice,
        n.signature = row.signature,
        n.visibility = row.visibility,
        n.return_type = row.returnType,
        n.line_start = row.lineStart,
        n.line_end = row.lineEnd,
        n.method_body = row.methodBody,
        n.annotations = row.annotations,
        n.metadata = row.metadata,
        n.indexed_at = datetime()
    `,
    {
      repoSlug,
      nodes: nodes.map((n) => ({
        nodeKey: n.nodeKey,
        nodeType: n.nodeType,
        filePath: n.filePath || null,
        symbolName: n.symbolName || null,
        microservice: n.microservice || null,
        signature: n.signature || null,
        visibility: n.visibility || null,
        returnType: n.returnType || null,
        lineStart: n.lineStart ?? null,
        lineEnd: n.lineEnd ?? null,
        methodBody: n.methodBody || null,
        annotations: n.annotations || null,
        metadata: n.metadata || null,
      })),
    },
  );
}

async function upsertGraphEdgesRemote(repoSlug: string, edges: GraphEdgeInput[]): Promise<void> {
  if (edges.length === 0) return;

  await runRemoteWrite(
    `
    UNWIND $edges AS row
    MATCH (from:CodeNode {repo_slug: $repoSlug, node_key: row.fromNodeKey})
    MATCH (to:CodeNode {repo_slug: $repoSlug, node_key: row.toNodeKey})
    MERGE (from)-[r:CODE_EDGE {
      repo_slug: $repoSlug,
      from_node_key: row.fromNodeKey,
      to_node_key: row.toNodeKey,
      edge_type: row.edgeType
    }]->(to)
    SET r.hop_weight = row.hopWeight,
        r.metadata = row.metadata,
        r.indexed_at = datetime()
    `,
    {
      repoSlug,
      edges: edges.map((e) => ({
        fromNodeKey: e.fromNodeKey,
        toNodeKey: e.toNodeKey,
        edgeType: e.edgeType,
        hopWeight: e.hopWeight ?? 1,
        metadata: e.metadata || null,
      })),
    },
  );
}

async function clearFileGraphRemote(repoSlug: string, filePath: string): Promise<void> {
  await runRemoteWrite(
    `
    MATCH (n:CodeNode {repo_slug: $repoSlug, file_path: $filePath})
    DETACH DELETE n
    `,
    { repoSlug, filePath },
  );

  await runRemoteWrite(
    `
    MATCH ()-[r:CODE_EDGE {repo_slug: $repoSlug}]->()
    WHERE r.from_node_key STARTS WITH $filePrefix
       OR r.to_node_key STARTS WITH $filePrefix
    DELETE r
    `,
    { repoSlug, filePrefix: `file:${filePath}` },
  );
}

async function clearRepoGraphRemote(repoSlug: string): Promise<void> {
  await runRemoteWrite(
    `
    MATCH (n:CodeNode {repo_slug: $repoSlug})
    DETACH DELETE n
    `,
    { repoSlug },
  );
}

async function getGraphStatsRemote(repoSlug: string): Promise<{ nodeCount: number; edgeCount: number }> {
  const node = await runRemoteReadOne(
    "MATCH (n:CodeNode {repo_slug: $repoSlug}) RETURN count(n) AS nodeCount",
    { repoSlug },
  );
  const edge = await runRemoteReadOne(
    "MATCH ()-[r:CODE_EDGE {repo_slug: $repoSlug}]->() RETURN count(r) AS edgeCount",
    { repoSlug },
  );

  return {
    nodeCount: Number(node?.nodeCount || 0),
    edgeCount: Number(edge?.edgeCount || 0),
  };
}

export async function upsertGraphNodes(repoSlug: string, nodes: GraphNodeInput[]): Promise<void> {
  if (useSqliteBackend()) {
    upsertGraphNodesSqlite(repoSlug, nodes);
  }
  if (useRemoteGraphBackend()) {
    await upsertGraphNodesRemote(repoSlug, nodes);
  }
}

export async function upsertGraphEdges(repoSlug: string, edges: GraphEdgeInput[]): Promise<void> {
  if (useSqliteBackend()) {
    upsertGraphEdgesSqlite(repoSlug, edges);
  }
  if (useRemoteGraphBackend()) {
    await upsertGraphEdgesRemote(repoSlug, edges);
  }
}

export async function clearFileGraph(repoSlug: string, filePath: string): Promise<void> {
  if (useSqliteBackend()) {
    clearFileGraphSqlite(repoSlug, filePath);
  }
  if (useRemoteGraphBackend()) {
    await clearFileGraphRemote(repoSlug, filePath);
  }
}

export async function clearRepoGraph(repoSlug: string): Promise<void> {
  if (useSqliteBackend()) {
    clearRepoGraphSqlite(repoSlug);
  }
  if (useRemoteGraphBackend()) {
    await clearRepoGraphRemote(repoSlug);
  }
}

export async function getGraphStats(repoSlug: string): Promise<{ nodeCount: number; edgeCount: number }> {
  if (useRemoteGraphBackend() && !useSqliteBackend()) {
    return getGraphStatsRemote(repoSlug);
  }
  return getGraphStatsSqlite(repoSlug);
}
