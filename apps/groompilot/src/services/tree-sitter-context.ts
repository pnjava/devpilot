import type { PRFile } from "./pr-review";

type TsLanguage = "java" | "groovy" | "python" | "typescript" | "javascript" | "c" | "cpp";

export interface ChangedLineRange {
  start: number;
  end: number;
}

export interface HunkAstContext {
  hunkStartLine: number;
  hunkEndLine: number;
  enclosingSymbol?: string;
  enclosingContainer?: string;
  parentAstPath: string[];
  nearbySiblingNodeTypes: string[];
  functionSignature?: string;
  referencedIdentifiers: string[];
  securitySensitiveApis: string[];
}

export interface ContextGraphNode {
  id: string;
  kind: "file" | "symbol" | "import" | "api" | "identifier";
  label: string;
}

export interface ContextGraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface TreeSitterFileContext {
  filePath: string;
  language: string;
  changedRanges: ChangedLineRange[];
  imports: string[];
  referencedIdentifiers: string[];
  securitySensitiveApis: string[];
  sensitiveOperations: string[];
  hunks: HunkAstContext[];
  subgraph: {
    nodes: ContextGraphNode[];
    edges: ContextGraphEdge[];
  };
}

export interface TreeSitterContextResult {
  enabled: boolean;
  fileContexts: TreeSitterFileContext[];
  parserLanguagesAvailable: string[];
  failures: Array<{ filePath: string; reason: string }>;
}

interface TsParserLike {
  setLanguage(language: any): void;
  parse(content: string): any;
}

let parserCtorCache: any;
const grammarCache = new Map<string, any>();

function shouldEnableTreeSitter(): boolean {
  return (process.env.REVIEW_TREE_SITTER_ENABLED || "true").toLowerCase() !== "false";
}

function detectLanguage(filePath: string): TsLanguage | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".groovy")) return "groovy";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
  if (lower.endsWith(".cc") || lower.endsWith(".cpp") || lower.endsWith(".cxx") || lower.endsWith(".hpp") || lower.endsWith(".hh") || lower.endsWith(".hxx")) return "cpp";
  return null;
}

function tryLoadParserCtor(): any | null {
  if (parserCtorCache) return parserCtorCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    parserCtorCache = require("tree-sitter");
    return parserCtorCache;
  } catch {
    return null;
  }
}

function tryLoadGrammar(language: TsLanguage): any | null {
  if (grammarCache.has(language)) return grammarCache.get(language) || null;

  try {
    let grammar: any;
    if (language === "java") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-java");
    } else if (language === "groovy") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-groovy");
    } else if (language === "python") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-python");
    } else if (language === "javascript") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-javascript");
    } else if (language === "typescript") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ts = require("tree-sitter-typescript");
      grammar = ts.typescript || ts;
    } else if (language === "c") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-c");
    } else if (language === "cpp") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      grammar = require("tree-sitter-cpp");
    }

    grammarCache.set(language, grammar || null);
    return grammar || null;
  } catch {
    grammarCache.set(language, null);
    return null;
  }
}

function buildParser(language: TsLanguage): TsParserLike | null {
  const Parser = tryLoadParserCtor();
  if (!Parser) return null;

  const grammar = tryLoadGrammar(language);
  if (!grammar) return null;

  try {
    const parser = new Parser();
    parser.setLanguage(grammar);
    return parser as TsParserLike;
  } catch {
    return null;
  }
}

function extractChangedLineRanges(patch: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  const regex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(patch)) !== null) {
    const start = Number(match[1] || 0);
    const span = Number(match[2] || 1);
    ranges.push({ start, end: start + Math.max(0, span - 1) });
  }
  return ranges;
}

function nodeText(content: string, node: any): string {
  if (!node) return "";
  const startIndex = Math.max(0, Number(node.startIndex || 0));
  const endIndex = Math.max(startIndex, Number(node.endIndex || startIndex));
  return content.slice(startIndex, endIndex);
}

