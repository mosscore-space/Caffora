// Shared UI building blocks: sheets, toast, confirm, searchable picker, wheel pickers, star slider, radar chart.
import { h, s, icon, clamp, norm, MONTHS, pad2, daysInMonth, today, parseYMD, ymd, fmtDateLong, uid } from './util.js';

/* =========================================================
   Sheets (bottom sheet on phones, dialog on desktop)
   ========================================================= */
const stack = [];
const host = () => document.getElementById('sheets');

/* History: every open sheet owns one history entry so the phone's back button closes the top sheet.
   Pushes and backs are queued so they can never interleave (e.g. closing one sheet while opening the next). */
const hq = [];
let hbusy = false, expectPop = false, idleWaiters = [];
function histPush() { hq.push('push'); hpump(); }
function histBack() { hq.push('back'); hpump(); }
function hpump() {
  if (hbusy) return;
  if (!hq.length) { const w = idleWaiters; idleWaiters = []; w.forEach(fn => fn()); return; }
  const op = hq.shift();
  if (op === 'push') { history.pushState({ sheet: true }, ''); hpump(); return; }
  hbusy = true; expectPop = true;
  history.back();
  setTimeout(() => { if (hbusy && expectPop) { hbusy = false; expectPop = false; hpump(); } }, 500); // safety net
}
/** Run fn once all pending history changes have settled. */
export function whenHistoryIdle(fn) { if (!hbusy && !hq.length) fn(); else idleWaiters.push(fn); }

window.addEventListener('popstate', () => {
  if (expectPop) { expectPop = false; hbusy = false; hpump(); return; }
  const top = stack[stack.length - 1];
  if (top) top.close(undefined, true); // the user pressed back
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
});

/**
 * openSheet({ title, body, footer, onClose, size:'md'|'lg'|'sm', headRight })
 * returns { el, body, close(result), setTitle, done: Promise }
 */
export function openSheet({ title = '', body, footer, onClose, size = 'md', headRight, className = '' } = {}) {
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  const titleEl = h('h2.sheet-title', title);
  const bodyEl = h('div.sheet-body', body);
  const footEl = footer ? h('div.sheet-foot', footer) : null;
  const closeBtn = h('button.icon-btn.sheet-x', { type: 'button', 'aria-label': 'Close', onclick: () => api.close() }, icon('close', 20));
  const panel = h('div.sheet.size-' + size + className.split(' ').filter(Boolean).map(c => '.' + c).join(''), { role: 'dialog', 'aria-modal': 'true' },
    h('div.sheet-grab'),
    h('header.sheet-head', closeBtn, titleEl, h('div.sheet-head-r', headRight || null)),
    bodyEl, footEl);
  const overlay = h('div.overlay', { onpointerdown: (e) => { if (e.target === overlay) api.close(); } }, panel);
  host().append(overlay);
  document.body.classList.add('noscroll');
  document.getElementById('toast')?.classList.remove('show');
  requestAnimationFrame(() => overlay.classList.add('open'));
  histPush();
  let closed = false;
  const api = {
    el: panel, body: bodyEl, overlay, done,
    setTitle: (t) => { titleEl.textContent = t; },
    close(result, fromPop = false) {
      if (closed) return; closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      if (!fromPop) histBack();
      overlay.classList.remove('open');
      const finish = () => { overlay.remove(); if (!stack.length) document.body.classList.remove('noscroll'); };
      setTimeout(finish, 220);
      onClose && onClose(result);
      resolveDone(result);
    },
  };
  stack.push(api);
  return api;
}
export const closeAllSheets = () => [...stack].reverse().forEach(s => s.close());

/* =========================================================
   Toast
   ========================================================= */
