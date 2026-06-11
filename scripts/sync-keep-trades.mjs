import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { textToHtml } from "../src/render.js";
import { Store } from "../src/store.js";

const args = parseArgs(process.argv.slice(2));
const label = String(args.label || "每日交易");
const port = Number(args.port || 9224);
const shouldImport = Boolean(args.import || args.sync);
const profileDir = resolve(args.profile || "data/keep-browser-profile");
const maxScrolls = Number(args.maxScrolls || 80);

let notes = [];

if (args.input) {
  notes = await loadNotes(args.input);
} else {
  const browser = await connectOrLaunch();
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find((item) => item.url().includes("keep.google.com")) || context.pages()[0] || await context.newPage();
    await page.goto("https://keep.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    await assertLoggedIn(page);
    await openLabel(page, label);
    notes = await collectLabelNotes(page, label);
  } finally {
    await browser.close();
  }
}

notes.sort((a, b) => Date.parse(a.sourceCreatedAt) - Date.parse(b.sourceCreatedAt) || a.title.localeCompare(b.title, "zh-CN"));

console.log(`Collected ${notes.length} Keep note(s) with label "${label}".`);
for (const note of notes) {
  console.log(`${note.sourceCreatedAt.slice(0, 10)} ${note.title}`);
}

if (args.output) {
  await writeFile(resolve(args.output), JSON.stringify({ label, notes }, null, 2), "utf8");
  console.log(`Wrote ${notes.length} note(s) to ${resolve(args.output)}`);
}

if (shouldImport) {
  const result = await importNotes(notes);
  console.log(`Imported ${result.created} new trade journal item(s), updated ${result.updated} changed item(s).`);
}

async function connectOrLaunch() {
  const { chromium } = await import("playwright");
  try {
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    return chromium.connectOverCDP(version.webSocketDebuggerUrl);
  } catch {
    await mkdir(profileDir, { recursive: true });
    return chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [`--remote-debugging-port=${port}`, "--no-first-run", "--disable-popup-blocking"]
    }).then((context) => ({
      contexts: () => [context],
      close: () => context.close()
    }));
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return response.json();
}

async function assertLoggedIn(page) {
  const state = await page.evaluate(() => ({
    url: location.href,
    text: (document.body.innerText || "").slice(0, 1000)
  }));
  if (/signin|accounts\.google/i.test(state.url) || /Sign in/i.test(state.text)) {
    throw new Error("Google Keep is not logged in. Open the controlled Chrome window and log in first.");
  }
}

async function openLabel(page, label) {
  const clicked = await page.evaluate((targetLabel) => {
    const candidates = [...document.querySelectorAll("a, div[role='button'], div, span")];
    const target = candidates.find((el) => (el.textContent || "").trim() === targetLabel);
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`Could not find Keep label "${label}" in the sidebar.`);
  await page.waitForTimeout(3500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
}

async function collectLabelNotes(page, label) {
  const collected = new Map();
  let stableScrolls = 0;
  let lastCount = 0;

  for (let i = 0; i < maxScrolls; i += 1) {
    const batch = await page.evaluate((targetLabel) => {
      const labelOrDate = new Set([targetLabel]);
      const roots = [...document.querySelectorAll(".IZ65Hb-n0tgWb")];
      return roots.map((el) => {
        const lines = (el.innerText || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const labels = lines.filter((line) => line === targetLabel);
        const title = lines.find((line) => line !== targetLabel && line !== "添加记事…") || "";
        const dateLine = [...lines].reverse().find((line) => looksLikeKeepDate(line)) || "";
        const bodyLines = lines.filter((line, index) => {
          if (index === lines.indexOf(title)) return false;
          if (line === title || labelOrDate.has(line) || line === dateLine || line === "添加记事…") return false;
          return true;
        });
        const text = [title, ...bodyLines].join("\n\n").trim();
        return {
          title,
          labels,
          dateLine,
          text,
          body: bodyLines.join("\n\n").trim()
        };
      }).filter((note) => note.title && note.labels.includes(targetLabel) && note.text);

      function looksLikeKeepDate(value) {
        return /今天|昨天|\d+月\d+日|\d{1,2}:\d{2}/.test(value);
      }
    }, label);

    for (const note of batch) {
      const normalized = normalizeNote(note);
      collected.set(normalized.sourceUrl, normalized);
    }

    if (collected.size === lastCount) stableScrolls += 1;
    else stableScrolls = 0;
    lastCount = collected.size;
    if (stableScrolls >= 3) break;

    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.8, 600)));
    await page.waitForTimeout(1200);
  }

  return [...collected.values()];
}

