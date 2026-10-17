// Small shared helpers: DOM builder, dates, numbers, images.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript: h('div.card#id', {onclick, class:'x', style:{}}, child, 'text', [children]) */
const SKIP_PROP = new Set(['list', 'form', 'style', 'class', 'dataset', 'html']);
function applyAttrs(node, attrs, svg) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') String(v).split(' ').forEach(c => c && node.classList.add(c));
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv; } }
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (!svg && k in node && !SKIP_PROP.has(k) && k !== 'for') { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v === true ? '' : v);
  }
}
function make(tag, ns) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const node = ns ? document.createElementNS(ns, m[1]) : document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1)); else node.id = part.slice(1);
  }
  return node;
}
const isAttrs = (a) => a && typeof a === 'object' && !(a instanceof Node) && !Array.isArray(a);
export function h(tag, attrs, ...kids) {
  const node = make(tag);
  if (!isAttrs(attrs)) { kids.unshift(attrs); attrs = null; }
  applyAttrs(node, attrs, false);
  append(node, kids);
  return node;
}
function append(node, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    node.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
/** SVG variant of h */
export function s(tag, attrs, ...kids) {
  const node = make(tag, 'http://www.w3.org/2000/svg');
  if (!isAttrs(attrs)) { kids.unshift(attrs); attrs = null; }
  applyAttrs(node, attrs, true);
  append(node, kids);
  return node;
}

/** Replace a node's children, ignoring null/false and flattening arrays. */
export function fill(node, ...kids) { node.replaceChildren(); append(node, kids); return node; }
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- strings ---------- */
export const norm = (str) => (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const cap = (str) => str ? str[0].toUpperCase() + str.slice(1) : '';

/* ---------- numbers ---------- */
export const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
export function fmtG(g) { return `${nf1.format(Math.round(g * 10) / 10)} g`; }
export function round1(n) { return Math.round(n * 10) / 10; }

/* ---------- dates (all dates are local 'YYYY-MM-DD' strings) ---------- */
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON3 = MONTHS.map(m => m.slice(0, 3));
export const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => ymd(new Date());
export function parseYMD(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
export function daysInMonth(y, m /* 1-12 */) { return new Date(y, m, 0).getDate(); }
export function dayNumber(str) { const [y, m, d] = str.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); }
export const daysBetween = (a, b) => dayNumber(b) - dayNumber(a);
export function addDays(str, n) { const d = parseYMD(str); d.setDate(d.getDate() + n); return ymd(d); }
export function fmtDate(str, withYear = true) {
  if (!str) return '';
  const d = parseYMD(str);
  return `${d.getDate()} ${MON3[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
}
export function fmtDateLong(str) { const d = parseYMD(str); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
export function relDay(str) {
  const n = daysBetween(str, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n > 1 && n < 7) return parseYMD(str).toLocaleDateString('en-GB', { weekday: 'long' });
  return fmtDate(str, parseYMD(str).getFullYear() !== new Date().getFullYear());
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
}

/* ---------- device ---------- */
export const IS_PHONE = (() => {
  try { return matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
})();

/* ---------- images ---------- */
const urlCache = new WeakMap();
export function blobURL(blob) {
  if (!blob) return null;
  let u = urlCache.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urlCache.set(blob, u); }
  return u;
}
/** Downscale an image file to a JPEG blob (max edge px). */
export async function shrinkImage(file, max = 960, quality = 0.84) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width || bmp.naturalWidth, hgt = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, max / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(hgt * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', quality));
}

/* ---------- numeric-only inputs ---------- */
export function numericInput(input, { decimal = false, max } = {}) {
  input.setAttribute('inputmode', decimal ? 'decimal' : 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    let v = input.value.replace(decimal ? /[^\d.]/g : /\D/g, '');
    if (decimal) { const p = v.split('.'); if (p.length > 2) v = p[0] + '.' + p.slice(1).join(''); }
    if (max != null && v !== '' && Number(v) > max) v = String(max);
    if (v !== input.value) input.value = v;
  });
  input.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.key.length > 1) return;
    if (!(decimal ? /[\d.]/ : /\d/).test(e.key)) e.preventDefault();
  });
  return input;
}

/* ---------- icons (stroke icons, 24px grid) ---------- */
const P = {
  brews: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 3c0 1.2 1 1.4 1 2.6M12 3c0 1.2 1 1.4 1 2.6"/>',
  beans: '<path d="M6.4 5.6c3.2-3 9.2-1.4 11.4 2.8s1.4 8.2-1.8 10.4c-3.4 2.3-8.4.6-10.5-3.6S3.4 8.4 6.4 5.6z" transform="rotate(8 12 12)"/><path d="M8 7c2.5 1.6 3 4 1.6 6.2s-.4 4.2 2.4 5.6" transform="rotate(8 12 12)"/>',
  grinders: '<path d="M6 4h12l-1.2 6H7.2L6 4z"/><path d="M7.5 10h9v3h-9z"/><path d="M12 13v5"/><path d="M8 20h8"/><path d="M18 5.5h2.5v3"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  map: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  chevronR: '<path d="m9 6 6 6-6 6"/>',
  chevronL: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  star: '<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.6z"/>',
  back: '<path d="M10 6 4 12l6 6M4 12h16"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reset: '<path d="M4 4v6h6"/><path d="M5.5 15a7.5 7.5 0 1 0 1.2-7.3L4 10"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  drop: '<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>',
  empty: '<path d="M5 8h14l-1.5 11h-11L5 8z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
};
export function icon(name, size = 22, cls = '') {
  const span = document.createElement('span');
  span.className = 'ico ' + cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return span;
}
export const iconHTML = (name, size = 22) => icon(name, size).outerHTML;

/* bean glyph used by freshness slide and empty thumbnails */
export function beanSVG(size = 24, cls = '') {
  const wrap = document.createElement('span');
  wrap.className = 'beanglyph ' + cls;
  wrap.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><g transform="rotate(-32 16 16)"><ellipse class="b-body" cx="16" cy="16" rx="9.6" ry="13.2"/><path class="b-crease" d="M16 3.4c-3.2 3.6 3.2 8.6 0 12.6s3.2 8.6 0 12.6" fill="none" stroke-width="1.9" stroke-linecap="round"/></g></svg>`;
  return wrap;
}
