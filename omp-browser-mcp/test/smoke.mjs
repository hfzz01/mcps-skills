/**
 * 冒烟测试：启动 MCP server，完成握手，然后驱动本地测试页面走一遍完整流程。
 * 用法：node test/smoke.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, "src", "index.js")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  let buffer = "";
  const waiters = new Map();
  child.stderr.on("data", (chunk) => process.stderr.write(`  [server] ${chunk}`));
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
      waiters.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  const notify = (method, params) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

  return { child, request, notify };
}

function show(label, response) {
  if (response.error) {
    console.log(`✗ ${label}: ${response.error.message}`);
    return null;
  }
  const parts = (response.result?.content ?? []).map((item) =>
    item.type === "image" ? `<图片 ${item.mimeType} ${Math.round(item.data.length / 1366)}KB>` : item.text
  );
  const out = parts.join("\n").trim();
  console.log(`✓ ${label}\n${out.split("\n").map((l) => "    " + l).join("\n")}`);
  return response.result;
}

const PAGE = process.env.SMOKE_URL || "http://127.0.0.1:8099/fixtures/app.html";
const { child, request, notify } = startServer();
let failures = 0;

try {
  console.log("=== 1. MCP 握手 ===");
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1.0.0" },
  });
  if (init.error) throw new Error(`initialize 失败：${init.error.message}`);
  console.log(`✓ 握手成功，服务端：${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  notify("notifications/initialized", {});

  console.log("\n=== 2. 工具列表 ===");
  const list = await request("tools/list", {});
  const tools = list.result.tools.map((t) => t.name);
  console.log(`✓ 共 ${tools.length} 个工具：${tools.join(", ")}`);

  console.log("\n=== 3. 打开页面 ===");
  if (!show("browser_open", await request("tools/call", { name: "browser_open", arguments: { name: "demo", url: PAGE } }))) failures++;

  console.log("\n=== 4. 观察页面 ===");
  if (!show("browser_observe", await request("tools/call", { name: "browser_observe", arguments: { name: "demo" } }))) failures++;

  console.log("\n=== 5. 按文本定位并点击 ===");
  if (!show("browser_click(text/)", await request("tools/call", { name: "browser_click", arguments: { name: "demo", selector: "text/查询" } }))) failures++;

  console.log("\n=== 6. 等待结果出现 ===");
  if (!show("browser_wait_for", await request("tools/call", { name: "browser_wait_for", arguments: { name: "demo", text: "SO-2026" } }))) failures++;

  console.log("\n=== 7. 用 ref 填写输入框 ===");
  const observed = await request("tools/call", { name: "browser_observe", arguments: { name: "demo" } });
  const body = (observed.result?.content ?? []).map((c) => c.text).join("\n");
  const textbox = [...body.matchAll(/^\[(\d+)\]\s+textbox\s+"([^"]*)"/gm)][0];
  if (!textbox) {
    console.log("✗ 观察结果里没有找到 textbox，跳过填写测试");
    failures++;
  } else {
    const ref = Number(textbox[1]);
    console.log(`  找到输入框 ref=${ref}（${textbox[2]}）`);
    if (!show(`browser_fill(ref=${ref})`, await request("tools/call", { name: "browser_fill", arguments: { name: "demo", ref, value: "SO-9999" } }))) failures++;
    const check = await request("tools/call", { name: "browser_evaluate", arguments: { name: "demo", expression: `document.querySelectorAll('input')[0].value` } });
    const value = (check.result?.content ?? []).map((c) => c.text).join("").trim();
    console.log(value.includes("SO-9999") ? `✓ 回填校验通过：${value.split("\n")[0]}` : `✗ 回填校验失败：${value}`);
    if (!value.includes("SO-9999")) failures++;
  }

  console.log("\n=== 8. 抽取正文 ===");
  if (!show("browser_extract", await request("tools/call", { name: "browser_extract", arguments: { name: "demo", max_chars: 300 } }))) failures++;

  console.log("\n=== 9. 截图（含像素预算压缩）===");
  if (!show("browser_screenshot", await request("tools/call", { name: "browser_screenshot", arguments: { name: "demo" } }))) failures++;

  console.log("\n=== 10. 错误处理：不存在的 ref ===");
  const bad = await request("tools/call", { name: "browser_click", arguments: { name: "demo", ref: 99999 } });
  if (bad.result?.isError) console.log(`✓ 按预期报错并给出可操作建议：\n    ${bad.result.content[0].text.split("\n")[0]}`);
  else { console.log("✗ 未报错，异常"); failures++; }

  console.log("\n=== 11. 关闭并回收进程 ===");
  if (!show("browser_close", await request("tools/call", { name: "browser_close", arguments: { name: "demo", kill: true } }))) failures++;
} catch (error) {
  failures++;
  console.log(`✗ 测试中断：${error.message}`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.log(`\n${failures === 0 ? "全部通过" : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
