import fs from "fs";
import path from "path";
import db from "../db";

type IngestOptions = {
  sourceType?: string;
  jiraKey?: string;
};

type CompactPack = {
  root?: { id?: string; title?: string; space?: string };
  pages?: Array<{
    id: string;
    title: string;
    webui?: string;
    headings?: string[];
    classifiedHeadings?: Array<{ heading: string; category: string }>;
    links?: string[];
    inlineImages?: Array<{ type: string; ref: string }>;
    attachments?: Array<{ id: string; title: string; mediaType?: string }>;
  }>;
  imageContext?: Array<{
    pageId: string;
    pageTitle: string;
    inlineImages?: Array<{ type: string; ref: string }>;
    attachments?: Array<{ id: string; title: string; mediaType?: string }>;
  }>;
  architecture?: Array<{ pageId: string; pageTitle: string; heading: string }>;
  business?: Array<{ pageId: string; pageTitle: string; heading: string }>;
  testing?: Array<{ pageId: string; pageTitle: string; heading: string }>;
  operations?: Array<{ pageId: string; pageTitle: string; heading: string }>;
  security?: Array<{ pageId: string; pageTitle: string; heading: string }>;
  logical?: {
    pages?: Array<{
      pageId: string;
      pageTitle: string;
      requirements?: string[];
      components?: string[];
      integrations?: string[];
      securityControls?: string[];
      testingStrategies?: string[];
      operationalGuides?: string[];
      decisions?: string[];
      risks?: string[];
    }>;
  };
  entities?: {
    requirements?: number;
    components?: number;
    integrations?: number;
    securityControls?: number;
    testingStrategies?: number;
    operationalGuides?: number;
    decisions?: number;
    risks?: number;
  };
};

function normalizePackPages(pack: CompactPack): NonNullable<CompactPack["pages"]> {
  if (Array.isArray(pack.pages) && pack.pages.length > 0) {
    const first: any = pack.pages[0];
    if (typeof first?.id === "string" && typeof first?.title === "string") {
      return pack.pages;
    }

    // Support logical-pack shape: pages[*].pageId/pageTitle with entity arrays.
    const logicalPages = (pack.pages as any[])
      .filter((p) => p && typeof p.pageId === "string" && typeof p.pageTitle === "string")
      .map((p) => {
        const toItems = (arr: unknown): string[] => Array.isArray(arr) ? arr.map((x) => String(x || "")).filter(Boolean) : [];
        const mapCategory = (items: string[], category: string) => items.map((heading) => ({ heading, category }));

        const requirements = toItems(p.requirements);
        const components = toItems(p.components);
        const integrations = toItems(p.integrations);
        const securityControls = toItems(p.securityControls);
        const testingStrategies = toItems(p.testingStrategies);
        const operationalGuides = toItems(p.operationalGuides);
        const decisions = toItems(p.decisions);
        const risks = toItems(p.risks);

        const headings = [
          ...requirements,
          ...components,
          ...integrations,
          ...securityControls,
          ...testingStrategies,
          ...operationalGuides,
          ...decisions,
          ...risks,
        ];

        const classifiedHeadings = [
          ...mapCategory(requirements, "business"),
          ...mapCategory(components, "architecture"),
          ...mapCategory(integrations, "architecture"),
          ...mapCategory(securityControls, "security"),
          ...mapCategory(testingStrategies, "testing"),
          ...mapCategory(operationalGuides, "operations"),
          ...mapCategory(decisions, "architecture"),
          ...mapCategory(risks, "risk"),
        ];

        return {
          id: String(p.pageId),
          title: String(p.pageTitle),
          headings,
          classifiedHeadings,
          links: [],
          inlineImages: [],
          attachments: [],
        };
      });

    if (logicalPages.length > 0) {
      return logicalPages as NonNullable<CompactPack["pages"]>;
    }
  }

  const map = new Map<string, {
    id: string;
    title: string;
    webui?: string;
    headings: string[];
    classifiedHeadings: Array<{ heading: string; category: string }>;
    links: string[];
    inlineImages: Array<{ type: string; ref: string }>;
    attachments: Array<{ id: string; title: string; mediaType?: string }>;
  }>();

  const ensure = (pageId: string, pageTitle: string) => {
    if (!map.has(pageId)) {
      map.set(pageId, {
        id: pageId,
        title: pageTitle,
        headings: [],
        classifiedHeadings: [],
        links: [],
        inlineImages: [],
        attachments: [],
      });
    }
    return map.get(pageId)!;
  };

  const addFromCategory = (items: Array<{ pageId: string; pageTitle: string; heading: string }> | undefined, category: string) => {
    for (const item of items || []) {
      const entry = ensure(String(item.pageId), String(item.pageTitle));
      entry.headings.push(String(item.heading));
      entry.classifiedHeadings.push({ heading: String(item.heading), category });
    }
  };

  addFromCategory(pack.architecture, "architecture");
  addFromCategory(pack.business, "business");
  addFromCategory(pack.testing, "testing");
  addFromCategory(pack.operations, "operations");
  addFromCategory(pack.security, "security");

  for (const lp of pack.logical?.pages || []) {
    const entry = ensure(String(lp.pageId), String(lp.pageTitle));
    const pushMany = (items: string[] | undefined, category: string) => {
      for (const item of items || []) {
        const text = String(item || "").trim();
        if (!text) continue;
        entry.headings.push(text);
        entry.classifiedHeadings.push({ heading: text, category });
      }
    };
    pushMany(lp.requirements, "business");
    pushMany(lp.components, "architecture");
    pushMany(lp.integrations, "architecture");
    pushMany(lp.securityControls, "security");
    pushMany(lp.testingStrategies, "testing");
    pushMany(lp.operationalGuides, "operations");
    pushMany(lp.decisions, "architecture");
    pushMany(lp.risks, "risk");
  }

  for (const img of pack.imageContext || []) {
    const entry = ensure(String(img.pageId), String(img.pageTitle));
    for (const i of img.inlineImages || []) entry.inlineImages.push(i);
    for (const a of img.attachments || []) entry.attachments.push(a);
  }

  return Array.from(map.values());
}