let toastTimer;
export function toast(message, { action, ms = 3800 } = {}) {
  const t = document.getElementById('toast');
  t.replaceChildren(...[h('span', message), action ? h('button.toast-act', { onclick: () => { t.classList.remove('show'); action.fn(); } }, action.label) : null].filter(Boolean));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* =========================================================
   Confirm dialog
   ========================================================= */
export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise(resolve => {
    let result = false;
    const sheet = openSheet({
      title, size: 'sm', className: 'confirm',
      body: h('p.confirm-text', text),
      footer: [
        h('button.btn', { type: 'button', onclick: () => sheet.close() }, cancelLabel),
        h('button.btn.primary' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { result = true; sheet.close(); } }, confirmLabel),
      ],
      onClose: () => resolve(result),
    });
  });
}

/* =========================================================
   Form helpers
   ========================================================= */
export function field(label, control, hint, cls = '') {
  return h('label.field' + (cls ? '.' + cls : ''), h('span.field-label', label), control, hint ? h('span.field-hint', hint) : null);
}
/** A div-based field (for controls that contain several buttons, so <label> would mis-route clicks). */
export function group(label, control, hint, cls = '') {
  return h('div.field' + (cls ? '.' + cls : ''), h('div.field-label', label), control, hint ? h('div.field-hint', hint) : null);
}
export function section(title, ...kids) { return h('section.form-sec', title ? h('h3', title) : null, ...kids); }

/** A button that looks like a select; call .set(text) to update. */
export function selectButton({ placeholder = 'Select', onclick, leading }) {
  const txt = h('span.sel-text.placeholder', placeholder);
  const lead = h('span.sel-lead');
  const btn = h('button.sel', { type: 'button', onclick }, lead, txt, icon('chevron', 18, 'sel-chev'));
  btn.set = (text, leadNode) => {
    txt.textContent = text || placeholder;
    txt.classList.toggle('placeholder', !text);
    lead.replaceChildren(...(leadNode ? [leadNode] : []));
  };
  btn.markInvalid = (on) => btn.classList.toggle('invalid', !!on);
  return btn;
}

export function segmented({ options, value, onChange, cls = '' }) {
  let cur = value;
  const btns = options.map(o => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o.v === cur),
    onclick: () => set(o.v, true),
  }, o.label));
  const el = h('div.seg' + (cls ? '.' + cls : ''), { role: 'radiogroup' }, btns);
  function paint() { btns.forEach((b, i) => { const on = options[i].v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
  function set(v, fire) { cur = v; paint(); if (fire && onChange) onChange(v); }
  paint();
  return { el, get: () => cur, set: (v) => set(v, false) };
}

/* =========================================================
   Searchable list picker (countries, varieties, processes, methods, beans, grinders)
   items: [{ id, label, sub, lead (fn → node), alt: [strings], disabled }]
   resolves: { item } | { create: 'text' } | null
   ========================================================= */
export function pickFromList({ title, items, selected, placeholder = 'Search', allowNew = false, newNoun = 'item', grouped = false, emptyText = 'Nothing matches.', showAll = true }) {
  return new Promise(resolve => {
    let result = null;
    const input = h('input.search-input', { type: 'search', placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterkeyhint: 'done' });
    const list = h('div.pick-list', { role: 'listbox' });
    const sheet = openSheet({
      title, size: 'lg', className: 'picker',
      body: [h('div.search-bar', icon('search', 18), input), list],
      onClose: () => resolve(result),
    });
    const prepared = items.map(it => ({ it, n: norm(it.label), alts: (it.alt || []).map(norm) }));
    const choose = (r) => { result = r; sheet.close(); };

    function row(it) {
      const on = selected != null && it.id === selected;
      return h('button.pick-row' + (on ? '.on' : '') + (it.disabled ? '.dim' : ''), { type: 'button', role: 'option', 'aria-selected': String(on), onclick: () => choose({ item: it }) },
        it.lead ? it.lead() : null,
        h('span.pick-main', h('span.pick-label', it.label), it.sub ? h('span.pick-sub', it.sub) : null),
        on ? icon('check', 18, 'pick-check') : null);
    }
    function render() {
      const raw = input.value.trim(), q = norm(raw);
      list.replaceChildren();
      let found = prepared;
      if (q) {
        found = prepared.filter(p => p.n.startsWith(q) || p.alts.some(a => a.startsWith(q)));
        if (!found.length) found = prepared.filter(p => p.n.includes(q) || p.alts.some(a => a.includes(q)));
      } else if (!showAll) found = [];
      if (allowNew && q && !prepared.some(p => p.n === q)) {
        list.append(h('button.pick-row.new', { type: 'button', onclick: () => choose({ create: raw.replace(/\s+/g, ' ') }) },
          h('span.pick-plus', icon('plus', 18)),
          h('span.pick-main', h('span.pick-label', `Add “${raw}” as a new ${newNoun}`))));
      }
      if (!found.length && !(allowNew && q)) { list.append(h('p.pick-empty', emptyText)); return; }
      let letter = '';
      for (const p of found) {
        if (grouped && !q) {
          const L = (p.it.label[0] || '').toUpperCase();
          if (L !== letter) { letter = L; list.append(h('div.pick-letter', L)); }
        }
        list.append(row(p.it));
      }
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = list.querySelector('.pick-row:not(.new)');
      const addRow = list.querySelector('.pick-row.new');
      const q = norm(input.value);
      const exact = prepared.find(p => p.n === q);
      if (exact) choose({ item: exact.it });
      else if (addRow && !first) addRow.click();
      else if (first) first.click();
      else if (addRow) addRow.click();
    });
    render();
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const on = list.querySelector('.pick-row.on'); if (on) on.scrollIntoView({ block: 'center' });
    });
  });
}

