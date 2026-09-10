/**
 * 运行时页面发现 —— 在已登录的浏览器里直接问系统「你都有哪些页面」
 *
 * 为什么不用静态扫描：IOC 这类系统的路由大量来自后端动态菜单（router.addRoutes 注入），
 * src/router 里根本看不到；而 /detail?id=123 这类参数页就算扫到了也打不开——没有真实 id。
 * 登录之后在系统里问，拿到的才是真相。
 *
 * 四个信息源，按可靠度合并：
 *   1. 菜单 DOM 的 index 属性 —— Element UI 在 router 模式下 index 就是路由路径，最可靠
 *   2. Vue Router 运行时实例 —— 含 addRoutes 动态注入的路由
 *   3. 菜单文本 —— 用来当中文标题（router 里的 name 经常是英文）
 *   4. 站内链接 —— 兜底补充
 *
 * 参数页怎么办：开着 --seed 时，会从列表页的 DOM / a[href] 里抠出一个真实 id，
 * 填进 url 的 {{evtId}} 占位符。这样详情页就能真的打开并截图。
 */

import fs from 'node:fs';
import path from 'node:path';
import { listTargets, connect } from './cdp.mjs';
import { pickTarget } from './browser.mjs';

/* ---------------- 页面内执行的脚本 ---------------- */

/** 读运行时路由 + 菜单 + 站内链接 */
function discoverRuntime() {
  const res = { framework: '', routes: [], menus: [], links: [] };

  // 1) 找 Vue Router 实例：Vue2 挂在 el.__vue__，Vue3 挂在 #app.__vue_app__
  let router = null;
  const nodes = Array.from(document.querySelectorAll('*'));
  for (const el of nodes) {
    if (el.__vue__ && el.__vue__.$router) { router = el.__vue__.$router; res.framework = 'vue2'; break; }
  }
  if (!router) {
    const appEl = document.querySelector('#app');
    if (appEl && appEl.__vue_app__) {
      res.framework = 'vue3';
      try { router = appEl.__vue_app__.config.globalProperties.$router; } catch {}
    }
  }
  if (!router) {
    const w = window;
    const cands = [w.__VUE_ROUTER__, w.router, w.vm && w.vm.$router, w.app && w.app.$router];
    for (const c of cands) { if (c && (typeof c.getRoutes === 'function' || c.options)) { router = c; break; } }
  }

  const norm = (p, prefix) => {
    if (!p) return '';
    if (p.startsWith('/')) return p;
    return (prefix ? prefix.replace(/\/+$/, '') : '') + '/' + p;
  };

  const walk = (list, prefix, group) => {
    for (const r of list || []) {
      const p = norm(r.path, prefix);
      const meta = r.meta || {};
      const title = meta.title || r.title || r.name || '';
      const kids = r.children || [];
      const g = group || meta.group || '';
      if (p) res.routes.push({ path: p, title: String(title), group: String(g), hasKids: kids.length > 0 });
      if (kids.length) walk(kids, p, g || title);
    }
  };

  if (router) {
    let list = [];
    try {
      if (typeof router.getRoutes === 'function') {
        // vue-router 4 / 3.5+：getRoutes 返回的是扁平且已展开的记录
        list = router.getRoutes().map((r) => ({
          path: r.path, name: r.name, meta: r.meta || {}, children: r.children || [],
        }));
      }
    } catch {}
    if (!list.length && router.options && Array.isArray(router.options.routes)) {
      list = router.options.routes;
    }
    walk(list, '', '');
  }

  // 2) 菜单 DOM：Element UI 的 el-menu-item 带 index（router 模式下即路径），
  //    Ant Design 则在 href / data 属性里，一起读出来
  const groupOf = (el) => {
    let p = el.parentElement;
    for (let i = 0; i < 6 && p; i++) {
      const cls = p.className && typeof p.className === 'string' ? p.className : '';
      if (cls.includes('el-submenu') || cls.includes('ant-menu-submenu') || cls.includes('submenu')) {
        const t = p.querySelector(':scope > .el-submenu__title, :scope > .ant-menu-submenu-title, :scope > [class*="submenu-title"]');
        if (t) return (t.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      }
      p = p.parentElement;
    }
    return '';
  };

  const menuSel = [
    '.el-menu-item', '.el-submenu__title', '.ant-menu-item', '.ant-menu-submenu-title',
    '[data-menu-path]', '[data-path]', 'nav a[href]', '[class*="menu-item"]',
  ].join(',');
  document.querySelectorAll(menuSel).forEach((el) => {
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (!text) return;
    const idx = el.getAttribute('index') || el.getAttribute('data-menu-path')
      || el.getAttribute('data-path') || el.getAttribute('href') || '';
    res.menus.push({ text, path: String(idx || '').trim(), group: groupOf(el) });
  });

  // 3) 站内链接兜底
  const links = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href') || '';
    if (!h || h.startsWith('javascript:') || h.startsWith('mailto:')) return;
    links.add(h);
  });
  res.links = Array.from(links).slice(0, 400);
  return res;
}

