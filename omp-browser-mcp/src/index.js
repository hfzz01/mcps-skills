#!/usr/bin/env node
/**
 * omp 风格浏览器自动化 MCP server。
 *
 * 设计来源：oh-my-pi 的 browser 工具。针对两个约束做了改造：
 *   1. 弱模型（GLM-5.2）→ 不采用 omp "在 eval 里写 JS" 的形态，改为**原子工具 + ref 数字定位**；
 *   2. 内网离线 → 不分发浏览器二进制，优先复用本机 Chrome/Edge，并支持 CDP 接管已登录会话。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { CONFIG } from "./config.js";
import { closeAll, closeTab, getTab, openTab, tabNames } from "./browser.js";
import { collect, formatList, formatTree } from "./observe.js";
import { click, fill, press, select as selectOptions, typeInto, waitFor } from "./actions.js";
import { takeScreenshot } from "./screenshot.js";

const EXTRACT = `() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach(el => el.remove());
  let text = clone.innerText || clone.textContent || '';
  text = text.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { title: document.title || '', text, length: text.length };
}`;

/** omp 的"回合结束回灌提示"在 MCP 下的等价实现：每次响应尾部提醒收尾。 */
function reminder() {
  if (!CONFIG.remind) return "";
  const names = tabNames();
  if (!names.length) return "";
  return `\n\n[提醒] 仍有 ${names.length} 个标签页未关闭（${names.join("、")}）。浏览器工作全部结束后，请调用 browser_close 并传 kill=true，否则会残留浏览器进程。`;
}

function text(value) {
  return { content: [{ type: "text", text: String(value) + reminder() }] };
}

function failed(error) {
  return { isError: true, content: [{ type: "text", text: error.message + reminder() }] };
}

