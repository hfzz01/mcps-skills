/* ============================================================
 * 确定性编译器 / Compiler
 * ------------------------------------------------------------
 * 输入：blueprints/*.json（声明式蓝图，由内网模型产出）
 *       foundry/*（样式宪章 + 组件契约 + 运行时，人工维护）
 * 输出：dist/ 下可直接双击打开的多页面原型集合
 *
 * 关键：编译期把每个场景都预渲染成 DOM 面板，运行时只切换
 * display。页面里没有任何手写脚本、没有任何网络请求，
 * 因此 file:// 协议下可用。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, actAttr, renderBlocks, COMPONENT_NAMES } from '../foundry/contracts.mjs';
import { lintBlueprints, checkFoundry, consistencyReport, sha256 } from './linker.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');

const SCENARIO_LABEL = {
  'existing-optimization': '存量页面功能优化',
  'new-feature': '新增功能',
  batch: '批量新增页面',
  portal: '原型门户',
};

/* ---------------- 蓝图装载 ---------------- */

export function loadBlueprints(root = ROOT) {
  const dir = path.join(root, 'blueprints');
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json') && !e.name.startsWith('_')) {
        try { out.push({ file: path.relative(root, f).replace(/\\/g, '/'), data: JSON.parse(fs.readFileSync(f, 'utf8')) }); }
        catch (err) { throw new Error(`蓝图解析失败 ${f}: ${err.message}`); }
      }
    }
  };
  walk(dir);
  out.sort((a, b) => String(a.data.order || 99) - String(b.data.order || 99) || a.data.id.localeCompare(b.data.id));
  return out;
}

