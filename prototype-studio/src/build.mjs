/**
 * 生成原型站
 *
 * 产物是一整个文件夹，双击 index.html 就能看，不需要起服务、不需要联网。
 * 数据走 data.js 的 script 标签引入，专门绕开 file:// 下 fetch 会被 CORS 拦掉的问题。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) n += copyDir(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function readLivePage(file) {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    return { body: `<div class="pv-empty">找不到可交互页文件：${file}</div>`, style: '' };
  }
  const html = fs.readFileSync(abs, 'utf8');
  const styles = [];
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { styles.push(css); return ''; });
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return { body: bodyMatch ? bodyMatch[1] : html, style: styles.join('\n') };
}

export function build(cfg, opts = {}) {
  const workDir = opts.outDir || cfg.out?.dir || 'work';
  const single = !!opts.single;
  const distDir = opts.dist || (single ? 'dist-single' : cfg.out?.dist || 'dist');
  const sitePath = path.join(workDir, 'site.json');

  if (!fs.existsSync(sitePath)) {
    throw new Error(`找不到 ${sitePath}。\n下一步：先执行 "node bin/proto.mjs capture" 生成截图数据，再执行 build。`);
  }

  const site = JSON.parse(fs.readFileSync(sitePath, 'utf8'));

  for (const p of site.pages) {
    if (p.type === 'live') {
      const { body, style } = readLivePage(p.file || '');
      p.body = body;
      p.style = style;
    }
    // 没有截到图的写实页给出占位，避免原型站开天窗
    if (p.type !== 'live' && (!p.states || !Object.keys(p.states).length)) {
      p.states = { default: { img: '', w: 1200, h: 700, hotspots: [], missing: true } };
    }
  }

  // 单文件模式：把截图转成 base64 内联进数据，产出一个可以直接发的 HTML
  let inlined = 0;
  if (single) {
    for (const p of site.pages) {
      for (const st of Object.values(p.states || {})) {
        if (!st.img) continue;
        const f = path.join(workDir, st.img);
        if (fs.existsSync(f)) {
          st.img = 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
          inlined++;
        }
      }
    }
  }

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const shotCount = single ? inlined : copyDir(path.join(workDir, 'shots'), path.join(distDir, 'shots'));

  // 主题样式：把前端仓里的 Element UI 主题 CSS 拷进来，新需求页就能跟真系统长得一样
  let themeInfo = '';
  let themeCss = '/* 未配置 themeCss，此文件为空 */\n';
  if (cfg.themeCss) {
    const abs = path.resolve(process.cwd(), cfg.themeCss);
    if (fs.existsSync(abs)) {
      themeCss = fs.readFileSync(abs, 'utf8');
      themeInfo = path.basename(cfg.themeCss);
    } else {
      themeInfo = `（未找到 ${cfg.themeCss}，已跳过）`;
    }
  }

  const payload = { site, brand: { title: cfg.title || '系统原型', subtitle: cfg.subtitle || '' } };
  const dataJs = 'window.__PROTO_SITE__ = ' +
    JSON.stringify(payload).replace(/<\/script/gi, '<\\/script') + ';\n';
  const tpl = fs.readFileSync(path.join(HERE, 'template', 'index.html'), 'utf8');

  if (single) {
    const html = tpl
      .replace('<link rel="stylesheet" href="theme.css">', '<style>\n' + themeCss + '\n</style>')
      .replace('<script src="data.js"></script>', '<script>\n' + dataJs + '</script>');
    fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');
  } else {
    fs.writeFileSync(path.join(distDir, 'theme.css'), themeCss, 'utf8');
    fs.writeFileSync(path.join(distDir, 'data.js'), dataJs, 'utf8');
    fs.writeFileSync(path.join(distDir, 'index.html'), tpl, 'utf8');
  }

  const liveCount = site.pages.filter(p => p.type === 'live').length;
  fs.writeFileSync(path.join(distDir, '使用说明.txt'), [
    '原型站使用说明',
    '',
    '1. 双击 index.html 即可打开，不需要联网、不需要起服务。',
    '2. 左侧是页面树，点标题切换页面。',
    '3. 截图上的虚线框是可点击热区，鼠标移上去会显示说明，点击可跳转页面或切换状态。',
    '4. 顶部「标注层」开关：打开后显示需求标注，评审时关掉、给开发时打开。',
    '5. 快捷键：F 演示模式，Esc 退出，N 标注开关，H 热区开关，左右方向键前进后退。',
    single
      ? '6. 这是单文件版，直接把 index.html 发出去即可，不需要任何其他文件。'
      : '6. 分享给他人时请把整个文件夹一起压缩发送，不要只发 index.html。',
    '',
    `共 ${site.pages.length} 个页面（其中 ${liveCount} 个可交互页），${shotCount} 张截图。`,
    site.errors && site.errors.length ? `\n采集时有 ${site.errors.length} 个页面出错，详见 work/site.json 的 errors 字段。` : '',
  ].join('\n'), 'utf8');

  return {
    distDir,
    pages: site.pages.length,
    live: liveCount,
    shots: shotCount,
    errors: site.errors || [],
    themeInfo,
  };
}
