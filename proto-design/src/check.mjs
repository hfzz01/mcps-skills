/**
 * check.mjs — 对 AI 生成的原型页做确定性合规检查。
 * 不依赖模型自觉：error 清零才算通过，退出码 0；否则 1。
 *
 * 检查项：
 *   E1 裸色值：不在 DESIGN.md 令牌表 / 基础色里（附最近令牌替换建议）
 *   E2 间距越阶：margin/padding/gap 的 px 值不在阶梯里
 *   E3 字号越阶：font-size 不在阶梯里
 *   E4 缺骨架标记：没有 `<!-- 骨架: xxx -->`
 *   W1 position:absolute（弹窗遮罩除外，先警告）
 *   W2 圆角越出常用值（2/4/8/16/50%）
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseColor } from './tokens.mjs';

const RADIUS_OK = new Set([0, 2, 4, 8, 16, 100]);

export function checkFile(file, tokens) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (e) {
    return { errors: [`无法读取文件：${e.message}`], warnings: [], stats: {} };
  }
  const errors = [];
  const warnings = [];

  /* 骨架标记（在剥注释前查） */
  const sk = html.match(/骨架\s*[:：]\s*([a-z-]+)/);
  if (!sk) errors.push(`缺骨架标记：页面必须从 layouts/ 骨架起步，文件内保留 <!-- 骨架: list|detail|form|dashboard -->`);

  /* 剥注释（跨行替换为空白、保留换行以维持行号），避免注释里的示例色值/词误报 */
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');

  const whitelist = buildWhitelist(tokens);
  const colorEntries = Object.entries(tokens.colors).map(([n, h]) => ({ name: n, hex: h.toLowerCase(), rgb: parseColor(h).rgb }));

  let inStyle = false;
  lines.forEach((line, i) => {
    const ln = i + 1;
    const low = line.toLowerCase();
    if (low.includes('<style')) inStyle = true;
    if (low.includes('</style')) { inStyle = false; return; }
    /* style="..." 属性 + <style> 块内都算 CSS 上下文 */
    const cssCtx = inStyle || /style\s*=\s*["'][^"']+["']/.test(low);

    /* --- 色值 --- */
    if (cssCtx) {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
        const raw = m[0];
        const c = parseColor(raw);
        if (!c) continue;
        if (raw.toLowerCase().startsWith('#') && whitelist.has(c.hex)) continue;
        if (!raw.startsWith('#') && whitelist.has(c.hex)) continue; /* rgba 变体按基色放行 */
        const near = nearest(c.rgb, colorEntries);
        errors.push(`L${ln} 表外色值 ${raw} → 建议改用 ${near.name}(${near.hex})`);
      }
    }

    /* --- 间距：竖直方向与简写管节奏，严格查；显式 -left/-right 多为表单 label 对齐，降 warning --- */
    for (const m of line.matchAll(/(?:^|[^-\w])(margin|padding|gap)(-(?:top|bottom|left|right|inline|block))?\s*:\s*([^;}"']+)/g)) {
      const horizontalOnly = m[2] === '-left' || m[2] === '-right' || m[2] === '-inline';
      for (const t of m[3].split(/\s+/)) {
        const vm = t.match(/^(-?)(\d+(?:\.\d+)?)(px)?$/);
        if (!vm) continue; /* auto / % / em / rem 放行 */
        const v = Math.round(Math.abs(+vm[2]));
        if (!tokens.spacingLadder.includes(v)) {
          const tip = `L${ln} 间距 ${m[1]}${m[2] || ''}:${t} 不在阶梯（${tokens.spacingLadder.join('/') }）→ 建议改 ${nearestLadder(v, tokens.spacingLadder)}px`;
          if (horizontalOnly) warnings.push(tip + '（若确为表单 label 对齐宽度可忽略）');
          else errors.push(tip);
        }
      }
    }

    /* --- 字号 --- */
    for (const m of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px)?/g)) {
      const v = Math.round(+m[1]);
      if (!tokens.fontLadder.includes(v)) {
        errors.push(`L${ln} 字号 ${v}px 不在阶梯（${tokens.fontLadder.join('/')}）→ 建议改 ${nearestLadder(v, tokens.fontLadder)}px`);
      }
    }

    /* --- 圆角 / 绝对定位 --- */
    for (const m of line.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      const v = Math.round(+m[1]);
      if (!RADIUS_OK.has(v)) warnings.push(`L${ln} 圆角 ${v}px 少见，一般用 4px（输入/按钮）或 8px（卡片）`);
    }
    if (/position\s*:\s*absolute/.test(low) && !/el-dialog|el-overlay|el-popover|el-dropdown|mask|遮罩/.test(low)) {
      warnings.push(`L${ln} 用了 position:absolute —— 栅格布局应该用 el-row/el-col，只有弹窗遮罩类才允许绝对定位`);
    }
  });

  return { errors, warnings, stats: { lines: lines.length } };
}

function buildWhitelist(tokens) {
  const set = new Set();
  for (const hex of Object.values(tokens.colors)) set.add(hex.toLowerCase());
  for (const c of tokens.baseColors) {
    const p = parseColor(c);
    if (p) set.add(p.hex.toLowerCase());
  }
  return set;
}

function nearest(rgb, entries) {
  let best = entries[0], bd = Infinity;
  for (const e of entries) {
    const d = e.rgb.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0);
    if (d < bd) { bd = d; best = e; }
  }
  return { name: best.name, hex: best.hex };
}

function nearestLadder(v, ladder) {
  return ladder.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

/* ---------- 目录批量 ---------- */
export function checkPath(target, tokens) {
  const abs = path.resolve(target);
  const files = [];
  const st = fs.statSync(abs);
  if (st.isFile()) files.push(abs);
  else {
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.html?$/i.test(e.name)) files.push(p);
      }
    };
    walk(abs);
  }
  const results = files.map(f => ({ file: f, ...checkFile(f, tokens) }));
  const errors = results.reduce((s, r) => s + r.errors.length, 0);
  const warnings = results.reduce((s, r) => s + r.warnings.length, 0);
  return { results, errors, warnings };
}