const TOOLS = [
  {
    name: "browser_open",
    description:
      "打开一个命名标签页（已存在则复用）。两种模式：headless 启动独立浏览器（默认）；connect 连接你本机已登录的 Chrome，直接复用登录态。" +
      "典型流程：browser_open → browser_observe → browser_click/type/fill → ... → browser_close(kill=true)。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字，会话内唯一，例如 console、jira、wiki。" },
        url: { type: "string", description: "要打开的网址。connect 模式下留空则新开一个空白标签页。" },
        mode: {
          type: "string",
          enum: ["headless", "connect"],
          description: "headless=启动独立浏览器（默认）；connect=连接本机已开启调试端口的 Chrome，可复用已登录状态。",
        },
        cdp_url: { type: "string", description: "connect 模式的 CDP 端点，默认 http://127.0.0.1:9222。" },
        target: { type: "string", description: "connect 模式下要接管的已有标签页的 URL 片段；留空则新建标签页。" },
        viewport: {
          type: "object",
          properties: { width: { type: "integer" }, height: { type: "integer" } },
          description: "视口尺寸，headless 默认 1440x900。",
        },
        dialogs: { type: "string", enum: ["accept", "dismiss"], description: "自动处理 alert/confirm 弹窗。" },
        timeout: { type: "integer", description: "打开页面的超时毫秒数，默认 30000。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_observe",
    description:
      "观察当前页面，返回可交互元素清单。输出里每行以 [数字] 开头，后续操作直接把这个数字作为 ref 传入，不需要写选择器。" +
      "这是「看页面」的主要方式，不消耗视觉能力、成本极低。页面变化后需要重新调用，因为元素编号会刷新。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        view: {
          type: "string",
          enum: ["list", "tree"],
          description: "list=扁平清单（默认，省 token）；tree=缩进树，保留 DOM 层级，适合嵌套组件。",
        },
        viewport_only: { type: "boolean", description: "只看当前视口内的元素，长页面用它省 token。" },
        include_all: { type: "boolean", description: "连不可交互元素一起返回（默认只返回按钮、输入框等可交互元素）。" },
        pierce: { type: "boolean", description: "穿透 shadow DOM，用于 Web Components 页面。" },
        max: { type: "integer", description: "最多返回多少个元素，默认 60。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_click",
    description: "点击页面元素。优先用 ref（browser_observe 输出的方括号数字）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        ref: { type: "integer", description: "元素编号，来自 browser_observe 输出每行开头的 [数字]。二选一，推荐用它。" },
        selector: { type: "string", description: "选择器，支持 css、text/按钮文字、aria/角色名、xpath/表达式。与 ref 二选一。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_type",
    description: "向输入框逐字输入文本（模拟真实键入，会触发输入事件）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        ref: { type: "integer", description: "元素编号。" },
        selector: { type: "string", description: "选择器，与 ref 二选一。" },
        text: { type: "string", description: "要输入的文本。" },
        clear: { type: "boolean", description: "输入前先清空原内容，默认 false。" },
      },
      required: ["name", "text"],
    },
  },
  {
    name: "browser_fill",
    description: "把输入框的值整体设为指定内容（先清空再输入）。只适用于文本框、多行文本域和可编辑区域；复选框、单选框请用 browser_click。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        ref: { type: "integer", description: "元素编号。" },
        selector: { type: "string", description: "选择器，与 ref 二选一。" },
        value: { type: "string", description: "要填入的值。" },
      },
      required: ["name", "value"],
    },
  },
  {
    name: "browser_press",
    description: "按键盘按键，如 Enter、Tab、Escape、ArrowDown、Control+A。不给 ref/selector 时对当前焦点元素生效。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        key: { type: "string", description: "按键名，例如 Enter。" },
        ref: { type: "integer", description: "可选，先聚焦该元素再按键。" },
        selector: { type: "string", description: "可选，先聚焦该元素再按键。" },
      },
      required: ["name", "key"],
    },
  },
  {
    name: "browser_select",
    description: "在下拉框（select）中选择选项。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        ref: { type: "integer", description: "元素编号。" },
        selector: { type: "string", description: "选择器，与 ref 二选一。" },
        values: { type: "array", items: { type: "string" }, description: "要选中的 option 的 value。" },
      },
      required: ["name", "values"],
    },
  },
  {
    name: "browser_goto",
    description: "导航到新网址。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        url: { type: "string", description: "目标网址。" },
        wait_until: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"],
          description: "等待到哪个加载阶段，默认 domcontentloaded。",
        },
        timeout: { type: "integer", description: "超时毫秒数，默认 30000。" },
      },
      required: ["name", "url"],
    },
  },
  {
    name: "browser_wait_for",
    description: "等待页面上出现某段文字、某个元素或跳转到某个 URL。页面是动态渲染时，操作后先等一下再观察。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        text: { type: "string", description: "等待页面上出现这段文字。" },
        selector: { type: "string", description: "等待这个选择器匹配到元素。" },
        url: { type: "string", description: "等待当前 URL 包含这段字符串。" },
        timeout: { type: "integer", description: "超时毫秒数，默认 20000。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_screenshot",
    description:
      "截图并返回给模型。会自动压缩到 1568px 边长 / 500KB 以内。仅在需要看视觉样式、布局、颜色时才用；" +
      "读取文字内容和操作元素请用 browser_observe 和 browser_extract，成本低得多。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        full_page: { type: "boolean", description: "截取整页而非仅视口。" },
        max_edge: { type: "integer", description: "边长上限，默认 1568。" },
        save_as: { type: "string", description: "可选，同时保存到磁盘的文件名。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_extract",
    description: "抽取页面正文为纯文本（自动剔除脚本、样式、导航等噪声）。读取长文、文档、表格内容时用它，比截图便宜得多。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        max_chars: { type: "integer", description: "最多返回多少字符，默认 8000。" },
      },
      required: ["name"],
    },
  },
  {
    name: "browser_evaluate",
    description:
      "兜底逃生舱：在页面里执行一段 JavaScript 表达式并返回值。只在上面所有工具都做不到时才用，例如读取自定义属性、批量提取数据。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        expression: { type: "string", description: "JS 表达式，例如 document.querySelectorAll('tr').length。" },
      },
      required: ["name", "expression"],
    },
  },
  {
    name: "browser_close",
    description: "关闭标签页。浏览器工作全部结束后，最后一个 close 务必传 kill=true，以终止自己启动的浏览器进程（connect 模式下只断开连接，不会关闭你的 Chrome）。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "标签页名字。" },
        kill: { type: "boolean", description: "是否一并终止自己拥有的浏览器进程。" },
      },
      required: ["name"],
    },
  },
];

