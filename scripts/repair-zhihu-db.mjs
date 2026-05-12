import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { slugify } from "../src/render.js";

const dbPath = resolve(process.argv[2] || "data/db.json");
const db = JSON.parse(await readFile(dbPath, "utf8"));

db.articles = db.articles.filter((article) => {
  return !(article.title.startsWith("回答：") && article.sourceUrl.includes("/api/v4/answers/"));
});

for (const article of db.articles) {
  if (!article.title.startsWith("想法：")) continue;
  article.contentHtml = article.contentHtml.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
  const text = article.contentHtml
    .replace(/<br\s*\/?>(\s*)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  article.title = `想法：${text.slice(0, 42) || article.id}`;
  article.excerpt = text.slice(0, 180);
}

const usedSlugs = new Set();
for (const article of db.articles) {
  const base = slugify(article.title);
  let slug = base;
  let index = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  article.slug = slug;
  usedSlugs.add(slug);
}

await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");

const counts = {};
for (const article of db.articles) {
  const kind = article.title.startsWith("回答：") ? "answer" : article.title.startsWith("想法：") ? "pin" : "article";
  counts[kind] = (counts[kind] || 0) + 1;
}

console.log({ ...counts, total: db.articles.length });