/* =========================================================
   Wheel (vertical snap picker)
   ========================================================= */
export function Wheel({ items, index = 0, onChange, itemH = 42, rows = 5, label = '', cls = '' }) {
  const H = itemH * rows, pad = (H - itemH) / 2;
  let cur = clamp(index, 0, items.length - 1), timer, dragging = false;
  const list = h('div.wheel-list', { style: { paddingBlock: pad + 'px' } });
  const scroller = h('div.wheel-scroll', { style: { height: H + 'px' } }, list);
  const root = h('div.wheel' + (cls ? '.' + cls : ''), { tabindex: 0, role: 'listbox', 'aria-label': label, style: { height: H + 'px', '--item-h': itemH + 'px' } },
    scroller, h('div.wheel-band'));

  function build() {
    list.replaceChildren(...items.map((it, i) => h('div.wheel-item', { role: 'option', onclick: () => { if (!dragging) goTo(i, true); } }, it.label)));
    paint(cur);
  }
  function paint(i) { [...list.children].forEach((c, k) => { c.classList.toggle('on', k === i); const d = Math.abs(k - i); c.style.opacity = d === 0 ? 1 : d === 1 ? 0.55 : d === 2 ? 0.28 : 0.12; }); }
  function goTo(i, smooth) {
    i = clamp(i, 0, items.length - 1);
    scroller.scrollTo({ top: i * itemH, behavior: smooth ? 'smooth' : 'auto' });
    if (!smooth) { cur = i; paint(i); }
  }
  function settle() {
    const i = clamp(Math.round(scroller.scrollTop / itemH), 0, items.length - 1);
    paint(i);
    if (i !== cur) { cur = i; onChange && onChange(items[i], i); }
    else cur = i;
  }
  scroller.addEventListener('scroll', () => {
    if (dragging) { paint(clamp(Math.round(scroller.scrollTop / itemH), 0, items.length - 1)); return; }
    paint(clamp(Math.round(scroller.scrollTop / itemH), 0, items.length - 1));
    clearTimeout(timer); timer = setTimeout(settle, 110);
  }, { passive: true });
  scroller.addEventListener('scrollend', () => { clearTimeout(timer); if (!dragging) settle(); });

  // mouse drag (touch uses native scrolling)
  let startY = 0, startTop = 0, moved = 0;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragging = true; moved = 0; startY = e.clientY; startTop = scroller.scrollTop;
    scroller.style.scrollSnapType = 'none'; scroller.classList.add('grabbing');
    scroller.setPointerCapture(e.pointerId);
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = Math.max(moved, Math.abs(e.clientY - startY));
    scroller.scrollTop = startTop - (e.clientY - startY);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    scroller.style.scrollSnapType = ''; scroller.classList.remove('grabbing');
    try { scroller.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (moved < 4) {
      const r = scroller.getBoundingClientRect();
      const i = Math.round((scroller.scrollTop + (e.clientY - r.top) - H / 2) / itemH);
      goTo(i, true);
    } else goTo(Math.round(scroller.scrollTop / itemH), true);
    setTimeout(() => { dragging = false; settle(); }, 0);
  };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); goTo(cur + 1, true); }
    if (e.key === 'ArrowUp') { e.preventDefault(); goTo(cur - 1, true); }
  });

  build();
  requestAnimationFrame(() => goTo(cur, false));
  return {
    el: root,
    get index() { return cur; },
    get value() { return items[cur]?.value; },
    setItems(newItems, keep = true) {
      items = newItems; cur = clamp(keep ? cur : 0, 0, items.length - 1); build(); goTo(cur, false);
    },
    setIndex: (i) => goTo(i, false),
  };
}

