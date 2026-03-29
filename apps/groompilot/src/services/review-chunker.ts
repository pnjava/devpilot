/**
 * GroomPilot Review Chunker
 *
 * Replaces the "single patch truncation" approach with proper hunk-aware
 * chunking. Every changed file and hunk is seen by analysis even if large.
 * LLM receives chunked slices with hunk boundaries rather than arbitrary
 * truncation.
 *
 * Algorithm:
 * 1. Split unified diff on hunk headers (`@@ -a,b +c,d @@`).
 * 2. Keep hunks intact when possible.
 * 3. If a single hunk exceeds the char limit, split inside the hunk on
 *    line boundaries while preserving +/- prefixes.
 * 4. Track line ranges from hunk headers.
 * 5. Generate stable chunk IDs from content hashing.
 */

import { createHash } from "crypto";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PatchChunk {
  /** Stable identifier: hash(filePath + hunkStart + hunkEnd + first N chars) */
  chunkId: string;
  /** Source file path */
  filePath: string;
  /** Detected language (from caller or extension) */
  language?: string;
  /** Start line number in the destination file (from hunk header) */
  hunkStartLine?: number;
  /** End line number in the destination file (best-effort) */
  hunkEndLine?: number;
  /** Approximate token count (chars / 4 heuristic) */
  approxTokens: number;
  /** The raw patch text for this chunk */
  patchText: string;
  /** Optional enrichment context (RCIE + Tree-sitter) injected by caller */
  contextText?: string;
  /** Index of this chunk within the file's chunks (0-based) */
  chunkIndex: number;
  /** Total number of chunks for this file */
  totalChunks: number;
}

