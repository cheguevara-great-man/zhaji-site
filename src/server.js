import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clearSessionCookie, hashPassword, parseCookies, sessionCookie, verifyPassword } from "./auth.js";
import { Emailer } from "./email.js";
import { loadEnv } from "./env.js";
import { escapeHtml, layout, markdownToHtml, textToHtml } from "./render.js";
import { Store } from "./store.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
await loadEnv(join(root, ".env"));
const publicDir = join(root, "public");
const store = new Store(process.env.DB_PATH || join(root, "data", "db.json"));
const emailer = new Emailer(process.env.OUTBOX_DIR || join(root, "data", "outbox"));
const port = Number(process.env.PORT || 4173);
const homePageSize = 12;

await store.load();

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    console.error(error);
    sendHtml(res, 500, layout({
      title: "Server error",
      user: getCurrentUser(req),
      body: `<section class="narrow"><h1>出了点问题</h1><p>${escapeHtml(error.message)}</p></section>`
    }));
  }
});

server.listen(port, () => {
  console.log(`Zhihu Article Site running at http://localhost:${port}`);
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  await store.load();
  const user = getCurrentUser(req);

  if (url.pathname.startsWith("/public/")) {
    return serveStatic(req, res, url.pathname.replace("/public/", ""));
  }
  if (url.pathname.startsWith("/uploads/")) {
    return serveStatic(req, res, url.pathname.replace("/", ""));
  }

  if (req.method === "GET" && url.pathname === "/") return home(res, user);
  if (req.method === "GET" && url.pathname === "/api/articles") return articleFeed(res, url);
  if (req.method === "GET" && url.pathname === "/archive") return archive(res, user, url);
  if (req.method === "GET" && url.pathname.startsWith("/articles/")) return articlePage(res, user, decodeURIComponent(url.pathname.split("/").pop()));

  if (req.method === "GET" && url.pathname === "/login") return authPage(res, user, "login");
  if (req.method === "GET" && url.pathname === "/register") return authPage(res, user, "register");
  if (req.method === "GET" && url.pathname === "/check-email") return checkEmailPage(res, user, url.searchParams.get("mode") || "verify");
  if (req.method === "GET" && url.pathname === "/verify-email") return verifyEmail(req, res, url.searchParams.get("token"));
  if (req.method === "GET" && url.pathname === "/forgot-password") return forgotPage(res, user);
  if (req.method === "GET" && url.pathname === "/reset-password") return resetPage(res, user, url.searchParams.get("token"));

  if (req.method === "POST" && url.pathname === "/register") return register(req, res);
  if (req.method === "POST" && url.pathname === "/login") return login(req, res);
  if (req.method === "POST" && url.pathname === "/logout") return logout(req, res);
  if (req.method === "POST" && url.pathname === "/forgot-password") return forgot(req, res);
  if (req.method === "POST" && url.pathname === "/reset-password") return resetPassword(req, res);
  if (req.method === "POST" && url.pathname.startsWith("/comments/")) return createComment(req, res, user, decodeURIComponent(url.pathname.split("/").pop()));
  if (req.method === "POST" && url.pathname.startsWith("/delete-comment/")) return deleteComment(req, res, user, url.pathname.split("/").pop());

  if (req.method === "GET" && url.pathname === "/admin") return requireAdmin(res, user, () => adminDashboard(res, user));
  if (req.method === "GET" && url.pathname === "/admin/new") return requireAdmin(res, user, () => articleForm(res, user));
  if (req.method === "GET" && url.pathname.startsWith("/admin/edit/")) return requireAdmin(res, user, () => articleForm(res, user, store.getArticleById(url.pathname.split("/").pop())));
  if (req.method === "GET" && url.pathname === "/admin/import") return requireAdmin(res, user, () => importPage(res, user));
  if (req.method === "POST" && url.pathname === "/admin/articles") return requireAdmin(res, user, () => saveArticle(req, res, user));
  if (req.method === "POST" && url.pathname.startsWith("/admin/articles/")) return requireAdmin(res, user, () => saveArticle(req, res, user, url.pathname.split("/").pop()));
  if (req.method === "POST" && url.pathname.startsWith("/admin/delete/")) return requireAdmin(res, user, () => removeArticle(res, url.pathname.split("/").pop()));
  if (req.method === "POST" && url.pathname === "/admin/import") return requireAdmin(res, user, () => importArticles(req, res, user));

  sendHtml(res, 404, layout({
    title: "Not found",
    user,
    body: `<section class="narrow"><h1>页面不存在</h1><p>这个地址没有对应内容。</p></section>`
  }));
}

function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  return store.getUserBySession(cookies.get("sid"));
}

