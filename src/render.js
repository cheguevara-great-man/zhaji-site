export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slugify(title) {
  const ascii = String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);

  return ascii || `article-${Date.now()}`;
}

export function textToHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

export function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const html = [];
  let inList = false;
  let paragraph = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function closeList() {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  closeList();
  return html.join("\n");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>');
}

export function layout({ title, user, body, active = "" }) {
  const nav = [
    ["目录", "/archive"],
    ["搜索", "/search"]
  ];

  if (user?.isAdmin) {
    nav.push(["管理", "/admin"]);
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script>try{document.documentElement.dataset.theme=localStorage.getItem("zhaji-theme")||"lake"}catch{document.documentElement.dataset.theme="lake"}</script>
  <link rel="stylesheet" href="/public/styles.css">
  <script type="module" async src="/public/app.js"></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">札记</a>
    <nav>
      ${nav.map(([label, href]) => `<a class="${active === href ? "active" : ""}" href="${href}">${label}</a>`).join("")}
    </nav>
    <div class="account">
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="切换视觉风格"><span data-theme-label>湖面</span></button>
      ${user ? `<span>${escapeHtml(user.name)}</span><form method="post" action="/logout"><button>退出</button></form>` : `<a href="/login">登录</a><a class="button-link" href="/register">注册</a>`}
    </div>
  </header>
  <main>
    ${body}
  </main>
</body>
</html>`;
}
