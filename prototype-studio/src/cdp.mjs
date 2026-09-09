/**
 * 极简 CDP 客户端 —— 零第三方依赖
 *
 * 只用 Node 内置的 fetch 与 WebSocket。Node 22 起 WebSocket 全局可用；
 * 更低版本依次尝试 undici / ws，都没有就给出可操作的报错而不是崩溃。
 * 这样内网机器不用 npm install 也能跑。
 */

let cachedImpl = null;

async function getWebSocketImpl() {
  if (cachedImpl) return cachedImpl;
  if (typeof globalThis.WebSocket === 'function') {
    cachedImpl = globalThis.WebSocket;
    return cachedImpl;
  }
  try {
    const mod = await import('undici');
    if (mod && mod.WebSocket) { cachedImpl = mod.WebSocket; return cachedImpl; }
  } catch {}
  try {
    const mod = await import('ws');
    const W = (mod && (mod.default || mod.WebSocket)) || null;
    if (W) { cachedImpl = W; return cachedImpl; }
  } catch {}
  throw new Error(
    '当前 Node 没有可用的 WebSocket 实现。\n' +
    '下一步：把 Node 升到 22 及以上即可；若不能升级，在本目录执行 npm i ws 后重试。'
  );
}

/** 列出调试端口上所有可接管的页面标签 */
export async function listTargets(host = '127.0.0.1', port = 9222) {
  const url = `http://${host}:${port}/json/list`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(
      `连不上浏览器调试端口 ${host}:${port}。\n` +
      `下一步：确认 Chrome/Edge 已带 --remote-debugging-port=${port} 启动并处于登录状态；\n` +
      `或执行 "node bin/proto.mjs probe" 让工具帮你检查。\n` +
      `原始错误：${err.message}`
    );
  }
  if (!res.ok) throw new Error(`浏览器调试端口返回 HTTP ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : [])
    .filter(t => t.type === 'page' && t.webSocketDebuggerUrl)
    .map(t => ({
      id: t.id,
      title: t.title || '(无标题)',
      url: t.url || '',
      wsUrl: t.webSocketDebuggerUrl,
    }));
}

/** 探测调试端口，返回浏览器版本信息 */
export async function browserVersion(host = '127.0.0.1', port = 9222) {
  const url = `http://${host}:${port}/json/version`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  return await res.json();
}

export async function connect(wsUrl, { timeout = 60000 } = {}) {
  const Impl = await getWebSocketImpl();
  const ws = new Impl(wsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WebSocket 连接失败：' + (e?.message || '未知原因'))); };
  });
  return new CdpSession(ws, timeout);
}

class CdpSession {
  constructor(ws, timeout) {
    this.ws = ws;
    this.timeout = timeout;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); }
      catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const slot = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(slot.timer);
        if (msg.error) slot.reject(new Error(`CDP 报错：${msg.error.message || JSON.stringify(msg.error)}`));
        else slot.resolve(msg.result);
        return;
      }
      if (msg.method) {
        const handlers = this.listeners.get(msg.method);
        if (handlers) handlers.forEach(h => { try { h(msg.params); } catch {} });
      }
    };
    ws.onclose = () => {
      this.pending.forEach(slot => { clearTimeout(slot.timer); slot.reject(new Error('浏览器连接已断开')); });
      this.pending.clear();
    };
  }

  /** 调用一个 CDP 命令，返回 result */
  send(method, params = {}, timeout) {
    const id = ++this.seq;
    const ms = timeout || this.timeout;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 命令 ${method} 超时（${ms}ms）`));
        }
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err); }
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}