function home(res, user) {
  const allArticles = store.listArticles();
  const articles = allArticles.slice(0, homePageSize);
  sendHtml(res, 200, layout({
    title: "札记",
    user,
    active: "/",
    body: `<section class="hero">
      <div>
        <p class="eyebrow">札记</p>
        <h1>思想是人在时间里存在的痕迹。</h1>
        <p>文章、回答、想法、小说和随笔都放在这里。</p>
      </div>
    </section>
    <section class="section-head"><h2>最近更新</h2><a href="/archive">全部目录</a></section>
    <section class="article-grid" data-feed data-next-offset="${articles.length}" data-page-size="${homePageSize}" data-has-more="${allArticles.length > articles.length ? "true" : "false"}">
      ${articles.length ? articles.map(articleCard).join("") : `<div class="empty">还没有文章。注册第一个账号后进入管理页发布或导入。</div>`}
    </section>
    <div class="feed-sentinel" data-feed-sentinel>${allArticles.length > articles.length ? "继续向下滚动" : "已经到底了"}</div>`
  }));
}

function articleFeed(res, url) {
  const offset = clampInteger(url.searchParams.get("offset"), 0, 100000);
  const limit = clampInteger(url.searchParams.get("limit"), 1, 24);
  const allArticles = store.listArticles();
  const articles = allArticles.slice(offset, offset + limit);
  const nextOffset = offset + articles.length;
  sendJson(res, 200, {
    html: articles.map(articleCard).join(""),
    nextOffset,
    hasMore: nextOffset < allArticles.length
  });
}

function archive(res, user, url) {
  const selectedKind = normalizeKindFilter(url.searchParams.get("kind"));
  const articles = store.listArticles({ kind: selectedKind });
  const allArticles = store.listArticles();
  const counts = countKinds(allArticles);
  const filters = [
    ["", "全部", allArticles.length],
    ["article", "文章", counts.article],
    ["answer", "回答", counts.answer],
    ["pin", "想法", counts.pin]
  ];
  sendHtml(res, 200, layout({
    title: "目录",
    user,
    active: "/archive",
    body: `<section class="page-heading"><h1>目录</h1><p>${articles.length} 篇内容</p></section>
    <nav class="filter-tabs">
      ${filters.map(([kind, label, count]) => `<a class="${selectedKind === kind ? "active" : ""}" href="/archive${kind ? `?kind=${kind}` : ""}">${label}<span>${count}</span></a>`).join("")}
    </nav>
    <section class="archive-list">
      ${articles.map((article) => `<a class="archive-row" href="/articles/${encodeURIComponent(article.slug)}">
        <span><small>${kindLabel(article.kind)}</small>${escapeHtml(article.title)}</span>
        <time>${formatDate(articleSourceCreatedAt(article))}</time>
      </a>`).join("") || `<div class="empty">暂无文章。</div>`}
    </section>`
  }));
}

function articlePage(res, user, slug) {
  const article = store.getArticleBySlug(slug, { includeDrafts: user?.isAdmin });
  if (!article) return sendHtml(res, 404, layout({ title: "Article not found", user, body: `<section class="narrow"><h1>文章不存在</h1></section>` }));

  const comments = store.listComments(article.id);
  sendHtml(res, 200, layout({
    title: article.title,
    user,
    body: `<article class="article">
      <header>
        <time>${formatDate(articleSourceCreatedAt(article))}</time>
        <h1>${escapeHtml(article.title)}</h1>
      </header>
      <div class="prose">${article.contentHtml}</div>
      ${article.sourceUrl ? `<footer class="article-footer"><a class="source-link" href="${escapeHtml(article.sourceUrl)}" rel="noreferrer">原文链接</a></footer>` : ""}
    </article>
    <section class="comments">
      <h2>评论</h2>
      ${comments.map((comment) => commentView(comment, user)).join("") || `<p class="muted">还没有评论。</p>`}
      ${user ? `<form class="comment-form" method="post" action="/comments/${encodeURIComponent(article.slug)}">
        <label>添加评论<textarea name="body" required minlength="2" rows="4"></textarea></label>
        <button>发布评论</button>
      </form>` : `<p class="muted"><a href="/login">登录</a> 后可以评论。</p>`}
    </section>`
  }));
}

