# Zhihu Article Site

A local personal article website for importing and publishing your own Zhihu articles.

## Features

- Clean article homepage, archive, article pages, and admin dashboard
- Email-based registration and login
- Password hashing with Node `crypto.scrypt`
- Password reset by email outbox fallback
- Logged-in comments
- First registered account becomes the admin
- Admin article creation, editing, publishing, and deletion
- JSON or Markdown import path for Zhihu article exports
- No npm dependencies for the first local version

## Run

```powershell
cd C:\Users\16526\Documents\Codex\2026-05-12\automate-this-browser-workflow-with-playwright\zhihu-site
npm.cmd start
```

Open:

```text
http://localhost:4173
```

The first account you register becomes the admin.

## Import Articles

JSON format:

```json
[
  {
    "title": "Article title",
    "markdown": "# Heading\nBody text",
    "sourceUrl": "https://zhuanlan.zhihu.com/p/...",
    "publishedAt": "2026-05-12T00:00:00.000Z"
  }
]
```

Run:

```powershell
npm.cmd run import:zhihu -- .\path\to\articles.json
```

You can also import a folder of `.md` files:

```powershell
npm.cmd run import:zhihu -- .\path\to\markdown-folder
```

## Email

By default, email is written to:

```text
data\outbox\
```

That is intentional for local development. Password reset links are stored there until SMTP is configured.

## Next Step For Zhihu

Once the site is running, the remaining work is to build the actual Zhihu collector. The reliable options are:

- Use an export or manually saved Markdown/HTML files.
- Use a list of your Zhihu article URLs and a logged-in browser session.
- Use Playwright with your manual login when Zhihu asks for verification.

Do not send your password in chat unless we decide the importer cannot proceed without a credential-based flow.