/* =========================================================
   Date picker: day / month / year wheels
   ========================================================= */
export function pickDate({ title = 'Select date', value, optional = false } = {}) {
  return new Promise(resolve => {
    const base = value ? parseYMD(value) : new Date();
    const nowY = new Date().getFullYear();
    const minY = Math.min(nowY - 15, base.getFullYear()), maxY = Math.max(nowY + 1, base.getFullYear());
    const years = []; for (let y = minY; y <= maxY; y++) years.push({ value: y, label: String(y) });
    let y = base.getFullYear(), m = base.getMonth() + 1, d = base.getDate();
    const dayItems = (n) => Array.from({ length: n }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
    const readout = h('div.date-readout');
    const upd = () => { readout.textContent = fmtDateLong(`${y}-${pad2(m)}-${pad2(d)}`); };
    const dayW = Wheel({ items: dayItems(daysInMonth(y, m)), index: d - 1, label: 'Day', cls: 'w-day', onChange: (it) => { d = it.value; upd(); } });
    const monW = Wheel({ items: MONTHS.map((n, i) => ({ value: i + 1, label: n })), index: m - 1, label: 'Month', cls: 'w-mon', onChange: (it) => { m = it.value; fixDays(); upd(); } });
    const yrW = Wheel({ items: years, index: y - minY, label: 'Year', cls: 'w-yr', onChange: (it) => { y = it.value; fixDays(); upd(); } });
    function fixDays() {
      const n = daysInMonth(y, m);
      if (dayW.el.querySelectorAll('.wheel-item').length !== n) {
        if (d > n) d = n;
        dayW.setItems(dayItems(n), true); dayW.setIndex(d - 1);
      }
    }
    let result = null;
    const sheet = openSheet({
      title, size: 'sm', className: 'wheel-sheet',
      body: [readout, h('div.wheels', dayW.el, monW.el, yrW.el), h('div.wheel-cap', h('span', 'Day'), h('span', 'Month'), h('span', 'Year'))],
      footer: [
        optional && value ? h('button.btn.ghost', { type: 'button', onclick: () => { result = ''; sheet.close(); } }, 'Clear') : null,
        h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => { result = `${y}-${pad2(m)}-${pad2(d)}`; sheet.close(); } }, 'Done'),
      ],
      onClose: () => resolve(result),
    });
    upd();
  });
}

/* =========================================================
   Time picker: hours / minutes / seconds wheels
   ========================================================= */
