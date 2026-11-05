/* ============================================================
 * 浏览器验收脚本 / Browser Verifier
 * ------------------------------------------------------------
 * 在真实 Chrome 里以 file:// 打开 dist/ 产物，实际点击并断言：
 * 样式宪章生效、页面跳转、状态切换、变更标记、弹窗、
 * 输入校验、状态剧本、批量页结构一致。
 * 只连本机 CDP，不联网、不调用模型、不启动/关闭浏览器。
 * 用法：node engine/verify-browser.mjs --port=9223
 * ============================================================ */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const PORT = Number(flag('port', 9223));
const DIST = flag('dist', path.join(ROOT, 'dist'));
const fileUrl = (rel) => 'file:///' + path.join(DIST, rel).replace(/\\/g, '/');

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 失败')); setTimeout(() => rej(new Error('ws 超时')), 8000); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && c.p.has(m.id)) { const { res, rej } = c.p.get(m.id); c.p.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error(`${method} 超时`)); } }, 12000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async goto(url, wait = 900) {
    await this.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, wait));
  }
}

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' · ' + detail : ''}`); };

async function main() {
  let list;
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }
  catch (e) { console.error(`连不上 CDP ${PORT}：${e.message}`); process.exitCode = 1; return; }
  const t = list.find(x => x.type === 'page' && !String(x.url).startsWith('devtools://'));
  if (!t) { console.error('没有页面标签'); process.exitCode = 1; return; }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');

  console.log('\n=== Prism 浏览器实测（file:// 真实点击）===');

  // 1) 门户 + 样式宪章生效
  await c.goto(fileUrl('index.html'));
  const portal = await c.eval(`({
    title: document.title,
    cards: document.querySelectorAll('.pcard').length,
    links: document.querySelectorAll('.page-link').length,
    bg: getComputedStyle(document.body).backgroundColor,
    charter: !!document.querySelector('link[href*="charter.css"]'),
    prism: typeof window.Prism
  })`);
  ok('门户以 file:// 打开', portal.title.includes('Prism') && portal.cards === 3, `${portal.cards} 张场景卡`);
  ok('样式宪章生效（计算样式）', portal.bg === 'rgb(243, 246, 250)', `body 背景 ${portal.bg}`);
  ok('运行时已加载', portal.prism === 'object');
  ok('全部页面入口', portal.links >= 16, `${portal.links} 个入口`);

  // 2) 卡片点击 → 页面跳转
  await c.eval(`document.querySelector('.pcard').click()`);
  await new Promise(r => setTimeout(r, 1000));
  const jumped = await c.eval(`({ url: location.href, page: document.body.dataset.pageId, scenes: document.querySelectorAll('.scene').length })`);
  ok('点击卡片跳转页面', jumped.url.includes('asset-ledger.html') && jumped.page === 'asset-ledger', `${jumped.scenes} 个状态面板`);

  // 3) 变更标记 + 状态切换
  await c.eval(`document.querySelector('[data-act="diff:on"]').click()`);
  ok('变更标记开关', await c.eval(`document.body.classList.contains('diff-on')`));
  await c.eval(`document.querySelector('[data-scene-btn="empty"]').click()`);
  const sc = await c.eval(`({ active: document.querySelector('.scene.is-active')?.dataset.scene, emptyText: document.querySelector('.scene.is-active')?.innerText.includes('没有符合条件的资产') })`);
  ok('状态切换到空数据', sc.active === 'empty' && sc.emptyText, `当前 ${sc.active}`);
  await c.eval(`document.querySelector('[data-scene-btn="default"]').click()`);

  // 4) 弹窗 + 输入校验
  await c.eval(`document.querySelector('[data-act="dialog:create"]').click()`);
  ok('弹窗打开', await c.eval(`!!document.querySelector('.overlay[data-overlay="create"].is-open')`));
  await c.eval(`document.querySelector('.overlay[data-overlay="create"] [data-act*="form:validate:create"]').click()`);
  await new Promise(r => setTimeout(r, 300));
  const errCount = await c.eval(`document.querySelectorAll('.overlay[data-overlay="create"] .form__row.is-error').length`);
  ok('必填校验拦下空提交', errCount >= 3, `${errCount} 个字段标红`);
  await c.eval(`(() => {
    const o = document.querySelector('.overlay[data-overlay="create"]');
    const set = (n, v) => { const el = o.querySelector('[data-field="'+n+'"]'); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
    set('assetName', '测试资产'); set('assetCode', 'ZC-2026-099'); set('assetType', '主机设备');
    return true;
  })()`);
  await c.eval(`document.querySelector('.overlay[data-overlay="create"] [data-act*="form:validate:create"]').click()`);
  await new Promise(r => setTimeout(r, 300));
  const afterSubmit = await c.eval(`({ open: !!document.querySelector('.overlay[data-overlay="create"].is-open'), scene: document.querySelector('.scene.is-active')?.dataset.scene, toast: document.querySelector('[data-toast]').classList.contains('is-open') })`);
  ok('填值后提交关闭弹窗并走状态剧本', !afterSubmit.open && afterSubmit.toast, `当前状态 ${afterSubmit.scene}`);
  await new Promise(r => setTimeout(r, 900));
  ok('加载态自动回到常规列表', (await c.eval(`document.querySelector('.scene.is-active')?.dataset.scene`)) === 'default');

  // 5) 表格内容与跳转动作
  const table = await c.eval(`({ rows: document.querySelectorAll('.scene.is-active .table tbody tr').length, links: document.querySelectorAll('.scene.is-active .table__link').length, pager: !!document.querySelector('.scene.is-active .pager') })`);
  ok('表格与分页渲染', table.rows >= 6 && table.pager, `${table.rows} 行 / ${table.links} 个行操作`);

  // 6) 新增功能页：三步 + 校验
  await c.goto(fileUrl('pages/inspection-plan.html'));
  const p1 = await c.eval(`({ page: document.body.dataset.pageId, scene: document.querySelector('.scene.is-active')?.dataset.scene, steps: document.querySelectorAll('.scene.is-active .step').length, inputs: document.querySelectorAll('.scene.is-active .input').length })`);
  ok('新增功能页打开', p1.page === 'inspection-plan' && p1.scene === 'step1' && p1.steps === 3, `${p1.inputs} 个输入框`);
  await c.eval(`document.querySelector('.scene.is-active [data-act*="form:validate:plan"]').click()`);
  await new Promise(r => setTimeout(r, 300));
  const p1err = await c.eval(`document.querySelectorAll('.scene.is-active .form__row.is-error').length`);
  ok('新增功能页校验生效', p1err >= 4, `${p1err} 个字段标红`);
  await c.eval(`document.querySelector('[data-scene-btn="step2"]').click()`);
  ok('步骤场景切换', (await c.eval(`document.querySelector('.scene.is-active')?.dataset.scene`)) === 'step2');
  await c.eval(`document.querySelector('[data-act="dialog:addRule"]').click()`);
  ok('规则弹窗打开', await c.eval(`!!document.querySelector('.overlay[data-overlay="addRule"].is-open')`));

  // 7) 批量页一致性（真实 DOM 对比）
  await c.goto(fileUrl('pages/ledger-station.html'));
  const b1 = await c.eval(`({ scenes: document.querySelectorAll('.scene').length, panels: document.querySelectorAll('.scene.is-active .panel').length, fields: document.querySelectorAll('.scene.is-active .field').length, rows: document.querySelectorAll('.scene.is-active .table tbody tr').length, bg: getComputedStyle(document.body).backgroundColor, hash: document.body.dataset.charterHash })`);
  await c.goto(fileUrl('pages/ledger-sensor.html'));
  const b2 = await c.eval(`({ scenes: document.querySelectorAll('.scene').length, panels: document.querySelectorAll('.scene.is-active .panel').length, fields: document.querySelectorAll('.scene.is-active .field').length, rows: document.querySelectorAll('.scene.is-active .table tbody tr').length, bg: getComputedStyle(document.body).backgroundColor, hash: document.body.dataset.charterHash })`);
  ok('批量页结构一致（真实 DOM）', JSON.stringify({ s: b1.scenes, p: b1.panels, f: b1.fields, r: b1.rows }) === JSON.stringify({ s: b2.scenes, p: b2.panels, f: b2.fields, r: b2.rows }),
    `各 ${b1.scenes} 态 / ${b1.panels} 面板 / ${b1.fields} 筛选 / ${b1.rows} 行`);
  ok('批量页共享同一宪章', b1.hash === b2.hash && b1.bg === b2.bg, `哈希 ${b1.hash}`);

  c.close();
  const failed = results.filter(x => !x.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error(`验收失败：${e.stack || e.message}`); process.exitCode = 1; });
