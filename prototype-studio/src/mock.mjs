/**
 * 接口拦截与数据填充 —— 零第三方依赖
 *
 * 解决什么问题：内网测试环境经常没数据（空列表、空图表）或接口报错，
 * 截出来的图自然没法拿去评审。与其求后端造数据，不如在浏览器层直接把响应换掉。
 *
 * 用 CDP 的 Fetch 域在「响应阶段」拦下 XHR/Fetch，四种用法：
 *   record   把真实响应存到 mocks/ 目录（下次可以照着改）
 *   replace  用 mocks/ 里的 JSON 整体替换响应
 *   amplify  把真实响应里的列表数组复制 N 条，造出满屏数据（最常用）
 *   auto     有规则文件就替换，否则放大，否则原样放行
 *
 * 关键坑：原响应若带 content-encoding/content-length，改写 body 后这两个头会失效，
 * 必须删掉，否则前端拿到的是乱码或直接报错。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 常见的分页列表字段，按命中优先级排列 */
const LIST_KEYS = ['records', 'list', 'rows', 'items', 'data', 'result'];

/** 看起来像主键的字段 */
const ID_RE = /^(id|ID|[a-zA-Z]*Id|[a-zA-Z]*ID)$/;
/** 看起来像名称的字段（放大时加后缀，避免满屏一模一样） */
const NAME_RE = /^(name|title|[a-zA-Z]*Name|[a-zA-Z]*Title|label)$/i;

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function getByPath(obj, p) {
  let cur = obj;
  for (const k of p) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setByPath(obj, p, val) {
  let cur = obj;
  for (let i = 0; i < p.length - 1; i++) {
    if (cur[p[i]] == null) cur[p[i]] = {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = val;
}

/**
 * 在响应 JSON 里找那个「应该被放大的列表」。
 * 优先 data.records / data.list 这类约定字段，找不到就广度优先找第一个非空对象数组。
 */
function findListPath(obj) {
  const root = obj && typeof obj === 'object' ? obj : {};
  for (const key of LIST_KEYS) {
    if (Array.isArray(root[key]) && root[key].length && isPlainObject(root[key][0])) {
      return [key];
    }
  }
  const data = root.data;
  if (isPlainObject(data)) {
    for (const key of LIST_KEYS) {
      if (Array.isArray(data[key]) && data[key].length && isPlainObject(data[key][0])) {
        return ['data', key];
      }
    }
  }
  // 兜底：广度优先找第一个长度 >= 1 的对象数组，深度不超过 4
  const queue = [[[], root, 0]];
  while (queue.length) {
    const [p, node, depth] = queue.shift();
    if (depth > 4) continue;
    if (Array.isArray(node) && node.length && isPlainObject(node[0])) return p;
    if (isPlainObject(node)) {
      for (const k of Object.keys(node)) queue.push([p.concat(k), node[k], depth + 1]);
    }
  }
  return null;
}

/** 深拷贝一份数据，并按序号改写主键与名称，避免放大后满屏重复、看起来很假 */
function cloneWithIndex(item, i, variants) {
  const out = JSON.parse(JSON.stringify(item));
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isPlainObject(node)) return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (ID_RE.test(k)) {
        if (typeof v === 'number') node[k] = v * 1000 + i;
        else if (typeof v === 'string' && /^\d+$/.test(v)) node[k] = String(Number(v) * 1000 + i);
      } else if (variants && NAME_RE.test(k) && typeof v === 'string' && v) {
        node[k] = `${v} ${String(i + 1).padStart(2, '0')}`;
      } else if (isPlainObject(v) || Array.isArray(v)) {
        walk(v);
      }
    }
  };
  walk(out);
  return out;
}

/** 同步分页总数，否则放大了列表但分页器还写着「共 3 条」 */
function syncTotal(obj, listPath, size) {
  const parentPath = listPath.slice(0, -1);
  const listKey = listPath[listPath.length - 1];
  const parent = parentPath.length ? getByPath(obj, parentPath) : obj;
  if (!isPlainObject(parent)) return;
  for (const k of Object.keys(parent)) {
    if (/^(total|totalCount|count|totalSize|totalNum)$/i.test(k) && typeof parent[k] === 'number') {
      parent[k] = size;
    }
  }
  if (isPlainObject(obj)) {
    for (const k of Object.keys(obj)) {
      if (/^(total|totalCount|count|totalSize|totalNum)$/i.test(k) && typeof obj[k] === 'number') obj[k] = size;
    }
  }
  void listKey;
}

/**
 * 放大一个响应体。返回新 JSON 字符串；无法处理时返回 null。
 */
export function amplifyJson(text, { factor = 5, max = 20, variants = true } = {}) {
  let obj;
  try { obj = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(obj)) return null;

  const listPath = findListPath(obj);
  if (!listPath) return null;

  const arr = getByPath(obj, listPath);
  if (!Array.isArray(arr) || !arr.length) return null;

  const target = Math.min(max, Math.max(arr.length, factor));
  const seeds = arr.slice(0, Math.min(arr.length, 5));
  const out = [];
  for (let i = 0; out.length < target; i++) {
    out.push(i < arr.length && i < seeds.length
      ? (i === 0 ? arr[0] : cloneWithIndex(seeds[i % seeds.length], i, variants))
      : cloneWithIndex(seeds[i % seeds.length], i, variants));
  }
  setByPath(obj, listPath, out);
  syncTotal(obj, listPath, out.length);
  return JSON.stringify(obj);
}

