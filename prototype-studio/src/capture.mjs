/**
 * 批量截图 + 自动热区导出
 *
 * 一次跑完 pages.json 里的所有页面：导航 → 等待 → 导出可点击元素坐标 → 全页截图；
 * 页面里配了 actions 的，再点一下元素补截「弹窗 / 抽屉 / 校验」等状态图。
 * 热区坐标按百分比存，截图尺寸变了也不跑位。
 */

import fs from 'node:fs';
import path from 'node:path';
import { listTargets, connect } from './cdp.mjs';
import { pickTarget } from './browser.mjs';

/**
 * 默认采集哪些元素当热区候选。
 * 放宽一点没关系：只有能匹配到「跳转目标」或「状态动作」的才会真正显示，
 * 匹配不上的只是躺在数据里，不会在原型站上画出来。
 */
const DEFAULT_SELECTORS = [
  'a[href]', 'button', 'input[type="button"]', 'input[type="submit"]',
  '.el-button', '.el-menu-item', '.el-submenu__title', '.el-tabs__item',
  '.el-breadcrumb__item', '.el-table__row', '.el-link', '.el-dropdown-menu__item',
  '[role="button"]', '[class*="btn"]', '[onclick]',
];

/** 页面内执行：收集所有可点击元素的文档坐标与文本 */
function collectElements(selectors, minSize, maxCount) {
  const doc = document.documentElement;
  const docW = Math.max(doc.scrollWidth, doc.clientWidth);
  const docH = Math.max(doc.scrollHeight, doc.clientHeight);
  const sx = window.scrollX || window.pageXOffset || 0;
  const sy = window.scrollY || window.pageYOffset || 0;
  const raw = [];

  let nodes;
  try { nodes = document.querySelectorAll(selectors.join(',')); }
  catch { nodes = document.querySelectorAll('a[href],button'); }

  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < minSize || r.height < minSize) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (parseFloat(st.opacity) < 0.1) continue;
    const x = r.left + sx;
    const y = r.top + sy;
    if (x < 0 || y < 0 || x > docW || y > docH) continue;
    const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '')
      .trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!text) continue;
    raw.push({
      el,
      tag: (el.tagName || '').toLowerCase(),
      text,
      href: el.getAttribute && el.getAttribute('href') ? el.getAttribute('href') : '',
      x: Math.round(x), y: Math.round(y),
      w: Math.round(r.width), h: Math.round(r.height),
      area: Math.round(r.width * r.height),
    });
  }

  // 去重：同一个文本若父子都命中，只留最内层那个
  const kept = raw.filter(a => !raw.some(b => b !== a && b.text === a.text && a.el.contains(b.el)));
  kept.sort((a, b) => a.area - b.area);

  const out = kept.slice(0, maxCount).map(k => ({
    tag: k.tag, text: k.text, href: k.href, x: k.x, y: k.y, w: k.w, h: k.h,
  }));
  return { docW, docH, items: out };
}

/**
 * 页面内执行：按 text:xxx 或 CSS 选择器点一下
 *
 * 文本匹配要挑「最内层、面积最小」的那个。否则像 div.body 这种祖先元素
 * 因为包含了整页文本也会被匹配上，点下去等于点了空气。
 */
function clickElement(expr) {
  const pick = (nodes) => {
    if (!nodes.length) return null;
    const inner = nodes.filter(e => !nodes.some(o => o !== e && e.contains(o)));
    const list = inner.length ? inner : nodes;
    let best = null, bestArea = Infinity;
    for (const e of list) {
      const r = e.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > 0 && a < bestArea) { bestArea = a; best = e; }
    }
    return best || list[0];
  };

  let el = null;
  if (expr.startsWith('text:')) {
    const kw = expr.slice(5).trim();
    const all = Array.from(document.querySelectorAll(
      'a,button,.el-button,.el-menu-item,[role="button"],input[type="button"],input[type="submit"],[class*="btn"],li,span,div'
    ));
    const textOf = (e) => (e.innerText || e.textContent || '').trim();
    el = pick(all.filter(e => textOf(e) === kw))
      || pick(all.filter(e => textOf(e).includes(kw)));
  } else {
    try { el = document.querySelector(expr); } catch { el = null; }
  }
  if (!el) return { ok: false, msg: `没找到元素：${expr}` };
  try { el.scrollIntoView({ block: 'center' }); } catch {}
  el.click();
  const label = (el.innerText || el.textContent || expr).trim().replace(/\s+/g, ' ').slice(0, 30);
  return { ok: true, msg: `已点击：${label}` };
}

