#!/usr/bin/env node
/**
 * prototype-studio 命令行入口
 *
 * 六个命令，按顺序跑完即可：
 *   init    生成配置文件骨架
 *   routes  从前端仓扫描路由，自动填页面清单
 *   launch  开一个带调试端口的浏览器（人工登录用）
 *   probe   检查能不能接管浏览器
 *   capture 批量截图并自动导出热区
 *   build   生成原型站
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargets, browserVersion } from '../src/cdp.mjs';
import { findBrowser, launchDebug, waitForPort } from '../src/browser.mjs';
import { capture } from '../src/capture.mjs';
import { build } from '../src/build.mjs';
import { scanRoutes } from '../src/routes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flags = {};
for (const a of argv.slice(1)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
}
const CONFIG = flags.config || 'pages.json';

function loadConfig({ optional = false } = {}) {
  if (!fs.existsSync(CONFIG)) {
    if (optional) return null;
    throw new Error(`当前目录没有 ${CONFIG}。\n下一步：先执行 "node bin/proto.mjs init" 生成配置。`);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (err) {
    throw new Error(`${CONFIG} 不是合法的 JSON：${err.message}\n下一步：检查是否多了逗号或少了引号。`);
  }
}

function cmdHelp() {
  console.log([
    'prototype-studio —— 从真实系统生成可交互原型站（零依赖）',
    '',
    '用法：node bin/proto.mjs <命令> [参数]',
    '',
    '  init              生成 pages.json 配置骨架与 live/ 目录',
    '  routes <前端src>   扫描 Vue Router 自动生成页面清单（会覆盖 pages.json，旧文件备份为 .bak）',
    '  launch            启动带调试端口的浏览器，供人工登录系统',
    '  probe             检查浏览器调试端口是否可用',
    '  capture           按 pages.json 批量截图并导出热区，产出 work/',
    '  build             生成原型站到 dist/',
    '',
    '常用参数：',
    '  --only=id1,id2    只重新采集指定页面',
    '  --config=xxx.json 指定配置文件（默认 pages.json）',
    '',
    '标准流程：init → routes → launch（人工登录）→ probe → capture → build',
  ].join('\n'));
}

function cmdInit() {
  if (fs.existsSync(CONFIG)) {
    console.log(`${CONFIG} 已存在，未改动。如需重新生成请先删除它。`);
    return;
  }
  const tpl = {
    title: '系统名称原型',
    subtitle: '需求分析 · 可交互原型',
    baseUrl: 'http://localhost:8080',
    browser: { host: '127.0.0.1', port: 9222, keyword: '' },
    viewport: { width: 1920, height: 1080 },
    shot: { maxWidth: 1568, maxBytes: 500000 },
    hotspots: { includeCandidates: false },
    out: { dir: 'work', dist: 'dist' },
    pages: [
      {
        id: 'home',
        title: '首页',
        group: '示例分组',
        url: '/',
        wait: 1500,
        actions: [],
        notes: [],
      },
    ],
  };
  fs.writeFileSync(CONFIG, JSON.stringify(tpl, null, 2), 'utf8');
  fs.mkdirSync('live', { recursive: true });
  const demo = path.join('live', '示例-可交互页.html');
  if (!fs.existsSync(demo)) {
    fs.writeFileSync(demo, [
      '<style>',
      '  .pvdemo { padding: 20px; font-family: -apple-system, "Microsoft YaHei", sans-serif; }',
      '  .pvdemo h3 { font-size: 15px; margin-bottom: 6px; }',
      '  .pvdemo p { color: #888; font-size: 12px; margin-bottom: 16px; }',
      '  .pvdemo .btn { background: #185fa5; color: #fff; border: 0; border-radius: 4px; padding: 7px 16px; cursor: pointer; font-size: 13px; }',
      '  .pvdemo .res { margin-top: 14px; padding: 12px; background: #e6f1fb; color: #0c447c; border-radius: 6px; display: none; }',
      '  .pvdemo .res.show { display: block; }',
      '</style>',
      '<div class="pvdemo">',
      '  <h3>新需求页面（可交互）</h3>',
      '  <p>这里写真实可操作的 HTML，用来演示截图里不存在的全新页面。</p>',
      '  <button class="btn" id="pvdGo">点我试试</button>',
      '  <button class="btn" style="background:#fff;color:#606266;border:1px solid #dcdfe6" data-go="home">回到首页</button>',
      '  <div class="res" id="pvdRes">交互生效了。任何元素加上 data-go="页面id" 即可跳转。</div>',
      '</div>',
      '<script>',
      '  document.getElementById("pvdGo").onclick = function () {',
      '    document.getElementById("pvdRes").classList.add("show");',
      '  };',
      '</scr' + 'ipt>',
    ].join('\n'), 'utf8');
  }
  console.log(`已生成 ${CONFIG} 与 live/ 目录。`);
  console.log('下一步：修改 baseUrl，然后执行 "node bin/proto.mjs routes <前端src目录>" 自动填页面清单。');
}

function cmdRoutes(dir) {
  if (!dir) {
    console.log('缺少参数。用法：node bin/proto.mjs routes <前端src目录>');
    console.log('例如：node bin/proto.mjs routes D:\\code\\ioc-web\\src');
    return;
  }
  const cfg = loadConfig({ optional: true }) || {};
  const { pages, dynamic, routeFiles } = scanRoutes(dir);
  if (!pages.length) {
    console.log(`在 ${dir} 里没找到路由配置。请确认目录里包含 router 配置文件（含 path: 与 component:）。`);
    return;
  }
  if (fs.existsSync(CONFIG)) fs.copyFileSync(CONFIG, CONFIG + '.bak');
  const out = {
    title: cfg.title || '系统名称原型',
    subtitle: cfg.subtitle || '',
    baseUrl: cfg.baseUrl || 'http://localhost:8080',
    browser: cfg.browser || { host: '127.0.0.1', port: 9222, keyword: '' },
    viewport: cfg.viewport || { width: 1920, height: 1080 },
    shot: cfg.shot || { maxWidth: 1568, maxBytes: 500000 },
    hotspots: cfg.hotspots || { includeCandidates: false },
    out: cfg.out || { dir: 'work', dist: 'dist' },
    pages,
  };
  fs.writeFileSync(CONFIG, JSON.stringify(out, null, 2), 'utf8');
  console.log(`已扫描 ${routeFiles.length} 个路由文件，生成 ${pages.length} 个页面，写入 ${CONFIG}。`);
  if (dynamic.length) {
    console.log(`跳过了 ${dynamic.length} 个动态路由（含 :id，需要真实数据才能打开）：`);
    console.log('  ' + dynamic.slice(0, 20).join('\n  '));
    console.log('  如需放进原型，请手动加一条 page 并把 url 换成真实地址。');
  }
  console.log('下一步：把 pages 里的 group 改成中文分组名，确认 baseUrl，然后 launch → capture。');
}

async function cmdLaunch() {
  const cfg = loadConfig({ optional: true }) || {};
  const port = cfg.browser?.port || 9222;
  const exe = findBrowser();
  if (!exe) {
    console.log('没找到 Chrome 或 Edge。请手动用下面的命令启动浏览器：');
    console.log(`  chrome.exe --remote-debugging-port=${port} --user-data-dir=%TEMP%\\proto-profile ${cfg.baseUrl || ''}`);
    return;
  }
  launchDebug(exe, { port, startUrl: cfg.baseUrl || 'about:blank', headless: !!flags.headless });
  await waitForPort('127.0.0.1', port);
  console.log(`已启动浏览器（调试端口 ${port}）：${exe}`);
  console.log(`已打开 ${cfg.baseUrl || 'about:blank'}`);
  console.log('下一步：在这个浏览器窗口里完成系统登录，然后执行 "node bin/proto.mjs capture"。');
  console.log('注意：请保持该浏览器窗口开着，capture 会接管其中的标签页。');
}

async function cmdProbe() {
  const cfg = loadConfig({ optional: true }) || {};
  const host = cfg.browser?.host || '127.0.0.1';
  const port = cfg.browser?.port || 9222;
  const ver = await browserVersion(host, port).catch(() => null);
  if (!ver) {
    console.log(`连不上 ${host}:${port}，浏览器调试端口没开。`);
    console.log('下一步：执行 "node bin/proto.mjs launch"，或手动带 --remote-debugging-port=' + port + ' 启动 Chrome。');
    process.exitCode = 1;
    return;
  }
  console.log(`已连上浏览器：${ver.Browser}`);
  const targets = await listTargets(host, port);
  if (!targets.length) {
    console.log('没有可接管的页面标签。请在被调试的浏览器里打开一个页面。');
    process.exitCode = 1;
    return;
  }
  console.log(`可接管的标签页 ${targets.length} 个：`);
  targets.slice(0, 15).forEach(t => console.log(`  - ${t.title}  ${t.url}`));
  const kw = cfg.browser?.keyword;
  console.log(kw ? `将优先接管标题或网址包含「${kw}」的标签。` : '将接管第一个非空白标签。');
  console.log('下一步：执行 "node bin/proto.mjs capture"。');
}

async function cmdCapture() {
  const cfg = loadConfig();
  const only = flags.only ? String(flags.only) : null;
  const r = await capture(cfg, { only });
  console.log('');
  console.log(`采集完成：${r.count} 个页面，数据已写入 ${path.join(r.outDir, 'site.json')}。`);
  if (r.errors.length) {
    console.log(`有 ${r.errors.length} 个页面出错：`);
    r.errors.forEach(e => console.log('  - ' + e));
    console.log('下一步：修正 pages.json 里对应页面的 url / ready / actions，然后用 --only=页面id 单独重采。');
  }
  console.log('下一步：执行 "node bin/proto.mjs build" 生成原型站。');
}

function cmdBuild() {
  const cfg = loadConfig();
  const single = !!flags.single;
  const dist = flags.out || (single ? 'dist-single' : cfg.out?.dist || 'dist');
  const r = build(cfg, { dist, single });
  console.log(`原型站已生成：${path.resolve(r.distDir)}`);
  console.log(`  ${r.pages} 个页面（其中 ${r.live} 个可交互页），${r.shots} 张截图${single ? '（已内联进单文件）' : ''}。`);
  if (r.themeInfo) console.log(`  主题样式：${r.themeInfo}`);
  if (r.errors.length) console.log(`  注意：采集阶段有 ${r.errors.length} 个页面出错。`);
  console.log('下一步：双击 ' + path.join(path.resolve(r.distDir), 'index.html') + ' 打开。');
}

async function main() {
  switch (cmd) {
    case 'init': cmdInit(); break;
    case 'routes': cmdRoutes(argv[1]); break;
    case 'launch': await cmdLaunch(); break;
    case 'probe': await cmdProbe(); break;
    case 'capture': await cmdCapture(); break;
    case 'build': cmdBuild(); break;
    case 'help': case '-h': case '--help': cmdHelp(); break;
    default:
      console.log(`未知命令：${cmd}`);
      cmdHelp();
      process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('出错了：' + err.message);
  process.exitCode = 1;
});
