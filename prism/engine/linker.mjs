/* ============================================================
 * 一致性链接器 / Linker
 * ------------------------------------------------------------
 * 一致性不靠模型自觉，靠编译期硬性校验：
 *   1. 蓝图只能引用契约白名单内的组件，props 必须通过类型校验
 *   2. 所有 navigate / scene / dialog / form 目标必须可达
 *   3. 样式宪章是唯一允许出现色值/字号字面量的文件
 *   4. 每个页面计算「结构指纹」（区块序列 + props 键），
 *      批量组必须指纹完全一致，才允许铸造
 * 任何 error 都会让 compile 中止；warning 只提示。
 * ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { COMPONENT_NAMES, validateProps } from '../foundry/contracts.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 模型白名单：清单之外一律拒绝，由链接器在编译期强制 */
export const ALLOWED_MODELS = [
  'GLM5.2', 'deepseekv4.1-flash1017', 'MiniMax-M3', 'Qwen3.7-max', 'Qwen3.7-plus',
];

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** 递归收集对象里所有字符串 */
export function walkStrings(o, cb) {
  if (typeof o === 'string') { cb(o); return; }
  if (Array.isArray(o)) { o.forEach(x => walkStrings(x, cb)); return; }
  if (o && typeof o === 'object') Object.values(o).forEach(x => walkStrings(x, cb));
}

/** 递归收集所有区块（含嵌套在 panel/tabs/compare 里的） */
function collectBlocks(blocks, out) {
  for (const b of blocks || []) {
    if (!b || !b.component) continue;
    out.push(b);
    const p = b.props || {};
    if (Array.isArray(p.body)) collectBlocks(p.body, out);
    if (Array.isArray(p.old)) collectBlocks(p.old, out);
    if (Array.isArray(p.new)) collectBlocks(p.new, out);
    for (const pane of p.panes || []) if (Array.isArray(pane.body)) collectBlocks(pane.body, out);
  }
  return out;
}

/** 结构指纹：只保留组件名 + props 键，不含任何数据值 */
export function structureFingerprint(page) {
  const skel = (blocks) => (blocks || []).map(b => {
    const p = b.props || {};
    const node = { c: b.component, k: Object.keys(p).sort() };
    if (Array.isArray(p.body)) node.b = skel(p.body);
    if (Array.isArray(p.old)) node.o = skel(p.old);
    if (Array.isArray(p.new)) node.n = skel(p.new);
    if (Array.isArray(p.panes)) node.t = p.panes.map(x => ({ id: x.id, b: skel(x.body) }));
    return node;
  });
  const scenes = page.scenes || {};
  const all = Object.keys(scenes).sort().map(k => ({ s: k, b: skel(scenes[k].blocks || []) }));
  return sha256(JSON.stringify(all));
}

const ACTION_RE = /^(navigate|scene|dialog|drawer|overlay|tab|step|toast|form|wait|toggle|select|diff|back)[:]/;

