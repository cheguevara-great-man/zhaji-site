# Zhihu Article Site

A local personal article website for importing and publishing your own Zhihu articles.

## Features

- Clean article homepage, archive, article pages, and admin dashboard
- Email-based registration, email verification, and login
- Password hashing with Node `crypto.scrypt`
- Password reset by SMTP or local email outbox fallback
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

## Collect From Zhihu

The collector opens a real browser, keeps its login session under `data\playwright-profile\zhihu`, downloads images to `public\uploads\zhihu`, and writes an export to `data\zhihu-export\articles.json`.

On Windows it uses Microsoft Edge by default, so it does not need to download Playwright's bundled Chromium. Use `--channel chrome` if you prefer Chrome.

Small test run:

```powershell
npm.cmd run collect:zhihu -- --profile "https://www.zhihu.com/people/cai-ba-74-36" --types posts --maxPosts 1
```

For a public-only probe without waiting for login:

```powershell
npm.cmd run collect:zhihu -- --profile "https://www.zhihu.com/people/cai-ba-74-36" --types posts --maxPosts 1 --noLoginWait
```

Full collection and import:

```powershell
npm.cmd run collect:zhihu -- --profile "https://www.zhihu.com/people/cai-ba-74-36" --import
```

If Zhihu is unstable, reduce the page size:

```powershell
npm.cmd run collect:zhihu -- --profile "https://www.zhihu.com/people/cai-ba-74-36" --import --pageSize 3
```

To rebuild imported Zhihu content while preserving local users:

```powershell
npm.cmd run collect:zhihu -- --profile "https://www.zhihu.com/people/cai-ba-74-36" --import --replace
```

If an interrupted run leaves duplicate imported records, repair the local database:

```powershell
npm.cmd run repair:zhihu
```

If Zhihu asks for login, complete login in the opened browser. Do not paste your password into chat.

## Email

By default, email is written to:

```text
data\outbox\
```

That is intentional for local development. Registration verification links and password reset links are stored there until SMTP is configured.

For a real server, copy `.env.example` to `.env` and fill in SMTP settings:

```ini
PUBLIC_BASE_URL=https://your-domain.com
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-smtp-user@example.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM="札记 <your-smtp-user@example.com>"
```

Common settings:

- QQ/腾讯企业邮箱 usually uses `SMTP_PORT=465` and `SMTP_SECURE=true`.
- 163/阿里邮箱 usually also supports `465` with SSL.
- For port `587`, use `SMTP_SECURE=false`; the app will upgrade with STARTTLS when the server supports it.

Do not commit `.env`. It is ignored by git.

## Next Step For Zhihu

Once the site is running, the remaining work is to build the actual Zhihu collector. The reliable options are:

- Use an export or manually saved Markdown/HTML files.
- Use a list of your Zhihu article URLs and a logged-in browser session.
- Use Playwright with your manual login when Zhihu asks for verification.

Do not send your password in chat unless we decide the importer cannot proceed without a credential-based flow.