function normalizeNote(note) {
  const title = cleanText(note.title);
  const body = cleanText(note.body || note.text.replace(note.title, ""));
  const sourceCreatedAt = parseTradeDate(title) || parseKeepDate(note.dateLine) || new Date().toISOString();
  const sourceId = sha1(title);
  const content = body || title;
  return {
    title,
    kind: "trade",
    excerpt: content.replace(/\s+/g, " ").slice(0, 180),
    contentHtml: textToHtml(content),
    sourceUrl: `keep://daily-trade/${sourceId}`,
    sourceCreatedAt,
    sourceUpdatedAt: sourceCreatedAt,
    publishedAt: sourceCreatedAt,
    status: "published",
    authorId: "keep-import"
  };
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseTradeDate(title) {
  const match = /^(\d{2,4})\s+(\d{1,2})\s+(\d{1,2})(?:\s|$)/.exec(title);
  if (!match) return "";
  const rawYear = Number(match[1]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return localDateIso(year, month, day);
}

function parseKeepDate(value) {
  const now = new Date();
  if (/今天/.test(value)) return localDateIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (/昨天/.test(value)) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return localDateIso(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate());
  }
  const match = /(\d{1,2})月(\d{1,2})日/.exec(value);
  if (match) return localDateIso(now.getFullYear(), Number(match[1]), Number(match[2]));
  return "";
}

function localDateIso(year, month, day) {
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return date.toISOString();
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

async function importNotes(notes) {
  const store = new Store(process.env.DB_PATH ? resolve(process.env.DB_PATH) : resolve("data", "db.json"));
  await store.load();
  let created = 0;
  let updated = 0;
  const existing = new Map(store.db.articles.map((article) => [article.sourceUrl, article]).filter(([sourceUrl]) => sourceUrl));

  for (const note of notes) {
    const current = existing.get(note.sourceUrl);
    if (current) {
      const changed = current.title !== note.title
        || current.kind !== note.kind
        || current.excerpt !== note.excerpt
        || current.contentHtml !== note.contentHtml
        || current.sourceCreatedAt !== note.sourceCreatedAt;
      if (!changed) continue;
      Object.assign(current, {
        title: note.title,
        kind: note.kind,
        excerpt: note.excerpt,
        contentHtml: note.contentHtml,
        sourceCreatedAt: note.sourceCreatedAt,
        sourceUpdatedAt: note.sourceUpdatedAt,
        publishedAt: note.publishedAt,
        updatedAt: new Date().toISOString()
      });
      updated += 1;
    } else {
      const article = await store.createArticle(note);
      existing.set(article.sourceUrl, article);
      created += 1;
    }
  }

  await store.save();
  return { created, updated };
}

async function loadNotes(path) {
  const payload = JSON.parse(await readFile(resolve(path), "utf8"));
  const items = Array.isArray(payload) ? payload : payload.notes;
  if (!Array.isArray(items)) throw new Error("Input JSON must be an array or an object with a notes array.");
  return items.map((item) => ({
    title: String(item.title || "").trim(),
    kind: "trade",
    excerpt: String(item.excerpt || "").trim(),
    contentHtml: String(item.contentHtml || ""),
    sourceUrl: String(item.sourceUrl || "").trim(),
    sourceCreatedAt: item.sourceCreatedAt || item.publishedAt || new Date().toISOString(),
    sourceUpdatedAt: item.sourceUpdatedAt || item.sourceCreatedAt || item.publishedAt || new Date().toISOString(),
    publishedAt: item.publishedAt || item.sourceCreatedAt || new Date().toISOString(),
    status: item.status || "published",
    authorId: item.authorId || "keep-import"
  })).filter((item) => item.title && item.sourceUrl && item.contentHtml);
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (key.includes("=")) {
      const [name, ...rest] = key.split("=");
      parsed[name] = rest.join("=");
    } else if (values[i + 1] && !values[i + 1].startsWith("--")) {
      parsed[key] = values[i + 1];
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
