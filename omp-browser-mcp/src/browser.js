import puppeteer from "puppeteer-core";
import { CONFIG, resolveExecutable } from "./config.js";

/**
 * 浏览器注册表：按 key 持有浏览器实例并做引用计数，计数归零才真正回收。
 * 这是 omp「owned vs 不拥有」语义的直接移植——kill 只对 owned 生效，
 * 用户自己的浏览器（connect 模式）永远只 disconnect。
 */
const browsers = new Map();
const tabs = new Map();

export function tabNames() {
  return [...tabs.keys()];
}

function warn(message) {
  process.stderr.write(`[omp-browser] ${message}\n`);
}

export function stealthScript() {
  return () => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    } catch {}
    try {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
    } catch {}
    try {
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    } catch {}
    try {
      Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
    } catch {}
    try {
      const permissions = navigator.permissions;
      const original = permissions && permissions.query;
      if (original) {
        permissions.query = (params) =>
          params && params.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : original.call(permissions, params);
      }
    } catch {}
  };
}

export async function launchBrowser({ headless, viewport }) {
  const executablePath = resolveExecutable();
  const browser = await puppeteer.launch({
    executablePath: executablePath || undefined,
    headless: headless !== false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      ...(headless === false ? ["--window-size=1440,900"] : []),
    ],
    defaultViewport: viewport
      ? { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor ?? 1 }
      : headless === false
        ? null
        : { width: 1440, height: 900 },
  });
  return { browser, exe: executablePath || "(puppeteer 默认)" };
}

export async function connectBrowser(cdpUrl) {
  const browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
  return browser;
}

async function applyPageDefaults(page, { stealth, dialogs }) {
  if (stealth && CONFIG.stealth) {
    await page.evaluateOnNewDocument(stealthScript());
  }
  if (dialogs) {
    page.on("dialog", async (dialog) => {
      try {
        dialogs === "accept" ? await dialog.accept() : await dialog.dismiss();
      } catch {}
    });
  }
  page.on("error", () => {});
}

/**
 * 打开（或复用）一个命名标签页。
 * mode=headless 时启动自己拥有的浏览器；mode=connect 时连到用户已登录的 Chrome。
 */
export async function openTab({ name, url, mode, cdpUrl, viewport, target, dialogs, timeoutMs }) {
  if (tabs.has(name)) {
    const existing = tabs.get(name);
    if (url) {
      await existing.page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }
    await existing.page.bringToFront().catch(() => {});
    return { tab: existing, created: false, exe: existing.exe };
  }

  const owned = mode === "headless";
  const key = owned ? `headless:${CONFIG.executable || "auto"}` : `connect:${cdpUrl}`;

  let entry = browsers.get(key);
  if (!entry) {
    if (owned) {
      const { browser, exe } = await launchBrowser({ headless: CONFIG.headless, viewport });
      entry = { key, browser, owned: true, refs: 0, exe };
    } else {
      const browser = await connectBrowser(cdpUrl);
      entry = { key, browser, owned: false, refs: 0, exe: `CDP ${cdpUrl}` };
    }
    browsers.set(key, entry);
  }
  entry.refs += 1;

  let page;
  try {
    if (!owned && target) {
      const pages = await entry.browser.pages();
      page = pages.find((p) => p.url().includes(target)) || null;
      if (!page) {
        throw new Error(
          `在 ${cdpUrl} 上找不到 URL 包含 "${target}" 的标签页。已打开的标签页：` +
            (await Promise.all(pages.map(async (p) => p.url()))).join(" | ")
        );
      }
    } else {
      page = await entry.browser.newPage();
      if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      }
    }
    await applyPageDefaults(page, { stealth: true, dialogs });
  } catch (error) {
    entry.refs -= 1;
    if (entry.refs <= 0) {
      await disposeEntry(entry);
      browsers.delete(key);
    }
    throw error;
  }

  const tab = { name, key, page, exe: entry.exe };
  tabs.set(name, tab);
  return { tab, created: true, exe: entry.exe };
}

export function getTab(name) {
  const tab = tabs.get(name);
  if (!tab) {
    throw new Error(
      `没有名为 "${name}" 的标签页。当前已打开：${tabNames().join(", ") || "(无)"}。请先用 browser_open 打开。`
    );
  }
  return tab;
}

async function disposeEntry(entry) {
  try {
    if (entry.owned) await entry.browser.close();
    else await entry.browser.disconnect();
  } catch {}
}

/** 关闭标签页。kill=true 且浏览器为自己拥有时一并终止进程。 */
export async function closeTab(name, kill) {
  const tab = tabs.get(name);
  if (!tab) {
    return { closed: false, message: `没有名为 "${name}" 的标签页。` };
  }
  const entry = browsers.get(tab.key);
  try {
    if (tab.ownedPage !== false) await tab.page.close().catch(() => {});
  } catch {}
  tabs.delete(name);

  let message;
  if (entry) {
    entry.refs -= 1;
    if (entry.refs <= 0 || (kill && entry.owned)) {
      await disposeEntry(entry);
      browsers.delete(tab.key);
      message = entry.owned
        ? `标签页 "${name}" 已关闭，且已终止它启动的浏览器进程。`
        : `标签页 "${name}" 已关闭，已断开与 ${tab.key.replace("connect:", "")} 的连接（未关闭用户的浏览器）。`;
    } else {
      message = `标签页 "${name}" 已关闭，浏览器仍在运行（还有 ${entry.refs} 个标签页持有它）。`;
    }
  } else {
    message = `标签页 "${name}" 已关闭。`;
  }
  return { closed: true, message };
}

export async function closeAll() {
  const owned = [...browsers.values()].filter((entry) => entry.owned);
  for (const entry of owned) await disposeEntry(entry);
  browsers.clear();
  tabs.clear();
  if (owned.length) warn(`进程退出，已回收 ${owned.length} 个自己启动的浏览器实例。`);
}