function findEnclosingNode(node: any): any {
  const interesting = new Set([
    "method_declaration", "function_declaration", "function_definition",
    "class_declaration", "class_definition", "constructor_declaration",
    "interface_declaration", "enum_declaration", "module",
  ]);

  let cur = node;
  while (cur) {
    if (interesting.has(String(cur.type || ""))) return cur;
    cur = cur.parent;
  }
  return node;
}

function findContainerNode(node: any): any {
  const containers = new Set(["class_declaration", "class_definition", "interface_declaration", "enum_declaration", "module", "program"]);
  let cur = node;
  while (cur) {
    if (containers.has(String(cur.type || ""))) return cur;
    cur = cur.parent;
  }
  return undefined;
}

function collectParentPath(node: any): string[] {
  const parts: string[] = [];
  let cur = node;
  while (cur) {
    parts.push(String(cur.type || "unknown"));
    cur = cur.parent;
  }
  return parts.reverse().slice(-8);
}

function parseIdentifiersAround(content: string, lineStart: number, lineEnd: number): string[] {
  const lines = content.split("\n");
  const from = Math.max(0, lineStart - 3);
  const to = Math.min(lines.length, lineEnd + 3);
  const snippet = lines.slice(from, to).join("\n");
  const ids = new Set<string>();
  const pattern = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snippet)) !== null) {
    ids.add(match[0]);
    if (ids.size >= 40) break;
  }
  return [...ids];
}

function parseImports(content: string, language: string): string[] {
  const imports = new Set<string>();
  const lines = content.split("\n");

  for (const line of lines.slice(0, 200)) {
    const trimmed = line.trim();
    if (language === "java" || language === "groovy") {
      const m = trimmed.match(/^import\s+([A-Za-z0-9_.*]+);?$/);
      if (m) imports.add(m[1]);
    } else if (language === "typescript" || language === "javascript") {
      const m = trimmed.match(/^import\s+.+?from\s+['"]([^'"]+)['"]/);
      if (m) imports.add(m[1]);
      const req = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
      if (req) imports.add(req[1]);
    } else if (language === "python") {
      const m = trimmed.match(/^from\s+([^\s]+)\s+import\s+/) || trimmed.match(/^import\s+([^\s]+)/);
      if (m) imports.add(m[1]);
    } else if (language === "c" || language === "cpp") {
      const m = trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/);
      if (m) imports.add(m[1]);
    }
  }

  return [...imports].slice(0, 80);
}

