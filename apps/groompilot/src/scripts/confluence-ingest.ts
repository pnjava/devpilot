#!/usr/bin/env tsx
import fs from "fs";
import path from "path";

type ConfluencePage = {
  id: string;
  title: string;
  body?: { storage?: { value?: string } };
  children?: { attachment?: { results?: any[] } };
  _links?: { webui?: string };
};

type LogicalPage = {
  pageId: string;
  pageTitle: string;
  requirements: string[];
  components: string[];
  integrations: string[];
  securityControls: string[];
  testingStrategies: string[];
  operationalGuides: string[];
  decisions: string[];
  risks: string[];
};

function required(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const BASE_URL = required("CONFLUENCE_BASE_URL").replace(/\/+$/, "");
const TOKEN = required("CONFLUENCE_PAT");
const ROOT_PAGE_ID = required("CONFLUENCE_ROOT_PAGE_ID");
const LIMIT = Math.max(1, Math.min(Number(process.env.CONFLUENCE_CHILD_LIMIT || 200), 1000));
const MAX_PAGES = Math.max(1, Math.min(Number(process.env.CONFLUENCE_MAX_PAGES || 5000), 50000));
const FOLLOW_SPACE_LINKS = ["1", "true", "yes", "on"].includes(String(process.env.CONFLUENCE_FOLLOW_SPACE_LINKS || "false").toLowerCase());

async function confGet<T>(apiPath: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Confluence API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const re = /<h[1-4][^>]*>(.*?)<\/h[1-4]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = String(m[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) headings.push(text);
  }
  return headings;
}

function extractInlineImages(html: string): Array<{ type: "confluence-image" | "img-tag"; ref: string }> {
  const refs: Array<{ type: "confluence-image" | "img-tag"; ref: string }> = [];

  const acImg = /<ac:image[\s\S]*?<ri:attachment[^>]*ri:filename="([^"]+)"[\s\S]*?<\/ac:image>/gi;
  let m: RegExpExecArray | null;
  while ((m = acImg.exec(html)) !== null) {
    refs.push({ type: "confluence-image", ref: m[1] });
  }

  const imgTag = /<img[^>]*src="([^"]+)"[^>]*>/gi;
  while ((m = imgTag.exec(html)) !== null) {
    refs.push({ type: "img-tag", ref: m[1] });
  }

  return refs;
}

function extractLinks(html: string): string[] {
  const links: string[] = [];
  const re = /<a[^>]*href="([^"]+)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push(m[1]);
  }
  return links;
}

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractListItems(html: string): string[] {
  const items: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtml(m[1] || "").trim();
    if (t.length >= 8) items.push(t);
  }
  return items;
}

function unique(items: string[], max = 40): string[] {
  return Array.from(new Set(items.map((x) => x.trim()).filter(Boolean))).slice(0, max);
}

