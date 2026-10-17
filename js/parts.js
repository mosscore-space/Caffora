// Reusable view pieces: thumbnails, freshness slide, chips, empty states.
import { h, icon, beanSVG, blobURL, fmtDate, nf0, fmtG, round1 } from './util.js';
import { freshness, remaining, consumedBy, ROAST_LABEL } from './store.js';

/* ---- flavor category colors ---- */
const CAT_COLORS = {
  'Fruity': 'red', 'Floral': 'pink', 'Sweet': 'peach', 'Nutty / Cocoa': 'maroon', 'Spices': 'flamingo',
  'Sour / Fermented': 'yellow', 'Green / Vegetative': 'green', 'Roasted': 'lavender', 'Other': 'overlay2',
};
const EXTRA = ['mauve', 'teal', 'sky', 'blue', 'sapphire', 'rosewater'];
export function catColor(cat) {
  if (CAT_COLORS[cat]) return `var(--${CAT_COLORS[cat]})`;
  let hsh = 0; for (const ch of cat) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--${EXTRA[hsh % EXTRA.length]})`;
}
export function noteChip(note, { on = false, onclick, small = false } = {}) {
  const tag = onclick ? 'button' : 'span';
  return h(`${tag}.chip.note${on ? '.on' : ''}${small ? '.sm' : ''}`, { type: onclick ? 'button' : null, onclick, style: { '--chip': catColor(note.c) }, 'aria-pressed': onclick ? String(on) : null }, note.n);
}

/* ---- thumbnails ---- */
export function beanThumb(bean, size = 64) {
  const url = bean?.image ? blobURL(bean.image) : null;
  const el = h('div.thumb', { style: { width: size + 'px', height: size + 'px' } });
  if (url) el.append(h('img', { src: url, alt: '', loading: 'lazy', draggable: false }));
  else el.append(beanSVG(Math.round(size * 0.5), 'ph'));
  return el;
}

/* ---- text helpers ---- */
export function altitudeText(b) {
  const f = b.altFrom, t = b.altTo, u = b.altUnit || 'm';
  if (!f && !t) return '';
  if (f && t) return `${nf0.format(f)}–${nf0.format(t)} ${u}`;
  return `${nf0.format(f || t)} ${u}`;
}
export const roastLabel = (r) => (ROAST_LABEL[r] || '') + ' roast';
export function chip(text, cls = '') { return h('span.chip' + (cls ? '.' + cls : ''), text); }

/* ---- freshness slide ---- */
const pluralDays = (n) => (n === 1 ? '1 day' : `${n} days`);
export function freshnessSlide(bean) {
  const f = freshness(bean);
  const pct = (d) => (d / f.domain) * 100;
  let caption;
  if (f.state === 'resting') {
    const n = f.from - f.days;
    caption = [h('b', 'Resting'), ` · peak ${n === 1 ? 'tomorrow' : 'in ' + pluralDays(n)} (${fmtDate(f.start, false)})`];
  } else if (f.state === 'peak') {
    const left = f.to - f.days;
    caption = [h('b', 'At its best'), left === 0 ? ' · last day of the window' : ` · ${pluralDays(left)} left (until ${fmtDate(f.end, false)})`];
  } else {
    const over = f.days - f.to;
    caption = [h('b', 'Past its best'), ` · ${pluralDays(over)} ago (${fmtDate(f.end, false)})`];
  }
  const label = (d, text, cls = '') => h('span.fresh-tick' + (cls ? '.' + cls : ''), { style: { left: pct(d) + '%' } }, text);
  return h('div.fresh.state-' + f.state, { role: 'img', 'aria-label': `Freshness: day ${f.days} after roast, ${f.state}` },
    h('div.fresh-track',
      h('i.z.pre', { style: { width: pct(f.from) + '%' } }),
      h('i.z.peak', { style: { left: pct(f.from) + '%', width: pct(f.to - f.from) + '%' } }),
      h('i.z.post', { style: { left: pct(f.to) + '%', right: 0 } }),
      h('span.fresh-bean', { style: { left: (f.pos * 100) + '%' } }, beanSVG(26))),
    h('div.fresh-scale',
      label(0, 'Roast', 'first'),
      label(f.from, fmtDate(f.start, false)),
      label(f.to, fmtDate(f.end, false))),
    h('div.fresh-cap', h('span.fresh-day', `Day ${f.days}`), h('span', caption)));
}

/* ---- remaining / consumed bars ---- */
export function stockBar(bean) {
  const used = consumedBy(bean.id);
  const total = bean.grams || 0;
  if (bean.finished) {
    const mine = Math.min(used, total), others = Math.max(0, total - mine);
    const pm = total ? (mine / total) * 100 : 0;
    return h('div.stock.done',
      h('div.stock-bar', h('i.mine', { style: { width: pm + '%' } }), h('i.others', { style: { width: (100 - pm) + '%' } })),
      h('div.stock-legend', h('span', h('i.dot.mine'), `You ${fmtG(mine)}`), h('span', h('i.dot.others'), `Others ${fmtG(others)}`)));
  }
  const left = remaining(bean);
  const pl = total ? (left / total) * 100 : 0;
  return h('div.stock',
    h('div.stock-bar', h('i.left', { style: { width: pl + '%' } })),
    h('div.stock-legend', h('span', h('b', fmtG(left)), ` left of ${fmtG(total)}`), used ? h('span.muted', `${fmtG(used)} brewed`) : null));
}

export function emptyState({ iconName = 'empty', title, text, action }) {
  return h('div.empty', h('div.empty-ico', icon(iconName, 34)), h('h3', title), text ? h('p', text) : null, action || null);
}

export function pageHead(title, sub, actions) {
  return h('header.page-head', h('div', h('h1', title), sub ? h('p.page-sub', sub) : null), h('div.page-actions', actions || null));
}
export { round1 };
