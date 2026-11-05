/* ============================================================
 * 组件契约 / Component Contracts
 * ------------------------------------------------------------
 * 这是「模型能用什么」的完整白名单。
 *   - 每个组件由本文件用确定性代码渲染，模型无法改写其 DOM/CSS。
 *   - 模型只能传 props，且 props 必须通过 validateProps 校验。
 *   - 交互以「动作串」声明：data-act="scene:empty|toast:已清空"
 *     运行时（runtime.js）统一解释，页面里没有一行手写脚本。
 * 设计不变量：所有视觉表现来自 charter.css + components.css；
 * 本文件不产出任何颜色值、字号值或布局数值。
 * ============================================================ */

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 动作数组 → data-act 字符串。文案内禁止使用竖线。 */
export function actAttr(acts) {
  if (!acts || !acts.length) return '';
  const s = (Array.isArray(acts) ? acts : [acts]).join('|').replace(/\|+/g, '|');
  return ` data-act="${esc(s)}"`;
}

function btn(b, extra = '') {
  const tone = b.tone === 'primary' ? ' btn--primary'
    : b.tone === 'danger' ? ' btn--danger'
      : b.tone === 'text' ? ' btn--text' : '';
  const size = b.size === 'lg' ? ' btn--lg' : b.size === 'sm' ? ' btn--sm' : '';
  const dis = b.disabled ? ' is-disabled' : '';
  return `<button type="button" class="btn${tone}${size}${dis}"${actAttr(b.act)}${extra}>${esc(b.label)}</button>`;
}

function tag(t) {
  if (!t) return '';
  const o = typeof t === 'string' ? { text: t } : t;
  const tone = o.tone || 'info';
  return `<span class="tag tag--${esc(tone)}"><span class="tag__dot"></span>${esc(o.text)}</span>`;
}

function cell(v) {
  if (v == null) return '<span class="table__sub">—</span>';
  if (typeof v === 'string' || typeof v === 'number') return esc(v);
  if (v.tag) return tag(v);
  if (v.link) return `<span class="table__link"${actAttr(v.act)}>${esc(v.link)}</span>`;
  let s = esc(v.text);
  if (v.sub) s += `<span class="table__sub">${esc(v.sub)}</span>`;
  return s;
}

function inputField(f, formMode) {
  const required = f.required ? '<i>*</i>' : '';
  const label = f.label ? `<label class="${formMode ? 'form__label' : 'field__label'}">${required}${esc(f.label)}</label>` : '';
  const wrapOpen = formMode ? '<div class="form__control">' : '';
  const wrapClose = formMode ? '</div>' : '';
  const attrs = ` name="${esc(f.name || '')}" data-field="${esc(f.name || '')}"`
    + (f.required ? ' data-required="1"' : '')
    + (f.rule ? ` data-rule="${esc(f.rule)}"` : '')
    + (f.error || f.required ? ` data-error="${esc(f.error || (f.label || '该项') + '不能为空')}"` : '')
    + (f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '');
  let ctrl;
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const val = typeof o === 'string' ? o : o.value;
      const txt = typeof o === 'string' ? o : o.label;
      return `<option value="${esc(val)}"${f.value === val ? ' selected' : ''}>${esc(txt)}</option>`;
    }).join('');
    ctrl = `<select class="select"${attrs}><option value="">${esc(f.placeholder || '请选择')}</option>${opts}</select>`;
  } else if (f.type === 'textarea') {
    ctrl = `<textarea class="textarea"${attrs}>${esc(f.value || '')}</textarea>`;
  } else if (f.type === 'date') {
    ctrl = `<input class="date" type="text"${attrs} value="${esc(f.value || '')}">`;
  } else if (f.type === 'checkbox') {
    const items = (f.options || []).map(o => `<label class="checkbox"><input type="checkbox" name="${esc(f.name)}" value="${esc(o)}">${esc(o)}</label>`).join('');
    ctrl = `<div class="toolbar__left"${attrs}>${items}</div>`;
  } else if (f.type === 'switch') {
    ctrl = `<label class="switch"><input type="checkbox" name="${esc(f.name)}"${f.value ? ' checked' : ''}>${esc(f.hint || '启用')}</label>`;
  } else {
    ctrl = `<input class="input" type="text"${attrs} value="${esc(f.value || '')}">`;
  }
  const hint = f.hint ? `<div class="${formMode ? 'form__hint' : 'field__hint'}">${esc(f.hint)}</div>` : '';
  const err = formMode ? '<div class="form__error"></div>' : '<div class="field__error"></div>';
  if (formMode) {
    return `<div class="form__row" data-form-row="${esc(f.name || '')}">${label}${wrapOpen}${ctrl}${hint}${err}${wrapClose}</div>`;
  }
  return `<div class="field" data-field-wrap="${esc(f.name || '')}">${label}${wrapOpen}${ctrl}${hint}${err}${wrapClose}</div>`;
}

