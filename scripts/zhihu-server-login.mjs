import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const args = parseArgs(process.argv.slice(2));
const storagePath = resolve(args.storage || process.env.ZHIHU_STORAGE_PATH || "data/zhihu-storage.json");
const screenshotPath = resolve(args.screenshot || "data/zhihu-login.png");
const profileDir = resolve(args.browserProfile || "data/playwright-profile/zhihu-server");
const waitMs = Number(args.waitMs || 600_000);

await mkdir(dirname(storagePath), { recursive: true });
await mkdir(dirname(screenshotPath), { recursive: true });
await mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1280, height: 900 },
  locale: "zh-CN"
});

const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(20_000);

try {
  await page.goto("https://www.zhihu.com/signin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body", { timeout: 20_000 });
  await openQrLogin(page);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to ${screenshotPath}`);
  console.log("Waiting for Zhihu login cookie...");
  await waitForZhihuSession(context, waitMs, async () => {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  });
  await context.storageState({ path: storagePath });
  console.log(`Saved Zhihu browser storage to ${storagePath}`);
} finally {
  await context.close();
}

async function openQrLogin(page) {
  const qrTexts = ["二维码登录", "扫码登录", "扫一扫登录"];
  for (const text of qrTexts) {
    const item = page.getByText(text, { exact: false }).first();
    if (await item.isVisible().catch(() => false)) {
      await item.click().catch(() => {});
      await page.waitForTimeout(1000);
      return;
    }
  }

  const qrIcon = page.locator("[class*=Qrcode], [class*=qrcode], button[aria-label*=二维码], button[aria-label*=扫码]").first();
  if (await qrIcon.isVisible().catch(() => false)) {
    await qrIcon.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
}

async function waitForZhihuSession(context, timeoutMs, onTick) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://www.zhihu.com");
    if (cookies.some((cookie) => cookie.name === "z_c0" && cookie.value)) return;
    await onTick();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for Zhihu login.");
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}
