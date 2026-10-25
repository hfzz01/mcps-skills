/**
 * tokens.mjs — 从存量前端仓提取设计令牌，产出 DESIGN.md（给人/agent 看）+ tokens.json（给 check 用）。
 *
 * 扫描优先级：
 *   1. 仓库样式目录里的 SCSS / LESS / CSS 变量（定制主题的指纹在这）
 *   2. 兜底：Element UI / Element Plus 官方默认值，并在 DESIGN.md 明确标注
 *
 * 零依赖，Node 20+。
 */
import fs from 'node:fs';
import path from 'node:path';

/* ---------- Element 官方默认值（兜底用） ---------- */
export const ELEMENT_DEFAULTS = {
  colors: {
    primary: '#409EFF', success: '#67C23A', warning: '#E6A23C',
    danger: '#F56C6C', info: '#909399',
    'text-primary': '#303133', 'text-regular': '#606266',
    'text-secondary': '#909399', 'text-placeholder': '#C0C4CC',
    border: '#DCDFE6', 'border-light': '#E4E7ED', 'border-lighter': '#EBEEF5',
    fill: '#F0F2F5', 'fill-light': '#F5F7FA',
  },
  baseFontSize: 14,
};

/** 基础中性色：任何页面都允许直接用，不进令牌表 */
export const BASE_COLORS = ['#ffffff', '#000000', 'transparent', 'currentColor'];

/** 间距阶梯与字号阶梯（规范值，写死；DESIGN.md 里同步展示） */
export const SPACING_LADDER = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48];
export const FONT_LADDER = [12, 13, 14, 16, 18, 20, 24];

/* ---------- 色值解析 ---------- */
export function parseColor(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length === 6) return { hex: '#' + h, rgb: hexToRgb('#' + h) };
    if (h.length === 8) return { hex: '#' + h.slice(0, 6), rgb: hexToRgb('#' + h.slice(0, 6)), alpha: parseInt(h.slice(6), 16) / 255 };
    return null;
  }
  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3];
    return { hex: rgbToHex(r, g, b), rgb: [r, g, b], alpha: m[4] != null ? +m[4] : 1 };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2], +m[3]);
    return { hex: rgbToHex(r, g, b), rgb: [r, g, b], alpha: m[4] != null ? +m[4] : 1 };
  }
  return null;
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('');
}
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/* ---------- 变量名语义化 ---------- */
function semanticName(raw) {
  return raw
    .replace(/^\$+/, '').replace(/^@/, '').replace(/^--/, '')
    .replace(/^el-color-/, '').replace(/^el-/, '').replace(/^color-/, '').replace(/^c-/, '')
    .replace(/^theme-/, '')
    .toLowerCase() || null;
}

/* ---------- 仓库样式文件收集 ---------- */
const STYLE_EXT = /\.(scss|less|css)$/i;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'public', 'static', 'coverage', '.idea', '.vscode']);

function collectStyleFiles(root, limit = 80) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6 || found.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1);
      } else if (e.isFile() && STYLE_EXT.test(e.name) && e.name !== 'index.css') {
        try { if (fs.statSync(p).size <= 300 * 1024) found.push(p); } catch { /* 忽略 */ }
      }
    }
  };
  walk(root, 0);
  return found;
}

/* ---------- 变量提取 ---------- */
const RE_SCSS = /\$([a-zA-Z][\w-]*)\s*:\s*([^;{}]+);/g;
const RE_LESS = /@([a-zA-Z][\w-]*)\s*:\s*([^;{}]+);/g;
const RE_CSSVAR = /(--[\w-]+)\s*:\s*([^;{}]+);/g;

function extractVars(file, bucket) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const add = (raw, value, kind) => {
    const name = semanticName(raw);
    if (!name || name.length > 40) return;
    if (/^font-family|import|media|include|extend|mixin|use|function/.test(name)) return;
    if (!bucket[kind].has(name)) bucket[kind].set(name, { value: value.trim(), from: file });
  };
  for (const [, n, v] of text.matchAll(RE_SCSS)) add(n, v, parseColor(v) ? 'colors' : guessKind(n, v));
  for (const [, n, v] of text.matchAll(RE_LESS)) if (!/^media|^import|^keyframes|^font-face/.test(n)) add(n, v, parseColor(v) ? 'colors' : guessKind(n, v));
  for (const [, n, v] of text.matchAll(RE_CSSVAR)) add(n, v, parseColor(v) ? 'colors' : guessKind(n, v));
}

function guessKind(name, value) {
  const n = name.toLowerCase();
  if (/radius|rounded/.test(n)) return 'radii';
  if (/font|text-size|size-(xs|sm|base|lg|xl)/.test(n) && /px|rem|em/.test(value)) return 'fonts';
  if (/space|gap|padding|margin/.test(n) && /px|rem|em/.test(value)) return 'spacings';
  return 'other';
}