export function pickTime({ title = 'Extraction time', value = 0 } = {}) {
  return new Promise(resolve => {
    let hh = Math.floor(value / 3600), mm = Math.floor((value % 3600) / 60), ss = value % 60;
    const range = (n) => Array.from({ length: n }, (_, i) => ({ value: i, label: pad2(i) }));
    const readout = h('div.date-readout.mono');
    const upd = () => { readout.textContent = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`; };
    const wH = Wheel({ items: range(25), index: hh, label: 'Hours', onChange: (it) => { hh = it.value; upd(); } });
    const wM = Wheel({ items: range(60), index: mm, label: 'Minutes', onChange: (it) => { mm = it.value; upd(); } });
    const wS = Wheel({ items: range(60), index: ss, label: 'Seconds', onChange: (it) => { ss = it.value; upd(); } });
    let result = null;
    const sheet = openSheet({
      title, size: 'sm', className: 'wheel-sheet',
      body: [readout, h('div.wheels', wH.el, wM.el, wS.el), h('div.wheel-cap', h('span', 'hr'), h('span', 'min'), h('span', 'sec'))],
      footer: [
        h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => { result = hh * 3600 + mm * 60 + ss; sheet.close(); } }, 'Done'),
      ],
      onClose: () => resolve(result),
    });
    upd();
  });
}

/* =========================================================
   Star rating slider (half stars; drag to fill)
   ========================================================= */
const STAR = 'M12 2.6l2.9 6.1 6.7.9-4.9 4.7 1.2 6.6L12 17.7 6.1 20.9l1.2-6.6L2.4 9.6l6.7-.9L12 2.6z';
export function StarSlider({ value = 0, onChange, max = 5, label = 'Rating' } = {}) {
  let v = value;
  const starRow = (cls) => h('div.star-row.' + cls, Array.from({ length: max }, () =>
    s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: STAR }))));
  const fill = h('div.star-fill', starRow('f'));
  const track = h('div.star-track', starRow('b'), fill);
  const num = h('span.star-num');
  const clearBtn = h('button.star-clear', { type: 'button', onclick: () => set(0, true), 'aria-label': 'Clear rating' }, 'Clear');
  const el = h('div.stars', { role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuestep': 0.5 }, track, h('div.star-meta', num, clearBtn));
  function paint() {
    fill.style.clipPath = `inset(0 ${100 - v / max * 100}% 0 0)`;
    num.textContent = v ? v.toFixed(1) : 'Not rated';
    num.classList.toggle('none', !v);
    clearBtn.hidden = !v;
    el.setAttribute('aria-valuenow', v);
  }
  function set(nv, fire) { v = nv; paint(); if (fire && onChange) onChange(v); }
  function fromEvent(e) {
    const r = track.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1);
    return Math.round(x * max * 2) / 2;
  }
  let drag = false;
  track.addEventListener('pointerdown', (e) => { drag = true; track.setPointerCapture(e.pointerId); set(fromEvent(e), true); });
  track.addEventListener('pointermove', (e) => { if (drag) set(fromEvent(e), true); });
  const up = () => { drag = false; };
  track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(clamp(v + 0.5, 0, max), true); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(clamp(v - 0.5, 0, max), true); }
  });
  paint();
  return { el, get: () => v, set: (nv) => set(nv, false) };
}

/* =========================================================
   Radar chart (5 axes)
   ========================================================= */
export const SENSORY = [
  { k: 'aroma', label: 'Aroma' }, { k: 'sweetness', label: 'Sweetness' }, { k: 'acidity', label: 'Acidity' },
  { k: 'bitterness', label: 'Bitterness' }, { k: 'body', label: 'Body' },
];
export function Radar({ values = {}, size = 260, max = 10, showValues = true, compact = false } = {}) {
  const c = size / 2, R = compact ? size * 0.4 : size * 0.33, n = SENSORY.length;
  const pt = (i, r) => { const a = (-90 + (360 / n) * i) * Math.PI / 180; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const ring = (f) => SENSORY.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const svg = s('svg.radar', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Sensory profile radar chart' });
  [0.2, 0.4, 0.6, 0.8, 1].forEach(f => svg.append(s('polygon.r-ring', { points: ring(f) })));
  SENSORY.forEach((_, i) => { const [x, y] = pt(i, R); svg.append(s('line.r-axis', { x1: c, y1: c, x2: x, y2: y })); });
  const poly = s('polygon.r-shape');
  const dots = SENSORY.map(() => s('circle.r-dot', { r: compact ? 2 : 3.4 }));
  svg.append(poly, ...dots);
  const labels = [];
  if (!compact) SENSORY.forEach((m, i) => {
    const [x, y] = pt(i, R + size * 0.075);
    const anchor = Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end';
    const t = s('text.r-label', { x, y: y + (i === 0 ? -2 : 4), 'text-anchor': anchor }, m.label);
    const tv = showValues ? s('tspan.r-val', { x, dy: '1.15em' }, '') : null;
    if (tv) t.append(tv);
    svg.append(t); labels.push(tv);
  });
  function update(vals) {
    const pts = SENSORY.map((m, i) => pt(i, R * clamp((Number(vals[m.k]) || 0) / max, 0, 1)));
    poly.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    pts.forEach((p, i) => { dots[i].setAttribute('cx', p[0]); dots[i].setAttribute('cy', p[1]); });
    labels.forEach((tv, i) => { if (tv) tv.textContent = String(Number(vals[SENSORY[i].k]) || 0); });
  }
  update(values);
  return { el: svg, update };
}

/* =========================================================
   Stepper for grind size
   ========================================================= */
export function Stepper({ value = '', step = 1, min = 0, max = Infinity, onChange, decimals = null, unit = '' } = {}) {
  const dec = decimals ?? (String(step).split('.')[1]?.length || 0);
  const input = h('input.step-input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value === '' || value == null ? '' : String(value), 'aria-label': 'Grind size' });
  const minus = h('button.step-btn', { type: 'button', 'aria-label': 'Decrease', onclick: () => bump(-1) }, icon('chevron', 18, 'rot'));
  const plus = h('button.step-btn', { type: 'button', 'aria-label': 'Increase', onclick: () => bump(1) }, icon('chevron', 18));
  const el = h('div.stepper', minus, input, unit ? h('span.step-unit', unit) : null, plus);
  const fmt = (n) => (dec ? n.toFixed(dec).replace(/\.?0+$/, '') : String(n));
  function get() { const n = parseFloat(input.value); return Number.isFinite(n) ? n : null; }
  function set(n, fire) {
    if (n == null) input.value = '';
    else { n = clamp(Math.round(n / step) * step, min, max); input.value = fmt(+n.toFixed(4)); }
    if (fire && onChange) onChange(get());
  }
  function bump(dir) { const cur = get() ?? (dir > 0 ? min - step : min + step); set(cur + dir * step, true); }
  input.addEventListener('input', () => { input.value = input.value.replace(/[^\d.]/g, ''); });
  input.addEventListener('change', () => set(get(), true));
  const api = {
    el, get, set: (n) => set(n, false),
    config(o) { if (o.step != null) step = o.step; if (o.max != null) max = o.max; if (o.min != null) min = o.min; },
  };
  return api;
}

export const newId = uid;

/** Read-only star display (supports halves). */
export function StarsStatic(value = 0, max = 5) {
  const row = (cls) => h('div.star-row.' + cls, Array.from({ length: max }, () => s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: STAR }))));
  return h('span.stars-ro', { role: 'img', 'aria-label': value ? `${value} out of ${max} stars` : 'Not rated' }, row('b'), h('div.star-fill', { style: { clipPath: `inset(0 ${100 - value / max * 100}% 0 0)` } }, row('f')));
}
