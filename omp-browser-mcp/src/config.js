import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CONFIG = {
  /** 显式指定浏览器可执行文件时优先使用它。 */
  executable: process.env.OMP_BROWSER_EXECUTABLE || "",
  /** connect 模式默认连接的内网/本机 CDP 端点。 */
  cdpUrl: process.env.OMP_BROWSER_CDP_URL || "http://127.0.0.1:9222",
  headless: process.env.OMP_BROWSER_HEADLESS !== "0",
  /** Stealth 默认开启（omp 的做法）。 */
  stealth: process.env.OMP_BROWSER_STEALTH !== "0",
  screenshotDir: process.env.OMP_BROWSER_SCREENSHOT_DIR || "",
  /** 三级超时预算，取值沿用 omp。 */
  actionTimeoutMs: int(process.env.OMP_BROWSER_ACTION_TIMEOUT_MS, 8000),
  quickTimeoutMs: int(process.env.OMP_BROWSER_QUICK_TIMEOUT_MS, 20000),
  zeroMatchFailFastMs: int(process.env.OMP_BROWSER_ZERO_MATCH_MS, 2000),
  /** 单次 observe 返回的元素上限，防止长页面把上下文撑爆。 */
  observeLimit: int(process.env.OMP_BROWSER_OBSERVE_LIMIT, 60),
  maxImageBytes: int(process.env.OMP_BROWSER_MAX_IMAGE_BYTES, 500 * 1024),
  maxImageEdge: int(process.env.OMP_BROWSER_MAX_IMAGE_EDGE, 1568),
  /** 每次响应尾部回灌"还有标签页没关"的提醒（omp 的回合结束提示在 MCP 下的等价实现）。 */
  remind: process.env.OMP_BROWSER_REMIND !== "0",
};

/** 需要顺序扫描的浏览器缓存目录（复用其他工具已下载的 Chromium，内网免下载）。 */
function cacheDirs() {
  const home = os.homedir();
  const dirs = [];
  if (process.env.OMP_BROWSER_CACHE_DIR) dirs.push(process.env.OMP_BROWSER_CACHE_DIR);
  dirs.push(path.join(home, ".agent-browser", "browsers"));
  dirs.push(path.join(home, ".cache", "ms-playwright"));
  if (process.platform === "win32") {
    dirs.push(path.join(process.env.LOCALAPPDATA || "", "ms-playwright"));
  } else {
    dirs.push(path.join(home, ".cache", "puppeteer"));
  }
  return dirs;
}

const EXE_NAMES =
  process.platform === "win32"
    ? ["chrome.exe", "msedge.exe", "headless_shell.exe"]
    : ["chrome", "chromium", "google-chrome", "msedge", "headless_shell"];

function isExe(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function scanDir(dir, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // 先找本层可执行文件，再递归子目录
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (EXE_NAMES.includes(entry.name.toLowerCase())) {
      const full = path.join(dir, entry.name);
      if (isExe(full)) return full;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hit = scanDir(path.join(dir, entry.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * 按 omp 的优先级复用已有浏览器，全部落空才返回 null（交由 puppeteer 自己解析/报错）：
 *   1. 显式指定  2. 系统 Chrome/Edge  3. 其他工具缓存里已下载的版本
 * 内网环境下这台机器只要装过 Chrome/Edge 就无需分发任何二进制。
 */
export function resolveExecutable() {
  if (CONFIG.executable && isExe(CONFIG.executable)) return CONFIG.executable;

  const fixed =
    process.platform === "win32"
      ? [
          path.join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
          path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
          path.join(process.env.PROGRAMFILES || "", "Microsoft/Edge/Application/msedge.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"];

  for (const candidate of fixed) {
    if (candidate && isExe(candidate)) return candidate;
  }
  for (const dir of cacheDirs()) {
    const hit = scanDir(dir);
    if (hit) return hit;
  }
  return null;
}
