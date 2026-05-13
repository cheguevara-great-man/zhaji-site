import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    DB_PATH: join(tmp, "db.json"),
    OUTBOX_DIR: join(tmp, "outbox")
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
  const cookie = verified.headers.get("set-cookie").split(";")[0];
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

  const article = await fetch(`${base}/articles/smoke-test-article`, { headers: { cookie } });
  const articleHtml = await article.text();
  if (!article.ok || !articleHtml.includes("Smoke Test Article")) {
    throw new Error("Created article was not rendered.");
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
  const latest = files.sort().at(-1);
  if (!latest) throw new Error("No email was written to the outbox.");

  const text = await readFile(join(outboxDir, latest), "utf8");
  const match = new RegExp(`https?://[^\\s]+${path}[^\\s]+`).exec(text);
  if (!match) throw new Error(`No ${path} link was found in the outbox email.`);
  return match[0];
}
