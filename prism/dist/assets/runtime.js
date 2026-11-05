/* ============================================================
 * Prism 交互运行时 / Runtime
 * ------------------------------------------------------------
 * 页面内零手写脚本。所有交互来自蓝图的 data-act 动作串：
 *   navigate:<页面id>[:<场景>]   页面跳转
 *   scene:<场景>                 切换状态面板
 *   dialog:<id> / dialog:close  弹窗
 *   drawer:<id> / drawer:close  抽屉
 *   overlay:close               关闭当前弹层
 *   tab:<组id>:<面板id>          标签页
 *   step:<n>                    步骤条推进
 *   toast:<文案>                轻提示（文案内不要竖线）
 *   form:validate:<表单id>      输入校验，失败中断后续动作
 *   form:reset:<表单id>         重置表单
 *   wait:<毫秒>                 等待（用于加载→成功的状态剧本）
 *   toggle:<元素id>             显示/隐藏
 *   select:all / select:none    表格全选
 *   diff:on / diff:off          变更标记开关
 *   back                        返回上一页
 * 全部通过事件委托实现，可在 file:// 下直接运行，不发任何请求。
 * ============================================================ */
(function () {
  'use strict';

  var body = document.body;
  var base = body.getAttribute('data-base') || './';
  var toastTimer = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ---------- 状态面板 ---------- */
  function showScene(name) {
    var target = name || 'default';
    var found = false;
    $$('.scene').forEach(function (n) {
      var on = n.getAttribute('data-scene') === target;
      n.classList.toggle('is-active', on);
      if (on) found = true;
    });
    if (!found) {
      var first = $('.scene');
      if (first) { first.classList.add('is-active'); target = first.getAttribute('data-scene'); }
    }
    $$('[data-scene-btn]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-scene-btn') === target);
    });
    return target;
  }

  /* ---------- 弹层 ---------- */
  function openOverlay(id) {
    $$('.overlay').forEach(function (o) { o.classList.remove('is-open'); });
    var el = $('.overlay[data-overlay="' + id + '"]');
    if (el) el.classList.add('is-open');
  }
  function closeOverlays() { $$('.overlay').forEach(function (o) { o.classList.remove('is-open'); }); }

  /* ---------- 提示 ---------- */
  function toast(msg) {
    var t = $('[data-toast]');
    if (!t) return;
    t.textContent = msg || '操作成功';
    t.classList.add('is-open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-open'); }, 2200);
  }

  /* ---------- 表单校验 ---------- */
  function clearField(row) {
    row.classList.remove('is-error');
    var e = $('.form__error, .field__error', row);
    if (e) e.textContent = '';
    var w = $('[data-field-wrap], .form__row', row);
    if (w && w.classList.contains('field')) w.classList.remove('is-error');
  }
  function validate(formId) {
    var form = $('.form[data-form="' + formId + '"]') || $('[data-field-wrap]');
    var scope = form || document;
    var rows = $$('.form__row, .field[data-field-wrap]', scope);
    var ok = true;
    rows.forEach(function (row) {
      var ctrl = $('[data-field]', row);
      if (!ctrl) return;
      clearField(row);
      var val = (ctrl.value || '').trim();
      var need = ctrl.getAttribute('data-required') === '1'
        || (form && $('.form__label i', row) != null);
      if (need && !val) {
        ok = false;
        row.classList.add('is-error');
        var e1 = $('.form__error, .field__error', row);
        if (e1) e1.textContent = ctrl.getAttribute('data-error') || '该项不能为空';
        return;
      }
      var rule = ctrl.getAttribute('data-rule');
      if (val && rule) {
        var pass = true;
        if (rule === 'number') pass = /^\d+(\.\d+)?$/.test(val);
        else if (rule === 'phone') pass = /^1\d{10}$/.test(val);
        else if (rule.indexOf('min:') === 0) pass = val.length >= Number(rule.slice(4));
        else if (rule.indexOf('regex:') === 0) { try { pass = new RegExp(rule.slice(6)).test(val); } catch (err) { pass = true; } }
        if (!pass) {
          ok = false;
          row.classList.add('is-error');
          var e2 = $('.form__error, .field__error', row);
          if (e2) e2.textContent = ctrl.getAttribute('data-error') || '格式不正确';
        }
      }
    });
    if (!ok) toast('请检查标红的输入项');
    return ok;
  }
  function resetForm(formId) {
    $$('input, select, textarea', $('.form[data-form="' + formId + '"]') || document).forEach(function (n) {
      if (n.type === 'checkbox') n.checked = false;
      else if (n.type !== 'button') n.value = '';
    });
    $$('.is-error').forEach(function (n) { n.classList.remove('is-error'); });
    $$('.form__error, .field__error').forEach(function (n) { n.textContent = ''; });
  }

  /* ---------- 其它动作 ---------- */
  function setTab(group, pane) {
    $$('.tab[data-tab-pane]').forEach(function (t) {
      if (t.closest('[data-tabs]') && t.closest('[data-tabs]').getAttribute('data-tabs') === group) {
        t.classList.toggle('is-active', t.getAttribute('data-tab-pane') === pane);
      }
    });
    $$('[data-tab-body]').forEach(function (p) {
      var hit = p.getAttribute('data-tab-body') === group + ':' + pane;
      p.hidden = !hit;
      p.classList.toggle('is-hidden', !hit);
    });
  }
  function setStep(n) {
    $$('[data-steps]').forEach(function (g) {
      $$('.step[data-step-no]', g).forEach(function (s) {
        var i = Number(s.getAttribute('data-step-no'));
        s.classList.toggle('is-active', i === n);
        s.classList.toggle('is-done', i < n);
        var no = $('.step__no', s);
        if (no) no.textContent = i < n ? '✓' : String(i);
      });
    });
  }
  function selectAll(on) {
    $$('[data-row-check]').forEach(function (c) { c.checked = !!on; });
    var a = $('[data-select-all]');
    if (a) a.checked = !!on;
  }

  /* ---------- 动作串解释 ---------- */
  async function run(act, source) {
    var steps = String(act || '').split('|').filter(Boolean);
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var pos = s.indexOf(':');
      var key = pos < 0 ? s : s.slice(0, pos);
      var val = pos < 0 ? '' : s.slice(pos + 1);
      switch (key) {
        case 'navigate': {
          var parts = val.split(':');
          var url = base + parts[0] + '.html' + (parts[1] ? '?scene=' + encodeURIComponent(parts[1]) : '');
          location.href = url;
          return;
        }
        case 'scene': showScene(val); break;
        case 'dialog': case 'drawer':
          if (val === 'close') closeOverlays(); else openOverlay(val);
          break;
        case 'overlay': case 'close': closeOverlays(); break;
        case 'tab': {
          var t = val.split(':');
          setTab(t[0], t[1]);
          break;
        }
        case 'step': setStep(Number(val) || 1); break;
        case 'toast': toast(val); break;
        case 'form': {
          var f = val.split(':');
          if (f[0] === 'validate') { if (!validate(f[1])) return; }
          else if (f[0] === 'reset') resetForm(f[1]);
          break;
        }
        case 'wait': await new Promise(function (r) { setTimeout(r, Math.min(5000, Number(val) || 300)); }); break;
        case 'toggle': {
          var el = document.getElementById(val)
            || $('[data-compare="' + val + '"]')
            || (val === 'compare' ? $('[data-compare]') : null);
          if (el) el.hidden = !el.hidden;
          break;
        }
        case 'select': selectAll(val === 'all'); break;
        case 'diff': body.classList.toggle('diff-on', val === 'on'); break;
        case 'back': history.back(); break;
        default: break;
      }
    }
  }

  /* ---------- 事件委托 ---------- */
  document.addEventListener('click', function (ev) {
    var node = ev.target.closest('[data-act]');
    if (node) {
      ev.preventDefault();
      run(node.getAttribute('data-act'), node);
      return;
    }
    if (ev.target.closest('.overlay__mask, [data-overlay-close]')) { closeOverlays(); return; }
    if (ev.target.closest('.dialog__close, .drawer__close')) { closeOverlays(); return; }
    var tab = ev.target.closest('.tab[data-tab-pane]');
    if (tab) {
      var g = tab.closest('[data-tabs]');
      if (g) setTab(g.getAttribute('data-tabs'), tab.getAttribute('data-tab-pane'));
    }
    var sa = ev.target.closest('[data-select-all]');
    if (sa) selectAll(sa.checked);
  });

  document.addEventListener('input', function (ev) {
    var row = ev.target.closest('.form__row, .field[data-field-wrap]');
    if (row && row.classList.contains('is-error') && (ev.target.value || '').trim()) {
      clearField(row);
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeOverlays();
  });

  document.addEventListener('DOMContentLoaded', function () {
    var q = new URLSearchParams(location.search);
    showScene(q.get('scene') || body.getAttribute('data-default-scene') || 'default');
  });
  if (document.readyState !== 'loading') {
    var q2 = new URLSearchParams(location.search);
    showScene(q2.get('scene') || body.getAttribute('data-default-scene') || 'default');
  }

  window.Prism = { scene: showScene, validate: validate, toast: toast, open: openOverlay, close: closeOverlays, tab: setTab, step: setStep };
})();
