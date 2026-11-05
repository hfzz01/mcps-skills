/* ============================================================
 * 输入通道 B：原页面 / 参考页面截图 / Image Extractor
 * ------------------------------------------------------------
 * 硬约束：清单内没有视觉模型，也不允许引入清单外模型。
 * 因此截图绝不交给模型「看图」，只做确定性像素计算：
 *   1. 零依赖解码 PNG（zlib.inflateSync + 逐行反滤波）
 *   2. 颜色量化统计 → 主色板
 *   3. 逐行背景占比 → 水平分区边界
 * 产出「样式宪章草案」，语义信息仍由需求文档与人工补充。
 * 支持 8bit 非隔行 PNG：RGB / RGBA / 灰 / 灰+α / 调色板。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePNG(buf) {
  if (!buf.slice(0, 8).equals(SIG)) throw new Error('不是 PNG 文件（截图请先转 PNG）');
  let off = 8, w = 0, h = 0, depth = 0, ctype = -1, interlace = 0;
  let palette = [];
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') {
      for (let i = 0; i + 2 < data.length; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!w || !h) throw new Error('PNG 缺少 IHDR');
  if (depth !== 8) throw new Error(`仅支持 8bit PNG，当前 ${depth}bit`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG，请另存为非隔行');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`不支持的 colorType ${ctype}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) pred = paeth(a, b, c);
      else if (filter !== 0) throw new Error(`未知 filter ${filter}`);
      out[y * stride + x] = (line[x] + pred) & 255;
    }
  }

  const rgb = (x, y) => {
    const i = y * stride + x * channels;
    if (ctype === 3) { const q = palette[out[i]] || [0, 0, 0]; return q; }
    if (ctype === 0 || ctype === 4) { const v = out[i]; return [v, v, v]; }
    let r = out[i], g = out[i + 1], b = out[i + 2];
    if (ctype === 6) {
      const al = out[i + 3] / 255;
      r = Math.round(r * al + 255 * (1 - al));
      g = Math.round(g * al + 255 * (1 - al));
      b = Math.round(b * al + 255 * (1 - al));
    }
    return [r, g, b];
  };
  return { width: w, height: h, colorType: ctype, rgb };
}

function hex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** 采样量化 → 主色板（按 32 级/通道归并） */
export function paletteOf(img, step = 2) {
  const counts = new Map();
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const [r, g, b] = img.rgb(x, y);
      const k = `${r >> 3},${g >> 3},${b >> 3}`;
      const e = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      counts.set(k, e);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 16)
    .map(e => ({ hex: hex(Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)), count: e.n }));
}

/** 逐行非背景占比 → 水平分区（用于对齐区块高度） */
export function zonesOf(img, step = 2) {
  const top = paletteOf(img, 4)[0];
  const tr = parseInt(top.hex.slice(1, 3), 16), tg = parseInt(top.hex.slice(3, 5), 16), tb = parseInt(top.hex.slice(5, 7), 16);
  const ratios = [];
  for (let y = 0; y < img.height; y += step) {
    let diff = 0, n = 0;
    for (let x = 0; x < img.width; x += step * 2) {
      const [r, g, b] = img.rgb(x, y);
      if (Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb) > 60) diff++;
      n++;
    }
    ratios.push({ y, ratio: n ? diff / n : 0 });
  }
  const zones = [];
  let start = null;
  const TH = 0.06;
  for (const r of ratios) {
    if (r.ratio > TH && start === null) start = r.y;
    if (r.ratio <= TH && start !== null) {
      if (r.y - start >= 8) zones.push({ top: start, height: r.y - start });
      start = null;
    }
  }
  if (start !== null && img.height - start >= 8) zones.push({ top: start, height: img.height - start });
  return { background: top.hex, zones: zones.slice(0, 12) };
}

export function extractImage(src, out) {
  if (!src || !fs.existsSync(src)) {
    console.error(`[image] 截图不存在：${src}`);
    console.error('  用法：node engine/prism.mjs charter <截图.png> --kind=image');
    process.exitCode = 1;
    return;
  }
  let img;
  try { img = decodePNG(fs.readFileSync(src)); }
  catch (e) { console.error(`[image] 解码失败：${e.message}`); process.exitCode = 1; return; }

  const pal = paletteOf(img);
  const z = zonesOf(img);
  const L = [];
  L.push('/* ============================================================');
  L.push(' * 样式宪章草案 / charter.draft.css（由 extract-image 生成）');
  L.push(` * 来源截图：${path.resolve(src)}`);
  L.push(` * 尺寸 ${img.width}×${img.height}，colorType ${img.colorType}`);
  L.push(' * 说明：本文件只含确定性像素统计，不含任何语义识别结果。');
  L.push(' *       页面语义、组件名称、字段规则请由需求文档与人工补充。');
  L.push(' *       草案必须人工确认后合并进 foundry/charter.css。');
  L.push(' * ============================================================ */');
  L.push('');
  L.push(':root {');
  L.push(`  /* 背景主色（出现频次最高） */`);
  L.push(`  --draft-bg: ${z.background};`);
  pal.slice(0, 10).forEach((c, i) => L.push(`  /* 色板 ${i + 1}：采样命中 ${c.count} 次 */\n  --draft-swatch-${i + 1}: ${c.hex};`));
  z.zones.forEach((v, i) => L.push(`  /* 水平分区 ${i + 1}：y=${v.top}，高=${v.height} */\n  --draft-zone-${i + 1}-top: ${v.top}px;\n  --draft-zone-${i + 1}-height: ${v.height}px;`));
  L.push('}');
  L.push('');
  const dest = out ? path.resolve(out) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'foundry', 'charter.draft.css');
  fs.writeFileSync(dest, L.join('\n'), 'utf8');

  console.log(`[image] ${img.width}×${img.height} 解码成功，采样色板 ${pal.length} 色`);
  console.log(`  背景主色 ${z.background}；前 5 色 ${pal.slice(0, 5).map(c => c.hex).join(' ')}`);
  console.log(`  水平分区 ${z.zones.length} 段：${z.zones.slice(0, 5).map(v => `y${v.top}/h${v.height}`).join(' ')}`);
  console.log(`  草案：${dest}`);
  console.log('  注意：截图未被任何模型识别；颜色仅作宪章校准参考，语义以需求文档为准。');
  return { width: img.width, height: img.height, palette: pal, zones: z.zones, dest };
}
