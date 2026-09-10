/**
 * 批量截图 + 自动热区导出
 *
 * 一次跑完 pages.json 里的所有页面：导航 → 等数据回来 → 导出可点击元素坐标 → 全页截图；
 * 页面里配了 actions 的，再点一下元素补截「弹窗 / 抽屉 / 校验」等状态图。
 * 热区坐标按百分比存，截图尺寸变了也不跑位。
 *
 * 三个关键设计：
 *   1. 等数据而非等时间 —— 注入 XHR/fetch 探针，等网络静默再截，避免截到空骨架
 *   2. 参数页用真实值 —— url 里的 {{evtId}} 会先从列表页抠一个真实 id 填上
 *   3. 数据可拦截 —— mock 会话能把空列表放大成满屏，测试环境没数据也能出图
 */

import fs from 'node:fs';
import path from 'node:path';
import { listTargets, connect } from './cdp.mjs';
import { pickTarget } from './browser.mjs';
import { createMockSession } from './mock.mjs';
import { grabIds as pageGrabIds } from './discover.mjs';

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

/* ---------------- 页面内执行的脚本 ---------------- */

/** 注入到每个新文档：统计在途的 XHR / fetch 请求 */
function installNetProbe() {
  if (window.__protoNet) return true;
  const S = { active: 0, last: Date.now() };
  window.__protoNet = S;
  const X = window.XMLHttpRequest;
  if (X && X.prototype) {
    const open = X.prototype.open;
    const send = X.prototype.send;
    X.prototype.open = function () { S.last = Date.now(); return open.apply(this, arguments); };
    X.prototype.send = function () {
      S.active++;
      S.last = Date.now();
      const done = () => { S.active = Math.max(0, S.active - 1); S.last = Date.now(); };
      try {
        this.addEventListener('loadend', done, { once: true });
        this.addEventListener('error', done, { once: true });
        this.addEventListener('abort', done, { once: true });
      } catch {}
      return send.apply(this, arguments);
    };
  }
  const F = window.fetch;
  if (typeof F === 'function') {
    window.fetch = function () {
      S.active++;
      S.last = Date.now();
      const done = () => { S.active = Math.max(0, S.active - 1); S.last = Date.now(); };
      try {
        return F.apply(this, arguments).then((r) => { done(); return r; }, (e) => { done(); throw e; });
      } catch (e) { done(); throw e; }
    };
  }
  return true;
}

/** 页面内执行：网络是否已静默 */
function netIdle(quiet) {
  const S = window.__protoNet;
  if (!S) return true;
  return S.active <= 0 && (Date.now() - S.last) >= (quiet || 600);
}

/** 页面内执行：页面是否渲染到可截图的程度 */
function checkReady(sel, text, minRows, rowSel) {
  if (sel) {
    try { if (!document.querySelector(sel)) return false; } catch { return false; }
  }
  if (text) {
    const body = document.body ? (document.body.innerText || '') : '';
    if (!body.includes(text)) return false;
  }
  if (minRows > 0) {
    const sel2 = rowSel || '.el-table__row, tbody tr, .ant-table-row';
    try {
      if (document.querySelectorAll(sel2).length < minRows) return false;
    } catch { return false; }
  }
  return true;
}

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
    // 表格行改用首格文本，否则一整行的文本拼起来太长，热区标签没法看
    let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (el.classList && (el.classList.contains('el-table__row') || el.tagName === 'TR')) {
      const first = el.querySelector('td, .el-table__cell');
      if (first) text = (first.innerText || first.textContent || '').trim().replace(/\s+/g, ' ');
    }
    if (!text) text = el.getAttribute('aria-label') || el.title || '';
    text = String(text).slice(0, 40);
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
    let p = u.pathname.replace(/\/+$/, '');
    if (!p) p = '/';
    return p + u.search;
  } catch { return ''; }
}

function pageKey(base, url) {
  if (!url) return '';
  if (url.startsWith('#/')) return url;
  return urlKey(base, url);
}