/** 校验所有蓝图，返回 { errors, warnings, stats } */
export function lintBlueprints(blueprints) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const stats = {
    pages: 0, scenes: 0, blocks: 0, forms: 0, inputs: 0,
    actions: 0, navigations: 0, overlays: 0, byScenario: {}, byModel: {}, fingerprints: {},
  };

  for (const { file, data: page } of blueprints) {
    const tag = `${page.id || path.basename(file)}`;
    if (!page.id) errors.push(`${file}: 缺少 id`);
    if (ids.has(page.id)) errors.push(`${tag}: 页面 id 重复`);
    ids.add(page.id);
    if (!page.title) errors.push(`${tag}: 缺少 title`);
    if (!page.scenario) errors.push(`${tag}: 缺少 scenario`);
    // 模型白名单：蓝图若声明了生成模型，必须是清单内的五个之一
    const model = page.generator?.model;
    if (model && !ALLOWED_MODELS.includes(model)) {
      errors.push(`${tag}: 使用了清单外模型 ${model}；仅允许 ${ALLOWED_MODELS.join(' / ')}`);
    }
    stats.byModel[model || '未声明'] = (stats.byModel[model || '未声明'] || 0) + 1;
    // 蓝图中不允许出现任何样式字段（防止模型把 CSS 塞进规格）
    walkStrings(page, (sv) => {
      if (/^\s*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|font-size\s*:|margin\s*:|padding\s*:|color\s*:)/.test(sv)) {
        errors.push(`${tag}: 蓝图里出现样式描述「${sv.slice(0, 40)}」；样式只能来自样式宪章`);
      }
    });
    if (!page.scenes || !Object.keys(page.scenes).length) {
      errors.push(`${tag}: 没有 scenes，至少要有 default`);
      continue;
    }
    if (!page.scenes.default && !page.defaultScene) warnings.push(`${tag}: 没有 default 场景且未指定 defaultScene，将使用第一个场景`);

    stats.pages++;
    stats.byScenario[page.scenario] = (stats.byScenario[page.scenario] || 0) + 1;
    const sceneNames = new Set(Object.keys(page.scenes));
    const overlayIds = new Set((page.overlays || []).map(o => o.id));
    const formIds = new Set();
    const pageNavTargets = [];

    for (const [sname, scene] of Object.entries(page.scenes)) {
      stats.scenes++;
      if (!scene.label) warnings.push(`${tag}/${sname}: 场景缺 label，状态条会用场景名`);
      const blocks = collectBlocks(scene.blocks, []);
      stats.blocks += blocks.length;
      for (const b of blocks) {
        if (!COMPONENT_NAMES.includes(b.component)) {
          errors.push(`${tag}/${sname}: 未知组件 ${b.component}（白名单：${COMPONENT_NAMES.join(', ')}）`);
          continue;
        }
        for (const e of validateProps(b.component, b.props || {})) errors.push(`${tag}/${sname}: ${e}`);
        if (b.component === 'form') { stats.forms++; formIds.add(b.props.id); }
        // 统计输入控件
        for (const f of (b.props.fields || [])) stats.inputs++;
        for (const s of (b.props.sections || [])) for (const f of (s.fields || [])) stats.inputs++;
      }
    }

    for (const o of page.overlays || []) {
      stats.overlays++;
      if (!o.id || !o.title) errors.push(`${tag}: overlay 需要 id 与 title`);
      const blocks = collectBlocks(o.blocks, []);
      stats.blocks += blocks.length;
      for (const b of blocks) {
        if (!COMPONENT_NAMES.includes(b.component)) errors.push(`${tag}/overlay ${o.id}: 未知组件 ${b.component}`);
        else for (const e of validateProps(b.component, b.props || {})) errors.push(`${tag}/overlay ${o.id}: ${e}`);
        // 弹层里的表单同样参与 form:validate 的可达性校验
        if (b.component === 'form') { stats.forms++; formIds.add(b.props.id); }
      }
    }

    // 动作串校验 + 目标可达性
    walkStrings(page, (s) => {
      if (!ACTION_RE.test(s)) return;
      stats.actions++;
      const key = s.slice(0, s.indexOf(':'));
      const val = s.slice(s.indexOf(':') + 1);
      if (s.includes('|')) errors.push(`${tag}: 动作串 ${s} 含竖线，会破坏分隔`);
      if (key === 'navigate') {
        stats.navigations++;
        pageNavTargets.push(val.split(':')[0]);
      } else if (key === 'scene') {
        if (!sceneNames.has(val)) errors.push(`${tag}: 动作 ${s} 指向不存在的场景（可用 ${[...sceneNames].join(', ')}）`);
      } else if (key === 'dialog' || key === 'drawer') {
        if (val !== 'close' && !overlayIds.has(val)) errors.push(`${tag}: 动作 ${s} 指向不存在的弹层（可用 ${[...overlayIds].join(', ') || '无'}）`);
      } else if (key === 'form') {
        const fid = val.split(':')[1];
        if (val.startsWith('validate') && !formIds.has(fid)) errors.push(`${tag}: 动作 ${s} 校验了不存在的表单 ${fid}`);
      } else if (key === 'wait') {
        if (!/^\d+$/.test(val)) errors.push(`${tag}: wait 需要毫秒数，得到 ${val}`);
      }
    });

    for (const t of pageNavTargets) {
      if (t === '../index' || t === 'index') continue;
      if (!ids.has(t) && !blueprints.some(b => b.data.id === t)) {
        errors.push(`${tag}: 动作 navigate:${t} 指向不存在的页面`);
      }
    }

    stats.fingerprints[page.id] = structureFingerprint(page);
    page._navTargets = pageNavTargets;
    page._sceneCount = sceneNames.size;
  }

  // 批量组结构一致性：同一 scenario=batch 且同一 batchGroup 的页面指纹必须一致
  const groups = new Map();
  for (const { data: page } of blueprints) {
    if (page.scenario !== 'batch') continue;
    const g = page.batchGroup || 'batch';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ id: page.id, fp: stats.fingerprints[page.id] });
  }
  stats.batchGroups = {};
  for (const [g, list] of groups) {
    const uniq = new Set(list.map(x => x.fp));
    stats.batchGroups[g] = { pages: list.length, distinctStructures: uniq.size, consistent: uniq.size === 1, fingerprint: list[0].fp.slice(0, 12) };
    if (uniq.size !== 1) errors.push(`批量组 ${g} 出现 ${uniq.size} 种不同结构，破坏一致性`);
  }

  return { errors, warnings, stats };
}

