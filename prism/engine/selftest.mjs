/* ============================================================
 * 全链路自检 / Selftest
 * 不依赖任何外部素材：自己用纯 Node 编码一张 PNG，
 * 再验证解码、提取、展开、校验、铸造、产物可打开性。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { compile, loadBlueprints, ROOT } from './compiler.mjs';
import { lintBlueprints, checkFoundry } from './linker.mjs';
import { expand } from './expand.mjs';
import { decodePNG, paletteOf, zonesOf, extractImage } from './extract-image.mjs';
import { extractRepo } from './extract-repo.mjs';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
/** 造一张「模拟存量页面截图」：顶栏 + 侧栏 + 若干内容卡片 + 主色按钮 */
function makeScreenshot(w = 1200, h = 760) {
  const px = Buffer.alloc(h * (1 + w * 3));
  const set = (x, y, c) => {
    const i = y * (1 + w * 3) + 1 + x * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };
  const BG = [243, 246, 250], WHITE = [255, 255, 255], BRAND = [31, 111, 235], LINE = [226, 232, 240], TEXT = [22, 32, 46];
  for (let y = 0; y < h; y++) {
    px[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      let c = BG;
      if (y < 56) c = WHITE;
      else if (x < 212) c = WHITE;
      else if (y >= 100 && y <= 170 && x >= 240 && x < w - 40) c = WHITE;
      else if (y >= 200 && y <= 470 && x >= 240 && x < 790) c = WHITE;
      else if (y >= 200 && y <= 470 && x >= 810 && x < w - 40) c = WHITE;
      else if (y >= 500 && y <= 700 && x >= 240 && x < w - 40) c = WHITE;
      if (y < 56 && x >= 240 && x < 400) c = BRAND;
      if ((y === 56 || y === 100 || y === 170 || y === 200 || y === 470 || y === 500 || y === 700) && x >= 212) c = LINE;
      if (y >= 120 && y <= 145 && x >= 260 && x < 370) c = TEXT;
      set(x, y, c);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function selftest(root = ROOT) {
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

  // 1) PNG 自编解码
  const pngPath = path.join(root, 'examples', '参考截图-示例.png');
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, makeScreenshot());
  const img = decodePNG(fs.readFileSync(pngPath));
  ok('PNG 零依赖解码', img.width === 1200 && img.height === 760, `${img.width}×${img.height}`);
  const pal = paletteOf(img), zones = zonesOf(img);
  ok('像素量化色板', pal.length >= 3 && pal[0].hex.startsWith('#'), `主色 ${pal[0].hex}，共 ${pal.length} 色`);
  ok('水平分区检测', zones.zones.length >= 2, `${zones.zones.length} 段`);
  const draftImg = path.join(root, 'foundry', 'charter.image.draft.css');
  extractImage(pngPath, draftImg);
  ok('截图 → 宪章草案', fs.existsSync(draftImg));

  // 2) 代码仓提取
  const repo = path.join(root, 'examples', 'mock-repo');
  const draftRepo = path.join(root, 'foundry', 'charter.repo.draft.css');
  const rr = extractRepo(repo, draftRepo);
  ok('代码仓 → 宪章草案', !!rr && rr.variables > 0, `命中 ${rr ? rr.variables : 0} 个变量`);

  // 3) 批量展开
  const ex = expand(root);
  ok('批量蓝图展开', ex.count >= 10, `${ex.count} 页`);

  // 4) 编译期校验
  const foundry = checkFoundry(root);
  const bps = loadBlueprints(root);
  const lint = lintBlueprints(bps);
  const errs = [...foundry.errors, ...lint.errors];
  ok('样式宪章唯一色值来源', foundry.errors.length === 0, `变量 ${foundry.variableCount} 个`);
  ok('编译期校验零错误', errs.length === 0, errs.slice(0, 2).join(' / '));

  // 5) 铸造
  const r = compile(root);
  ok('铸造成功', r.ok, r.ok ? `${r.pages} 页 / ${r.edges} 条跳转` : r.errors.slice(0, 2).join(' / '));

  // 6) 产物可打开性
  const dist = path.join(root, 'dist');
  ok('门户存在', fs.existsSync(path.join(dist, 'index.html')));
  const pages = fs.readdirSync(path.join(dist, 'pages')).filter(f => f.endsWith('.html'));
  ok('多页面 HTML 集合', pages.length >= 12, `${pages.length} 个文件`);
  const htmlAll = [fs.readFileSync(path.join(dist, 'index.html'), 'utf8'),
    ...pages.map(f => fs.readFileSync(path.join(dist, 'pages', f), 'utf8'))].join('\n');
  ok('file:// 无网络请求', !/fetch\(|XMLHttpRequest|<script[^>]+src=["']https?:/i.test(htmlAll));
  ok('共享同一样式宪章', (htmlAll.match(/href="[^"]*charter\.css"/g) || []).length === pages.length + 1,
    `${(htmlAll.match(/href="[^"]*charter\.css"/g) || []).length} 处引用`);
  ok('点击交互动作串', (htmlAll.match(/data-act=/g) || []).length > 100);
  ok('输入控件', (htmlAll.match(/class="input"|class="select"/g) || []).length > 10);
  ok('状态面板', (htmlAll.match(/class="scene/g) || []).length >= pages.length);
  ok('页面跳转', (htmlAll.match(/navigate:/g) || []).length > 20);
  ok('一致性报告', fs.existsSync(path.join(dist, 'consistency-report.md')));
  ok('批量结构指纹一致', Object.values(r.stats.batchGroups || {}).every(g => g.consistent));

  const failed = results.filter(x => !x.pass);
  console.log('\n=== Prism 全链路自检 ===');
  results.forEach(x => console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? ' · ' + x.detail : ''}`));
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) process.exitCode = 1;
  return { results, failed };
}
