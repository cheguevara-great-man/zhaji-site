import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Store } from "../src/store.js";
import { markdownToHtml } from "../src/render.js";

const DEFAULT_PROFILE = "https://www.zhihu.com/people/cai-ba-74-36";
const args = parseArgs(process.argv.slice(2));
const profileUrl = args.profile || args._[0] || DEFAULT_PROFILE;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const profilePath = new URL(profileUrl).pathname.replace(/\/(answers|posts|pins|asks|columns).*/, "");
const urlToken = profilePath.split("/").filter(Boolean).pop();
const outputDir = resolve(args.output || join(root, "data", "zhihu-export"));
const uploadDir = resolve(args.uploads || join(root, "public", "uploads", "zhihu"));
const userDataDir = resolve(args.browserProfile || join(root, "data", "playwright-profile", "zhihu"));
const dbPath = resolve(args.db || join(root, "data", "db.json"));
const maxPosts = Number(args.maxPosts || args.max || 0);
const maxAnswers = Number(args.maxAnswers || args.max || 0);
const maxPins = Number(args.maxPins || args.max || 0);
const types = new Set(String(args.types || "posts,answers,pins").split(",").map((item) => item.trim()).filter(Boolean));
const shouldImport = Boolean(args.import);
const shouldReplace = Boolean(args.replace);
const headless = Boolean(args.headless);
const waitForLogin = !args.noLoginWait;
const browserChannel = args.channel || (process.platform === "win32" ? "msedge" : "");
const pageSize = Number(args.pageSize || 5);

await mkdir(outputDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });
await mkdir(userDataDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  headless,
  ...(browserChannel ? { channel: browserChannel } : {}),
  viewport: { width: 1365, height: 900 },
  locale: "zh-CN"
});

const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(20_000);

const articles = shouldReplace ? [] : await loadPreviousExport();
const seenSources = new Set(articles.map((item) => item.sourceUrl).filter(Boolean));

try {
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 20_000 });
  await closeLoginModal(page);
  if (waitForLogin) {
    await waitForManualLoginIfNeeded(page);
  }

  const profile = await readProfileStats(page);
  console.log(`Profile: ${profile.name || profileUrl}`);
  console.log(`Expected: posts=${profile.posts ?? "?"}, answers=${profile.answers ?? "?"}, pins=${profile.pins ?? "?"}`);

  if (types.has("posts")) {
    const posts = await collectApiArticles(context, maxPosts);
    for (const post of posts) {
      if (seenSources.has(post.sourceUrl)) continue;
      await addItem(await localizeImages(context, post));
    }
  }

  if (types.has("answers")) {
    const answers = await collectApiAnswers(context, maxAnswers);
    for (const answer of answers) {
      if (seenSources.has(answer.sourceUrl)) continue;
      await addItem(await localizeImages(context, answer));
    }
  }

  if (types.has("pins")) {
    const pins = await collectApiPins(context, maxPins);
    for (const pin of pins) {
      if (seenSources.has(pin.sourceUrl)) continue;
      const item = await localizeImages(context, pin);
      await addItem(item);
    }
  }

  if (shouldImport) {
    await importIntoSite(articles, { replace: shouldReplace });
  }

  console.log(`Done. Exported ${articles.length} item(s) to ${join(outputDir, "articles.json")}`);
} finally {
  await context.close();
}

async function collectApiArticles(context, max) {
  const include = "data[*].content,excerpt,title,created,updated,url,id,image_url";
  const data = await collectApiPages(context, `https://www.zhihu.com/api/v4/members/${urlToken}/articles?include=${encodeURIComponent(include)}&sort_by=created`, max, "articles");
  return data.map((item) => normalizeItem({
    kind: "article",
    title: item.title,
    excerpt: item.excerpt,
    contentHtml: item.content || markdownToHtml(item.excerpt || ""),
    sourceUrl: item.url || `https://zhuanlan.zhihu.com/p/${item.id}`,
    publishedAt: fromUnix(item.created || item.updated)
  }));
}

