/**
 * 浏览器发现与启动
 *
 * 内网不分发浏览器二进制，一律复用机器上已装的 Chrome / Edge。
 * 原则：绝不杀不属于本次启动的浏览器进程；自己开的用独立临时 profile，不污染用户数据。
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export function browserCandidates() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
}

/** 找本机已装的浏览器，找不到返回 null */
export function findBrowser() {
  for (const p of browserCandidates()) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

/** 带调试端口启动一个独立实例（用于全新登录的场景） */
export function launchDebug(browserPath, { port = 9222, startUrl = 'about:blank', headless = false } = {}) {
  const userDataDir = path.join(os.tmpdir(), `proto-studio-${Date.now()}`);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--window-size=1600,1000',
  ];
  if (headless) args.push('--headless=new');
  args.push(startUrl);

  const proc = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  return { proc, userDataDir, port };
}

/** 轮询等待调试端口就绪 */
export async function waitForPort(host = '127.0.0.1', port = 9222, timeout = 25000) {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`);
      if (res.ok) return true;
    } catch (err) { lastErr = err; }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`等待浏览器调试端口 ${port} 超时（${timeout}ms）。${lastErr ? '最后一次错误：' + lastErr.message : ''}`);
}

/** 从候选标签里挑一个，优先标题/网址包含关键字的 */
export function pickTarget(targets, keyword) {
  if (!targets.length) return null;
  if (keyword) {
    const hit = targets.find(t => (t.title || '').includes(keyword) || (t.url || '').includes(keyword));
    if (hit) return hit;
  }
  return targets.find(t => t.url && t.url !== 'about:blank') || targets[0];
}
