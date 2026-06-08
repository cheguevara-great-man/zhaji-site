import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "zhihu-site-"));
const port = 4199;
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    PUBLIC_BASE_URL: base,
    DB_PATH: join(tmp, "db.json"),
    OUTBOX_DIR: join(tmp, "outbox"),
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_SECURE: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForServer(base);
  await expectStatus("/", 200);

  const register = await post("/register", {
    name: "Admin",
    email: "admin@example.com",
    password: "password123"
  });
  if (!register.headers.get("location")?.includes("/check-email")) {
    throw new Error("Registration did not redirect to email verification notice.");
  }

  const verifyLink = await readLatestEmailLink(join(tmp, "outbox"), "/verify-email");
  const verified = await fetch(verifyLink, { redirect: "manual" });
  const setCookie = verified.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`Email verification did not set a session cookie. status=${verified.status} location=${verified.headers.get("location")}`);
  }
  const cookie = setCookie.split(";")[0];
  if (!verified.headers.get("location")?.includes("/admin")) {
    throw new Error("First verified account did not redirect to admin.");
  }

  await expectStatus("/admin", 200, cookie);

  const created = await post("/admin/articles", {
    title: "Smoke Test Article",
    excerpt: "A verified article.",
    sourceUrl: "https://zhuanlan.zhihu.com/p/example",
    publishedAt: "2026-05-13T00:00",
    status: "published",
    format: "markdown",
    content: "# Heading\nThis is a smoke test."
  }, cookie);

  if (!created.headers.get("location")?.includes("/admin")) {
    throw new Error("Article creation did not redirect to admin.");
  }

  await seedExternalComments(join(tmp, "db.json"));

  const article = await fetch(`${base}/articles/smoke-test-article`, { headers: { cookie } });
  const articleHtml = await article.text();
  if (!article.ok || !articleHtml.includes("Smoke Test Article")) {
    throw new Error("Created article was not rendered.");
  }
  if (!articleHtml.includes("Imported Zhihu comment") || !articleHtml.includes("Imported Zhihu reply")) {
    throw new Error("Imported external comments were not rendered.");
  }

  const search = await fetch(`${base}/search?q=smoke`, { headers: { cookie } });
  const searchHtml = await search.text();
  if (!search.ok || !searchHtml.includes("Smoke Test Article")) {
    throw new Error("Search did not return the created article.");
  }

  const commentSearch = await fetch(`${base}/search?q=${encodeURIComponent("Imported Zhihu reply")}`, { headers: { cookie } });
  const commentSearchHtml = await commentSearch.text();
  if (!commentSearch.ok || !commentSearchHtml.includes("Smoke Test Article") || !commentSearchHtml.includes("评论")) {
    throw new Error("Search did not return imported external comments.");
  }

  await post("/comments/smoke-test-article", { body: "Looks good." }, cookie);
  const commented = await fetch(`${base}/articles/smoke-test-article`, { headers: { cookie } });
  const commentedHtml = await commented.text();
  if (!commentedHtml.includes("Looks good.")) {
    throw new Error("Comment was not rendered.");
  }

  await post("/forgot-password", { email: "admin@example.com" });

  console.log("Smoke test passed.");
} finally {
  child.kill();
  await rm(tmp, { recursive: true, force: true });
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not start. ${stderr}`);
}

async function expectStatus(path, status, cookie = "") {
  const response = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  if (response.status !== status) {
    throw new Error(`${path} returned ${response.status}, expected ${status}.`);
  }
}

async function post(path, fields, cookie = "") {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {})
    },
    body: new URLSearchParams(fields),
    redirect: "manual"
  });
}

async function readLatestEmailLink(outboxDir, path) {
  const files = await readdir(outboxDir);
  for (const file of files.sort().reverse()) {
    const text = await readFile(join(outboxDir, file), "utf8");
    const match = new RegExp(`https?://[^\\s]+${path}[^\\s]+`).exec(text);
    if (match) return match[0];
  }

  throw new Error(`No ${path} link was found in the outbox email.`);
}

async function seedExternalComments(dbPath) {
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  const article = db.articles.find((item) => item.slug === "smoke-test-article");
  if (!article) throw new Error("Smoke article was not found in db.");
  db.comments.push({
    id: "external-parent",
    articleId: article.id,
    userId: null,
    parentId: null,
    body: "Imported Zhihu comment",
    source: "zhihu",
    sourceCommentId: "zhihu-parent",
    sourceParentCommentId: "",
    authorName: "知乎用户甲",
    likeCount: 3,
    ipLocation: "北京",
    createdAt: new Date().toISOString()
  }, {
    id: "external-child",
    articleId: article.id,
    userId: null,
    parentId: "external-parent",
    body: "Imported Zhihu reply",
    source: "zhihu",
    sourceCommentId: "zhihu-child",
    sourceParentCommentId: "zhihu-parent",
    authorName: "知乎用户乙",
    replyToAuthorName: "知乎用户甲",
    likeCount: 1,
    ipLocation: "上海",
    createdAt: new Date().toISOString()
  });
  await writeFile(dbPath, JSON.stringify(db, null, 2), "utf8");
}