/* ---------------- 主流程 ---------------- */

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
  // 每个新文档都装上网络探针，否则等数据只能靠猜
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try{(${installNetProbe.toString()})()}catch(e){}`,
  }).catch(() => {});

  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(${args.map(a => JSON.stringify(a ?? null)).join(',')})`;
    const { result: r, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, 30000);
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内脚本执行失败');
    return r?.value;
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 接口拦截：测试环境没数据时，靠它把空列表放大成满屏
  const mock = await createMockSession(cdp, cfg.mock || {}, { rulesDir: path.resolve(process.cwd(), (cfg.mock || {}).dir || 'mocks') });

  /* ---- 参数页的真实值：先从种子页面抠出来 ---- */
  const varValues = {};
  const fillVars = (s) => String(s ?? '').replace(/\{\{(\w+)\}\}/g, (m, n) => (varValues[n] != null ? varValues[n] : m));

  for (const [name, def] of Object.entries(cfg.vars || {})) {
    if (!def || typeof def !== 'object') continue;
    if (def.value != null && def.value !== '') { varValues[name] = String(def.value); continue; }
    if (!def.from || !baseUrl) continue;
    try {
      const seedUrl = /^https?:\/\//i.test(def.from) ? def.from : baseUrl + def.from;
      await cdp.send('Page.navigate', { url: seedUrl });
      await sleep(1800);
      const ids = await evaluate(pageGrabIds);
      let val = '';
      if (def.pattern) {
        const re = new RegExp(def.pattern);
        const hrefs = await evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href).slice(0, 200));
        for (const h of hrefs) { const m = String(h).match(re); if (m) { val = m[1] || m[0]; break; } }
      }
      if (!val) val = (ids.byHref || [])[0] || (ids.byAttr || [])[0] || '';
      if (val) {
        varValues[name] = String(val);
        console.log(`变量 ${name} = ${val}（取自 ${def.from}）`);
      } else {
        console.log(`警告：没能从 ${def.from} 抠出 ${name} 的值，用到它的页面可能打不开。`);
      }
    } catch (err) {
      console.log(`警告：解析变量 ${name} 失败：${err.message}`);
    }
  }

  // 页面跳转表：key 必须用替换后的真实 URL，否则 {{auto1}} 这种占位符
  // 和页面里真实的 href（/detail.html?id=EVT20260001）永远对不上，热区会全军覆没
  const urlToPage = new Map();
  // 另建一张「归一化」跳转表：把 id=数值 换成占位符再比对，
  // 这样列表里每一行的详情链接（id 各不相同）都能指向同一个详情页
  const normForMatch = (u) => String(u).replace(/([?&](?:id|ID|[a-zA-Z]*[iI]d|no|No|NO|code|key)=)[^&/#]{3,}/g, '$1{{ID}}');
  const urlToPageNorm = new Map();
  // 标题跳转表：Element UI 的菜单项不是 <a>，跳转全靠 vue-router，
  // DOM 上抓不到 href。但菜单文本通常就是页面标题，用文本对上即可自动接线
  const titleToPage = new Map();
  for (const p of cfg.pages || []) {
    if (p.type === 'live' || !p.url) continue;
    const real = fillVars(p.url);
    const k = pageKey(baseUrl, real);
    if (k && !urlToPage.has(k)) urlToPage.set(k, p.id);
    const nk = pageKey(baseUrl, normForMatch(real));
    if (nk && !urlToPageNorm.has(nk)) urlToPageNorm.set(nk, p.id);
    if (p.title && !titleToPage.has(p.title)) titleToPage.set(p.title, p.id);
  }

  const pages = (cfg.pages || []).filter(p => !p.skip);
  const skipped = (cfg.pages || []).filter(p => p.skip);
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

  /** 等页面渲染到位：先看条件选择器/文本/行数，再看网络是否静默 */
  const waitPageReady = async (page) => {
    const sel = page.ready || '';
    const text = page.readyText || '';
    const minRows = page.minRows || 0;
    const rowSel = page.rowSelector || '';
    if (sel || text || minRows) {
      const started = Date.now();
      const limit = page.readyTimeout || 15000;
      while (Date.now() - started < limit) {
        const ok = await evaluate(checkReady, sel, text, minRows, rowSel).catch(() => true);
        if (ok) break;
        await sleep(300);
      }
    }
    const quiet = page.networkIdle ?? 700;
    if (quiet > 0) {
      const started = Date.now();
      const limit = page.networkIdleTimeout || 15000;
      while (Date.now() - started < limit) {
        const ok = await evaluate(netIdle, quiet).catch(() => true);
        if (ok) break;
        await sleep(250);
      }
    }
  };

  const shoot = async () => {
    const { contentSize } = await cdp.send('Page.getLayoutMetrics');
    const w = Math.max(1, Math.round(contentSize.width));
    const h = Math.min(16000, Math.max(1, Math.round(contentSize.height)));
    const scale = Math.min(1, maxWidth / w);
    await setViewport(w, h, scale);
    await sleep(200);
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
    // 用页面里真实的 URL 做基准，targets 快照可能是过期的
    const currentUrl = await evaluate(() => location.href).catch(() => target.url) || target.url;
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
      // href 里也可能带 {{var}}，一并替换后再比对
      const key = urlKey(currentUrl || baseUrl, fillVars(it.href));
      let linked = key ? urlToPage.get(key) : null;
      // 精确匹配不上时，按归一化形式再试一次（同一详情页的不同 id）
      if (!linked && key) linked = urlToPageNorm.get(normForMatch(key)) || null;
      // 再按文本对页面标题试一次（菜单、面包屑没有 href，靠这个接线）
      if (!linked && it.text && it.text.length <= 20) linked = titleToPage.get(it.text) || null;
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

      const rawUrl = fillVars(page.url);
      if (/\{\{\w+\}\}/.test(rawUrl)) {
        throw new Error(`url 里的 ${rawUrl.match(/\{\{\w+\}\}/)[0]} 没有取到值，请检查 vars 配置`);
      }
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : baseUrl + rawUrl;
      await setViewport(vw, vh, 1);
      await cdp.send('Page.navigate', { url });
      await sleep(300);
      await waitPageReady(page);
      await sleep(page.wait ?? 800);

      const states = {};
      states.default = await grab(page, 'default', page.actions);

      for (const act of page.actions || []) {
        if (!act.click || !act.state) continue;
        const r = await evaluate(clickElement, act.click);
        if (!r.ok) { errors.push(`${page.title}: ${r.msg}`); continue; }
        await sleep(act.wait ?? 700);
        states[act.state] = await grab(page, act.state, page.actions);
      }

      result.push({
        id: page.id, title: page.title, group: page.group || '未分组',
        type: 'shot', url: page.url || '', notes: page.notes || [], states,
      });

      const n = Object.keys(states).length;
      const kb = Math.round(Object.values(states).reduce((s, v) => s + v.bytes, 0) / 1024);
      const spots = Object.values(states).reduce((s, v) => s + v.hotspots.length, 0);
      let emptyWarn = '';
      if (page.minRows) {
        const rows = await evaluate((s) => document.querySelectorAll(s).length, page.rowSelector || '.el-table__row').catch(() => -1);
        if (rows >= 0 && rows < page.minRows) emptyWarn = ` · 只有 ${rows} 行数据（期望 ${page.minRows} 行），考虑开 mock.amplify`;
      }
      console.log(`${prefix} · ${n} 个状态 · ${spots} 个热区 · ${kb}KB${emptyWarn}`);
    } catch (err) {
      errors.push(`${page.title || page.id}: ${err.message}`);
      console.log(`${prefix} · 失败：${err.message}`);
    }
  }

  const mockReport = mock.report();
  if (mockReport) console.log('\n' + mockReport);
  await mock.close();
  cdp.close();

  if (skipped.length) {
    console.log(`\n跳过了 ${skipped.length} 个标记为 skip 的页面：`);
    skipped.slice(0, 10).forEach(p => console.log(`  - ${p.title || p.id}  ${p.url}`));
  }

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

  return { site, outDir, errors, count: result.length, skipped: skipped.length };
}