function safeFileName(url) {
  return String(url)
    .replace(/^https?:\/\//, '')
    .replace(/[^\w\-.:]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-80);
}

/**
 * 创建拦截会话。返回的对象带 stats / report / close。
 * 未启用时返回一个空壳，capture 那边不用分支判断。
 */
export async function createMockSession(cdp, mockCfg = {}, opts = {}) {
  const stats = { paused: 0, replaced: 0, amplified: 0, recorded: 0, failed: 0, urls: [] };
  const noop = {
    stats,
    async close() {},
    report: () => '',
  };

  if (!mockCfg || mockCfg.enabled === false) return noop;

  const dir = mockCfg.dir || 'mocks';
  const mode = mockCfg.mode || 'auto';
  const matches = mockCfg.match || [];
  const skips = mockCfg.skip || ['.js', '.css', '.map', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico'];
  const amp = mockCfg.amplify || null;
  const rules = mockCfg.rules || null;
  const shouldRecord = !!mockCfg.record;
  const urlPattern = mockCfg.urlPattern || '*';

  const rulesDir = opts.rulesDir || path.resolve(process.cwd(), dir);
  fs.mkdirSync(rulesDir, { recursive: true });

  const typeOk = (p) => !p.resourceType || p.resourceType === 'XHR' || p.resourceType === 'Fetch';
  const urlOk = (url) => {
    if (!url) return false;
    if (skips.some((s) => url.includes(s))) return false;
    if (matches.length) return matches.some((m) => url.includes(m));
    return true;
  };

  /** 改写响应头：去掉编码与长度，换成新的字节数 */
  const rebuildHeaders = (headers, byteLen) => {
    const out = [];
    for (const h of headers || []) {
      const n = String(h.name || '').toLowerCase();
      if (n === 'content-encoding' || n === 'content-length' || n === 'content-md5') continue;
      out.push({ name: h.name, value: h.value });
    }
    out.push({ name: 'content-length', value: String(byteLen) });
    if (!out.some((h) => String(h.name).toLowerCase() === 'access-control-allow-origin')) {
      out.push({ name: 'access-control-allow-origin', value: '*' });
    }
    return out;
  };

  const deliver = async (requestId, code, headers, bodyBase64) => {
    const body = Buffer.from(bodyBase64 || '', 'base64');
    const hs = rebuildHeaders(headers, body.length);
    // 只能用 fulfillRequest 改写响应。continueResponse 虽然有 body 参数，
    // 但 Chrome 会静默忽略它——不报错、不改内容，排查起来非常坑
    await cdp.send('Fetch.fulfillRequest', {
      requestId, responseCode: code || 200, responseHeaders: hs, body: body.toString('base64'),
    }, 20000);
  };

  const passThrough = async (requestId) => {
    try { await cdp.send('Fetch.continueResponse', { requestId }, 15000); }
    catch { /* 页面可能已经跳走，忽略 */ }
  };

  const handler = async (p) => {
    stats.paused++;
    // 注意：Fetch.requestPaused 事件的 URL 在 p.request.url，没有顶层 url 字段
    const reqUrl = (p.request && p.request.url) || '';
    try {
      if (!typeOk(p) || !urlOk(reqUrl)) { await passThrough(p.requestId); return; }

      let raw = '';
      let wasBase64 = false;
      try {
        const r = await cdp.send('Fetch.getResponseBody', { requestId: p.requestId }, 25000);
        raw = r.body || '';
        wasBase64 = !!r.base64Encoded;
      } catch {
        await passThrough(p.requestId);
        return;
      }
      const text = wasBase64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
      if (!text || text.length < 2) { await passThrough(p.requestId); return; }

      let finalText = text;
      let how = '';

      // 1) 规则替换：用户手写的 JSON 优先级最高
      if (rules && rules.length) {
        for (const rule of rules) {
          if (!rule || !rule.contains || !reqUrl.includes(rule.contains)) continue;
          const f = path.resolve(rulesDir, rule.file || '');
          if (fs.existsSync(f)) {
            finalText = fs.readFileSync(f, 'utf8');
            how = 'replace';
            break;
          }
        }
      }

      // 2) 放大列表
      if (!how && amp && (mode === 'amplify' || mode === 'auto')) {
        const bigger = amplifyJson(text, {
          factor: amp.factor ?? 5,
          max: amp.max ?? 20,
          variants: amp.variants !== false,
        });
        if (bigger) { finalText = bigger; how = 'amplify'; }
      }

      if (how === 'replace') stats.replaced++;
      if (how === 'amplify') stats.amplified++;

      if (shouldRecord) {
        try {
          fs.writeFileSync(path.join(rulesDir, safeFileName(reqUrl) + '.json'), text, 'utf8');
          stats.recorded++;
        } catch {}
      }

      if (!how) { await passThrough(p.requestId); return; }

      if (stats.urls.length < 40) stats.urls.push(`${how} ${reqUrl}`);
      await deliver(p.requestId, p.responseStatusCode || 200, p.responseHeaders, Buffer.from(finalText, 'utf8').toString('base64'));
    } catch {
      stats.failed++;
      await passThrough(p.requestId);
    }
  };

  cdp.on('Fetch.requestPaused', handler);
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern, requestStage: 'Response' }],
  });

  return {
    stats,
    async close() {
      try { await cdp.send('Fetch.disable', {}, 10000); } catch {}
    },
    report() {
      if (!stats.paused) return '';
      const lines = [
        `接口拦截：共拦下 ${stats.paused} 个请求，放大 ${stats.amplified} 个，替换 ${stats.replaced} 个，录制 ${stats.recorded} 个${stats.failed ? `，失败 ${stats.failed} 个` : ''}。`,
      ];
      if (stats.urls.length) {
        lines.push('  被处理的接口（前 10 条）：');
        stats.urls.slice(0, 10).forEach((u) => lines.push('    - ' + u));
      }
      return lines.join('\n');
    },
  };
}