async function collectApiAnswers(context, max) {
  const include = "data[*].content,question,title,created_time,updated_time,url,id";
  const data = await collectApiPages(context, `https://www.zhihu.com/api/v4/members/${urlToken}/answers?include=${encodeURIComponent(include)}&sort_by=created`, max, "answers");
  return data.map((item) => {
    const question = item.question?.title || item.question?.name || item.title || "知乎问题";
    return normalizeItem({
      kind: "answer",
      title: `回答：${question}`,
      excerpt: stripTags(item.content || "").slice(0, 180),
      contentHtml: item.content || "",
      sourceUrl: `https://www.zhihu.com/question/${item.question?.id || ""}/answer/${item.id}`,
      publishedAt: fromUnix(item.created_time || item.updated_time)
    });
  });
}

async function collectApiPins(context, max) {
  const include = "data[*].content,created,updated,url,id";
  const data = await collectApiPages(context, `https://www.zhihu.com/api/v4/members/${urlToken}/pins?include=${encodeURIComponent(include)}`, max, "pins");
  return data.map((item) => {
    const html = pinContentHtml(item.content);
    const text = stripTags(html).replace(/\s+/g, " ").trim();
    return normalizeItem({
      kind: "pin",
      title: `想法：${text.slice(0, 42) || item.id}`,
      excerpt: text.slice(0, 180),
      contentHtml: html,
      sourceUrl: normalizeZhihuUrl(item.url || `https://www.zhihu.com/pin/${item.id}`),
      publishedAt: fromUnix(item.created || item.updated)
    });
  });
}

async function collectApiPages(context, firstUrl, max, label) {
  const items = [];
  let url = appendLimit(firstUrl, Math.min(max || pageSize, pageSize));

  while (url) {
    const response = await requestWithRetry(context, url);
    if (!response.ok()) {
      throw new Error(`Zhihu ${label} API returned HTTP ${response.status()}: ${(await response.text()).slice(0, 300)}`);
    }

    const payload = await response.json();
    for (const item of payload.data || []) {
      items.push(item);
      if (max && items.length >= max) break;
    }

    console.log(`Fetched ${items.length}${payload.paging?.totals ? `/${payload.paging.totals}` : ""} ${label}`);
    if ((max && items.length >= max) || payload.paging?.is_end) break;
    url = payload.paging?.next ? ensureHttps(payload.paging.next) : "";
    await new Promise((resolve) => setTimeout(resolve, 450));
  }

  return items;
}

async function requestWithRetry(context, url) {
  let lastResponse;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    lastResponse = await context.request.get(url, {
      headers: {
        referer: profileUrl,
        accept: "application/json, text/plain, */*"
      }
    });
    if (lastResponse.ok() || ![429, 500, 502, 503, 504].includes(lastResponse.status())) {
      return lastResponse;
    }
    await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
  }
  return lastResponse;
}

async function addItem(item) {
  if (!item?.title || !item?.contentHtml) return;
  articles.push(item);
  seenSources.add(item.sourceUrl);
  await saveExport(articles);
  console.log(`Saved: [${item.kind}] ${item.title}`);
}

