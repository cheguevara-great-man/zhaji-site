import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Store } from "../src/store.js";
import { markdownToHtml, textToHtml } from "../src/render.js";

const input = process.argv[2];

if (!input) {
  console.error("Usage: npm run import:zhihu -- <articles.json | markdown-directory>");
  process.exit(1);
}

const store = new Store(process.env.DB_PATH ? resolve(process.env.DB_PATH) : resolve("data", "db.json"));
await store.load();

const statPath = resolve(input);
const importedBy = "importer";
const articles = [];

async function importJson(path) {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : parsed.articles;

  if (!Array.isArray(items)) {
    throw new Error("JSON must be an array or an object with an articles array.");
  }

  for (const item of items) {
    const title = String(item.title || "").trim();
    if (!title) continue;

    const html = item.html || item.contentHtml || markdownToHtml(item.markdown || item.content || "");
    articles.push({
      title,
      excerpt: item.excerpt || item.summary || "",
      contentHtml: html,
      sourceUrl: item.sourceUrl || item.url || "",
      publishedAt: item.publishedAt || item.createdAt || new Date().toISOString(),
      status: item.status || "published",
      authorId: importedBy
    });
  }
}

async function importMarkdownDirectory(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || ![".md", ".txt"].includes(extname(entry.name).toLowerCase())) continue;
    const raw = await readFile(join(path, entry.name), "utf8");
    const [firstLine, ...rest] = raw.split(/\r?\n/);
    const title = firstLine.replace(/^#\s*/, "").trim() || entry.name.replace(/\.[^.]+$/, "");
    const body = firstLine.startsWith("# ") ? rest.join("\n") : raw;
    articles.push({
      title,
      excerpt: textToHtml(body).replace(/<[^>]+>/g, "").slice(0, 180),
      contentHtml: markdownToHtml(body),
      sourceUrl: "",
      publishedAt: new Date().toISOString(),
      status: "published",
      authorId: importedBy
    });
  }
}

if (extname(statPath).toLowerCase() === ".json") {
  await importJson(statPath);
} else {
  await importMarkdownDirectory(statPath);
}

for (const article of articles) {
  await store.createArticle(article);
}

console.log(`Imported ${articles.length} article(s).`);