function deriveLogicalPage(pageId: string, pageTitle: string, headings: string[], listItems: string[], plainText: string): LogicalPage {
  const lines = unique([...headings, ...listItems], 120);
  const requirements = lines.filter((x) => /\b(must|should|shall|required|requirement|need to)\b/i.test(x));
  const components = lines.filter((x) => /\b(service|component|module|controller|api|endpoint|consumer|provider|layer|repository|adapter)\b/i.test(x));
  const integrations = lines.filter((x) => /\b(integration|kafka|queue|topic|mongodb|atlas|rest|api|event|webhook|messaging|database)\b/i.test(x));
  const securityControls = lines.filter((x) => /\b(security|auth|authorization|token|owasp|pci|encryption|mask|vulnerability|secret|compliance)\b/i.test(x));
  const testingStrategies = lines.filter((x) => /\b(test|testing|qa|regression|integration test|unit test|sanity|validation)\b/i.test(x));
  const operationalGuides = lines.filter((x) => /\b(deploy|deployment|runbook|monitor|observability|cluster|namespace|devops|pipeline|ci|cd)\b/i.test(x));
  const decisions = lines.filter((x) => /\b(decision|chosen|selected|strategy|approach|architecture)\b/i.test(x));
  const risks = lines.filter((x) => /\b(risk|challenge|issue|concern|limitation|constraint|trade.?off)\b/i.test(x));

  const textSentences = String(plainText || "")
    .split(/[\.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 220);

  return {
    pageId,
    pageTitle,
    requirements: unique([...requirements, ...textSentences.filter((s) => /\b(must|should|shall|required)\b/i.test(s))]),
    components: unique([...components, ...headings.filter((h) => /\b(service|component|api|design|architecture)\b/i.test(h))]),
    integrations: unique(integrations),
    securityControls: unique(securityControls),
    testingStrategies: unique(testingStrategies),
    operationalGuides: unique(operationalGuides),
    decisions: unique(decisions),
    risks: unique(risks),
  };
}

function classifyHeading(heading: string): "architecture" | "business" | "testing" | "operations" | "security" | "other" {
  const h = heading.toLowerCase();
  if (/architecture|design|component|integration|sequence|domain model/.test(h)) return "architecture";
  if (/business|requirement|payment|user interface|prioritization/.test(h)) return "business";
  if (/test|qa|verification|validation/.test(h)) return "testing";
  if (/deploy|monitor|runbook|devops|operation|namespace|cluster/.test(h)) return "operations";
  if (/security|owasp|pci|auth|token|encryption|vulnerability/.test(h)) return "security";
  return "other";
}

function extractConfluencePageIdsFromLinks(links: string[], spaceKey: string): string[] {
  const ids: string[] = [];
  for (const link of links) {
    const s = String(link || "");
    const m1 = s.match(/\/spaces\/[A-Za-z0-9_-]+\/pages\/(\d+)\//);
    const m2 = s.match(/[?&]pageId=(\d+)/i);
    const id = m1?.[1] || m2?.[1];
    if (!id) continue;
    if (s.includes("/spaces/") && !s.includes(`/spaces/${spaceKey}/`)) continue;
    ids.push(id);
  }
  return Array.from(new Set(ids));
}

async function getPageById(pageId: string): Promise<ConfluencePage | null> {
  try {
    return await confGet<ConfluencePage>(
      `/rest/api/content/${pageId}?expand=body.storage,children.attachment,_links`,
    );
  } catch {
    return null;
  }
}

async function crawlPages(rootPageId: string, spaceKey: string): Promise<ConfluencePage[]> {
  const pages = new Map<string, ConfluencePage>();
  const queue: string[] = [rootPageId];
  const crawledChildren = new Set<string>();

  while (queue.length > 0 && pages.size < MAX_PAGES) {
    const pageId = queue.shift()!;

    if (!pages.has(pageId)) {
      const page = await getPageById(pageId);
      if (page?.id) pages.set(page.id, page);
    }

    const current = pages.get(pageId);
    if (!current) continue;

    if (FOLLOW_SPACE_LINKS) {
      const html = current.body?.storage?.value || "";
      const links = extractLinks(html);
      const linkedIds = extractConfluencePageIdsFromLinks(links, spaceKey);
      for (const id of linkedIds) {
        if (!pages.has(id) && !queue.includes(id) && pages.size + queue.length < MAX_PAGES) queue.push(id);
      }
    }

    if (crawledChildren.has(pageId)) continue;
    crawledChildren.add(pageId);

    let start = 0;
    while (pages.size < MAX_PAGES) {
      type ChildResponse = {
        size?: number;
        limit?: number;
        start?: number;
        results?: ConfluencePage[];
        _links?: { next?: string };
      };

      const child = await confGet<ChildResponse>(
        `/rest/api/content/${pageId}/child/page?limit=${LIMIT}&start=${start}&expand=body.storage,children.attachment,_links`,
      );
      const results = child.results || [];
      if (results.length === 0) break;

      for (const p of results) {
        if (!p?.id) continue;
        if (!pages.has(p.id)) pages.set(p.id, p);
        if (!queue.includes(p.id) && !crawledChildren.has(p.id) && pages.size + queue.length < MAX_PAGES) queue.push(p.id);
      }

      if (!child._links?.next) break;
      start += child.limit || LIMIT;
    }
  }

  // Exclude root from output list to preserve previous behavior.
  pages.delete(rootPageId);
  return Array.from(pages.values());
}

async function main() {
  type PageResponse = { id: string; title: string; space?: { key?: string }; body?: { storage?: { value?: string } } };

  const root = await confGet<PageResponse>(`/rest/api/content/${ROOT_PAGE_ID}?expand=body.storage,space,_links`);
  const spaceKey = root.space?.key || "";
  const descendants = await crawlPages(ROOT_PAGE_ID, spaceKey);

  const pages = descendants.map((p) => {
    const html = p.body?.storage?.value || "";
    const headings = extractHeadings(html);
    const listItems = extractListItems(html);
    const plainText = stripHtml(html);
    const inlineImages = extractInlineImages(html);
    const links = extractLinks(html);
    const attachments = (p.children?.attachment?.results || []).map((a: any) => ({
      id: String(a.id || ""),
      title: String(a.title || ""),
      mediaType: String(a.metadata?.mediaType || ""),
    }));

    return {
      id: p.id,
      title: p.title,
      webui: p._links?.webui || "",
      headings,
      listItems,
      plainText,
      classifiedHeadings: headings.map((h) => ({ heading: h, category: classifyHeading(h) })),
      links,
      inlineImages,
      attachments,
      logical: deriveLogicalPage(p.id, p.title, headings, listItems, plainText),
    };
  });

  const pack = {
    generatedAt: new Date().toISOString(),
    root: {
      id: root.id,
      title: root.title,
      space: root.space?.key || "",
    },
    counts: {
      pages: pages.length,
      pagesWithImages: pages.filter((p) => p.inlineImages.length > 0 || p.attachments.length > 0).length,
      totalInlineImages: pages.reduce((s, p) => s + p.inlineImages.length, 0),
      totalAttachments: pages.reduce((s, p) => s + p.attachments.length, 0),
    },
    pages,
  };

  const outDir = path.resolve(__dirname, "../../batch-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fullPath = path.join(outDir, `confluence-knowledge_${ROOT_PAGE_ID}_${stamp}.json`);
  const compactPath = path.join(outDir, `copilot-knowledge-pack_${ROOT_PAGE_ID}_${stamp}.json`);
  const logicalPath = path.join(outDir, `logical-knowledge-pack_${ROOT_PAGE_ID}_${stamp}.json`);

  fs.writeFileSync(fullPath, JSON.stringify(pack, null, 2));

  const compact = {
    generatedAt: pack.generatedAt,
    root: pack.root,
    counts: pack.counts,
    architecture: pages.flatMap((p) => p.classifiedHeadings.filter((h) => h.category === "architecture").map((h) => ({ pageId: p.id, pageTitle: p.title, heading: h.heading }))),
    business: pages.flatMap((p) => p.classifiedHeadings.filter((h) => h.category === "business").map((h) => ({ pageId: p.id, pageTitle: p.title, heading: h.heading }))),
    testing: pages.flatMap((p) => p.classifiedHeadings.filter((h) => h.category === "testing").map((h) => ({ pageId: p.id, pageTitle: p.title, heading: h.heading }))),
    operations: pages.flatMap((p) => p.classifiedHeadings.filter((h) => h.category === "operations").map((h) => ({ pageId: p.id, pageTitle: p.title, heading: h.heading }))),
    security: pages.flatMap((p) => p.classifiedHeadings.filter((h) => h.category === "security").map((h) => ({ pageId: p.id, pageTitle: p.title, heading: h.heading }))),
    imageContext: pages
      .filter((p) => p.inlineImages.length > 0 || p.attachments.length > 0)
      .map((p) => ({
        pageId: p.id,
        pageTitle: p.title,
        inlineImages: p.inlineImages,
        attachments: p.attachments,
      })),
  };

  const logical = {
    generatedAt: pack.generatedAt,
    root: pack.root,
    counts: pack.counts,
    entities: {
      requirements: pages.reduce((s, p) => s + p.logical.requirements.length, 0),
      components: pages.reduce((s, p) => s + p.logical.components.length, 0),
      integrations: pages.reduce((s, p) => s + p.logical.integrations.length, 0),
      securityControls: pages.reduce((s, p) => s + p.logical.securityControls.length, 0),
      testingStrategies: pages.reduce((s, p) => s + p.logical.testingStrategies.length, 0),
      operationalGuides: pages.reduce((s, p) => s + p.logical.operationalGuides.length, 0),
      decisions: pages.reduce((s, p) => s + p.logical.decisions.length, 0),
      risks: pages.reduce((s, p) => s + p.logical.risks.length, 0),
    },
    pages: pages.map((p) => p.logical),
  };

  fs.writeFileSync(compactPath, JSON.stringify(compact, null, 2));
  fs.writeFileSync(logicalPath, JSON.stringify(logical, null, 2));

  console.log(`Wrote: ${fullPath}`);
  console.log(`Wrote: ${compactPath}`);
  console.log(`Wrote: ${logicalPath}`);
  console.log(`Pages: ${pack.counts.pages}`);
  console.log(`Pages with images: ${pack.counts.pagesWithImages}`);
  console.log(`Follow space links: ${FOLLOW_SPACE_LINKS ? "enabled" : "disabled"}`);
  if (pack.counts.pages >= MAX_PAGES) {
    console.log(`NOTE: hit CONFLUENCE_MAX_PAGES=${MAX_PAGES}. Increase it to crawl more.`);
  }
}

main().catch((err) => {
  console.error(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