/** 页面内执行：返回当前页可点的菜单项数量 */
function countMenuItems() {
  const els = Array.from(document.querySelectorAll(
    '.el-menu-item, .ant-menu-item, nav a[href], [class*="menu-item"]'
  ));
  let n = 0;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    const t = (el.innerText || '').trim();
    if (r.width > 4 && r.height > 4 && t) n++;
  });
  return n;
}

/** 页面内执行：点第 i 个菜单项，返回它的文本 */
function clickMenuByIndex(i) {
  const els = Array.from(document.querySelectorAll(
    '.el-menu-item, .ant-menu-item, nav a[href], [class*="menu-item"]'
  )).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && (el.innerText || '').trim();
  });
  const el = els[i];
  if (!el) return { ok: false, text: '' };
  const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  try { el.scrollIntoView({ block: 'center' }); } catch {}
  el.click();
  return { ok: true, text };
}

/** 页面内执行：从当前页抠出真实业务 id，供参数页使用 */
export function grabIds() {
  const byHref = [];
  const byAttr = [];
  const idRe = /[?&](?:id|ID|[a-zA-Z]*[iI]d)=([^&"'\s<>]+)/g;
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  document.querySelectorAll('a[href]').forEach((a) => {
    const h = a.href || '';
    let m;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(h))) byHref.push(m[1]);
    const u = h.match(uuidRe);
    if (u) byHref.push(u[0]);
  });

  document.querySelectorAll('[data-id],[data-row-id],[data-key],[data-pk]').forEach((el) => {
    const v = el.getAttribute('data-id') || el.getAttribute('data-row-id')
      || el.getAttribute('data-key') || el.getAttribute('data-pk');
    if (v) byAttr.push(v);
  });

  return {
    byHref: Array.from(new Set(byHref)).slice(0, 20),
    byAttr: Array.from(new Set(byAttr)).slice(0, 20),
  };
}

/* ---------------- Node 侧 ---------------- */