export function loadPortal(root = ROOT) {
  const f = path.join(root, 'blueprints', '_portal.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

/* ---------------- 外壳 ---------------- */

function renderNav(manifest, activeId, base) {
  const groups = new Map();
  for (const p of manifest.pages) {
    if (!p.nav) continue;
    const g = p.group || '其他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  let s = '';
  for (const [g, list] of groups) {
    s += `<div class="nav-group"><div class="nav-group__title">${esc(g)}</div>`;
    for (const p of list) {
      const on = p.id === activeId ? ' is-active' : '';
      const dot = p.scenario === 'new-feature' ? '<span class="nav-item__dot"></span>' : '';
      s += `<div class="nav-item${on}"${actAttr([`navigate:${p.id}`])}>${esc(p.title)}${dot}</div>`;
    }
    s += '</div>';
  }
  return `<nav class="sidebar">${s}</nav>`;
}

function renderHeader(page, base) {
  return `<header class="app-header">
    <div class="brand"${actAttr(['navigate:../index'])} style="cursor:pointer">
      <div class="brand__mark">P</div>
      <div><span class="brand__text">PRISM</span><span class="brand__sub">可交互原型</span></div>
    </div>
    <div class="header-path">${esc(page.group || '')} / ${esc(page.title || '')}</div>
    <div class="header-right">
      <span class="header-chip">${esc(SCENARIO_LABEL[page.scenario] || page.scenario || '')}</span>
      <span>内网原型 · 非生产系统</span><span class="avatar">需</span>
    </div>
  </header>`;
}

function renderBreadcrumb(page) {
  const crumbs = page.breadcrumb || [page.group, page.title].filter(Boolean);
  return `<div class="breadcrumb">${crumbs.map((c, i) =>
    i === crumbs.length - 1 ? `<b>${esc(c)}</b>` : `<span>${esc(c)}</span>`).join('')}</div>`;
}

function renderSceneBar(page) {
  const keys = Object.keys(page.scenes || {});
  if (keys.length < 2) return '';
  const d = page.defaultScene || (page.scenes.default ? 'default' : keys[0]);
  return `<div class="scene-bar"><span class="scene-bar__label">交互状态（点击切换）</span>`
    + keys.map(k => `<button type="button" class="scene-btn${k === d ? ' is-active' : ''}" data-scene-btn="${esc(k)}"${actAttr([`scene:${k}`])}>${esc(page.scenes[k].label || k)}</button>`).join('')
    + `</div>`;
}

function renderScenarioTools(page) {
  if (page.scenario !== 'existing-optimization') return '';
  return `<div class="toolbar" style="border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:var(--sp-4)">
    <div class="toolbar__left">
      <span class="tag tag--warn">存量页面优化</span>
      <span class="toolbar__count">橙色虚线框标出本次变更区域；「新旧对照」场景可并排比较改版前后</span>
    </div>
    <div class="toolbar__right">
      <button type="button" class="btn btn--sm"${actAttr(['diff:on'])}>显示变更标记</button>
      <button type="button" class="btn btn--sm"${actAttr(['diff:off'])}>隐藏变更标记</button>
    </div>
  </div>`;
}

function renderOverlays(page) {
  return (page.overlays || []).map(o => {
    const isDrawer = o.kind === 'drawer';
    const inner = isDrawer
      ? `<div class="drawer"><div class="drawer__head"><span>${esc(o.title)}</span><span class="dialog__close drawer__close" data-overlay-close>×</span></div>
          <div class="drawer__body">${renderBlocks(o.blocks, {})}</div>
          <div class="drawer__foot">${(o.foot || []).map(b => `<button type="button" class="btn${b.tone === 'primary' ? ' btn--primary' : ''}"${actAttr(b.act)}>${esc(b.label)}</button>`).join('')}</div></div>`
      : `<div class="dialog"><div class="dialog__head"><span>${esc(o.title)}</span><span class="dialog__close" data-overlay-close>×</span></div>
          <div class="dialog__body">${renderBlocks(o.blocks, {})}</div>
          <div class="dialog__foot">${(o.foot || []).map(b => `<button type="button" class="btn${b.tone === 'primary' ? ' btn--primary' : ''}"${actAttr(b.act)}>${esc(b.label)}</button>`).join('')}</div></div>`;
    return `<div class="overlay" data-overlay="${esc(o.id)}"><div class="overlay__mask"></div>${inner}</div>`;
  }).join('\n');
}

function htmlDoc(page, bodyHtml, opts) {
  const asset = opts.portal ? 'assets/' : '../assets/';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title || 'Prism')} · 可交互原型</title>
<link rel="stylesheet" href="${asset}charter.css">
<link rel="stylesheet" href="${asset}components.css">
</head>
<body data-base="${esc(opts.portal ? 'pages/' : '')}" data-default-scene="${esc(page.defaultScene || 'default')}"
  data-charter-hash="${esc(opts.charterHash)}" data-page-id="${esc(page.id || 'portal')}" data-scenario="${esc(page.scenario || 'portal')}">
${bodyHtml}
<div class="toast" data-toast></div>
<script src="${asset}runtime.js"></script>
</body>
</html>
`;
}

/* ---------------- 页面 ---------------- */

export function renderPage(page, manifest, opts) {
  const scenes = page.scenes || {};
  const keys = Object.keys(scenes);
  const d = page.defaultScene || (scenes.default ? 'default' : keys[0]);
  const sceneHtml = keys.map(k => `<div class="scene${k === d ? ' is-active' : ''}" data-scene="${esc(k)}">\n`
    + renderBlocks(scenes[k].blocks || [], {})
    + (scenes[k].note ? `<div class="change-note">${esc(scenes[k].note)}</div>` : '')
    + `\n</div>`).join('\n');

  const foot = `<div class="footnote">
    页面 <b>${esc(page.id)}</b> · ${esc(SCENARIO_LABEL[page.scenario] || page.scenario || '')} ·
    状态 ${keys.length} 个 · 样式宪章 <code>${esc(opts.charterHash)}</code><br>
    需求来源：${esc(page.source?.requirement || '—')} ｜ 一致性基线：${esc(page.source?.baseline || '样式宪章 + 组件契约')}<br>
    ${esc(page.summary || '')}
  </div>`;

  const body = `<div class="app">
${renderHeader(page, '')}
<div class="app-body">
${renderNav(manifest, page.id, '')}
<main class="main"><div class="page">
${renderBreadcrumb(page)}
${renderScenarioTools(page)}
${renderSceneBar(page)}
${sceneHtml}
${foot}
</div></main>
</div>
</div>
${renderOverlays(page)}`;
  return htmlDoc(page, body, opts);
}

/* ---------------- 门户 ---------------- */

export function renderPortal(portal, manifest, opts) {
  const cards = (portal.sections || []).map(sec => {
    const first = sec.pages && sec.pages[0];
    const act = first ? actAttr([`navigate:${first}`]) : '';
    return `<div class="pcard"${act}>
      <div class="pcard__tag">${esc(sec.tag || '')}</div>
      <div class="pcard__title">${esc(sec.title || '')}</div>
      <div class="pcard__desc">${esc(sec.desc || '')}</div>
      <div class="pcard__foot">${esc(sec.foot || '')}${first ? '　→ 点击进入' : ''}</div>
    </div>`;
  }).join('\n');

  const links = manifest.pages.map(p =>
    `<div class="page-link"${actAttr([`navigate:${p.id}`])}><span>${esc(p.title)}</span><span>${esc(p.sceneCount)} 态</span></div>`).join('\n');

  const body = `<div class="portal">
  <div class="portal__hero">
    <h1 class="portal__title">${esc(portal.title || 'Prism 原型集合')}</h1>
    <p class="portal__lead">${esc(portal.lead || '')}</p>
    <div class="portal__meta">${(portal.meta || []).map(m => `<span class="tag tag--brand">${esc(m)}</span>`).join('')}</div>
  </div>
  <div class="portal__section">
    <h2 class="portal__section-title">三类需求场景</h2>
    <p class="portal__section-desc">每类场景都有真实可操作的页面：点击、输入、状态切换、页面跳转全部可用。点卡片进入对应原型。</p>
    <div class="card-grid">${cards}</div>
  </div>
  <div class="portal__section">
    <h2 class="portal__section-title">全部页面（${manifest.pages.length}）</h2>
    <p class="portal__section-desc">批量生成的页面共用同一套结构指纹，仅数据不同；视觉与交互完全一致。</p>
    <div class="page-list">${links}</div>
  </div>
  <div class="portal__section">
    <h2 class="portal__section-title">方案要点</h2>
    <div class="panel"><div class="panel__body">
      ${(portal.points || []).map((p, i) => `<div class="change-note">${i + 1}. <b>${esc(p.title)}</b>　${esc(p.text)}</div>`).join('')}
    </div></div>
  </div>
  <div class="footnote">
    样式宪章 <code>${esc(opts.charterHash)}</code> · 组件契约 <code>${esc(opts.contractHash)}</code> · 契约组件 ${COMPONENT_NAMES.length} 个<br>
    本目录为纯静态文件，无网络请求、无后端、无外部依赖，可直接双击打开或整目录拷贝分发。
  </div>
</div>`;
  return htmlDoc({ id: 'portal', title: portal.title, scenario: 'portal' }, body, { ...opts, portal: true });
}

/* ---------------- 编译入口 ---------------- */

export function compile(root = ROOT, opts = {}) {
  const dist = opts.dist || path.join(root, 'dist');
  const blueprints = loadBlueprints(root);
  const portal = loadPortal(root);
  if (!blueprints.length) throw new Error('blueprints/ 下没有蓝图');

  const foundry = checkFoundry(root);
  const lint = lintBlueprints(blueprints);
  if (foundry.errors.length) lint.errors.unshift(...foundry.errors.map(e => `[单一事实源] ${e}`));
  lint.warnings.unshift(...foundry.warnings.map(w => `[单一事实源] ${w}`));

  if (lint.errors.length) {
    return { ok: false, errors: lint.errors, warnings: lint.warnings, stats: lint.stats };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    charterHash: foundry.charterHash,
    contractHash: foundry.contractHash,
    componentCount: COMPONENT_NAMES.length,
    pages: [],
    edges: [],
    stats: lint.stats,
  };
  for (const { data: p } of blueprints) {
    manifest.pages.push({
      id: p.id, title: p.title, group: p.group || '其他', scenario: p.scenario,
      nav: p.nav !== false, sceneCount: Object.keys(p.scenes || {}).length,
      scenes: Object.keys(p.scenes || {}), fingerprint: (lint.stats.fingerprints[p.id] || '').slice(0, 12),
      file: `pages/${p.id}.html`, order: p.order || 99,
    });
    for (const t of new Set(p._navTargets || [])) {
      if (t === '../index' || t === 'index') continue;
      manifest.edges.push({ from: p.id, to: t });
    }
  }

  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  for (const f of ['charter.css', 'components.css', 'runtime.js']) {
    fs.copyFileSync(path.join(root, 'foundry', f), path.join(dist, 'assets', f));
  }

  const ctx = { charterHash: foundry.charterHash, contractHash: foundry.contractHash };
  for (const { data: p } of blueprints) {
    fs.writeFileSync(path.join(dist, 'pages', `${p.id}.html`), renderPage(p, manifest, ctx), 'utf8');
  }
  if (portal) fs.writeFileSync(path.join(dist, 'index.html'), renderPortal(portal, manifest, ctx), 'utf8');

  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dist, 'consistency-report.md'), consistencyReport(lint, foundry, manifest), 'utf8');

  return {
    ok: true, errors: [], warnings: lint.warnings, stats: lint.stats,
    dist, pages: manifest.pages.length, edges: manifest.edges.length,
    charterHash: foundry.charterHash, report: path.join(dist, 'consistency-report.md'),
  };
}