function detectSecuritySensitiveApis(content: string): string[] {
  const matches: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\bexecuteQuery\s*\(|\bexecuteUpdate\s*\(|\bcreateStatement\s*\(/g, "sql-execution"],
    [/\bRuntime\.getRuntime\(\)\.exec\s*\(|\bProcessBuilder\s*\(/g, "process-exec"],
    [/\bCipher\.getInstance\s*\(|\bMessageDigest\.getInstance\s*\(/g, "crypto-api"],
    [/\bHttpClient\b|\bRestTemplate\b|\bWebClient\b|\bfetch\s*\(/g, "network-api"],
    [/\bFiles\.(read|write)|\bFileInputStream\b|\bFileOutputStream\b/g, "file-io"],
    [/\b@PreAuthorize\b|\b@Secured\b|\bhasRole\s*\(|\bhasAuthority\s*\(/g, "authz-api"],
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) matches.push(label);
  }

  return Array.from(new Set(matches));
}

function detectSensitiveOperations(securityApis: string[]): string[] {
  return securityApis.map((api) => {
    if (api.includes("sql")) return "data-access";
    if (api.includes("process")) return "subprocess";
    if (api.includes("crypto")) return "crypto";
    if (api.includes("network")) return "network";
    if (api.includes("file")) return "file-io";
    if (api.includes("auth")) return "auth";
    return "general-sensitive";
  });
}

function collectCallEdges(identifiers: string[], fileNodeId: string): ContextGraphEdge[] {
  return identifiers.slice(0, 20).map((id) => ({
    from: fileNodeId,
    to: `id:${id}`,
    relation: "references",
  }));
}

function buildFallbackContext(file: PRFile, language: string, changedRanges: ChangedLineRange[]): TreeSitterFileContext {
  const content = file.fullContent || file.patch || "";
  const imports = parseImports(content, language);
  const securitySensitiveApis = detectSecuritySensitiveApis(content);
  const referencedIdentifiers = changedRanges.length > 0
    ? parseIdentifiersAround(content, changedRanges[0].start, changedRanges[0].end)
    : parseIdentifiersAround(content, 1, 20);

  const fileNodeId = `file:${file.filename}`;
  const nodes: ContextGraphNode[] = [{ id: fileNodeId, kind: "file", label: file.filename }];
  for (const imp of imports.slice(0, 20)) nodes.push({ id: `import:${imp}`, kind: "import", label: imp });
  for (const api of securitySensitiveApis) nodes.push({ id: `api:${api}`, kind: "api", label: api });
  for (const id of referencedIdentifiers.slice(0, 20)) nodes.push({ id: `id:${id}`, kind: "identifier", label: id });

  const edges: ContextGraphEdge[] = [
    ...imports.slice(0, 20).map((imp) => ({ from: fileNodeId, to: `import:${imp}`, relation: "imports" })),
    ...securitySensitiveApis.map((api) => ({ from: fileNodeId, to: `api:${api}`, relation: "uses-api" })),
    ...collectCallEdges(referencedIdentifiers, fileNodeId),
  ];

  const hunks: HunkAstContext[] = changedRanges.map((range) => ({
    hunkStartLine: range.start,
    hunkEndLine: range.end,
    parentAstPath: ["fallback"],
    nearbySiblingNodeTypes: [],
    referencedIdentifiers,
    securitySensitiveApis,
  }));

  return {
    filePath: file.filename,
    language,
    changedRanges,
    imports,
    referencedIdentifiers,
    securitySensitiveApis,
    sensitiveOperations: detectSensitiveOperations(securitySensitiveApis),
    hunks,
    subgraph: { nodes, edges },
  };
}

export function serializeTreeSitterContextForPrompt(contexts: TreeSitterFileContext[], maxChars = 8000): string {
  const sections: string[] = ["=== CHANGED-CODE AST CONTEXT (Tree-sitter) ==="];

  for (const ctx of contexts) {
    sections.push(`\nFile: ${ctx.filePath}`);
    sections.push(`Language: ${ctx.language}`);
    sections.push(`ChangedRanges: ${ctx.changedRanges.map((r) => `${r.start}-${r.end}`).join(", ") || "none"}`);
    if (ctx.imports.length > 0) sections.push(`Imports: ${ctx.imports.slice(0, 12).join(", ")}`);
    if (ctx.securitySensitiveApis.length > 0) sections.push(`SensitiveAPIs: ${ctx.securitySensitiveApis.join(", ")}`);

    for (const hunk of ctx.hunks.slice(0, 4)) {
      const symbolText = hunk.enclosingSymbol ? `symbol=${hunk.enclosingSymbol}` : "symbol=unknown";
      const containerText = hunk.enclosingContainer ? `container=${hunk.enclosingContainer}` : "container=unknown";
      sections.push(`  - Hunk ${hunk.hunkStartLine}-${hunk.hunkEndLine}: ${symbolText}; ${containerText}`);
      if (hunk.functionSignature) sections.push(`    Signature: ${hunk.functionSignature.slice(0, 180)}`);
      if (hunk.referencedIdentifiers.length > 0) sections.push(`    Identifiers: ${hunk.referencedIdentifiers.slice(0, 16).join(", ")}`);
      if (hunk.securitySensitiveApis.length > 0) sections.push(`    Security APIs: ${hunk.securitySensitiveApis.join(", ")}`);
    }
  }

  sections.push("=== END AST CONTEXT ===");
  const text = sections.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) + "\n...[truncated]" : text;
}

export async function buildTreeSitterContextSubgraph(files: PRFile[]): Promise<TreeSitterContextResult> {
  const enabled = shouldEnableTreeSitter();
  const result: TreeSitterContextResult = {
    enabled,
    fileContexts: [],
    parserLanguagesAvailable: [],
    failures: [],
  };

  if (!enabled) return result;

  const available = ["java", "groovy", "python", "typescript", "javascript", "c", "cpp"].filter((lang) => {
    const parser = buildParser(lang as TsLanguage);
    return Boolean(parser);
  });
  result.parserLanguagesAvailable = available;

  for (const file of files) {
    const language = detectLanguage(file.filename);
    if (!language) continue;

    const patch = file.patch || "";
    const changedRanges = extractChangedLineRanges(patch);
    const content = file.fullContent || patch;

    const parser = buildParser(language);
    if (!parser || !content) {
      result.fileContexts.push(buildFallbackContext(file, language, changedRanges));
      if (!parser) {
        result.failures.push({ filePath: file.filename, reason: `tree-sitter parser unavailable for ${language}` });
      }
      continue;
    }

    try {
      const tree = parser.parse(content);
      const root = tree?.rootNode;
      if (!root) {
        result.fileContexts.push(buildFallbackContext(file, language, changedRanges));
        result.failures.push({ filePath: file.filename, reason: "parse returned empty root" });
        continue;
      }

      const imports = parseImports(content, language);
      const securitySensitiveApis = detectSecuritySensitiveApis(content);
      const referencedIdentifiers = new Set<string>();
      const hunks: HunkAstContext[] = [];

      for (const range of changedRanges) {
        const node = root.namedDescendantForPosition(
          { row: Math.max(0, range.start - 1), column: 0 },
          { row: Math.max(0, range.end - 1), column: 100 },
        );
        const enclosing = findEnclosingNode(node);
        const container = findContainerNode(node);

        const parentAstPath = collectParentPath(node);
        const siblingTypes = Array.isArray(node?.parent?.namedChildren)
          ? node.parent.namedChildren.slice(0, 8).map((n: any) => String(n.type || "unknown"))
          : [];

        const signatureText = nodeText(content, enclosing).split("\n")[0]?.trim() || undefined;
        const ids = parseIdentifiersAround(content, range.start, range.end);
        for (const id of ids) referencedIdentifiers.add(id);

        hunks.push({
          hunkStartLine: range.start,
          hunkEndLine: range.end,
          enclosingSymbol: String(enclosing?.type || "unknown"),
          enclosingContainer: container ? String(container?.type || "unknown") : undefined,
          parentAstPath,
          nearbySiblingNodeTypes: siblingTypes,
          functionSignature: signatureText,
          referencedIdentifiers: ids,
          securitySensitiveApis,
        });
      }

      const fileNodeId = `file:${file.filename}`;
      const nodes: ContextGraphNode[] = [{ id: fileNodeId, kind: "file", label: file.filename }];
      const edges: ContextGraphEdge[] = [];

      for (const imp of imports.slice(0, 20)) {
        const nodeId = `import:${imp}`;
        nodes.push({ id: nodeId, kind: "import", label: imp });
        edges.push({ from: fileNodeId, to: nodeId, relation: "imports" });
      }

      for (const api of securitySensitiveApis) {
        const nodeId = `api:${api}`;
        nodes.push({ id: nodeId, kind: "api", label: api });
        edges.push({ from: fileNodeId, to: nodeId, relation: "uses-api" });
      }

      for (const id of [...referencedIdentifiers].slice(0, 25)) {
        const nodeId = `id:${id}`;
        nodes.push({ id: nodeId, kind: "identifier", label: id });
        edges.push({ from: fileNodeId, to: nodeId, relation: "references" });
      }

      result.fileContexts.push({
        filePath: file.filename,
        language,
        changedRanges,
        imports,
        referencedIdentifiers: [...referencedIdentifiers],
        securitySensitiveApis,
        sensitiveOperations: detectSensitiveOperations(securitySensitiveApis),
        hunks,
        subgraph: { nodes, edges },
      });
    } catch (err: any) {
      result.fileContexts.push(buildFallbackContext(file, language, changedRanges));
      result.failures.push({ filePath: file.filename, reason: err?.message || "parse failed" });
    }
  }

  return result;
}
