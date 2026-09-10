/**
 * 本地测试用的静态站点服务
 *   node test/serve.mjs [端口] [站点目录名]
 * 例：node test/serve.mjs 8932 ioc-site
 * 自带 /api/ 接口，且刻意只返回 2 条数据，用来验证 mock.amplify 的放大效果。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, process.argv[3] || 'fixtures');
const PORT = Number(process.argv[2]) || 8931;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript' };

const EVENTS = [
  { id: 1001, eventNo: 'EVT20260001', eventName: '化工园区异味投诉', level: '紧急', status: '待派单', area: '城东区', time: '2026-09-10 09:12' },
  { id: 1002, eventNo: 'EVT20260002', eventName: '道路塌陷隐患上报', level: '一般', status: '处理中', area: '城西区', time: '2026-09-10 10:03' },
];

http.createServer((req, res) => {
  const url = req.url || '/';
  let p = decodeURIComponent(url.split('?')[0]);

  if (p.startsWith('/api/')) {
    const isList = p.includes('events');
    const body = isList
      ? { code: 0, msg: 'ok', data: { records: EVENTS, total: EVENTS.length, size: 10, current: 1 } }
      : { code: 0, msg: 'ok', data: { id: 1001, ...EVENTS[0], desc: '群众反映园区内有刺激性气味，需现场核查。' } };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }

  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // 未知路径一律回列表页，模拟 SPA 的 history 回退
    const fallback = path.join(ROOT, 'index.html');
    if (fs.existsSync(fallback)) {
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      res.end(fs.readFileSync(fallback));
      return;
    }
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`服务已启动：http://127.0.0.1:${PORT}  目录=${path.basename(ROOT)}`));