/** 检查单一事实源自身是否合规 */
export function checkFoundry(root = ROOT) {
  const errors = [];
  const warnings = [];
  const charter = fs.readFileSync(path.join(root, 'foundry', 'charter.css'), 'utf8');
  const comps = fs.readFileSync(path.join(root, 'foundry', 'components.css'), 'utf8');
  const charterHash = sha256(charter).slice(0, 16);

  const colorRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
  const colorHits = (comps.match(colorRe) || []);
  if (colorHits.length) errors.push(`components.css 出现 ${colorHits.length} 处色值字面量：${colorHits.slice(0, 5).join(', ')}`);
  const fsHits = (comps.match(/font-size:\s*\d+(?:\.\d+)?px/g) || []);
  if (fsHits.length) errors.push(`components.css 出现 ${fsHits.length} 处裸字号：${fsHits.slice(0, 5).join(', ')}`);
  const vars = (charter.match(/--[\w-]+\s*:/g) || []).length;
  if (vars < 20) warnings.push(`样式宪章只定义了 ${vars} 个变量，可能过于单薄`);

  const contractSrc = fs.readFileSync(path.join(root, 'foundry', 'contracts.mjs'), 'utf8');
  const contractHash = sha256(contractSrc).slice(0, 16);
  return { errors, warnings, charterHash, contractHash, variableCount: vars };
}