async function collectLinks(page, url, options) {
  console.log(`Collecting ${options.label}: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 20_000 });
  await closeLoginModal(page);
  if (waitForLogin) {
    await waitForManualLoginIfNeeded(page);
  }
  await page.waitForTimeout(1000);

  const found = new Set();
  let stableRounds = 0;
  let lastCount = 0;
  const maxRounds = 80;

  for (let round = 0; round < maxRounds; round += 1) {
    const links = await page.evaluate(() => {
      const containers = [...document.querySelectorAll(".List-item, .ContentItem, .ArticleItem, [data-za-detail-view-path-module]")];
      const roots = containers.length ? containers : [document.querySelector("main") || document.body];
      return roots.flatMap((root) => [...root.querySelectorAll("a[href]")])
        .map((link) => link.href)
        .filter(Boolean)
        .map((href) => href.startsWith("//") ? `https:${href}` : href);
    });

    for (const link of links) {
      const normalized = normalizeZhihuUrl(link);
      if (options.match(normalized)) found.add(normalized);
    }

    if (options.max && found.size >= options.max) break;
    if (options.expected && found.size >= options.expected) break;

    stableRounds = found.size === lastCount ? stableRounds + 1 : 0;
    lastCount = found.size;
    if (stableRounds >= 8) break;

    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(900);
  }

  const result = [...found];
  console.log(`Found ${result.length} ${options.label}.`);
  return options.max ? result.slice(0, options.max) : result;
}

async function collectPins(page, url, expected) {
  console.log(`Collecting pins: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 20_000 });
  await closeLoginModal(page);
  if (waitForLogin) {
    await waitForManualLoginIfNeeded(page);
  }
  await page.waitForTimeout(1000);

  const items = new Map();
  let stableRounds = 0;
  let lastCount = 0;

  for (let round = 0; round < 80; round += 1) {
    const batch = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".List-item, .PinItem, [data-za-detail-view-path-module='PinItem']")];
      return cards.map((card, index) => {
        const link = card.querySelector("a[href*='/pin/'], a[href*='zhuanlan.zhihu.com/p/'], a[href*='/question/']")?.href || location.href + `#pin-${index}`;
        const time = card.querySelector("time")?.getAttribute("datetime") || card.querySelector("time")?.textContent || "";
        const content = card.querySelector(".RichText, .ztext, .ContentItem, .PinItem-content") || card;
        const text = content.innerText?.trim() || "";
        const html = content.innerHTML || "";
        return { link, time, text, html };
      }).filter((item) => item.text || item.html);
    });

    for (const pin of batch) {
      const sourceUrl = normalizeZhihuUrl(pin.link);
      if (!items.has(sourceUrl)) {
        items.set(sourceUrl, {
          kind: "pin",
          title: `想法：${pin.text.replace(/\s+/g, " ").slice(0, 42) || "未命名想法"}`,
          excerpt: pin.text.replace(/\s+/g, " ").slice(0, 180),
          contentHtml: pin.html || markdownToHtml(pin.text),
          sourceUrl,
          publishedAt: parseZhihuDate(pin.time),
          status: "published"
        });
      }
    }

    if (expected && items.size >= expected) break;
    stableRounds = items.size === lastCount ? stableRounds + 1 : 0;
    lastCount = items.size;
    if (stableRounds >= 8) break;

    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(900);
  }

  const result = [...items.values()];
  console.log(`Found ${result.length} pins.`);
  return expected ? result.slice(0, expected) : result;
}

