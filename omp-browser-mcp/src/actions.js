import { CONFIG } from "./config.js";

/**
 * 元素解析与动作执行。
 *
 * 超时沿用 omp 的三级预算：单元格/调用预算留 1s headroom，交互类 8s、
 * 观察类 20s，且**选择器零匹配 2s 就快速失败**——拿到的永远是"点了没反应"
 * 或"选择器没匹配到"这种可诊断错误，而不是一句笼统的 timeout。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）。页面可能仍在加载，可先调用 browser_wait_for 等待目标出现。`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalizeSelector(selector) {
  if (typeof selector !== "string" || !selector.trim()) return null;
  return selector.trim();
}

/**
 * 解析元素。ref 优先——它就是 observe 输出里方括号中的数字，
 * 对弱模型远比拼选择器可靠。
 */
export async function resolveElement(page, { ref, selector }, timeoutMs) {
  let sel;
  if (ref !== undefined && ref !== null) {
    const n = Number(ref);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`ref 必须是正整数（browser_observe 输出里方括号中的数字），收到：${JSON.stringify(ref)}`);
    }
    sel = `[data-omp-ref="${n}"]`;
  } else {
    sel = normalizeSelector(selector);
  }
  if (!sel) {
    throw new Error("必须提供 ref 或 selector 之一。推荐用 ref：先 browser_observe 观察，再传返回的方括号数字。");
  }

  const budget = Math.min(CONFIG.zeroMatchFailFastMs, timeoutMs);
  const deadline = Date.now() + budget;
  for (;;) {
    const handle = await page.$(sel).catch(() => null);
    if (handle) return { handle, sel };
    if (Date.now() >= deadline) {
      throw new Error(
        `选择器 ${sel} 在 ${budget}ms 内没有匹配到任何元素。\n` +
          `建议：调用 browser_observe 重新观察当前页面，用输出里的 ref=数字 定位（元素编号会在每次 observe 后刷新）；\n` +
          `或换用 text/按钮文字、aria/角色名、xpath/表达式 等前缀。`
      );
    }
    await sleep(250);
  }
}

async function act(page, target, timeoutMs, label, fn) {
  const { handle, sel } = await resolveElement(page, target, timeoutMs);
  try {
    return await withTimeout(fn(handle), timeoutMs, label);
  } finally {
    await handle.dispose().catch(() => {});
  }
}

export async function click(page, target, timeoutMs) {
  return act(page, target, timeoutMs, "点击", async (handle) => {
    await handle.click();
    return `已点击 ${target.ref !== undefined ? `ref=${target.ref}` : target.selector}。`;
  });
}

export async function typeInto(page, target, text, timeoutMs, clearFirst) {
  return act(page, target, timeoutMs, "输入", async (handle) => {
    if (clearFirst) {
      await handle.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
    }
    await handle.type(text, { delay: 8 });
    return `已在 ${target.ref !== undefined ? `ref=${target.ref}` : target.selector} 输入 ${text.length} 个字符。`;
  });
}

export async function fill(page, target, value, timeoutMs) {
  return act(page, target, timeoutMs, "填值", async (handle) => {
    const info = await handle.evaluate((el) => ({
      tag: el.tagName,
      type: el.type || "",
      editable: el.isContentEditable === true,
    }));
    const fillable =
      info.editable ||
      info.tag === "TEXTAREA" ||
      (info.tag === "INPUT" && !["checkbox", "radio", "file"].includes(info.type));
    if (!fillable) {
      throw new Error(
        `ref=${target.ref ?? target.selector} 是 <${info.tag.toLowerCase()}${info.type ? ` type="${info.type}"` : ""}>，不是可填写元素。` +
          `可填写的只有文本框、多行文本域和可编辑区域；复选框/单选框请用 browser_click。`
      );
    }
    await handle.click();
    await handle.evaluate((el) => {
      if (el.isContentEditable) el.innerText = "";
      else el.value = "";
    });
    await handle.type(value, { delay: 5 });
    return `已把 ${target.ref !== undefined ? `ref=${target.ref}` : target.selector} 的值设为 "${value}"。`;
  });
}

export async function press(page, target, key, timeoutMs) {
  if (target.ref === undefined && target.selector === undefined) {
    await page.keyboard.press(key);
    return `已按下 ${key}。`;
  }
  return act(page, target, timeoutMs, "按键", async (handle) => {
    await handle.focus();
    await page.keyboard.press(key);
    return `已在 ${target.ref !== undefined ? `ref=${target.ref}` : target.selector} 上按下 ${key}。`;
  });
}

export async function select(page, target, values, timeoutMs) {
  return act(page, target, timeoutMs, "下拉选择", async (handle) => {
    const selected = await handle.select(...values);
    return `已选择 ${selected.join(", ") || "(无匹配选项)"}。可选值可用 browser_evaluate 读取。`;
  });
}

export async function waitFor(page, { text, selector, url, timeoutMs }) {
  const deadline = timeoutMs ?? CONFIG.quickTimeoutMs;
  const started = Date.now();
  for (;;) {
    if (url) {
      if (page.url().includes(url)) return `URL 已匹配 "${url}"。`;
    }
    if (selector) {
      const found = await page.$(normalizeSelector(selector)).catch(() => null);
      if (found) {
        await found.dispose().catch(() => {});
        return `已等到元素 ${selector}。`;
      }
    }
    if (text) {
      const hit = await page
        .evaluate((needle) => (document.body.innerText || "").includes(needle), text)
        .catch(() => false);
      if (hit) return `页面上已出现文本 "${text}"。`;
    }
    if (Date.now() - started >= deadline) {
      const what = url ? `URL 包含 "${url}"` : selector ? `元素 ${selector}` : `文本 "${text}"`;
      throw new Error(`等待 ${what} 超时（${deadline}ms）。可延长 timeout，或先用 browser_observe 看看页面现在是什么状态。`);
    }
    await sleep(250);
  }
}
