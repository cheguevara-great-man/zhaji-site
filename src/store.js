import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomToken } from "./auth.js";
import { slugify } from "./render.js";

const emptyDb = {
  users: [],
  articles: [],
  comments: [],
  sessions: [],
  passwordResets: []
};

export class Store {
  constructor(path) {
    this.path = path;
    this.db = structuredClone(emptyDb);
  }

  async load() {
    try {
      this.db = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save();
    }

    for (const key of Object.keys(emptyDb)) {
      if (!Array.isArray(this.db[key])) this.db[key] = [];
    }
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2), "utf8");
    await rename(tmp, this.path);
  }

  async createUser({ name, email, passwordHash }) {
    const normalizedEmail = normalizeEmail(email);
    if (this.db.users.some((user) => user.email === normalizedEmail)) {
      throw new Error("Email is already registered.");
    }

    const now = new Date().toISOString();
    const user = {
      id: randomToken(12),
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      isAdmin: this.db.users.length === 0,
      createdAt: now
    };

    this.db.users.push(user);
    await this.save();
    return withoutPassword(user);
  }

  getUserByEmail(email) {
    return this.db.users.find((user) => user.email === normalizeEmail(email));
  }

  getUserById(id) {
    const user = this.db.users.find((item) => item.id === id);
    return user ? withoutPassword(user) : null;
  }

  async updatePassword(userId, passwordHash) {
    const user = this.db.users.find((item) => item.id === userId);
    if (!user) throw new Error("User not found.");
    user.passwordHash = passwordHash;
    await this.save();
  }

  async createSession(userId) {
    const token = randomToken();
    const session = {
      token,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
    };
    this.db.sessions.push(session);
    await this.save();
    return token;
  }

  async deleteSession(token) {
    this.db.sessions = this.db.sessions.filter((session) => session.token !== token);
    await this.save();
  }

  getUserBySession(token) {
    if (!token) return null;
    const now = Date.now();
    const session = this.db.sessions.find((item) => item.token === token && Date.parse(item.expiresAt) > now);
    return session ? this.getUserById(session.userId) : null;
  }

  listArticles({ includeDrafts = false, kind = "" } = {}) {
    return [...this.db.articles]
      .filter((article) => includeDrafts || article.status === "published")
      .filter((article) => !kind || article.kind === kind)
      .sort((a, b) => Date.parse(b.publishedAt || b.createdAt) - Date.parse(a.publishedAt || a.createdAt));
  }

  getArticleBySlug(slug, { includeDrafts = false } = {}) {
    const article = this.db.articles.find((item) => item.slug === slug);
    if (!article) return null;
    if (!includeDrafts && article.status !== "published") return null;
    return article;
  }

  getArticleById(id) {
    return this.db.articles.find((item) => item.id === id) || null;
  }

  async createArticle(input) {
    const now = new Date().toISOString();
    const baseSlug = slugify(input.slug || input.title);
    const article = {
      id: randomToken(12),
      title: String(input.title).trim(),
      kind: normalizeKind(input.kind),
      slug: this.uniqueSlug(baseSlug),
      excerpt: String(input.excerpt || "").trim(),
      contentHtml: String(input.contentHtml || ""),
      sourceUrl: String(input.sourceUrl || "").trim(),
      status: input.status === "draft" ? "draft" : "published",
      authorId: input.authorId,
      createdAt: now,
      updatedAt: now,
      publishedAt: input.publishedAt || now
    };

    this.db.articles.push(article);
    await this.save();
    return article;
  }

  async updateArticle(id, input) {
    const article = this.getArticleById(id);
    if (!article) throw new Error("Article not found.");

    article.title = String(input.title).trim();
    article.kind = normalizeKind(input.kind || article.kind);
    article.excerpt = String(input.excerpt || "").trim();
    article.contentHtml = String(input.contentHtml || "");
    article.sourceUrl = String(input.sourceUrl || "").trim();
    article.status = input.status === "draft" ? "draft" : "published";
    article.publishedAt = input.publishedAt || article.publishedAt;
    article.updatedAt = new Date().toISOString();

    await this.save();
    return article;
  }

  async deleteArticle(id) {
    this.db.articles = this.db.articles.filter((article) => article.id !== id);
    this.db.comments = this.db.comments.filter((comment) => comment.articleId !== id);
    await this.save();
  }

  listComments(articleId) {
    return this.db.comments
      .filter((comment) => comment.articleId === articleId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }

  async createComment({ articleId, userId, body }) {
    const comment = {
      id: randomToken(12),
      articleId,
      userId,
      body: String(body).trim(),
      createdAt: new Date().toISOString()
    };
    this.db.comments.push(comment);
    await this.save();
    return comment;
  }

  async deleteComment(id, user) {
    const comment = this.db.comments.find((item) => item.id === id);
    if (!comment) return;
    if (!user?.isAdmin && comment.userId !== user?.id) {
      throw new Error("Not allowed.");
    }
    this.db.comments = this.db.comments.filter((item) => item.id !== id);
    await this.save();
  }

  async createPasswordReset(userId) {
    const token = randomToken();
    const reset = {
      token,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 45).toISOString(),
      usedAt: null
    };
    this.db.passwordResets.push(reset);
    await this.save();
    return token;
  }

  async consumePasswordReset(token) {
    const reset = this.db.passwordResets.find((item) => item.token === token && !item.usedAt);
    if (!reset || Date.parse(reset.expiresAt) < Date.now()) return null;
    reset.usedAt = new Date().toISOString();
    await this.save();
    return this.getUserById(reset.userId);
  }

  uniqueSlug(base) {
    let slug = base;
    let index = 2;
    while (this.db.articles.some((article) => article.slug === slug)) {
      slug = `${base}-${index}`;
      index += 1;
    }
    return slug;
  }
}

function normalizeKind(kind) {
  return ["article", "answer", "pin"].includes(kind) ? kind : "article";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function withoutPassword(user) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}