/* ---------------------------------------------------------- */

export const CONTRACTS = {
  pageHead: {
    label: '页面标题区', required: ['title'], props: { title: 'string', desc: 'string', badges: 'array', actions: 'array' },
    render: p => `<div class="page-head">
      <div><h1 class="page-head__title">${esc(p.title)}</h1>
        ${p.desc ? `<p class="page-head__desc">${esc(p.desc)}</p>` : ''}
        ${(p.badges || []).length ? `<div class="page-head__badges">${p.badges.map(tag).join('')}</div>` : ''}
      </div>
      ${(p.actions || []).length ? `<div class="page-head__actions">${p.actions.map(b => btn(b)).join('')}</div>` : ''}
    </div>`,
  },

  notice: {
    label: '提示条', required: ['text'], props: { tone: 'string', title: 'string', text: 'string' },
    render: p => `<div class="alert alert--${esc(p.tone || 'info')}"><div><b>${esc(p.title || '说明')}</b>　${esc(p.text)}</div></div>`,
  },

  filterBar: {
    label: '筛选区', required: [], props: { fields: 'array', actions: 'array', note: 'string' },
    render: p => `<div class="filter">
      ${(p.fields || []).map(f => inputField(f, false)).join('')}
      <div class="toolbar__left">${(p.actions || []).map(b => btn(b)).join('')}</div>
      ${p.note ? `<div class="change-note">${esc(p.note)}</div>` : ''}
    </div>`,
  },

  toolbar: {
    label: '工具条', required: [], props: { count: 'string', left: 'array', right: 'array' },
    render: p => `<div class="toolbar">
      <div class="toolbar__left">${p.count ? `<span class="toolbar__count">${esc(p.count)}</span>` : ''}${(p.left || []).map(b => btn(b)).join('')}</div>
      <div class="toolbar__right">${(p.right || []).map(b => btn(b)).join('')}</div>
    </div>`,
  },

  dataTable: {
    label: '数据表格', required: ['columns', 'rows'], props: { columns: 'array', rows: 'array', selectable: 'boolean', pager: 'object|false', rowActs: 'array', opsTitle: 'string', emptyText: 'string' },
    render: p => {
      const cols = p.columns || [];
      const heads = `<tr>${p.selectable ? '<th style="width:36px"><input type="checkbox" data-select-all></th>' : ''}`
        + cols.map(c => `<th>${esc(c.title)}</th>`).join('')
        + ((p.rowActs || []).length ? `<th>${esc(p.opsTitle || '操作')}</th>` : '') + '</tr>';
      const body = (p.rows || []).map(r => `<tr>
        ${p.selectable ? '<td><input type="checkbox" data-row-check></td>' : ''}
        ${cols.map(c => `<td>${cell(r[c.key])}</td>`).join('')}
        ${(p.rowActs || []).length ? `<td><div class="row-ops">${p.rowActs.map(a => `<span class="table__link"${actAttr(a.act)}>${esc(a.label)}</span>`).join('')}</div></td>` : ''}
      </tr>`).join('');
      const pg = p.pager || {};
      const pager = p.pager === false ? '' : `<div class="pager">
        <span class="pager__info">共 ${esc(pg.total || (p.rows || []).length)} 条　每页 ${esc(pg.size || 10)} 条</span>
        <button class="pager__btn">上一页</button>
        <button class="pager__btn is-active">${esc(pg.page || 1)}</button>
        <button class="pager__btn">${Number(pg.page || 1) + 1}</button>
        <button class="pager__btn">下一页</button>
      </div>`;
      return `<div class="table-wrap"><table class="table"><thead>${heads}</thead><tbody>${body}</tbody></table></div>${pager}`;
    },
  },

  statGrid: {
    label: '指标卡组', required: ['items'], props: { items: 'array' },
    render: p => `<div class="stat-grid">${(p.items || []).map(i => `<div class="stat-card">
      <div class="stat-card__label">${esc(i.label)}</div>
      <div class="stat-card__value">${esc(i.value)}</div>
      <div class="stat-card__trend${i.direction === 'down' ? ' is-down' : ''}">${esc(i.trend || '')}</div>
    </div>`).join('')}</div>`,
  },

  chartGrid: {
    label: '图表占位', required: [], props: { boxes: 'array' },
    render: p => `<div class="chart-grid">${(p.boxes || []).map(b => `<div class="panel"><div class="panel__head">${esc(b.title)}</div>
      <div class="panel__body"><div class="chart-box">${(b.bars || []).map((n, i) => `<div class="chart-bar${i % 3 === 2 ? ' is-alt' : ''}" style="height:${Math.max(6, Math.min(100, Number(n) || 20))}%"></div>`).join('')}</div></div></div>`).join('')}</div>`,
  },

  descList: {
    label: '描述列表', required: ['items'], props: { items: 'array' },
    render: p => `<div class="desc-list">${(p.items || []).map(i => `<div class="desc-item">
      <div class="desc-item__label">${esc(i.label)}</div><div class="desc-item__value">${esc(i.value)}</div>
    </div>`).join('')}</div>`,
  },

  form: {
    label: '表单', required: ['id'], props: { id: 'string', sections: 'array', foot: 'array' },
    render: p => `<form class="form" data-form="${esc(p.id)}" onsubmit="return false">
      ${(p.sections || []).map(s => `<div class="form__section">${esc(s.title || '')}</div>
        ${(s.fields || []).map(f => inputField(f, true)).join('')}`).join('')}
      <div class="form__foot">${(p.foot || []).map(b => btn(b)).join('')}</div>
    </form>`,
  },

  steps: {
    label: '步骤条', required: ['items'], props: { items: 'array', current: 'number', id: 'string' },
    render: p => {
      const cur = Number(p.current || 1);
      return `<div class="steps" data-steps="${esc(p.id || 'steps')}">${(p.items || []).map((it, i) => {
        const n = i + 1;
        const cls = n < cur ? 'is-done' : n === cur ? 'is-active' : '';
        return `<div class="step ${cls}" data-step-no="${n}"><span class="step__no">${n < cur ? '✓' : n}</span><span>${esc(it.title || it)}</span></div>`
          + (i < (p.items || []).length - 1 ? '<span class="step__line"></span>' : '');
      }).join('')}</div>`;
    },
  },

  tabs: {
    label: '标签页', required: ['id', 'panes'], props: { id: 'string', panes: 'array' },
    render: (p, ctx) => `<div class="tabs" data-tabs="${esc(p.id)}">${(p.panes || []).map((t, i) =>
      `<div class="tab${i === 0 ? ' is-active' : ''}" data-tab-pane="${esc(t.id)}"${actAttr([`tab:${p.id}:${t.id}`])}>${esc(t.title)}</div>`).join('')}</div>
      ${(p.panes || []).map((t, i) => `<div class="tabpane${i === 0 ? '' : ' is-hidden'}" data-tab-body="${esc(p.id)}:${esc(t.id)}"${i === 0 ? '' : ' hidden'}>${renderBlocks(t.body || [], ctx)}</div>`).join('')}`,
  },

  sceneBar: {
    label: '状态切换条', required: ['scenes'], props: { scenes: 'array', active: 'string', label: 'string' },
    render: p => `<div class="scene-bar"><span class="scene-bar__label">${esc(p.label || '交互状态')}</span>
      ${(p.scenes || []).map(s => `<button type="button" class="scene-btn${s.id === (p.active || 'default') ? ' is-active' : ''}" data-scene-btn="${esc(s.id)}"${actAttr([`scene:${s.id}`])}>${esc(s.label)}</button>`).join('')}</div>`,
  },

  emptyState: {
    label: '空状态', required: [], props: { title: 'string', desc: 'string', actions: 'array' },
    render: p => `<div class="empty"><div class="empty__icon">□</div>
      <div class="empty__title">${esc(p.title || '暂无数据')}</div>
      <div class="empty__desc">${esc(p.desc || '')}</div>
      <div class="toolbar__left">${(p.actions || []).map(b => btn(b)).join('')}</div></div>`,
  },

  loadingState: {
    label: '加载状态', required: [], props: { rows: 'number', text: 'string' },
    render: p => `<div style="padding:var(--sp-6)"><div class="toolbar__left" style="margin-bottom:var(--sp-4)"><span class="spinner"></span><span>${esc(p.text || '正在加载数据…')}</span></div>
      ${Array.from({ length: Number(p.rows) || 6 }, (_, i) => `<div class="skeleton" style="margin-bottom:var(--sp-3);width:${100 - (i % 3) * 12}%"></div>`).join('')}</div>`,
  },

  successState: {
    label: '成功状态', required: [], props: { title: 'string', desc: 'string', actions: 'array' },
    render: p => `<div class="empty"><div class="empty__icon" style="background:var(--ok-soft);color:var(--ok)">✓</div>
      <div class="empty__title">${esc(p.title || '操作成功')}</div>
      <div class="empty__desc">${esc(p.desc || '')}</div>
      <div class="toolbar__left">${(p.actions || []).map(b => btn(b)).join('')}</div></div>`,
  },

  diffNote: {
    label: '变更说明', required: ['changes'], props: { changes: 'array', title: 'string' },
    render: p => `<div class="notice" style="padding:var(--sp-4)"><div class="panel__head" style="border:none;padding:0 0 var(--sp-2)">${esc(p.title || '本次需求变更点')}</div>
      ${(p.changes || []).map((c, i) => `<div class="change-note">${i + 1}. <b>${esc(c.type || '优化')}</b> · ${esc(c.zone)}：${esc(c.note)}</div>`).join('')}</div>`,
  },

  compare: {
    label: '新旧对照', required: ['old', 'new'], props: { old: 'array', new: 'array', oldTitle: 'string', newTitle: 'string' },
    render: (p, ctx) => `<div class="compare" data-compare>
      <div class="compare__col"><div class="compare__title">${esc(p.oldTitle || '改版前')}</div>${renderBlocks(p.old || [], ctx)}</div>
      <div class="compare__col is-new"><div class="compare__title">${esc(p.newTitle || '改版后')}</div>${renderBlocks(p.new || [], ctx)}</div>
    </div>`,
  },

  panel: {
    label: '面板容器', required: [], props: { title: 'string', body: 'array', headExtra: 'array', padded: 'boolean' },
    render: (p, ctx) => `<div class="panel">
      ${p.title ? `<div class="panel__head"><span>${esc(p.title)}</span><div class="toolbar__right">${(p.headExtra || []).map(b => btn(b)).join('')}</div></div>` : ''}
      <div class="${p.padded === false ? '' : 'panel__body'}">${renderBlocks(p.body || [], ctx)}</div></div>`,
  },

  timeline: {
    label: '时间线', required: ['items'], props: { items: 'array' },
    render: p => `<div>${(p.items || []).map(i => `<div class="alert alert--${esc(i.tone || 'info')}" style="margin-bottom:var(--sp-2)">
      <div style="min-width:var(--col-label-w);color:var(--ink-500)">${esc(i.time)}</div>
      <div><b>${esc(i.title)}</b>　${esc(i.desc || '')}</div></div>`).join('')}</div>`,
  },
};

