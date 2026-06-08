import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "playwright";
import { loadEnv } from "../src/env.js";
import { Store } from "../src/store.js";

const args = parseArgs(process.argv.slice(2));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
await loadEnv(join(root, ".env"));

const dbPath = resolve(args.db || process.env.DB_PATH || join(root, "data", "db.json"));
const storagePath = resolve(args.storage || process.env.ZHIHU_STORAGE_PATH || join(root, "data", "zhihu-storage.json"));
const kinds = new Set(String(args.types || args.kinds || "article,answer,pin").split(",").map((item) => item.trim()).filter(Boolean));
const maxItems = Number(args.maxItems || args.max || 0);
const maxRootPages = Number(args.maxRootPages || 0);
const maxChildPages = Number(args.maxChildPages || 0);
const delayMs = Number(args.delayMs || 350);
const dryRun = Boolean(args.dryRun);

await mkdir(dirname(dbPath), { recursive: true });
const store = new Store(dbPath);
await store.load();

const context = await request.newContext({
  storageState: storagePath,
  extraHTTPHeaders: {
    accept: "application/json, text/plain, */*",
    referer: "https://www.zhihu.com/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  }
});

try {
  const articles = store.listArticles({ includeDrafts: true })
    .filter((article) => kinds.has(article.kind))
    .filter((article) => zhihuResource(article))
    .slice(0, maxItems || undefined);

  console.log(`Scanning ${articles.length} Zhihu item(s) for comments.`);

  const comments = [];
  let scanned = 0;
  for (const article of articles) {
    scanned += 1;
    const resource = zhihuResource(article);
    const collected = await collectCommentsForArticle(article, resource);
    comments.push(...collected);
    if (collected.length) {
      console.log(`Collected ${collected.length} comment(s): [${article.kind}] ${article.title}`);
    } else if (scanned % 25 === 0) {
      console.log(`Scanned ${scanned}/${articles.length} item(s).`);
    }
    await sleep(delayMs);
  }

  if (dryRun) {
    console.log(`Dry run collected ${comments.length} Zhihu comment(s). Database was not changed.`);
  } else {
    const result = await store.upsertExternalComments(comments);
    console.log(`Imported ${result.created} new Zhihu comment(s), updated ${result.updated} existing comment(s).`);
  }
} finally {
  await context.dispose();
}

async function collectCommentsForArticle(article, resource) {
  const roots = await collectRootComments(resource);
  const rows = [];

  for (const rootComment of roots) {
    rows.push(normalizeComment(article, rootComment, ""));
    const childCount = Number(rootComment.child_comment_count || 0);
    if (childCount > 0) {
      const children = await collectChildComments(rootComment.id);
      for (const child of children) rows.push(normalizeComment(article, child, child.reply_comment_id || rootComment.id));
      await sleep(delayMs);
    }
  }

  return rows.filter((comment) => comment.body);
}

async function collectRootComments(resource) {
  const comments = [];
  let url = rootCommentUrl(resource);
  let pages = 0;

  while (url) {
    pages += 1;
    const payload = await getJson(url);
    for (const comment of payload.data || []) comments.push(comment);
    if (payload.paging?.is_end || (maxRootPages && pages >= maxRootPages)) break;
    url = payload.paging?.next ? ensureHttps(payload.paging.next) : "";
    await sleep(delayMs);
  }

  return comments;
}

async function collectChildComments(rootCommentId) {
  const comments = [];
  let url = `https://www.zhihu.com/api/v4/comment_v5/comment/${encodeURIComponent(rootCommentId)}/child_comment?limit=20&offset=`;
  let pages = 0;

  while (url) {
    pages += 1;
    const payload = await getJson(url);
    for (const comment of payload.data || []) comments.push(comment);
    if (payload.paging?.is_end || (maxChildPages && pages >= maxChildPages)) break;
    url = payload.paging?.next ? ensureHttps(payload.paging.next) : "";
    await sleep(delayMs);
  }

  return comments;
}

async function getJson(url) {
  const response = await requestWithRetry(url);
  if (!response.ok()) {
    throw new Error(`Zhihu comments API returned HTTP ${response.status()}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json();
}

async function requestWithRetry(url) {
  let lastResponse;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    lastResponse = await context.get(url);
    if (lastResponse.ok() || ![408, 409, 425, 429, 500, 502, 503, 504].includes(lastResponse.status())) return lastResponse;
    const delay = 900 * attempt;
    console.warn(`Zhihu comment request returned HTTP ${lastResponse.status()}, retrying after ${delay}ms.`);
    await sleep(delay);
  }
  return lastResponse;
}

function normalizeComment(article, comment, fallbackParentId) {
  const author = comment.author || {};
  const replyAuthor = comment.reply_author || comment.reply_to_author || {};
  return {
    articleId: article.id,
    source: "zhihu",
    sourceCommentId: comment.id,
    sourceParentCommentId: parentCommentId(comment, fallbackParentId),
    authorName: author.name || (author.is_anonymous ? "匿名用户" : "知乎用户"),
    authorUrl: author.url_token ? `https://www.zhihu.com/people/${author.url_token}` : "",
    authorAvatarUrl: author.avatar_url || "",
    authorHeadline: author.headline || "",
    replyToAuthorName: replyAuthor.name || "",
    body: plainText(comment.content),
    likeCount: Number(comment.like_count || 0),
    ipLocation: ipLocation(comment),
    createdAt: fromUnix(comment.created_time)
  };
}

function parentCommentId(comment, fallbackParentId) {
  const replyCommentId = String(comment.reply_comment_id || "");
  if (replyCommentId && replyCommentId !== "0" && replyCommentId !== String(comment.id)) return replyCommentId;
  const rootCommentId = String(comment.reply_root_comment_id || "");
  if (rootCommentId && rootCommentId !== String(comment.id)) return rootCommentId;
  return fallbackParentId && fallbackParentId !== String(comment.id) ? String(fallbackParentId) : "";
}

function ipLocation(comment) {
  const tag = (comment.comment_tag || []).find((item) => item.type === "ip_info");
  return tag?.text || "";
}

function zhihuResource(article) {
  const sourceUrl = String(article.sourceUrl || "");
  const id = sourceId(article.kind, sourceUrl);
  if (!id) return null;
  if (article.kind === "article") return { type: "articles", id };
  if (article.kind === "answer") return { type: "answers", id };
  if (article.kind === "pin") return { type: "pins", id };
  return null;
}

function sourceId(kind, sourceUrl) {
  if (kind === "article") return /\/p\/(\d+)/.exec(sourceUrl)?.[1] || "";
  if (kind === "answer") return /\/answer\/(\d+)/.exec(sourceUrl)?.[1] || "";
  if (kind === "pin") return /\/pins?\/(\d+)/.exec(sourceUrl)?.[1] || "";
  return "";
}

function rootCommentUrl(resource) {
  return `https://www.zhihu.com/api/v4/comment_v5/${resource.type}/${encodeURIComponent(resource.id)}/root_comment?order_by=score&limit=20&offset=`;
}

function plainText(html) {
  return decodeHtml(String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function fromUnix(value) {
  return value ? new Date(Number(value) * 1000).toISOString() : new Date().toISOString();
}

function ensureHttps(url) {
  return String(url || "").replace(/^http:/, "https:");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
