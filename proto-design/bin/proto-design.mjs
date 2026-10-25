#!/usr/bin/env node
/**
 * proto-design — 原型页设计规范工具（零第三方依赖，Node 20+）
 *
 *   tokens <前端仓路径>   提取设计令牌 → DESIGN.md + tokens.json
 *   check  <html|目录>    对 AI 生成的原型页做合规检查（error 清零才算过）
 *   new    <页面名>       从 layouts/ 骨架复制一个页面起手
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTokens, renderDesignMd, ELEMENT_DEFAULTS, BASE_COLORS, SPACING_LADDER, FONT_LADDER } from '../src/tokens.mjs';
import { checkPath } from '../src/check.mjs';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELP = [
  'proto-design — 原型页设计规范工具',
  '',
  '命令：',
  '  tokens <前端仓路径> [--out=DESIGN.md] [--json=tokens.json]',
  '      扫描仓库样式变量提取设计令牌。有定制主题就提定制的；没有就退到',
  '      Element 默认值并在 DESIGN.md 里标注。DESIGN.md 给人和 agent 看，',
  '      tokens.json 给 check 用。两个文件都写到 --out/--json 指定的路径。',
  '',
  '  check <html文件或目录> [--tokens=tokens.json]',
  '      合规检查：表外色值 / 间距越阶 / 字号越阶 / 缺骨架标记。',
  '      error 清零退出码 0；有 error 退出码 1，必须改到清零。',
  '      找不到 tokens.json 时用 Element 默认令牌兜底。',
  '',
  '  new <页面名> [--from=list|detail|form|dashboard]',
  '      从 layouts/ 骨架复制一个起手页到当前目录（保留骨架标记）。',
  '',
  '标准流程：tokens → new → （agent 扩写页面）→ check → 改到 error 清零',
].join('\n');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const rest = [];
for (const a of argv.slice(1)) {
  const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  else rest.push(a);
}

try {
  switch (cmd) {
    case 'tokens': cmdTokens(); break;
    case 'check': cmdCheck(); break;
    case 'new': cmdNew(); break;
    case 'help': case '--help': case '-h': case undefined: console.log(HELP); break;
    default: console.error(`未知命令：${cmd}\n\n${HELP}`); process.exit(2);
  }
} catch (e) {
  console.error(`错误：${e.message}`);
  process.exit(2);
}

/* ---------- tokens ---------- */
function cmdTokens() {
  const repo = rest[0];
  if (!repo) { console.error('用法：tokens <前端仓路径>\n例：tokens D:/code/ioc-web'); process.exit(2); }
  const out = flags.out || 'DESIGN.md';
  const json = flags.json || 'tokens.json';

  const tokens = extractTokens(repo);
  fs.writeFileSync(out, renderDesignMd(tokens), 'utf8');
  fs.writeFileSync(json, JSON.stringify(tokens, null, 2), 'utf8');

  const n = Object.keys(tokens.colors).length;
  console.log(`已生成 ${path.resolve(out)} 与 ${path.resolve(json)}`);
  console.log(`  令牌：${n} 个颜色，来源${tokens.meta.customThemeDetected ? '：检测到定制主题 ✓' : '：Element 默认（未检测到定制）'}`);
  console.log(`  阶梯：字号 ${tokens.fontLadder.join('/')}，间距 ${tokens.spacingLadder.join('/')}`);
  console.log('下一步：让 agent 按 DESIGN.md + layouts/ 写页面，写完必须跑 check。');
}

/* ---------- check ---------- */
function cmdCheck() {
  const target = rest[0];
  if (!target) { console.error('用法：check <html文件或目录>'); process.exit(2); }
  if (!fs.existsSync(target)) { console.error(`路径不存在：${target}`); process.exit(2); }

  let tokens;
  const tokPath = flags.tokens || 'tokens.json';
  if (fs.existsSync(tokPath)) {
    tokens = JSON.parse(fs.readFileSync(tokPath, 'utf8'));
  } else {
    tokens = {
      meta: { customThemeDetected: false, baseFontSize: ELEMENT_DEFAULTS.baseFontSize },
      colors: { ...ELEMENT_DEFAULTS.colors },
      baseColors: BASE_COLORS,
      spacingLadder: SPACING_LADDER,
      fontLadder: FONT_LADDER,
      radii: {},
    };
    console.log(`（未找到 ${tokPath}，用 Element 默认令牌兜底。建议先跑：node bin/proto-design.mjs tokens <前端仓路径>）\n`);
  }

  const r = checkPath(target, tokens);
  for (const item of r.results) {
    const label = r.results.length > 1 ? path.relative('.', item.file) : target;
    for (const e of item.errors) console.log(`[error]   ${label} ${e}`);
    for (const w of item.warnings) console.log(`[warning] ${label} ${w}`);
  }
  const header = r.results.length > 1 ? `共 ${r.results.length} 个文件，` : '';
  console.log(`\n${header}error ${r.errors} 个，warning ${r.warnings} 个。`);
  if (r.errors > 0) {
    console.log('有 error 不算完成。按建议逐条改正后重新跑 check，直到 error 清零。');
    process.exit(1);
  }
  console.log('✓ 通过。warning 可酌情处理，不阻塞交付。');
}

/* ---------- new ---------- */
function cmdNew() {
  const name = rest[0];
  if (!name || !/^[\w-]+$/.test(name)) { console.error('用法：new <页面名>（英文短名，如 evt-list）'); process.exit(2); }
  const from = flags.from || 'list';
  const tpl = path.join(HERE, 'layouts', `${from}.html`);
  if (!fs.existsSync(tpl)) {
    console.error(`骨架不存在：layouts/${from}.html（可选：list / detail / form / dashboard）`);
    process.exit(2);
  }
  const dest = path.resolve(`${name}.html`);
  if (fs.existsSync(dest) && !flags.force) {
    console.error(`已存在 ${dest}，不覆盖。换个名字或加 --force。`);
    process.exit(2);
  }
  fs.copyFileSync(tpl, dest);
  console.log(`已从 ${from} 骨架生成 ${dest}`);
  console.log('下一步：往替换区填字段和内容，保留骨架标记注释，写完跑 check。');
}