function slugify(s, used) {
  let base = String(s || '')
    .replace(/[^a-zA-Z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'page';
  if (/^\d/.test(base)) base = 'p-' + base;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function isDynamic(p) {
  return /:\w+|\{\{|\*\w+/.test(p || '');
}

/** 只把「看起来像系统内页」的路径留下来 */
function isPagePath(p) {
  if (!p || typeof p !== 'string') return false;
  if (!/^[#/]/.test(p)) return false;
  if (/^#\/?$/.test(p)) return false;
  if (/^\/(api|static|assets|public|vendor)\//i.test(p)) return false;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|map|json|pdf|xlsx?|docx?)$/i.test(p)) return false;
  return true;
}

/**
 * 把 URL 里的真实业务编号换成占位符。
 *
 * 不这么做的话，列表页 20 行数据就会有 20 个 /detail?id=EVT0001…EVT0020，
 * 被当成 20 个不同页面收进来，页面清单直接炸掉。
 * 归一化之后它们合并成同一条，真实值存进 vars 供 capture 时回填。
 */
const ID_PARAM_RE = /([?&](?:id|ID|[a-zA-Z]*[iI]d|no|No|NO|code|key)=)([^&/#]+)/g;
const ID_SEG_RE = /(\/)([A-Za-z]{2,}[-_]?\d{3,}|\d{6,})(?=\/|$|\?)/g;

function makeNormalizer() {
  const map = new Map();
  let n = 0;
  return (u) => {
    let real = null;
    let norm = String(u).replace(ID_PARAM_RE, (m, prefix, val) => {
      if (val.length < 3 || !/\d/.test(val)) return m;
      if (real === null) real = val;
      return prefix + '~AUTOID~';
    });
    if (real === null) {
      norm = norm.replace(ID_SEG_RE, (m, prefix, val) => {
        if (val.length < 4 || !/\d/.test(val)) return m;
        if (real === null) real = val;
        return prefix + '~AUTOID~';
      });
    }
    if (real === null) return { url: u, varName: null, realVal: null };
    if (!map.has(norm)) map.set(norm, `auto${++n}`);
    const varName = map.get(norm);
    return { url: norm.split('~AUTOID~').join(`{{${varName}}}`), varName, realVal: real };
  };
}

function stripBase(p, baseUrl) {
  if (!p) return p;
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      if (baseUrl) {
        const b = new URL(baseUrl);
        if (u.host === b.host) return u.pathname + u.search + u.hash;
      }
      return u.pathname + u.search + u.hash;
    } catch { return p; }
  }
  return p;
}

function guessGroup(p, fallback) {
  if (fallback) return fallback;
  const m = String(p || '').match(/^#?\/([^/?#]+)/);
  return m ? m[1] : '未分组';
}

export async function discover(cfg, opts = {}) {
  const host = cfg.browser?.host || '127.0.0.1';
  const port = cfg.browser?.port || 9222;
  const baseUrl = (cfg.baseUrl || '').replace(/\/+$/, '');
  const doClick = opts.click !== false;
  const doSeed = opts.seed !== false;
  const maxMenu = opts.maxMenu || 60;

  const targets = await listTargets(host, port);
  if (!targets.length) {
    throw new Error(`调试端口 ${host}:${port} 上没有可接管的页面。\n下一步：先 launch 开浏览器，人工登录进系统，再跑 discover。`);
  }
  const target = pickTarget(targets, cfg.browser?.keyword);
  const cdp = await connect(target.wsUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evaluate = async (fn, ...args) => {
    const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a ?? null)).join(',')})`;
    const { result: r, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, 30000);
    if (exceptionDetails) throw new Error(exceptionDetails.text || '页面内脚本执行失败');
    return r?.value;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 若当前标签不在目标系统里，先导航过去
  const isOnSite = baseUrl
    ? (target.url || '').toLowerCase().includes(new URL(baseUrl).host.toLowerCase())
    : true;
  if (!isOnSite && baseUrl) {
    await cdp.send('Page.navigate', { url: baseUrl });
    await sleep(600);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const st = await evaluate(() => document.readyState);
      if (st === 'complete') break;
    }
    await sleep(1500);
  }

  console.log(`已接管：${target.title}  ${target.url}`);

  const raw = await evaluate(discoverRuntime);
  console.log(`框架识别：${raw.framework || '未识别（不影响，菜单照样能读）'}`);
  console.log(`运行时路由 ${raw.routes.length} 条 · 菜单项 ${raw.menus.length} 个 · 站内链接 ${raw.links.length} 个`);

  /* ---- 可选：逐个点击菜单，拿真实 URL（含 query） ---- */
  const clicked = [];
  if (doClick) {
    let n = 0;
    try { n = await evaluate(countMenuItems); } catch {}
    const total = Math.min(n, maxMenu);
    const skipWords = ['退出', '注销', '登出', '退出登录', 'logout', '个人中心', '修改密码', '帮助', '关于'];
    if (total > 0) console.log(`开始逐个点击菜单（${total} 项），拿真实 URL 与 query 参数…`);
    for (let i = 0; i < total; i++) {
      try {
        const r = await evaluate(clickMenuByIndex, i);
        if (!r.ok || !r.text) continue;
        if (skipWords.some((w) => r.text.includes(w))) continue;
        await sleep(opts.clickWait || 1400);
        const href = await evaluate(() => location.href);
        const p = stripBase(href, baseUrl);
        if (isPagePath(p) || /^#/.test(p)) {
          clicked.push({ url: p, title: r.text });
          process.stdout.write(`  [${i + 1}/${total}] ${r.text}  →  ${p}\n`);
        }
      } catch {
        // 单个菜单点坏了不影响整体
      }
    }
    console.log(`点击遍历完成，拿到 ${clicked.length} 个真实地址。`);
  }

  /* ---- 合并四个信息源 ---- */
  const merged = new Map();
  const usedIds = new Set();
  const normalize = makeNormalizer();
  const autoVars = {};
  const put = (url, title, group, src) => {
    const raw = stripBase(url, baseUrl);
    if (!isPagePath(raw)) return;
    let u = raw;
    // 链接里的真实编号一律换成占位符，否则列表有多少行就会冒出多少个「详情页」
    if (src === 'link') {
      const r = normalize(raw);
      u = r.url;
      if (r.varName && r.realVal) autoVars[r.varName] = { from: '', pattern: '', value: r.realVal };
    }
    const key = u.split('#')[0];
    const exist = merged.get(key);
    if (exist) {
      // 后来者只补空缺的标题，不覆盖已有更具体的 URL（带 query 的优先）
      if (!exist.title && title) exist.title = title;
      if (!exist.group && group) exist.group = group;
      if (u.length > (exist.url || '').length) exist.url = u;
      return;
    }
    merged.set(key, { url: u, title: title || '', group: group || '', src });
  };

  for (const r of raw.routes) put(r.path, r.title, r.group, 'router');
  for (const m of raw.menus) {
    if (isPagePath(m.path)) put(m.path, m.text, m.group, 'menu');
  }
  for (const c of clicked) put(c.url, c.title, '', 'click');
  for (const l of raw.links) put(l, '', '', 'link');

  /* ---- 参数页：抠真实 id 填进去 ---- */
  const dyn = [];
  const vars = {};
  if (doSeed) {
    const listCandidates = Array.from(merged.values())
      .filter((p) => !isDynamic(p.url))
      .filter((p) => /(list|manage|index|query|search|list$|列表)/i.test(p.url + p.title))
      .slice(0, 8);

    for (const [key, page] of merged.entries()) {
      // 只处理真正的动态路由（:id），已被归一化成 {{autoN}} 的不再动它
      if (!/:\w+|\*\w+/.test(key)) continue;
      if (/\{\{\w+\}\}/.test(page.url || '')) continue;
      dyn.push({ url: page.url, title: page.title, reason: '需要真实参数值' });
      if (!listCandidates.length) continue;
      if (Object.keys(vars).length >= 6) continue;

      for (const seed of listCandidates) {
        try {
          const url = /^https?:\/\//i.test(seed.url) ? seed.url : baseUrl + seed.url;
          await cdp.send('Page.navigate', { url });
          await sleep(1800);
          const ids = await evaluate(grabIds);
          const val = (ids.byHref || [])[0] || (ids.byAttr || [])[0];
          if (val) {
            const name = 'seed' + (Object.keys(vars).length + 1);
            vars[name] = { from: seed.url, pattern: '', value: String(val) };
            page.url = String(page.url || '').replace(/:\w+|\{\{\w+\}\}/, `{{${name}}}`);
            merged.set(key, page);
            console.log(`  参数页 ${page.title || page.url} → 用 ${name}=${val}（取自 ${seed.url}）`);
            break;
          }
        } catch { /* 换下一个候选 */ }
      }
    }
  }

  // 动态页没拿到种子的，仍然列出来但标记 skip，避免 capture 时打开失败
  const pages = Array.from(merged.values()).map((p) => {
    const stillDyn = /\{\{\w+\}\}/.test(p.url) ? false : isDynamic(p.url);
    return {
      id: slugify(p.title || p.url, usedIds),
      title: p.title || p.url,
      group: p.group || guessGroup(p.url, ''),
      url: p.url,
      wait: 1500,
      actions: [],
      notes: [],
      ...(stillDyn ? { skip: true, _reason: '缺少真实参数值，补齐 url 后删掉 skip' } : {}),
    };
  });

  // 链接里抠出来的编号也作为变量，capture 时回填
  Object.assign(vars, autoVars);

  cdp.close();

  return { pages, dynamic: dyn, vars, menus: raw.menus.length, routes: raw.routes.length, clicked: clicked.length };
}

/** 把发现结果写进配置文件，保留原有 baseUrl / mock / viewport 等设置 */
export function writePages(configPath, cfg, result, { backup = true } = {}) {
  const prev = cfg || {};
  if (backup && fs.existsSync(configPath)) fs.copyFileSync(configPath, configPath + '.bak');
  const out = {
    title: prev.title || '系统名称原型',
    subtitle: prev.subtitle || '',
    baseUrl: prev.baseUrl || 'http://localhost:8080',
    browser: prev.browser || { host: '127.0.0.1', port: 9222, keyword: '' },
    viewport: prev.viewport || { width: 1920, height: 1080 },
    shot: prev.shot || { maxWidth: 1568, maxBytes: 500000 },
    hotspots: prev.hotspots || { includeCandidates: false },
    mock: prev.mock || { enabled: false },
    out: prev.out || { dir: 'work', dist: 'dist' },
    pages: result.pages,
  };
  if (result.vars && Object.keys(result.vars).length) {
    out.vars = Object.fromEntries(Object.entries(result.vars).map(([k, v]) => [k, v]));
  }
  fs.writeFileSync(configPath, JSON.stringify(out, null, 2), 'utf8');
  return out;
}