/* ---------------------------------------------------------- */

export const COMPONENT_NAMES = Object.keys(CONTRACTS);

/** props 类型校验：返回错误数组（空数组 = 通过） */
export function validateProps(name, props) {
  const c = CONTRACTS[name];
  if (!c) return [`未知组件 "${name}"；可用：${COMPONENT_NAMES.join(', ')}`];
  const errs = [];
  for (const k of c.required || []) {
    if (props[k] == null) errs.push(`组件 ${name} 缺少必填属性 ${k}`);
  }
  for (const [k, spec] of Object.entries(c.props || {})) {
    if (props[k] == null && props[k] !== false) continue;
    const ok = String(spec).split('|').some(t =>
      t === 'array' ? Array.isArray(props[k])
        : t === 'object' ? (typeof props[k] === 'object' && !Array.isArray(props[k]) && props[k] !== null)
          : t === 'false' ? props[k] === false
            : typeof props[k] === t);
    if (!ok) errs.push(`组件 ${name} 的 ${k} 应为 ${spec}，实际 ${Array.isArray(props[k]) ? 'array' : typeof props[k]}`);
  }
  return errs;
}

/** 渲染单个区块；changed 区块自动套变更标记 */
export function renderBlock(block, ctx) {
  if (!block || !block.component) return `<!-- 空区块 -->`;
  const html = CONTRACTS[block.component].render(block.props || {}, ctx);
  if (!block.changed) return html;
  return `<div class="is-changed"><span class="diff-badge">${esc(block.changeLabel || '本次变更')}</span>${html}
    ${block.changeNote ? `<div class="change-note">${esc(block.changeNote)}</div>` : ''}</div>`;
}

export function renderBlocks(list, ctx) {
  return (list || []).map(b => renderBlock(b, ctx)).join('\n');
}
