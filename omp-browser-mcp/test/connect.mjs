/**
 * connect 模式测试：验证「接管用户已登录的 Chrome」这条路径。
 *
 * 这是内网场景的 P0 能力——浏览器由用户自己启动并登录，agent 通过 CDP 接入，
 * 共享 profile 从而天然带登录态，且 close 时只断开、绝不关闭用户的浏览器。
 *
 * 用法：node test/connect.mjs
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9333;
const PROFILE = path.join(os.tmpdir(), `omp-connect-profile-${Date.now()}`);
const CHROME = process.env.OMP_TEST_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PAGE = process.env.SMOKE_URL || "http://127.0.0.1:8099/fixtures/app.html";

function waitForCdp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return (async function poll() {
    for (;;) {
      try {
        const response = await fetch(url);
        if (response.ok) return await response.json();
      } catch {}
      if (Date.now() > deadline) throw new Error(`CDP 端点 ${url} 在 ${timeoutMs}ms 内未就绪`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
}

function startMcp() {
  const child = spawn(process.execPath, [path.join(ROOT, "src", "index.js")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  let buffer = "";
  const waiters = new Map();
  child.stderr.on("data", (chunk) => process.stderr.write(`  [mcp] ${chunk}`));
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = waiters.get(message.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter(message);
      }
    }
  });
  let nextId = 1;
  const request = (method, params, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), timeoutMs);
      waiters.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  return { child, request, notify };
}

function firstText(response) {
  if (response.error) return `错误：${response.error.message}`;
  return (response.result?.content ?? []).map((c) => c.text ?? "").join("\n").trim();
}

let chrome;
let failures = 0;

try {
  console.log("=== 1. 模拟「用户自己启动的 Chrome」（带独立 profile，代表已登录状态）===");
  chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      PAGE,
    ],
    { stdio: "ignore", detached: false }
  );
  const version = await waitForCdp(`http://127.0.0.1:${PORT}/json/version`);
  console.log(`✓ Chrome 已就绪：${version.Browser}（调试端口 ${PORT}）`);

  const { child: mcp, request, notify } = startMcp();
  try {
    await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "connect-test", version: "1" } });
    notify("notifications/initialized", {});

    console.log("\n=== 2. 用 connect 模式接入，并接管已打开的标签页 ===");
    const opened = await request("tools/call", {
      name: "browser_open",
      arguments: { name: "intranet", mode: "connect", cdp_url: `http://127.0.0.1:${PORT}`, target: "app.html" },
    });
    console.log(firstText(opened).split("\n").map((l) => "    " + l).join("\n"));
    if (opened.error) failures++;

    console.log("\n=== 3. 在接管的标签页上观察 ===");
    const observed = await request("tools/call", { name: "browser_observe", arguments: { name: "intranet" } });
    const observedText = firstText(observed);
    console.log(observedText.split("\n").slice(0, 12).map((l) => "    " + l).join("\n"));
    if (observed.error || !observedText.includes("button")) failures++;

    console.log("\n=== 4. 关闭：只断开，绝不杀用户的浏览器 ===");
    const closed = await request("tools/call", { name: "browser_close", arguments: { name: "intranet", kill: true } });
    const closedText = firstText(closed);
    console.log(`    ${closedText.split("\n")[0]}`);
    if (!closedText.includes("未关闭用户的浏览器")) {
      console.log("✗ 关闭语义不符合预期（应明确说明不会关闭用户浏览器）");
      failures++;
    }

    const stillAlive = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.ok).catch(() => false);
    console.log(stillAlive ? "✓ 用户的 Chrome 仍然存活（未被关闭）" : "✗ 用户浏览器被误杀了");
    if (!stillAlive) failures++;
  } finally {
    mcp.kill("SIGTERM");
  }
} catch (error) {
  failures++;
  console.log(`✗ 测试中断：${error.message}`);
} finally {
  if (chrome) {
    try {
      chrome.kill("SIGTERM");
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${failures === 0 ? "connect 模式全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