function authPage(res, user, mode) {
  if (user) return redirect(res, "/");
  const isLogin = mode === "login";
  sendHtml(res, 200, layout({
    title: isLogin ? "登录" : "注册",
    user,
    body: `<section class="auth-panel">
      <h1>${isLogin ? "登录" : "注册"}</h1>
      <form method="post" action="/${isLogin ? "login" : "register"}">
        ${isLogin ? "" : `<label>用户名<input name="name" required minlength="2"></label>`}
        <label>邮箱<input type="email" name="email" required></label>
        <label>密码<input type="password" name="password" required minlength="8"></label>
        <button>${isLogin ? "登录" : "创建账号"}</button>
      </form>
      <p>${isLogin ? `还没有账号？<a href="/register">注册</a> · <a href="/forgot-password">忘记密码</a>` : `已有账号？<a href="/login">登录</a>`}</p>
    </section>`
  }));
}

function forgotPage(res, user) {
  sendHtml(res, 200, layout({
    title: "找回密码",
    user,
    body: `<section class="auth-panel"><h1>找回密码</h1>
      <form method="post" action="/forgot-password">
        <label>注册邮箱<input type="email" name="email" required></label>
        <button>发送重置链接</button>
      </form>
    </section>`
  }));
}

function checkEmailPage(res, user, mode = "verify") {
  const isReset = mode === "reset";
  sendHtml(res, 200, layout({
    title: "请检查邮箱",
    user,
    body: `<section class="narrow"><h1>请检查邮箱</h1>
      <p>${isReset ? "如果邮箱存在，密码重置链接已经发送。" : "验证链接已经发送到你的邮箱，点击链接后账号就可以正常登录。"}</p>
      ${emailer.smtp ? "" : `<p>当前没有配置 SMTP，邮件会写入本地 <code>data\\outbox</code>。</p>`}
    </section>`
  }));
}

function resetPage(res, user, token) {
  sendHtml(res, 200, layout({
    title: "重置密码",
    user,
    body: `<section class="auth-panel"><h1>重置密码</h1>
      <form method="post" action="/reset-password">
        <input type="hidden" name="token" value="${escapeHtml(token || "")}">
        <label>新密码<input type="password" name="password" required minlength="8"></label>
        <button>更新密码</button>
      </form>
    </section>`
  }));
}

async function register(req, res) {
  const form = await readForm(req);
  const password = form.get("password");
  if (String(password).length < 8) throw new Error("Password must be at least 8 characters.");

  const user = await store.createUser({
    name: form.get("name"),
    email: form.get("email"),
    passwordHash: await hashPassword(password)
  });
  await sendVerificationEmail(req, user);
  redirect(res, "/check-email");
}

async function verifyEmail(req, res, token) {
  const user = await store.consumeEmailVerification(token);
  if (!user) {
    return sendHtml(res, 400, layout({
      title: "验证失败",
      user: getCurrentUser(req),
      body: `<section class="narrow"><h1>验证失败</h1><p>这个验证链接无效或已经过期。</p><p><a href="/register">重新注册</a></p></section>`
    }));
  }

  const session = await store.createSession(user.id);
  res.setHeader("Set-Cookie", sessionCookie(session));
  redirect(res, user.isAdmin ? "/admin" : "/");
}

async function login(req, res) {
  const form = await readForm(req);
  const user = store.getUserByEmail(form.get("email"));
  if (!user || !(await verifyPassword(form.get("password"), user.passwordHash))) {
    return sendHtml(res, 401, layout({ title: "登录失败", user: null, body: `<section class="narrow"><h1>登录失败</h1><p>邮箱或密码不正确。</p><p><a href="/login">返回登录</a></p></section>` }));
  }
  if (!user.emailVerifiedAt) {
    await sendVerificationEmail(req, user);
    return redirect(res, "/check-email");
  }

  const token = await store.createSession(user.id);
  res.setHeader("Set-Cookie", sessionCookie(token));
  redirect(res, "/");
}

async function logout(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  await store.deleteSession(cookies.get("sid"));
  res.setHeader("Set-Cookie", clearSessionCookie());
  redirect(res, "/");
}