async function extractArticle(context, url) {
  const page = await context.newPage();
  try {
    console.log(`Reading article: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 20_000 });
    await closeLoginModal(page);
    await expandContent(page);
    const raw = await page.evaluate(() => {
      const title = document.querySelector("h1.Post-Title, h1")?.textContent?.trim() || document.title.replace(/ - 知乎$/, "");
      const root = document.querySelector(".Post-RichTextContainer .RichText, .Post-RichTextContainer, .RichText.ztext, article") || document.body;
      const clone = root.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, button, .RichContent-actions, .ContentItem-actions").forEach((node) => node.remove());
      const publishedAt = document.querySelector("meta[property='article:published_time']")?.content
        || document.querySelector("time")?.getAttribute("datetime")
        || "";
      return {
        kind: "article",
        title,
        excerpt: clone.textContent.trim().replace(/\s+/g, " ").slice(0, 180),
        contentHtml: clone.innerHTML,
        sourceUrl: location.href,
        publishedAt
      };
    });
    return localizeImages(context, normalizeItem(raw));
  } finally {
    await page.close();
  }
}

async function extractAnswer(context, url) {
  const page = await context.newPage();
  try {
    console.log(`Reading answer: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body", { timeout: 20_000 });
    await closeLoginModal(page);
    await expandContent(page);
    const raw = await page.evaluate(() => {
      const question = document.querySelector(".QuestionHeader-title, h1")?.textContent?.trim() || document.title.replace(/ - 知乎$/, "");
      const answerId = location.pathname.match(/answer\/(\d+)/)?.[1];
      const answerRoot = document.querySelector(`[name="${answerId}"]`)?.closest(".AnswerItem")
        || document.querySelector(".AnswerItem")
        || document.querySelector(".RichContent")
        || document.body;
      const content = answerRoot.querySelector(".RichContent-inner, .RichText.ztext, .RichText") || answerRoot;
      const clone = content.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, button, .RichContent-actions, .ContentItem-actions").forEach((node) => node.remove());
      const publishedAt = answerRoot.querySelector("meta[itemprop='dateCreated']")?.content
        || answerRoot.querySelector("time")?.getAttribute("datetime")
        || "";
      return {
        kind: "answer",
        title: `回答：${question}`,
        excerpt: clone.textContent.trim().replace(/\s+/g, " ").slice(0, 180),
        contentHtml: clone.innerHTML,
        sourceUrl: location.href,
        publishedAt
      };
    });
    return localizeImages(context, normalizeItem(raw));
  } finally {
    await page.close();
  }
}

async function localizeImages(context, item) {
  const page = await context.newPage();
  await page.setContent(`<main>${item.contentHtml}</main>`);
  const images = await page.$$eval("img", (nodes) => nodes.map((img, index) => ({
    index,
    src: img.getAttribute("data-original") || img.getAttribute("data-actualsrc") || img.currentSrc || img.src || ""
  })));

  for (const image of images) {
    const imageUrl = normalizeImageUrl(image.src);
    if (!imageUrl) continue;
    try {
      const localUrl = await downloadImage(context, imageUrl, item.sourceUrl);
      await page.$$eval("img", (nodes, payload) => {
        const img = nodes[payload.index];
        if (!img) return;
        img.setAttribute("src", payload.localUrl);
        img.removeAttribute("srcset");
        img.removeAttribute("data-original");
        img.removeAttribute("data-actualsrc");
      }, { index: image.index, localUrl });
    } catch (error) {
      console.warn(`Image skipped: ${imageUrl} (${error.message})`);
    }
  }

  item.contentHtml = await page.$eval("main", (node) => node.innerHTML);
  await page.close();
  return item;
}

async function downloadImage(context, url, sourceUrl) {
  const parsed = new URL(url);
  const ext = cleanExtension(extname(parsed.pathname)) || ".jpg";
  const stem = `${safeFileName(new URL(sourceUrl).pathname)}-${safeFileName(basename(parsed.pathname, ext))}`.slice(0, 120);
  const filename = `${stem || Date.now()}${ext}`;
  const filePath = join(uploadDir, filename);
  const publicPath = `/uploads/zhihu/${filename}`;

  try {
    await readFile(filePath);
    return publicPath;
  } catch {
    const response = await context.request.get(url, { headers: { referer: sourceUrl } });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    await writeFile(filePath, await response.body());
    return publicPath;
  }
}

async function importIntoSite(items, { replace = false } = {}) {
  const store = new Store(dbPath);
  await store.load();
  if (replace) {
    const zhihuArticleIds = new Set(store.db.articles.filter((article) => article.authorId === "zhihu-import").map((article) => article.id));
    store.db.articles = store.db.articles.filter((article) => article.authorId !== "zhihu-import");
    store.db.comments = store.db.comments.filter((comment) => !zhihuArticleIds.has(comment.articleId));
  }
  const existing = new Set(store.db.articles.map((article) => article.sourceUrl).filter(Boolean));
  let count = 0;

  for (const item of items) {
    if (existing.has(item.sourceUrl)) continue;
    await store.createArticle({
      title: item.title,
      excerpt: item.excerpt,
      contentHtml: item.contentHtml,
      sourceUrl: item.sourceUrl,
      publishedAt: item.publishedAt,
      status: "published",
      authorId: "zhihu-import"
    });
    count += 1;
  }

  console.log(`Imported ${count} new item(s) into ${dbPath}`);
}

async function readProfileStats(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const pick = (label) => {
      const match = text.match(new RegExp(`${label}(\\d+)`));
      return match ? Number(match[1]) : 0;
    };
    return {
      name: document.querySelector("h1")?.textContent?.trim() || "",
      answers: pick("回答"),
      posts: pick("文章"),
      pins: pick("想法")
    };
  });
}

