/* ============================================================
 * Prism CLI —— 内网零依赖命令行入口
 *   node engine/prism.mjs doctor     ← 内网第一条命令
 *   node engine/prism.mjs run        ← 日常只敲这一条
 *   node engine/prism.mjs help
 *   node engine/prism.mjs charter <来源> --kind=repo|image|dom
 *   node engine/prism.mjs expand
 *   node engine/prism.mjs lint
 *   node engine/prism.mjs compile
 *   node engine/prism.mjs selftest
 * 不安装任何 npm 包，不发起任何网络请求（dom 模式只连本机 CDP）。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './linker.mjs';
import { loadBlueprints, compile } from './compiler.mjs';
import { lintBlueprints, checkFoundry } from './linker.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const pos = args.slice(1).filter(a => !a.startsWith('--'));
const flags = {};
for (const a of args.slice(1)) {
  if (!a.startsWith('--')) continue;
  const [k, v] = a.slice(2).split('=');
  flags[k] = v === undefined ? true : v;
}
const ROOTDIR = flags.root ? path.resolve(flags.root) : ROOT;

function help() {
  console.log([
    'Prism · 规格驱动的可交互 HTML 原型铸造台（内网 / 零依赖）',
    '',
    '第一条命令：',
    '  doctor                        环境体检 + 告诉你下一步敲什么（不改文件、不联网）',
    '  run                           展开 + 校验 + 铸造，日常只敲这一条',
    '',
    '命令：',
    '  help                          显示本说明',
    '  charter <来源> --kind=repo    从代码仓 CSS/SCSS 变量提取样式宪章草案',
    '  charter <来源> --kind=image   从原页面截图提取色板与分区草案（纯 Node 解码 PNG）',
    '  charter --kind=dom            从受控浏览器已登录页面读 computed style 提取草案',
    '  expand                        把 examples/batch-matrix.json 展开成批量蓝图',
    '  lint                          只做编译期校验，不产出文件',
    '  compile                      校验 + 铸造 dist/ 多页面原型集合',
    '  selftest                      全链路自检（含 PNG 编解码自测）',
    '  verify-browser                真实 Chrome 里打开 file:// 产物并实际点击验收',
    '',
    '常用参数：',
    '  --root=<dir>     指定 Prism 根目录（默认脚本所在目录）',
    '  --out=<file>     草案输出路径',
    '  --port=<n>       dom 模式默认 9222；verify-browser 默认 9223',
    '  --dist=<dir>     compile 的输出目录',
    '',
    '首次落地：doctor → 双击 dist/index.html 看成品 → 按 docs/00-内网落地手册.md 让 codeagent 写蓝图',
    '日常迭代：改 blueprints/*.json 或 examples/batch-matrix.json → node engine/prism.mjs run',
    '产出：dist/index.html（门户）+ dist/pages/*.html（每个页面独立可打开）',
  ].join('\n'));
}

function cmdLint() {
  const bps = loadBlueprints(ROOTDIR);
  const foundry = checkFoundry(ROOTDIR);
  const lint = lintBlueprints(bps);
  console.log(`蓝图 ${bps.length} 份，样式宪章哈希 ${foundry.charterHash}，契约组件 ${foundry.contractHash}`);
  console.log(`error ${lint.errors.length} · warning ${lint.warnings.length}`);
  lint.errors.forEach(e => console.log(`  [错误] ${e}`));
  lint.warnings.forEach(w => console.log(`  [警告] ${w}`));
  if (lint.errors.length) { console.log('结论：校验未通过，不允许铸造。'); process.exitCode = 1; }
  else console.log('结论：编译期校验通过，可以执行 compile。');
}

async function cmdCharter() {
  const kind = flags.kind || 'repo';
  if (kind === 'repo') {
    const { extractRepo } = await import('./extract-repo.mjs');
    extractRepo(pos[0] || path.join(ROOTDIR, 'examples', 'mock-repo'), flags.out);
  } else if (kind === 'image') {
    const { extractImage } = await import('./extract-image.mjs');
    extractImage(pos[0], flags.out);
  } else if (kind === 'dom') {
    const { extractDom } = await import('./extract-dom.mjs');
    await extractDom({ port: Number(flags.port) || 9222, out: flags.out });
  } else {
    console.error(`未知 --kind=${kind}，可用 repo / image / dom`);
    process.exitCode = 1;
  }
}

async function main() {
  switch (cmd) {
    case 'help': help(); break;
    case 'doctor': {
      const { doctor } = await import('./doctor.mjs');
      doctor(ROOTDIR);
      break;
    }
    case 'run': {
      const { expand } = await import('./expand.mjs');
      const ex = expand(ROOTDIR);
      console.log(`[1/3] 批量展开 ${ex.count} 份蓝图 → ${ex.dir}`);
      const r = compile(ROOTDIR, { dist: flags.dist ? path.resolve(flags.dist) : undefined });
      if (!r.ok) {
        console.error(`[2/3] 编译期校验未通过：${r.errors.length} 个错误`);
        r.errors.forEach(e => console.error(`  [错误] ${e}`));
        console.error('  按 docs/00-内网落地手册.md 的「一页纸故障表」改蓝图，再跑一次 run。');
        process.exitCode = 1;
        break;
      }
      console.log(`[2/3] 校验通过（error 0）`);
      console.log(`[3/3] 铸造完成：${r.pages} 页 / ${r.edges} 条跳转 / ${r.stats.scenes} 个状态`);
      console.log(`  双击打开：${path.join(r.dist, 'index.html')}`);
      console.log(`  发给别人：把 ${r.dist} 整个目录压缩发过去（不要只发 index.html）`);
      r.warnings.forEach(w => console.log(`  [警告] ${w}`));
      break;
    }
    case 'lint': cmdLint(); break;
    case 'compile': {
      const r = compile(ROOTDIR, { dist: flags.dist ? path.resolve(flags.dist) : undefined });
      if (!r.ok) {
        console.error(`铸造中止：${r.errors.length} 个编译期错误`);
        r.errors.forEach(e => console.error(`  [错误] ${e}`));
        process.exitCode = 1;
        break;
      }
      console.log(`铸造完成：${r.pages} 个页面，${r.edges} 条跳转边`);
      console.log(`  目录：${r.dist}`);
      console.log(`  门户：${path.join(r.dist, 'index.html')}`);
      console.log(`  一致性报告：${r.report}`);
      console.log(`  样式宪章哈希：${r.charterHash}（所有页面共用）`);
      console.log(`  状态面板 ${r.stats.scenes} · 区块 ${r.stats.blocks} · 输入控件 ${r.stats.inputs} · 动作 ${r.stats.actions}`);
      for (const [g, v] of Object.entries(r.stats.batchGroups || {})) {
        console.log(`  批量组 ${g}：${v.pages} 页，结构指纹 ${v.fingerprint} ${v.consistent ? '完全一致' : '不一致'}`);
      }
      r.warnings.forEach(w => console.log(`  [警告] ${w}`));
      break;
    }
    case 'expand': {
      const { expand } = await import('./expand.mjs');
      const r = expand(ROOTDIR);
      console.log(`批量展开：${r.count} 份蓝图写入 ${r.dir}`);
      console.log(`  模板 ${r.template} · 矩阵 ${r.matrix} · 结构指纹保证一致`);
      break;
    }
    case 'charter': await cmdCharter(); break;
    case 'selftest': {
      const { selftest } = await import('./selftest.mjs');
      await selftest(ROOTDIR);
      break;
    }
    case 'verify-browser': {
      await import('./verify-browser.mjs');
      break;
    }
    default:
      console.error(`未知命令 ${cmd}，执行 help 查看`);
      process.exitCode = 1;
  }
}

main().catch(e => { console.error(`执行失败：${e.stack || e.message}`); process.exitCode = 1; });