async function forgot(req, res) {
  const form = await readForm(req);
  const user = store.getUserByEmail(form.get("email"));
  if (user) {
    const token = await store.createPasswordReset(user.id);
    const link = `${baseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    await emailer.send({
      to: user.email,
      subject: "札记密码重置",
      text: `请打开下面的链接重置密码，45 分钟内有效：\n\n${link}`
    });
  }

  sendHtml(res, 200, layout({
    title: "邮件已处理",
    user: getCurrentUser(req),
    body: `<section class="narrow"><h1>请检查邮箱</h1><p>如果邮箱存在，重置链接已经发送。</p>${emailer.smtp ? "" : `<p>当前没有配置 SMTP，邮件会写入本地 <code>data\\outbox</code>。</p>`}</section>`
  }));
}

async function resetPassword(req, res) {
  const form = await readForm(req);
  const user = await store.consumePasswordReset(form.get("token"));
  if (!user) throw new Error("Reset link is invalid or expired.");

  await store.updatePassword(user.id, await hashPassword(form.get("password")));
  redirect(res, "/login");
}

async function sendVerificationEmail(req, user) {
  const token = await store.createEmailVerification(user.id);
  const link = `${baseUrl(req)}/verify-email?token=${encodeURIComponent(token)}`;
  return emailer.send({
    to: user.email,
    subject: "札记邮箱验证",
    text: `请打开下面的链接完成邮箱验证，24 小时内有效：\n\n${link}`
  });
}

async function createComment(req, res, user, slug) {
  if (!user) return redirect(res, "/login");
  if (!user.emailVerifiedAt) return redirect(res, "/check-email");
  const article = store.getArticleBySlug(slug);
  if (!article) throw new Error("Article not found.");
  const form = await readForm(req);
  if (String(form.get("body")).trim().length < 2) throw new Error("Comment is too short.");
  await store.createComment({ articleId: article.id, userId: user.id, body: form.get("body") });
  redirect(res, `/articles/${encodeURIComponent(slug)}`);
}

async function deleteComment(req, res, user, id) {
  if (!user) return redirect(res, "/login");
  await store.deleteComment(id, user);
  redirect(res, req.headers.referer || "/");
}

function adminDashboard(res, user) {
  const articles = store.listArticles({ includeDrafts: true });
  sendHtml(res, 200, layout({
    title: "Admin",
    user,
    active: "/admin",
    body: `<section class="admin-head"><div><h1>内容管理</h1><p>发布、编辑和导入你的文章。</p></div><div><a class="button-link" href="/admin/import">导入</a><a class="primary-action" href="/admin/new">新文章</a></div></section>
    <section class="admin-list">
      ${articles.map((article) => `<div class="admin-row">
        <div><strong>${escapeHtml(article.title)}</strong><span>${article.status} · ${formatDate(articleSourceCreatedAt(article))}</span></div>
        <div class="row-actions"><a href="/articles/${encodeURIComponent(article.slug)}">查看</a><a href="/admin/edit/${article.id}">编辑</a><form method="post" action="/admin/delete/${article.id}" data-confirm="确定删除这篇文章？"><button>删除</button></form></div>
      </div>`).join("") || `<div class="empty">暂无文章。</div>`}
    </section>`
  }));
}

function articleForm(res, user, article = null) {
  sendHtml(res, 200, layout({
    title: article ? "编辑文章" : "新文章",
    user,
    body: `<section class="editor">
      <h1>${article ? "编辑文章" : "新文章"}</h1>
      <form method="post" action="${article ? `/admin/articles/${article.id}` : "/admin/articles"}">
        <label>标题<input name="title" required value="${escapeHtml(article?.title || "")}"></label>
        <label>摘要<textarea name="excerpt" rows="3">${escapeHtml(article?.excerpt || "")}</textarea></label>
        <label>原文链接<input name="sourceUrl" value="${escapeHtml(article?.sourceUrl || "")}"></label>
        <label>知乎创建时间<input type="datetime-local" name="publishedAt" value="${toDateInput(articleSourceCreatedAt(article || {}))}"></label>
        <label>类型<select name="kind"><option value="article" ${article?.kind !== "answer" && article?.kind !== "pin" ? "selected" : ""}>文章</option><option value="answer" ${article?.kind === "answer" ? "selected" : ""}>回答</option><option value="pin" ${article?.kind === "pin" ? "selected" : ""}>想法</option></select></label>
        <label>状态<select name="status"><option value="published" ${article?.status !== "draft" ? "selected" : ""}>发布</option><option value="draft" ${article?.status === "draft" ? "selected" : ""}>草稿</option></select></label>
        <label>格式<select name="format"><option value="markdown">Markdown</option><option value="html" ${article ? "selected" : ""}>HTML</option></select></label>
        <label>正文<textarea class="content-editor" name="content" required rows="18">${escapeHtml(article?.contentHtml || "")}</textarea></label>
        <button>保存</button>
      </form>
    </section>`
  }));
}

async function saveArticle(req, res, user, id = null) {
  const form = await readForm(req);
  const content = form.get("format") === "html" ? form.get("content") : markdownToHtml(form.get("content"));
  const input = {
    title: form.get("title"),
    kind: form.get("kind"),
    excerpt: form.get("excerpt"),
    sourceUrl: form.get("sourceUrl"),
    sourceCreatedAt: fromDateInput(form.get("publishedAt")),
    publishedAt: fromDateInput(form.get("publishedAt")),
    status: form.get("status"),
    contentHtml: content,
    authorId: user.id
  };

  if (id) await store.updateArticle(id, input);
  else await store.createArticle(input);
  redirect(res, "/admin");
}

async function removeArticle(res, id) {
  await store.deleteArticle(id);
  redirect(res, "/admin");
}

function importPage(res, user) {
  sendHtml(res, 200, layout({
    title: "导入文章",
    user,
    body: `<section class="editor">
      <h1>导入文章</h1>
      <p class="muted">粘贴 JSON 数组。每项支持 title、markdown、html、sourceUrl、publishedAt、excerpt。</p>
      <form method="post" action="/admin/import">
        <label>文章 JSON<textarea class="content-editor" name="payload" rows="18" required>[{"title":"示例文章","markdown":"# 小标题\\n正文内容","sourceUrl":"https://zhuanlan.zhihu.com/p/example"}]</textarea></label>
        <button>导入</button>
      </form>
    </section>`
  }));
}

async function importArticles(req, res, user) {
  const form = await readForm(req, 5_000_000);
  const parsed = JSON.parse(form.get("payload"));
  const items = Array.isArray(parsed) ? parsed : parsed.articles;
  if (!Array.isArray(items)) throw new Error("Payload must be an array or an object with an articles array.");

  for (const item of items) {
    if (!item.title) continue;
    await store.createArticle({
      title: item.title,
      kind: item.kind || inferKindFromTitle(item.title),
      excerpt: item.excerpt || item.summary || "",
      contentHtml: item.html || item.contentHtml || markdownToHtml(item.markdown || item.content || ""),
      sourceUrl: item.sourceUrl || item.url || "",
      sourceCreatedAt: item.sourceCreatedAt || item.publishedAt || new Date().toISOString(),
      sourceUpdatedAt: item.sourceUpdatedAt || item.sourceCreatedAt || item.publishedAt || new Date().toISOString(),
      publishedAt: item.sourceCreatedAt || item.publishedAt || new Date().toISOString(),
      status: item.status || "published",
      authorId: user.id
    });
  }

  redirect(res, "/admin");
}

function articleCard(article) {
  const excerpt = articleExcerpt(article);
  return `<a class="article-card" href="/articles/${encodeURIComponent(article.slug)}">
    <time>${formatDate(articleSourceCreatedAt(article))}</time>
    <h2>${escapeHtml(article.title)}</h2>
    <p>${escapeHtml(excerpt)}</p>
  </a>`;
}

function articleExcerpt(article) {
  const source = article.excerpt || article.contentHtml;
  return stripHtml(source).replace(/\s+/g, " ").trim().slice(0, 140);
}

function commentView(comment, currentUser) {
  const author = store.getUserById(comment.userId);
  const canDelete = currentUser?.isAdmin || currentUser?.id === comment.userId;
  return `<div class="comment">
    <div><strong>${escapeHtml(author?.name || "用户")}</strong><time>${formatDate(comment.createdAt)}</time></div>
    <p>${textToHtml(comment.body)}</p>
    ${canDelete ? `<form method="post" action="/delete-comment/${comment.id}"><button>删除</button></form>` : ""}
  </div>`;
}

function requireAdmin(res, user, next) {
  if (!user?.isAdmin) return redirect(res, "/login");
  return next();
}

async function serveStatic(req, res, path) {
  const safePath = path.replaceAll("\\", "/").replace(/\.\.+/g, "");
  const filePath = join(publicDir, safePath);
  const type = mimeType(filePath);
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(body);
}

async function readForm(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sendHtml(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function articleSourceCreatedAt(article) {
  return article?.sourceCreatedAt || article?.publishedAt || "";
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 16);
}

function fromDateInput(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

function clampInteger(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normalizeKindFilter(kind) {
  return ["article", "answer", "pin"].includes(kind) ? kind : "";
}

function inferKindFromTitle(title) {
  if (String(title).startsWith("回答：")) return "answer";
  if (String(title).startsWith("想法：")) return "pin";
  return "article";
}

function kindLabel(kind) {
  if (kind === "answer") return "回答";
  if (kind === "pin") return "想法";
  return "文章";
}

function countKinds(articles) {
  const counts = { article: 0, answer: 0, pin: 0 };
  for (const article of articles) {
    const kind = normalizeKindFilter(article.kind) || inferKindFromTitle(article.title);
    counts[kind] += 1;
  }
  return counts;
}

function mimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "application/javascript";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  return "application/octet-stream";
}
