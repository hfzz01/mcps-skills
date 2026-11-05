/* ============================================================
 * 批量蓝图展开器 / Expand
 * ------------------------------------------------------------
 * 输入：一份页面模板（blueprints/batch/_template.json）
 *      一份需求矩阵（examples/batch-matrix.json）
 * 输出：N 份结构完全相同的蓝图，只有数据不同。
 *
 * 模板里用 "$from:字段名" 引用矩阵字段；字符串里的
 * {{字段名}} 做文本替换。数据行由确定性公式生成（不用随机数），
 * 保证同一矩阵每次展开结果完全一致、可复现。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';

const STATUS = ['在运', '停用', '检修', '待验收'];
const OWNER = ['运行一班', '运行二班', '检修班', '自动化组', '外包运维'];

function fill(node, item) {
  if (typeof node === 'string') {
    if (node.startsWith('$from:')) {
      const k = node.slice(6);
      return item[k] !== undefined ? item[k] : node;
    }
    return node.replace(/\{\{(\w+)\}\}/g, (m, k) => (item[k] !== undefined ? String(item[k]) : m));
  }
  if (Array.isArray(node)) return node.map(x => fill(x, item));
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = fill(v, item);
    return o;
  }
  return node;
}

/** 由确定性公式造行数据，避免随机导致每次产出不同 */
function makeRows(item, columns, statuses, n = 6) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = {};
    for (const c of columns) {
      switch (c.key) {
        case 'code': r.code = `${item.code}-${String(i + 1).padStart(3, '0')}`; break;
        case 'name': r.name = { text: `${item.title.replace(/台账$/, '')} · ${['主机', '传感', '网关', '电源', '控制柜', '链路'][i % 6]}${i + 1}号`, sub: `${item.owner} / 台账项 ${i + 1}` }; break;
        case 'status': r.status = { tag: statuses[(i + item.index) % statuses.length], tone: ['ok', 'info', 'warn', 'brand'][(i + item.index) % 4] }; break;
        case 'owner': r.owner = OWNER[(i + item.index * 2) % OWNER.length]; break;
        case 'updated': r.updated = `2026-${String((i % 9) + 1).padStart(2, '0')}-${String(((i * 3) % 27) + 1).padStart(2, '0')}`; break;
        case 'count': r.count = String(12 + ((i * 7 + item.index * 5) % 80)); break;
        case 'link': r.link = { link: '查看详情', act: [`navigate:${item.linkTo || 'asset-ledger'}`] }; break;
        default: r[c.key] = '—';
      }
    }
    rows.push(r);
  }
  return rows;
}

export function expand(root) {
  const dir = path.join(root, 'blueprints', 'batch');
  const matrixPath = path.join(root, 'examples', 'batch-matrix.json');
  if (!fs.existsSync(matrixPath)) throw new Error(`找不到需求矩阵 ${matrixPath}`);
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const tplPath = path.join(root, matrix.template || 'blueprints/batch/_template.json');
  if (!fs.existsSync(tplPath)) throw new Error(`找不到批量模板 ${tplPath}`);
  const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));

  fs.mkdirSync(dir, { recursive: true });
  // 清掉上次生成的批量页（保留 _ 开头的模板）
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !f.startsWith('_')) fs.unlinkSync(path.join(dir, f));
  }

  let count = 0;
  matrix.items.forEach((raw, idx) => {
    const item = { ...raw, index: idx, columns: matrix.columns, statuses: matrix.statuses || STATUS,
      rows: null, total: raw.total || 6, scenario: 'batch', batchGroup: matrix.batchGroup || 'batch',
      group: matrix.group, linkTo: matrix.linkTo || 'asset-ledger' };
    item.rows = makeRows(item, matrix.columns, item.statuses, 6);
    const page = fill(tpl, item);
    page.id = item.id;
    page.order = 100 + idx;
    fs.writeFileSync(path.join(dir, `${item.id}.json`), JSON.stringify(page, null, 2) + '\n', 'utf8');
    count++;
  });
  return { count, dir, template: path.relative(root, tplPath).replace(/\\/g, '/'), matrix: 'examples/batch-matrix.json' };
}