/** 汇总成可交付的一致性报告 */
export function consistencyReport(lint, foundry, manifest) {
  const s = lint.stats;
  const L = [];
  L.push('# Prism 一致性报告');
  L.push('');
  L.push(`生成时间：${new Date().toISOString()}`);
  L.push('');
  L.push('## 一、单一事实源');
  L.push('');
  L.push(`| 项 | 值 |`);
  L.push(`| --- | --- |`);
  L.push(`| 样式宪章 charter.css 哈希 | \`${foundry.charterHash}\` |`);
  L.push(`| 宪章变量数 | ${foundry.variableCount} |`);
  L.push(`| 组件契约 contracts.mjs 哈希 | \`${foundry.contractHash}\` |`);
  L.push(`| 契约组件数 | ${COMPONENT_NAMES.length}（${COMPONENT_NAMES.join('、')}） |`);
  L.push(`| components.css 色值字面量 | 0（链接器已强制校验） |`);
  L.push(`| 页面内联样式 | 仅允许引用 var()，模型输出中无样式字段 |`);
  L.push('');
  L.push('所有页面引用同一份 `assets/charter.css` 与 `assets/components.css`，');
  L.push('配色 / 字号 / 间距 / 圆角 / 组件形态由文件路径强制同源，页面无法覆盖。');
  L.push('');
  L.push('## 二、编译期校验结果');
  L.push('');
  L.push(`| 校验项 | 结果 |`);
  L.push(`| --- | --- |`);
  L.push(`| 蓝图 error 数 | ${lint.errors.length} ${lint.errors.length ? '（编译中止）' : '✓ 清零'} |`);
  L.push(`| 蓝图 warning 数 | ${lint.warnings.length} |`);
  L.push(`| 组件引用合法性 | ${lint.errors.some(e => e.includes('未知组件')) ? '失败' : '✓ 全部命中契约白名单'} |`);
  L.push(`| 页面跳转可达性 | ${lint.errors.some(e => e.includes('navigate')) ? '失败' : '✓ 全部目标存在'} |`);
  L.push(`| 状态 / 弹层可达性 | ${lint.errors.some(e => e.includes('场景') || e.includes('弹层')) ? '失败' : '✓ 全部可达'} |`);
  L.push('');
  L.push('## 三、产出规模');
  L.push('');
  L.push(`| 指标 | 数量 |`);
  L.push(`| --- | --- |`);
  L.push(`| 页面 | ${s.pages} |`);
  L.push(`| 场景 / 状态面板 | ${s.scenes} |`);
  L.push(`| 区块实例 | ${s.blocks} |`);
  L.push(`| 表单 / 输入控件 | ${s.forms} / ${s.inputs} |`);
  L.push(`| 交互动作串 / 跳转 | ${s.actions} / ${s.navigations} |`);
  L.push(`| 弹层 | ${s.overlays} |`);
  L.push(`| 按场景 | ${Object.entries(s.byScenario).map(([k, v]) => `${k} ${v} 页`).join(' · ')} |`);
  L.push('');
  L.push('## 四、模型使用审计（编译期白名单）');
  L.push('');
  L.push(`允许清单：${ALLOWED_MODELS.join(' / ')}。蓝图若声明清单外模型，编译直接中止。`);
  L.push('');
  L.push('| 模型 | 产出蓝图数 |');
  L.push('| --- | --- |');
  for (const [m, n] of Object.entries(s.byModel)) L.push(`| ${m} | ${n} |`);
  L.push('');
  L.push('工具侧不调用任何模型；模型只在内网 codeagent 会话里把需求文档转成声明式蓝图，');
  L.push('输出中若混入任何色值 / 字号 / 间距描述，链接器同样判为 error。');
  L.push('');
  L.push('## 五、批量一致性（结构指纹）');
  L.push('');
  if (!Object.keys(s.batchGroups || {}).length) L.push('本次没有批量组。');
  else {
    L.push('结构指纹 = 对「场景 → 区块序列 → 组件名 + props 键」做 SHA256，**不含任何数据值**。');
    L.push('批量组要求所有页面指纹相同：数据不同、结构必须一致。');
    L.push('');
    L.push('| 批量组 | 页数 | 不同结构数 | 指纹 | 结论 |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const [g, v] of Object.entries(s.batchGroups)) {
      L.push(`| ${g} | ${v.pages} | ${v.distinctStructures} | \`${v.fingerprint}\` | ${v.consistent ? '✓ 完全一致' : '✗ 不一致'} |`);
    }
  }
  L.push('');
  L.push('## 六、页面清单');
  L.push('');
  L.push('| 页面 id | 标题 | 场景 | 状态数 | 结构指纹 |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const p of manifest.pages) {
    L.push(`| ${p.id} | ${p.title} | ${p.scenario} | ${p.sceneCount} | \`${p.fingerprint}\` |`);
  }
  L.push('');
  if (lint.warnings.length) {
    L.push('## 七、警告');
    L.push('');
    lint.warnings.forEach(w => L.push(`- ${w}`));
    L.push('');
  }
  L.push('---');
  L.push('');
  L.push('结论：布局、配色、字号、间距、组件形态、交互状态均由编译期不变量约束；');
  L.push('模型只产出声明式蓝图，不产出任何 HTML/CSS，因此不存在「模型画歪」的通路。');
  return L.join('\n') + '\n';
}