export function extractJiraKeys(text: string): string[] {
  const matches = String(text || "").toUpperCase().match(/[A-Z][A-Z0-9]+-\d+/g) || [];
  return Array.from(new Set(matches));
}

function safeDocId(sourceType: string, pageId: string): string {
  return `${sourceType}:${pageId}`;
}

function inferTagTokens(title: string, headings: string[]): string[] {
  const raw = `${title} ${headings.join(" ")}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "hub", "home", "guide"]);
  const tokens = raw.filter((w) => w.length >= 4 && !stop.has(w));
  return Array.from(new Set(tokens)).slice(0, 40);
}

export function ingestKnowledgePack(pack: CompactPack, options: IngestOptions = {}): { documents: number; facts: number; images: number; jiraLinks: number } {
  const sourceType = options.sourceType || "confluence";
  const pages = normalizePackPages(pack);

  const upsertDoc = db.prepare(`
    INSERT INTO knowledge_documents (id, source_type, source_space, source_page_id, title, url, body_excerpt, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      body_excerpt = excluded.body_excerpt,
      metadata_json = excluded.metadata_json,
      updated_at = datetime('now')
  `);

  const clearFacts = db.prepare("DELETE FROM knowledge_facts WHERE document_id = ?");
  const insertFact = db.prepare("INSERT INTO knowledge_facts (document_id, category, heading, content, weight) VALUES (?, ?, ?, ?, ?)");

  const clearImages = db.prepare("DELETE FROM knowledge_image_assets WHERE document_id = ?");
  const insertImage = db.prepare("INSERT INTO knowledge_image_assets (document_id, source_ref, media_type, caption, metadata_json) VALUES (?, ?, ?, ?, ?)");

  const clearTags = db.prepare("DELETE FROM knowledge_tags WHERE document_id = ?");
  const insertTag = db.prepare("INSERT OR IGNORE INTO knowledge_tags (document_id, tag_type, tag_value) VALUES (?, ?, ?)");

  const insertJiraLink = db.prepare("INSERT OR IGNORE INTO knowledge_jira_links (jira_key, document_id, confidence, source) VALUES (?, ?, ?, ?)");

  let factsCount = 0;
  let imageCount = 0;
  let jiraLinksCount = 0;

  const tx = db.transaction(() => {
    for (const page of pages) {
      const docId = safeDocId(sourceType, page.id);
      const headings = page.headings || [];
      const meta = {
        links: page.links || [],
        classifiedHeadings: page.classifiedHeadings || [],
      };

      upsertDoc.run(
        docId,
        sourceType,
        pack.root?.space || null,
        page.id,
        page.title,
        page.webui || null,
        headings.slice(0, 8).join(" | ") || null,
        JSON.stringify(meta),
      );

      clearFacts.run(docId);
      for (const ch of page.classifiedHeadings || []) {
        insertFact.run(docId, ch.category || "other", ch.heading || null, ch.heading || "", 1.0);
        factsCount += 1;
      }
      for (const h of headings) {
        insertFact.run(docId, "heading", h, h, 0.8);
        factsCount += 1;
      }

      clearImages.run(docId);
      for (const img of page.inlineImages || []) {
        insertImage.run(docId, img.ref, "inline", page.title, JSON.stringify({ type: img.type || "inline" }));
        imageCount += 1;
      }
      for (const att of page.attachments || []) {
        insertImage.run(docId, att.title || att.id, att.mediaType || "attachment", page.title, JSON.stringify({ attachmentId: att.id }));
        imageCount += 1;
      }

      clearTags.run(docId);
      for (const token of inferTagTokens(page.title, headings)) {
        insertTag.run(docId, "token", token);
      }
      insertTag.run(docId, "space", pack.root?.space || "");

      const autoJiraKeys = extractJiraKeys(`${page.title}\n${headings.join("\n")}`);
      for (const key of autoJiraKeys) {
        insertJiraLink.run(key, docId, 0.75, "auto-detected");
        jiraLinksCount += 1;
      }
      if (options.jiraKey) {
        insertJiraLink.run(options.jiraKey.toUpperCase(), docId, 0.6, "manual-batch");
        jiraLinksCount += 1;
      }
    }
  });

  tx();

  return {
    documents: pages.length,
    facts: factsCount,
    images: imageCount,
    jiraLinks: jiraLinksCount,
  };
}

export function ingestKnowledgePackFile(filePath: string, options: IngestOptions = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Knowledge pack file not found: ${abs}`);
  }
  const json = JSON.parse(fs.readFileSync(abs, "utf8")) as CompactPack;
  return ingestKnowledgePack(json, options);
}

