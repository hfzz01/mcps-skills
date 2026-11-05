/* ============================================================
 * 输入通道 C：受控浏览器探索 / DOM Extractor
 * ------------------------------------------------------------
 * 只连接本机已有的 CDP 调试端口，读取已登录页面的
 * computedStyle 与几何尺寸，产出「样式宪章草案」。
 * 不启动浏览器、不关闭浏览器、不点击、不提交、不调用模型。
 * 零依赖：Node 内置 fetch + 全局 WebSocket（Node 22+）。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function listTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!r.ok) throw new Error(`CDP 列表请求失败 ${r.status}`);
  return r.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('WebSocket 连接失败'));
      setTimeout(() => rej(new Error('WebSocket 连接超时')), 8000);
    });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`${method} 超时`)); } }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const PROBE = `(() => {
  const sels = ['body','h1','h2','h3','button','.el-button','input','.el-input__inner','table','th','td',
                '.el-table','.el-menu','.el-card','.el-tag','a','label','.el-form-item__label','.el-pagination'];
  const out = [];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    out.push({ sel, color: s.color, background: s.backgroundColor, fontSize: s.fontSize,
      fontWeight: s.fontWeight, padding: s.padding, borderRadius: s.borderRadius,
      borderColor: s.borderColor, height: Math.round(r.height), width: Math.round(r.width) });
  }
  const freq = {};
  const all = Array.from(document.querySelectorAll('*')).slice(0, 1200);
  for (const el of all) {
    const s = getComputedStyle(el);
    for (const v of [s.color, s.backgroundColor, s.borderTopColor]) {
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent') continue;
      freq[v] = (freq[v] || 0) + 1;
    }
  }
  const palette = Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 16);
  const sizes = {};
  for (const el of all) {
    const s = getComputedStyle(el);
    sizes[s.fontSize] = (sizes[s.fontSize] || 0) + 1;
  }
  return { url: location.href, title: document.title, samples: out, palette,
    fontSizes: Object.entries(sizes).sort((a,b)=>b[1]-a[1]).slice(0, 8),
    scrollHeight: document.documentElement.scrollHeight, elementCount: all.length };
})()`;

export async function extractDom({ port = 9222, out } = {}) {
  if (typeof WebSocket === 'undefined') {
    console.error('[dom] 需要 Node 22+（全局 WebSocket）；当前运行时不支持');
    process.exitCode = 1; return;
  }
  let targets;
  try { targets = await listTargets(port); }
  catch (e) {
    console.error(`[dom] 连不上 127.0.0.1:${port}：${e.message}`);
    console.error('  处置：用带 --remote-debugging-port=9222 的浏览器打开存量系统并人工登录，再重试。');
    console.error('  本工具不会替你启动或关闭浏览器。');
    process.exitCode = 1; return;
  }
  const pages = targets.filter(t => t.type === 'page' && !String(t.url).startsWith('devtools://'));
  if (!pages.length) { console.error('[dom] 没有可用页面标签'); process.exitCode = 1; return; }
  const target = pages[0];
  let cdp;
  try {
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const r = await cdp.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面脚本执行异常');
    const d = r.result.value;

    const L = [];
    L.push('/* ============================================================');
    L.push(' * 样式宪章草案 / charter.draft.css（由 extract-dom 生成）');
    L.push(` * 来源页面：${d.url}`);
    L.push(` * 页面标题：${d.title} ｜ 采样元素 ${d.elementCount} 个 ｜ 文档高 ${d.scrollHeight}px`);
    L.push(' * 说明：读的是 computedStyle 真实值，不是截图猜测值。');
    L.push(' *       草案必须人工确认后合并进 foundry/charter.css，模型不得改写。');
    L.push(' * ============================================================ */');
    L.push('');
    L.push(':root {');
    d.palette.forEach(([c, n], i) => L.push(`  /* 计算样式频次 ${n} 次 */\n  --draft-computed-${i + 1}: ${c};`));
    d.fontSizes.forEach(([fs, n], i) => L.push(`  /* 字号频次 ${n} 次 */\n  --draft-fontsize-${i + 1}: ${fs};`));
    L.push('}');
    L.push('');
    L.push('/* ---- 主要元素实测 ----');
    for (const s of d.samples) {
      L.push(` * ${s.sel.padEnd(24)} 颜色 ${s.color} ｜ 背景 ${s.background} ｜ 字号 ${s.fontSize} ｜ 圆角 ${s.borderRadius} ｜ 尺寸 ${s.width}×${s.height}`);
    }
    L.push(' */');
    L.push('');
    const dest = out ? path.resolve(out) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'foundry', 'charter.draft.css');
    fs.writeFileSync(dest, L.join('\n'), 'utf8');

    console.log(`[dom] 已接管 ${d.url}`);
    console.log(`  采样元素 ${d.elementCount} 个，计算样式色板 ${d.palette.length} 色，字号 ${d.fontSizes.length} 档`);
    console.log(`  主色频次：${d.palette.slice(0, 4).map(([c, n]) => `${c}(${n})`).join(' ')}`);
    console.log(`  字号分布：${d.fontSizes.map(([f, n]) => `${f}(${n})`).join(' ')}`);
    console.log(`  草案：${dest}`);
    return { url: d.url, palette: d.palette, dest };
  } catch (e) {
    console.error(`[dom] 采集失败：${e.message}`);
    process.exitCode = 1;
  } finally { if (cdp) cdp.close(); }
}