async function waitForManualLoginIfNeeded(page) {
  const needsLogin = await page.locator("text=请登录后查看").first().isVisible().catch(() => false);
  if (!needsLogin) return;

  console.log("Zhihu is asking for login. Please complete login in the opened browser. Waiting up to 5 minutes...");
  for (let i = 0; i < 300; i += 1) {
    await closeLoginModal(page);
    const stillBlocked = await page.locator("text=请登录后查看").first().isVisible().catch(() => false);
    const loginButton = await page.locator("button:has-text('登录/注册'), button:has-text('登录')").first().isVisible().catch(() => false);
    if (!stillBlocked && !loginButton) return;
    await page.waitForTimeout(1000);
  }
}

async function closeLoginModal(page) {
  const close = page.locator("button:has-text('关闭')").last();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function expandContent(page) {
  for (let i = 0; i < 5; i += 1) {
    const buttons = page.locator("button:has-text('阅读全文'), button:has-text('显示全部')");
    const count = await buttons.count().catch(() => 0);
    if (!count) break;
    await buttons.first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

function normalizeItem(item) {
  return {
    ...item,
    title: String(item.title || "未命名").trim(),
    excerpt: String(item.excerpt || "").trim(),
    contentHtml: String(item.contentHtml || "").trim(),
    sourceUrl: normalizeZhihuUrl(item.sourceUrl),
    publishedAt: parseZhihuDate(item.publishedAt),
    status: "published"
  };
}

function normalizeZhihuUrl(href) {
  if (!href) return "";
  const normalized = href.startsWith("//") ? `https:${href}` : href;
  const url = new URL(normalized, "https://www.zhihu.com");
  url.hash = "";
  return url.href;
}

function normalizeImageUrl(src) {
  if (!src || src.startsWith("data:")) return "";
  return src.startsWith("//") ? `https:${src}` : src;
}

function parseZhihuDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function fromUnix(value) {
  const number = Number(value);
  if (!number) return new Date().toISOString();
  return new Date(number * 1000).toISOString();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function pinContentHtml(content) {
  if (!Array.isArray(content)) return markdownToHtml(String(content || ""));
  return content.map((part) => {
    if (part.type === "image" || part.image_url || part.url?.match(/\.(png|jpe?g|gif|webp|avif)(\?|$)/i)) {
      const src = part.image_url || part.url || part.content;
      return src ? `<p><img src="${src}" alt=""></p>` : "";
    }
    return markdownToHtml(decodeZhihuText(part.content || part.own_text || ""));
  }).join("\n");
}

function decodeZhihuText(value) {
  return String(value || "")
    .replaceAll("&lt;br&gt;", "\n")
    .replaceAll("&lt;br/&gt;", "\n")
    .replaceAll("&lt;br /&gt;", "\n")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function appendLimit(url, limit) {
  const parsed = new URL(url);
  parsed.searchParams.set("limit", String(limit));
  if (!parsed.searchParams.has("offset")) parsed.searchParams.set("offset", "0");
  return parsed.href;
}

function ensureHttps(url) {
  return url.replace(/^http:\/\//, "https://");
}

function safeFileName(value) {
  return String(value || "")
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanExtension(ext) {
  const lower = ext.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"].includes(lower) ? lower : "";
}

async function loadPreviousExport() {
  try {
    const raw = await readFile(join(outputDir, "articles.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.articles || [];
  } catch {
    return [];
  }
}

async function saveExport(items) {
  await writeFile(join(outputDir, "articles.json"), JSON.stringify(items, null, 2), "utf8");
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}
