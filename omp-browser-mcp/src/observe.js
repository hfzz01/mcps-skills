/**
 * 页面元素采集：omp `observe()` 的等价实现。
 *
 * 与 omp 的差异：omp 走 Playwright 打包的 ARIA snapshot 源码；这里用一段自包含的
 * 页面内脚本直接遍历 DOM 计算 role / accessible name / state，并给元素打上
 * `data-omp-ref` 序号。好处是零外部资产、可完全离线，且 ref 天然就是可点击的选择器。
 */

const COLLECT = `(opts) => {
  const ATTR = 'data-omp-ref';
  const roots = [document];
  document.querySelectorAll('[' + ATTR + ']').forEach(el => el.removeAttribute(ATTR));

  const INPUT_ROLE = {
    text: 'textbox', email: 'textbox', tel: 'textbox', url: 'textbox',
    search: 'searchbox', password: 'textbox', number: 'spinbutton',
    checkbox: 'checkbox', radio: 'radio', range: 'slider',
    submit: 'button', button: 'button', reset: 'button', image: 'button', file: 'button',
  };
  const INTERACTIVE = new Set([
    'button','link','textbox','combobox','listbox','option','checkbox','radio','switch',
    'tab','menuitem','menuitemcheckbox','menuitemradio','slider','spinbutton','searchbox','treeitem',
  ]);

  const clip = (s, n) => (s ? String(s).replace(/\\s+/g, ' ').trim().slice(0, n) : '');

  function roleOf(el) {
    const explicit = (el.getAttribute && el.getAttribute('role') || '').toLowerCase();
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'INPUT') return INPUT_ROLE[(el.type || 'text').toLowerCase()] || 'textbox';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SUMMARY') return 'button';
    if (el.isContentEditable) return 'textbox';
    return '';
  }

  function nameOf(el) {
    const idref = el.getAttribute && el.getAttribute('aria-labelledby');
    if (idref) {
      const parts = idref.split(/\\s+/).map(id => {
        const t = document.getElementById(id);
        return t ? t.textContent : '';
      }).filter(Boolean);
      if (parts.length) return clip(parts.join(' '), 80);
    }
    const label = el.getAttribute && el.getAttribute('aria-label');
    if (label) return clip(label, 80);
    if (el.labels && el.labels.length) return clip(el.labels[0].textContent, 80);
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const wrapped = el.closest('label');
      if (wrapped) return clip(wrapped.textContent, 80);
      if (el.placeholder) return clip(el.placeholder, 80);
      if (tag === 'INPUT' && ['submit','button','reset'].includes((el.type||'').toLowerCase()) && el.value) {
        return clip(el.value, 80);
      }
      if (el.title) return clip(el.title, 80);
      return '';
    }
    const text = el.innerText || el.textContent || '';
    if (text.trim()) return clip(text, 80);
    if (el.title) return clip(el.title, 80);
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img) return clip(img.alt, 80);
    return '';
  }

  function valueOf(el) {
    if (el.tagName === 'INPUT') {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return '';
      return clip(el.value, 60);
    }
    if (el.tagName === 'TEXTAREA') return clip(el.value, 60);
    if (el.tagName === 'SELECT') {
      const opt = el.selectedOptions && el.selectedOptions[0];
      return opt ? clip(opt.textContent, 60) : '';
    }
    return '';
  }

  function statesOf(el) {
    const out = [];
    if (el.disabled) out.push('disabled');
    if (el.required) out.push('required');
    if (el.readOnly) out.push('readonly');
    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' && typeof el.checked === 'boolean') out.push('checked=' + el.checked);
    if (type === 'radio' && el.checked) out.push('checked=true');
    if (el.selected && el.tagName === 'OPTION') out.push('selected');
    const expanded = el.getAttribute && el.getAttribute('aria-expanded');
    if (expanded !== null && expanded !== undefined) out.push('expanded=' + expanded);
    if (document.activeElement === el) out.push('focused');
    return out;
  }

  function visible(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    if (opts.viewportOnly) {
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    }
    return true;
  }

  const SKIP = new Set(['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','HEAD','META','LINK','TITLE','BR','HR']);
  const elements = [];
  let seq = 0;

  function walk(parent, depth) {
    if (depth > 24) return;
    let children = parent.children;
    if (!children) return;
    for (const el of Array.from(children)) {
      if (SKIP.has(el.tagName)) continue;
      const role = roleOf(el);
      const interactive = INTERACTIVE.has(role) || el.isContentEditable ||
        (el.getAttribute && el.getAttribute('tabindex') !== null && role);
      if ((opts.includeAll || interactive) && visible(el)) {
        seq += 1;
        el.setAttribute(ATTR, String(seq));
        elements.push({
          ref: seq,
          tag: el.tagName.toLowerCase(),
          role: role || 'generic',
          name: nameOf(el),
          value: valueOf(el),
          states: statesOf(el),
          depth,
        });
      }
      walk(el, depth + 1);
      if (opts.pierce && el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
  }

  for (const root of roots) walk(root, 0);

  return {
    url: location.href,
    title: document.title || '',
    viewport: { width: innerWidth, height: innerHeight },
    scroll: {
      x: Math.round(scrollX), y: Math.round(scrollY),
      w: innerWidth, h: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
    },
    total: elements.length,
    elements,
  };
}`;

