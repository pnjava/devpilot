// ─────────────────────────────────────────────────────────────
// Story Readiness — Normalizer
// Handles sparse Jira input: AC extraction, field cleanup
// ─────────────────────────────────────────────────────────────

/**
 * Attempt to extract acceptance criteria from the description body.
 * Many Jira stories have AC buried in the description rather than
 * in a dedicated field. This handles common patterns:
 *   - "Acceptance Criteria:" header
 *   - "AC:" shorthand
 *   - "Given … When … Then …" blocks
 *   - "Definition of Done" sections
 */
export function extractAcceptanceCriteria(description: string): string {
  if (!description || !description.trim()) return "";

  // ── Pattern 1: Explicit AC header ────────────────────────
  const acHeaderPatterns = [
    /(?:^|\n)\s*(?:acceptance\s+criteria|ac)\s*[:：\-]\s*([\s\S]+?)(?=\n\s*(?:description|notes|dependencies|technical|implementation|details|definition of done)\s*[:：\-]|\n---|\n===|$)/i,
    /(?:^|\n)\s*\*{0,2}(?:acceptance\s+criteria|ac)\*{0,2}\s*[:：\-]\s*([\s\S]+?)(?=\n\s*\*{0,2}(?:description|notes|dependencies|technical|implementation)\*{0,2}\s*[:：\-]|\n---|\n===|$)/i,
  ];

  for (const pattern of acHeaderPatterns) {
    const match = description.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  // ── Pattern 2: Given/When/Then blocks ────────────────────
  const gwtPattern = /(?:Given\s+[^\n]+)\n\s*(?:When\s+[^\n]+)\n\s*(?:Then\s+[^\n]+)(?:\n\s*And\s+[^\n]+)*/gi;
  const gwtMatches = description.match(gwtPattern);
  if (gwtMatches && gwtMatches.length > 0) {
    return gwtMatches.join("\n\n").trim();
  }

  // ── Pattern 3: Definition of Done section ────────────────
  const dodPattern = /(?:^|\n)\s*(?:definition\s+of\s+done|dod)\s*[:：\-]\s*([\s\S]+?)(?=\n\s*(?:description|notes|dependencies|technical)\s*[:：\-]|\n---|\n===|$)/i;
  const dodMatch = description.match(dodPattern);
  if (dodMatch?.[1]?.trim()) {
    return dodMatch[1].trim();
  }

  return "";
}

/**
 * Normalize a sparse Jira story request. Fills in derived fields
 * and extracts AC from description if the dedicated AC field is empty.
 */
export interface NormalizeInput {
  jiraKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  epicKey?: string;
  issueType?: string;
  labels: string[];
  assignee?: string;
  reporter?: string;
  status?: string;
  componentTags: string[];
  storyLinks: string[];
  linkedConfluenceUrls: string[];
  manualContextText?: string;
}

export interface NormalizeResult {
  normalized: NormalizeInput;
  acExtractedFromDescription: boolean;
  fieldsDefaulted: string[];
}

export function normalizeStoryInput(input: NormalizeInput): NormalizeResult {
  const fieldsDefaulted: string[] = [];
  let acExtractedFromDescription = false;

  // ── Trim all string fields ─────────────────────────────
  const title = (input.title || "").trim();
  let description = (input.description || "").trim();
  let acceptanceCriteria = (input.acceptanceCriteria || "").trim();

  if (!title) fieldsDefaulted.push("title");
  if (!description) fieldsDefaulted.push("description");

  // ── AC extraction fallback ─────────────────────────────
  if (!acceptanceCriteria && description) {
    const extracted = extractAcceptanceCriteria(description);
    if (extracted) {
      acceptanceCriteria = extracted;
      acExtractedFromDescription = true;
    }
  }
  if (!acceptanceCriteria) fieldsDefaulted.push("acceptanceCriteria");

  // ── Labels normalization ───────────────────────────────
  const labels = (input.labels || []).map((l) => l.trim().toLowerCase()).filter(Boolean);

  // ── Component tags normalization ───────────────────────
  const componentTags = (input.componentTags || []).map((c) => c.trim()).filter(Boolean);

  return {
    normalized: {
      ...input,
      title,
      description,
      acceptanceCriteria,
      labels,
      componentTags,
      storyLinks: input.storyLinks || [],
      linkedConfluenceUrls: input.linkedConfluenceUrls || [],
    },
    acExtractedFromDescription,
    fieldsDefaulted,
  };
}