export function getKnowledgeContextForJira(jiraKey: string, limit = 20) {
  const key = String(jiraKey || "").trim().toUpperCase();
  if (!key) {
    return { jiraKey: key, documents: [], facts: [], images: [], contextText: "" };
  }

  const docs = db.prepare(`
    SELECT d.id, d.title, d.url, l.confidence, d.source_space as sourceSpace
    FROM knowledge_jira_links l
    JOIN knowledge_documents d ON d.id = l.document_id
    WHERE l.jira_key = ?
    ORDER BY l.confidence DESC, d.updated_at DESC
    LIMIT ?
  `).all(key, limit) as Array<{ id: string; title: string; url?: string; confidence: number; sourceSpace?: string }>;

  const docIds = docs.map((d) => d.id);
  if (docIds.length === 0) {
    return { jiraKey: key, documents: [], facts: [], images: [], contextText: "" };
  }

  const placeholders = docIds.map(() => "?").join(",");
  const facts = db.prepare(`
    SELECT document_id as documentId, category, heading, content, weight
    FROM knowledge_facts
    WHERE document_id IN (${placeholders})
    ORDER BY weight DESC, id DESC
    LIMIT 120
  `).all(...docIds) as Array<{ documentId: string; category: string; heading?: string; content: string; weight: number }>;

  const images = db.prepare(`
    SELECT document_id as documentId, source_ref as sourceRef, media_type as mediaType, caption
    FROM knowledge_image_assets
    WHERE document_id IN (${placeholders})
    ORDER BY id DESC
    LIMIT 60
  `).all(...docIds) as Array<{ documentId: string; sourceRef: string; mediaType?: string; caption?: string }>;

  const lines: string[] = [];
  lines.push(`Knowledge context for ${key}:`);
  for (const d of docs.slice(0, 12)) {
    lines.push(`- ${d.title}${d.sourceSpace ? ` [${d.sourceSpace}]` : ""}`);
  }
  const topFacts = facts.slice(0, 25);
  if (topFacts.length > 0) {
    lines.push("Top architecture/business facts:");
    for (const f of topFacts) {
      lines.push(`- (${f.category}) ${f.content}`);
    }
  }
  const topImages = images.slice(0, 12);
  if (topImages.length > 0) {
    lines.push("Image/attachment references:");
    for (const i of topImages) {
      lines.push(`- ${i.sourceRef}${i.mediaType ? ` [${i.mediaType}]` : ""}`);
    }
  }

  return {
    jiraKey: key,
    documents: docs,
    facts,
    images,
    contextText: lines.join("\n"),
  };
}

export function getKnowledgeContextForJiraKeys(jiraKeys: string[], limitPerKey = 20): { jiraKeys: string[]; contextText: string } {
  const keys = Array.from(new Set(jiraKeys.map((k) => k.toUpperCase().trim()).filter(Boolean)));
  const chunks = keys
    .map((k) => getKnowledgeContextForJira(k, limitPerKey).contextText)
    .filter(Boolean);
  return { jiraKeys: keys, contextText: chunks.join("\n\n") };
}