async function handle(name, args = {}) {
  const page = () => getTab(args.name).page;

  switch (name) {
    case "browser_open": {
      const { tab, created, exe } = await openTab({
        name: args.name,
        url: args.url,
        mode: args.mode || "headless",
        cdpUrl: args.cdp_url || CONFIG.cdpUrl,
        viewport: args.viewport,
        target: args.target,
        dialogs: args.dialogs,
        timeoutMs: args.timeout || 30000,
      });
      const snapshot = await collect(tab.page, {});
      return text(
        `已${created ? "打开" : "复用"}标签页 "${args.name}"（浏览器：${exe}）。\n` +
          `当前地址：${snapshot.url}\n标题：${snapshot.title || "(无)"}\n` +
          `页面上共有 ${snapshot.total} 个可交互元素。\n\n` +
          `下一步：调用 browser_observe 查看元素编号，再开始操作。`
      );
    }

    case "browser_observe": {
      const snapshot = await collect(getTab(args.name).page, {
        include_all: args.include_all,
        viewport_only: args.viewport_only,
        pierce: args.pierce,
      });
      const limit = args.max || CONFIG.observeLimit;
      return text(
        args.view === "tree"
          ? formatTree(snapshot, limit)
          : formatList(snapshot, limit, args.viewport_only)
      );
    }

    case "browser_click":
      return text(await click(page(), { ref: args.ref, selector: args.selector }, CONFIG.actionTimeoutMs));

    case "browser_type":
      return text(
        await typeInto(page(), { ref: args.ref, selector: args.selector }, args.text, CONFIG.actionTimeoutMs, args.clear)
      );

    case "browser_fill":
      return text(await fill(page(), { ref: args.ref, selector: args.selector }, args.value, CONFIG.actionTimeoutMs));

    case "browser_press":
      return text(await press(page(), { ref: args.ref, selector: args.selector }, args.key, CONFIG.actionTimeoutMs));

    case "browser_select":
      return text(await selectOptions(page(), { ref: args.ref, selector: args.selector }, args.values, CONFIG.actionTimeoutMs));

    case "browser_goto": {
      await page().goto(args.url, { waitUntil: args.wait_until || "domcontentloaded", timeout: args.timeout || 30000 });
      return text(`已导航到 ${args.url}`);
    }

    case "browser_wait_for":
      return text(
        await waitFor(page(), {
          text: args.text,
          selector: args.selector,
          url: args.url,
          timeoutMs: args.timeout || CONFIG.quickTimeoutMs,
        })
      );

    case "browser_screenshot": {
      const shot = await takeScreenshot(page(), { fullPage: args.full_page, maxEdge: args.max_edge, saveAs: args.save_as });
      const note = shot.savedPath ? `\n已保存到 ${shot.savedPath}` : "";
      return {
        content: [
          { type: "image", data: shot.buffer.toString("base64"), mimeType: shot.mimeType },
          { type: "text", text: `截图 ${shot.width}x${shot.height}，${Math.round(shot.buffer.length / 1024)}KB。${note}${reminder()}` },
        ],
      };
    }

    case "browser_extract": {
      const result = await page().evaluate(new Function(`return (${EXTRACT})`)());
      const limit = args.max_chars || 8000;
      const body = result.text.length > limit ? result.text.slice(0, limit) + `\n\n（已截断，共 ${result.length} 字符）` : result.text;
      return text(`# ${result.title || "(无标题)"}\n\n${body}`);
    }

    case "browser_evaluate": {
      const value = await page().evaluate(args.expression);
      if (value === undefined) return text("表达式已执行，没有返回值。");
      return text(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    }

    case "browser_close": {
      const { message } = await closeTab(args.name, args.kill);
      return text(message);
    }

    default:
      throw new Error(`未知工具：${name}`);
  }
}

const server = new Server({ name: "omp-browser", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handle(name, args);
  } catch (error) {
    return failed(error instanceof Error ? error : new Error(String(error)));
  }
});

const shutdown = async () => {
  await closeAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => {
  if (tabNames().length) {
    process.stderr.write(`[omp-browser] 退出时仍有未关闭标签页：${tabNames().join(", ")}\n`);
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write("[omp-browser] MCP server 已就绪（stdio）\n");