/** 页面内执行：判断某个选择器是否已出现（用于等待渲染完成） */
function hasSelector(sel) {
  try { return !!document.querySelector(sel); } catch { return true; }
}

function absUrl(base, u) {
  try { return new URL(u, base).href; } catch { return ''; }
}

/** 把 href 归一成可用于比对的 key，兼容 history 模式与 hash 模式 */
function urlKey(base, href) {
  if (!href) return '';
  const full = absUrl(base, href);
  if (!full) return '';
  try {
    const u = new URL(full);
    if (u.hash && u.hash.startsWith('#/')) return u.hash;
    return u.pathname + u.search;
  } catch { return ''; }
}

function pageKey(base, url) {
  if (!url) return '';
  if (url.startsWith('#/')) return url;
  return urlKey(base, url);
}

export async function capture(cfg, opts = {}) {
  const outDir = opts.outDir || cfg.out?.dir || 'work';
  const shotsDir = path.join(outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const host = cfg.browser?.host || '127.0.0.1';
  const port = cfg.browser?.port || 9222;
  const vw = cfg.viewport?.width || 1920;
  const vh = cfg.viewport?.height || 1080;
  const maxWidth = cfg.shot?.maxWidth || 1568;
  const maxBytes = cfg.shot?.maxBytes || 500000;
  const qualityLevels = cfg.shot?.quality || [82, 72, 62, 52, 42, 34];
  const selectors = cfg.hotspots?.selectors || DEFAULT_SELECTORS;
  const minSize = cfg.hotspots?.minSize ?? 8;
  const maxCount = cfg.hotspots?.maxCount ?? 90;
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');

  const targets = await listTargets(host, port);
  if (!targets.length) throw new Error(`调试端口 ${host}:${port} 上没有可用的页面标签。请先在浏览器里打开并登录目标系统。`);
  const target = pickTarget(targets, cfg.browser?.keyword);
  const cdp = await connect(target.wsUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable').catch(() => {});

  const urlToPage = new Map();
  for (const p of cfg.pages || []) {
    if (p.type === 'live' || !p.url) continue;
    const k = pageKey(baseUrl, p.url);
    if (k) urlToPage.set(k, p.id);
  }

  const pages = (cfg.pages || []).filter(p => !p.skip);
  const only = opts.only ? String(opts.only).split(',').map(s => s.trim()).filter(Boolean) : null;
  const errors = [];
  const result = [];
  let done = 0;

  const setViewport = (w, h, scale = 1) =>
    cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
      deviceScaleFactor: scale, mobile: false,
    });

  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
    const { result: r, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, 30000);
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内脚本执行失败');
    return r?.value;
  };

  const waitReady = async (sel, timeout) => {
    if (!sel) return;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const ok = await evaluate(hasSelector, sel).catch(() => true);
      if (ok) return;
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const shoot = async () => {
    const { contentSize } = await cdp.send('Page.getLayoutMetrics');
    const w = Math.max(1, Math.round(contentSize.width));
    const h = Math.min(16000, Math.max(1, Math.round(contentSize.height)));
    const scale = Math.min(1, maxWidth / w);
    await setViewport(w, h, scale);
    await new Promise(r => setTimeout(r, 200));
    let buf = null;
    for (const q of qualityLevels) {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg', quality: q, fromSurface: true,
      }, 60000);
      buf = Buffer.from(data, 'base64');
      if (buf.length <= maxBytes) break;
      if (q === qualityLevels[qualityLevels.length - 1]) break;
    }
    await setViewport(vw, vh, 1);
    return { buf, cssWidth: w, cssHeight: h };
  };

  /**
   * 判断一个元素是否命中了某个状态动作：
   * - 在默认态里命中 action.click 的元素，点击后进入该状态
   * - 在某个状态里命中 action.back 的元素，点击后回到默认态
   */
  const matchAction = (page, stateName, actions, text) => {
    for (const act of actions || []) {
      if (!act || !act.state) continue;
      if (stateName === 'default' && typeof act.click === 'string' && act.click.startsWith('text:')) {
        if (text.includes(act.click.slice(5).trim())) return { to: page.id, state: act.state };
      }
      if (act.state === stateName && typeof act.back === 'string' && act.back.startsWith('text:')) {
        if (text.includes(act.back.slice(5).trim())) return { to: page.id, state: 'default' };
      }
    }
    return null;
  };

  const grab = async (page, stateName, actions) => {
    const currentUrl = target.url;
    const collected = await evaluate(collectElements, selectors, minSize, maxCount);
    const { buf, cssWidth, cssHeight } = await shoot();

    const fname = stateName === 'default' ? `${page.id}.jpg` : `${page.id}__${stateName}.jpg`;
    fs.writeFileSync(path.join(shotsDir, fname), buf);

    const spots = [];
    for (const it of collected.items) {
      const x = +(it.x / cssWidth * 100).toFixed(3);
      const y = +(it.y / cssHeight * 100).toFixed(3);
      const w = +(it.w / cssWidth * 100).toFixed(3);
      const h = +(it.h / cssHeight * 100).toFixed(3);
      if (x < -1 || y < -1 || x > 101 || y > 101) continue;
      const key = urlKey(currentUrl || baseUrl, it.href);
      const linked = key ? urlToPage.get(key) : null;
      const actHit = matchAction(page, stateName, actions, it.text);

      if (linked && linked !== page.id) {
        spots.push({ x, y, w, h, label: it.text, to: linked, state: 'default', kind: 'link' });
      } else if (actHit) {
        spots.push({ x, y, w, h, label: it.text, to: actHit.to, state: actHit.state, kind: 'action' });
      } else if (cfg.hotspots?.includeCandidates) {
        spots.push({ x, y, w, h, label: it.text, to: '', state: '', kind: 'candidate' });
      }
    }
    return { img: `shots/${fname}`, w: cssWidth, h: cssHeight, hotspots: spots, bytes: buf.length };
  };

  for (const page of pages) {
    if (only && !only.includes(page.id)) continue;
    done++;
    const prefix = `[${done}/${only ? only.length : pages.length}] ${page.title || page.id}`;
    try {
      if (page.type === 'live') {
        result.push({
          id: page.id, title: page.title, group: page.group || '未分组',
          type: 'live', file: page.file || '', notes: page.notes || [], states: {},
        });
        console.log(`${prefix} · 可交互页，跳过截图`);
        continue;
      }

      const url = /^https?:\/\//i.test(page.url || '') ? page.url : baseUrl + (page.url || '');
      await setViewport(vw, vh, 1);
      await cdp.send('Page.navigate', { url });
      await new Promise(r => setTimeout(r, 300));
      await waitReady(page.ready, page.readyTimeout || 8000);
      await new Promise(r => setTimeout(r, page.wait ?? 1200));

      const states = {};
      states.default = await grab(page, 'default', page.actions);

      for (const act of page.actions || []) {
        if (!act.click || !act.state) continue;
        const r = await evaluate(clickElement, act.click);
        if (!r.ok) { errors.push(`${page.title}: ${r.msg}`); continue; }
        await new Promise(res => setTimeout(res, act.wait ?? 700));
        states[act.state] = await grab(page, act.state, page.actions);
      }

      result.push({
        id: page.id, title: page.title, group: page.group || '未分组',
        type: 'shot', url: page.url || '', notes: page.notes || [], states,
      });

      const n = Object.keys(states).length;
      const kb = Math.round(Object.values(states).reduce((s, v) => s + v.bytes, 0) / 1024);
      const spots = Object.values(states).reduce((s, v) => s + v.hotspots.length, 0);
      console.log(`${prefix} · ${n} 个状态 · ${spots} 个热区 · ${kb}KB`);
    } catch (err) {
      errors.push(`${page.title || page.id}: ${err.message}`);
      console.log(`${prefix} · 失败：${err.message}`);
    }
  }

  cdp.close();

  const site = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl,
      viewport: { width: vw, height: vh },
      title: cfg.title || '系统原型',
      subtitle: cfg.subtitle || '',
    },
    pages: result,
    errors,
  };
  fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(site, null, 2), 'utf8');

  return { site, outDir, errors, count: result.length };
}