/* ---------- 主流程 ---------- */
export function extractTokens(repoPath, opts = {}) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root)) throw new Error(`目录不存在：${root}`);
  const files = collectStyleFiles(root);
  const bucket = { colors: new Map(), fonts: new Map(), radii: new Map(), spacings: new Map(), other: new Map() };
  for (const f of files) extractVars(f, bucket);

  /* 颜色：只保留能解析成色值的，归一 hex；同名冲突时保留先出现的（collectStyleFiles 按目录序，src 内优先） */
  const colors = {};
  const colorSources = {};
  for (const [name, { value, from }] of bucket.colors) {
    const c = parseColor(value);
    if (!c || !name) continue;
    if (name.length > 24) continue;
    if (colors[name] && colors[name].toLowerCase() !== c.hex) continue;
    colors[name] = c.hex;
    colorSources[name] = { value: value.trim(), from: path.relative(root, from).replaceAll('\\', '/') };
  }

  /* 核心令牌缺失时用 Element 默认兜底，并记录哪些是兜底 */
  const fallbackUsed = [];
  for (const [name, hex] of Object.entries(ELEMENT_DEFAULTS.colors)) {
    if (!colors[name]) {
      colors[name] = hex;
      colorSources[name] = { value: hex, from: '（未检测到定制，取 Element 默认）' };
      fallbackUsed.push(name);
    }
  }

  /* 字号基础值 */
  let baseFontSize = ELEMENT_DEFAULTS.baseFontSize;
  const fontRaw = bucket.fonts.get('font-size-base') || bucket.fonts.get('font-base') || bucket.fonts.get('font-size');
  if (fontRaw) {
    const m = fontRaw.value.match(/(\d+(?:\.\d+)?)px/);
    if (m) baseFontSize = +m[1];
  }

  /* 圆角 */
  const radii = {};
  for (const [name, { value }] of bucket.radii) {
    const m = value.match(/(\d+(?:\.\d+)?)px/);
    if (m && Object.keys(radii).length < 8) radii[name] = +m[1];
  }

  return {
    meta: {
      repo: root.replaceAll('\\', '/'),
      scannedFiles: files.length,
      generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
      customThemeDetected: fallbackUsed.length < Object.keys(ELEMENT_DEFAULTS.colors).length,
      baseFontSize,
    },
    colors, colorSources, radii,
    baseColors: BASE_COLORS,
    spacingLadder: SPACING_LADDER,
    fontLadder: FONT_LADDER,
  };
}

/* ---------- DESIGN.md 渲染 ---------- */
export function renderDesignMd(tokens) {
  const t = tokens;
  const lines = [];
  const src = t.meta.customThemeDetected
    ? `**检测到定制主题**，以下令牌提取自仓库样式变量（扫描 ${t.meta.scannedFiles} 个样式文件）。`
    : `**未检测到定制主题**，以下为 Element 官方默认值（扫描了 ${t.meta.scannedFiles} 个样式文件，没有命中令牌变量）。如果系统实际定制过主题，请把正确的变量文件路径告诉生成工具。`;

  lines.push(`# 设计令牌`);
  lines.push('');
  lines.push(`> 仓库：\`${t.meta.repo}\`　生成：${t.meta.generatedAt}　工具：proto-design tokens`);
  lines.push(`> ${src}`);
  lines.push('');
  lines.push(`## 颜色令牌`);
  lines.push('');
  lines.push('**规则：页面中出现的每一个色值都必须来自下表或基础色。出现表外色值 = error。**');
  lines.push('');
  lines.push('| 令牌 | 值 | 来源 |');
  lines.push('|---|---|---|');
  for (const [name, hex] of Object.entries(t.colors)) {
    const cs = t.colorSources[name] || {};
    lines.push(`| ${name} | \`${hex}\` | ${cs.from || ''} |`);
  }
  lines.push('');
  lines.push(`基础色（可直接用，不必声明）：${t.baseColors.map(c => '`' + c + '`').join('、')}，以及上表任意色值的 rgba 半透明变体。`);
  lines.push('');
  lines.push(`## 字号阶梯`);
  lines.push('');
  lines.push(`只允许：${t.fontLadder.join(' / ')} px。主字号 **${t.meta.baseFontSize}px**（表格、表单、正文默认）。`);
  lines.push('');
  lines.push(`## 间距阶梯`);
  lines.push('');
  lines.push(`margin / padding / gap 只允许：${t.spacingLadder.join(' / ')} px。`);
  lines.push('');
  lines.push(`## 圆角`);
  lines.push('');
  if (Object.keys(t.radii).length) {
    lines.push(Object.entries(t.radii).map(([n, v]) => `${n}=${v}px`).join('，') + '（其余组件用 4px 或 8px）');
  } else {
    lines.push('未提取到定制圆角，统一用 Element 默认：输入/按钮 4px，卡片 8px，弹窗 16px。');
  }
  lines.push('');
  lines.push(`## 布局规范`);
  lines.push('');
  lines.push('- 栅格用 `el-row` / `el-col`，一行 24 栏；禁止 `position:absolute` 定位（弹窗遮罩除外）。');
  lines.push('- 页面必须从 `layouts/` 的骨架起步（文件内保留 `<!-- 骨架: xxx -->` 标记），禁止空白文件起手。');
  lines.push('- 组件直接用 Element class（`el-button` / `el-table` / `el-form` …），主题 CSS 由原型站注入，不要自己重写组件样式。');
  return lines.join('\n') + '\n';
}