export async function collect(page, opts = {}) {
  return page.evaluate(
    new Function(`return (${COLLECT})`)(),
    {
      includeAll: !!opts.include_all,
      viewportOnly: !!opts.viewport_only,
      pierce: !!opts.pierce,
    }
  );
}

function line(el) {
  const parts = [`[${el.ref}]`, el.role];
  if (el.name) parts.push(`"${el.name}"`);
  if (el.value) parts.push(`= "${el.value}"`);
  if (el.states.length) parts.push(`[${el.states.join(",")}]`);
  return parts.join(" ");
}

/** 视图一：扁平清单 + 数字 ref。省 token，适合表单填写、列表操作等绝大多数场景。 */
export function formatList(snapshot, limit, viewportOnly) {
  const shown = snapshot.elements.slice(0, limit);
  const out = [
    `URL: ${snapshot.url}`,
    `标题: ${snapshot.title || "(无)"}`,
    `视口: ${snapshot.viewport.width}x${snapshot.viewport.height}　滚动: ${snapshot.scroll.y}/${snapshot.scroll.sh}`,
    "",
  ];
  if (!shown.length) {
    out.push("当前没有采集到可交互元素。若页面尚未加载完，先调用 browser_wait_for；若内容在滚动区域之外，可去掉 viewport_only 再观察。");
    return out.join("\n");
  }
  for (const el of shown) out.push(line(el));
  out.push("");
  if (snapshot.elements.length > shown.length) {
    out.push(`（共 ${snapshot.elements.length} 个，已截断至前 ${shown.length} 个${viewportOnly ? "；可去掉 viewport_only 看全部，或用 browser_wait_for 等目标出现" : ""}）`);
  }
  out.push(`共 ${shown.length} 个可交互元素。后续操作直接传 ref=方括号里的数字，例如 browser_click(ref=${shown[0].ref})。`);
  return out.join("\n");
}

/** 视图二：缩进树 + ref。保留层级上下文，适合嵌套组件、需要理解结构时。 */
export function formatTree(snapshot, limit) {
  const shown = snapshot.elements.slice(0, limit);
  const out = [`URL: ${snapshot.url}`, `标题: ${snapshot.title || "(无)"}`, ""];
  for (const el of shown) {
    out.push(`${"  ".repeat(Math.min(el.depth, 12))}${line(el)}`);
  }
  if (snapshot.elements.length > shown.length) {
    out.push("", `（共 ${snapshot.elements.length} 个，已截断至前 ${shown.length} 个）`);
  }
  return out.join("\n");
}