export interface ChunkOptions {
  /** Maximum characters per chunk (default: 4500) */
  maxCharsPerChunk?: number;
  /** Maximum hunks per chunk (default: 4) */
  maxHunksPerChunk?: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ParsedHunk {
  /** The full hunk header line */
  header: string;
  /** Destination start line from `+X` in `@@ -a,b +X,Y @@` */
  destStart: number;
  /** Destination line count from `,Y` in `@@ -a,b +X,Y @@` */
  destCount: number;
  /** All lines in this hunk (including the header) */
  lines: string[];
  /** Character count of all lines joined */
  charCount: number;
}

// ─── Hunk parsing ─────────────────────────────────────────────────────────────

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

function parseHunks(patch: string): ParsedHunk[] {
  const allLines = patch.split("\n");
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;

  for (const line of allLines) {
    const match = line.match(HUNK_HEADER_RE);
    if (match) {
      if (current) {
        current.charCount = current.lines.join("\n").length;
        hunks.push(current);
      }
      current = {
        header: line,
        destStart: Number(match[3]),
        destCount: Number(match[4] ?? 1),
        lines: [line],
        charCount: 0,
      };
    } else if (current) {
      // Skip file-level headers that appear before first hunk
      current.lines.push(line);
    }
    // Lines before the first hunk header (e.g. --- a/... +++ b/...) are dropped
    // as they're redundant when we include the file path in PatchChunk metadata.
  }

  if (current) {
    current.charCount = current.lines.join("\n").length;
    hunks.push(current);
  }

  return hunks;
}

// ─── Large hunk splitting ─────────────────────────────────────────────────────

/**
 * Split a single oversized hunk into sub-hunks on line boundaries.
 * Preserves +/- prefixes and context lines. Each sub-hunk gets an adjusted
 * hunk header reflecting approximate line range.
 */
function splitOversizedHunk(hunk: ParsedHunk, maxChars: number): ParsedHunk[] {
  // If it fits, return as-is
  if (hunk.charCount <= maxChars) return [hunk];

  const subHunks: ParsedHunk[] = [];
  // Skip the header line; we'll create new headers per sub-hunk
  const contentLines = hunk.lines.slice(1);
  let currentLines: string[] = [];
  let currentChars = 0;
  let lineOffset = 0;

  const flush = () => {
    if (currentLines.length === 0) return;
    const destLine = hunk.destStart + lineOffset;
    const header = `@@ -0,0 +${destLine},${currentLines.length} @@ [chunked]`;
    const sub: ParsedHunk = {
      header,
      destStart: destLine,
      destCount: currentLines.length,
      lines: [header, ...currentLines],
      charCount: 0,
    };
    sub.charCount = sub.lines.join("\n").length;
    subHunks.push(sub);
  };

  for (const line of contentLines) {
    const lineLen = line.length + 1; // +1 for newline
    if (currentChars + lineLen > maxChars && currentLines.length > 0) {
      flush();
      currentLines = [];
      currentChars = 0;
    }
    currentLines.push(line);
    currentChars += lineLen;

    // Track destination line offset (count non-removed lines)
    if (!line.startsWith("-")) {
      lineOffset++;
    }
  }

  flush();
  return subHunks;
}

// ─── Chunk ID generation ──────────────────────────────────────────────────────

function generateChunkId(filePath: string, hunkStart: number | undefined, hunkEnd: number | undefined, text: string): string {
  const input = `${filePath}:${hunkStart ?? 0}:${hunkEnd ?? 0}:${text.slice(0, 200)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_CHARS = Number(process.env.REVIEW_CHUNK_MAX_CHARS || 4500);
const DEFAULT_MAX_HUNKS = 4;

/**
 * Split a unified diff for a single file into chunked review units.
 *
 * Algorithm:
 * 1. Parse all hunks from the unified diff.
 * 2. Split any oversized hunks into sub-hunks.
 * 3. Group hunks into chunks respecting char and hunk-count limits.
 * 4. Generate stable chunk IDs.
 *
 * Never drops hunks — every line in the diff appears in exactly one chunk.
 */
export function chunkUnifiedDiff(params: {
  filePath: string;
  patch: string;
  language?: string;
  maxCharsPerChunk?: number;
  maxHunksPerChunk?: number;
}): PatchChunk[] {
  const {
    filePath,
    patch,
    language,
    maxCharsPerChunk = DEFAULT_MAX_CHARS,
    maxHunksPerChunk = DEFAULT_MAX_HUNKS,
  } = params;

  if (!patch || !patch.trim()) {
    return [];
  }

  // 1. Parse hunks
  let hunks = parseHunks(patch);

  if (hunks.length === 0) {
    // No hunk headers found — treat entire patch as a single hunk
    const text = patch.trim();
    if (!text) return [];
    return [{
      chunkId: generateChunkId(filePath, undefined, undefined, text),
      filePath,
      language,
      approxTokens: Math.ceil(text.length / 4),
      patchText: text,
      chunkIndex: 0,
      totalChunks: 1,
    }];
  }

  // 2. Split oversized hunks
  const flatHunks: ParsedHunk[] = [];
  for (const hunk of hunks) {
    flatHunks.push(...splitOversizedHunk(hunk, maxCharsPerChunk));
  }

  // 3. Group into chunks
  const chunks: PatchChunk[] = [];
  let currentHunks: ParsedHunk[] = [];
  let currentChars = 0;

  const flushChunk = () => {
    if (currentHunks.length === 0) return;
    const text = currentHunks.map((h) => h.lines.join("\n")).join("\n");
    const startLine = currentHunks[0].destStart;
    const lastHunk = currentHunks[currentHunks.length - 1];
    const endLine = lastHunk.destStart + lastHunk.destCount - 1;

    chunks.push({
      chunkId: generateChunkId(filePath, startLine, endLine, text),
      filePath,
      language,
      hunkStartLine: startLine,
      hunkEndLine: endLine,
      approxTokens: Math.ceil(text.length / 4),
      patchText: text,
      chunkIndex: 0, // will be set below
      totalChunks: 0, // will be set below
    });
  };

  for (const hunk of flatHunks) {
    const hunkChars = hunk.charCount;

    // If adding this hunk would exceed limits, flush current
    if (currentHunks.length > 0 && (
      currentChars + hunkChars > maxCharsPerChunk ||
      currentHunks.length >= maxHunksPerChunk
    )) {
      flushChunk();
      currentHunks = [];
      currentChars = 0;
    }

    currentHunks.push(hunk);
    currentChars += hunkChars;
  }

  flushChunk();

  // 4. Set indices
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].totalChunks = chunks.length;
  }

  return chunks;
}

/**
 * Chunk all files in a PR, returning a flat list of PatchChunks ordered by
 * risk priority (higher risk first) for greedy LLM budget allocation.
 */
export function chunkPRFiles(
  files: Array<{
    filePath: string;
    patch: string;
    language?: string;
    risk?: "low" | "medium" | "high" | "critical";
  }>,
  opts?: ChunkOptions,
): PatchChunk[] {
  const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  // Sort files by risk (higher risk first)
  const sorted = [...files].sort((a, b) => {
    const ra = riskOrder[a.risk || "low"] ?? 3;
    const rb = riskOrder[b.risk || "low"] ?? 3;
    return ra - rb;
  });

  const allChunks: PatchChunk[] = [];
  for (const file of sorted) {
    const fileChunks = chunkUnifiedDiff({
      filePath: file.filePath,
      patch: file.patch,
      language: file.language,
      maxCharsPerChunk: opts?.maxCharsPerChunk,
      maxHunksPerChunk: opts?.maxHunksPerChunk,
    });
    allChunks.push(...fileChunks);
  }

  return allChunks;
}

/**
 * Budget manager: select which chunks should be sent to LLM based on a
 * maximum total token budget. Returns selected chunks (greedy by order,
 * which is by risk if chunkPRFiles was used).
 */
export function selectChunksForLLM(
  chunks: PatchChunk[],
  maxTotalTokens: number,
): { selected: PatchChunk[]; deferred: PatchChunk[] } {
  const selected: PatchChunk[] = [];
  const deferred: PatchChunk[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    if (usedTokens + chunk.approxTokens <= maxTotalTokens) {
      selected.push(chunk);
      usedTokens += chunk.approxTokens;
    } else {
      deferred.push(chunk);
    }
  }

  return { selected, deferred };
}
