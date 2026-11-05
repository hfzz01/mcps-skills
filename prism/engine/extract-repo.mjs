/* ============================================================
 * 输入通道 A：代码仓探索 / Repo Extractor
 * ------------------------------------------------------------
 * 扫描前端仓的 CSS / SCSS / LESS 变量，产出「样式宪章草案」。
 * 只做静态文本解析，不执行代码、不联网、不调用模型。
 * 草案需要人工确认后合并进 foundry/charter.css —— 这一步是
 * 保证「贴合存量系统」的人为关口，模型不得自行改写宪章。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.workbuddy', 'vendor']);
const EXT = /\.(css|scss|less|sass)$/i;
const ELEMENT_DEFAULT_PRIMARY = '#409eff';

function walk(dir, out, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out, depth + 1);
    else if (EXT.test(e.name)) {
      try { out.push({ file: f, text: fs.readFileSync(f, 'utf8') }); } catch {}
    }
  }
  return out;
}

const PATTERNS = [
  { re: /(\$[\w-]+)\s*:\s*([^;{}]+);/g, kind: 'SCSS' },
  { re: /(@[\w-]+)\s*:\s*([^;{}]+);/g, kind: 'LESS' },
  { re: /(--[\w-]+)\s*:\s*([^;{}]+);/g, kind: 'CSS' },
];

function classify(k, v) {
  const key = k.toLowerCase();
  if (/#[0-9a-f]{3,8}\b|rgb|hsl/i.test(v)) return 'color';
  if (/^[\d.]+px$/.test(v) && /font|fs|size|字号/.test(key)) return 'font';
  if (/^[\d.]+(px|rem)$/.test(v) && /space|sp-|gap|margin|padding|间距|radius|圆角/.test(key)) return 'metric';
  if (/^[\d.]+px$/.test(v) && /radius/.test(key)) return 'metric';
  return 'other';
}

export function extractRepo(src, out) {
  if (!src || !fs.existsSync(src)) {
    console.error(`[repo] 来源不存在：${src}`);
    console.error('  用法：node engine/prism.mjs charter <前端仓目录> --kind=repo');
    process.exitCode = 1;
    return;
  }
  const files = walk(src, []);
  const found = [];
  for (const f of files) {
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(f.text))) {
        const k = m[1], v = m[2].trim();
        if (v.length > 60 || /\$\{|@\{/.test(v)) continue;
        const kind = classify(k, v);
        if (kind === 'other') continue;
        found.push({ name: k, value: v, kind, syntax: p.kind, file: path.relative(src, f.file).replace(/\\/g, '/') });
      }
    }
  }

  // 去重（同名变量保留首次出现）
  const seen = new Set();
  const uniq = found.filter(x => !seen.has(x.name + x.value) && seen.add(x.name + x.value));
  const colors = uniq.filter(x => x.kind === 'color');
  const fonts = uniq.filter(x => x.kind === 'font');
  const metrics = uniq.filter(x => x.kind === 'metric');
  const primary = colors.find(x => /primary|brand|main|主色/i.test(x.name));
  const customized = primary && primary.value.toLowerCase() !== ELEMENT_DEFAULT_PRIMARY;

  const L = [];
  L.push('/* ============================================================');
  L.push(' * 样式宪章草案 / charter.draft.css（由 extract-repo 生成）');
  L.push(` * 来源：${path.resolve(src)}`);
  L.push(` * 扫描文件 ${files.length} 个，命中样式变量 ${uniq.length} 个`);
  L.push(` * 主题判定：${primary ? (customized ? '检测到定制主色 ' + primary.value + '（非 Element 默认 #409EFF）' : '主色与 Element 默认值一致') : '未发现主色变量'}`);
  L.push(' * 注意：本草案必须人工确认后才能合并进 foundry/charter.css。');
  L.push(' *       模型不得改写宪章，只能引用。');
  L.push(' * ============================================================ */');
  L.push('');
  L.push(':root {');
  for (const x of [...colors, ...fonts, ...metrics]) {
    L.push(`  /* ${x.syntax} · ${x.file} · ${x.name} */`);
    L.push(`  --draft-${x.name.replace(/[^A-Za-z0-9-]/g, '')}: ${x.value};`);
  }
  L.push('}');
  L.push('');

  const dest = out ? path.resolve(out) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'foundry', 'charter.draft.css');
  fs.writeFileSync(dest, L.join('\n'), 'utf8');

  console.log(`[repo] 扫描 ${files.length} 个样式文件，命中 ${uniq.length} 个变量`);
  console.log(`  颜色 ${colors.length} · 字号 ${fonts.length} · 间距/形态 ${metrics.length}`);
  console.log(`  主题：${primary ? `主色 ${primary.name}=${primary.value}${customized ? '（定制）' : '（Element 默认）'}` : '未发现主色变量'}`);
  console.log(`  草案：${dest}`);
  console.log('  下一步：人工挑选变量合并进 foundry/charter.css，随后 lint → compile');
  return { files: files.length, variables: uniq.length, dest };
}
