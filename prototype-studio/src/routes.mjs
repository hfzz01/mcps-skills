/**
 * 从前端代码仓扫描 Vue Router 配置，自动生成页面清单
 *
 * 同时适配 Vue Router 3（Vue2）与 Vue Router 4（Vue3）的写法。
 * 生成的是草稿：分组名来自目录名，需要人工改成中文；动态路由（含 :id）会被跳过并单独列出，
 * 因为它需要真实数据才能打开。
 */

import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.workbuddy', '.output', 'public']);
const EXT = /\.(js|jsx|ts|tsx|vue)$/i;
const MAX_FILE = 400 * 1024;

function walk(dir, out, depth = 0) {
  if (depth > 8) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(p, out, depth + 1);
    } else if (e.isFile() && EXT.test(e.name)) {
      try { if (fs.statSync(p).size <= MAX_FILE) out.push(p); } catch {}
    }
  }
  return out;
}

/** 从一段路由配置文本里抠出 path / name / title / component */
function parseRoutes(txt) {
  const found = [];
  const re = /path\s*:\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const win = txt.slice(m.index, m.index + 700);
    const name = (win.match(/name\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    const title = (win.match(/meta\s*:\s*\{[\s\S]{0,200}?title\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    const redirect = (win.match(/redirect\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    const comp = (win.match(/component\s*:?\s*\(?\s*\)?\s*=>\s*import\(\s*['"]([^'"]+)['"]/) || [])[1]
      || (win.match(/component\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/) || [])[1]
      || (win.match(/component\s*:\s*([A-Za-z0-9_$]+)/) || [])[1] || '';
    found.push({ path: m[1], name, title, comp, redirect });
  }
  return found;
}

function slug(p) {
  return String(p || '').replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase() || 'home';
}

function guessGroup(comp, url) {
  const seg = String(comp || '').replace(/\\/g, '/');
  const parts = seg.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  const u = String(url || '').replace(/^\/+/, '').split('/')[0];
  return u || '未分组';
}

export function scanRoutes(srcDir, opts = {}) {
  if (!fs.existsSync(srcDir)) throw new Error(`目录不存在：${srcDir}`);
  const files = walk(srcDir, []);
  const routeFiles = [];
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (/path\s*:\s*['"]/.test(txt) && /component\s*:/.test(txt)) {
      routeFiles.push({ file: f, routes: parseRoutes(txt) });
    }
  }

  const seen = new Set();
  const pages = [];
  const dynamic = [];
  for (const rf of routeFiles) {
    for (const r of rf.routes) {
      if (!r.path) continue;
      if (r.path.includes(':')) { dynamic.push(r.path); continue; }
      const id = slug(r.path);
      if (seen.has(id)) continue;
      seen.add(id);
      pages.push({
        id,
        title: r.title || r.name || r.path,
        group: guessGroup(r.comp, r.path),
        url: r.path,
        wait: 1200,
        actions: [],
        notes: [],
      });
    }
  }
  return { pages, dynamic, routeFiles: routeFiles.map(r => r.file) };
}
