// Stats tab: total brews + bar charts (week by day, month by week, year by month).
import { h, s, icon, clear, MON3, MONTHS, ymd, parseYMD, addDays, today, daysInMonth, pad2, fmtDate } from './util.js';
import { S } from './store.js';
import { pageHead, emptyState } from './parts.js';
import { nav } from './nav.js';

const offsets = { week: 0, month: 0, year: 0 };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function countBy(pred) { return S.brews.filter(b => pred(b.date)).length; }
const inRange = (a, b) => (d) => d >= a && d <= b;

function weekData(off) {
  const t = parseYMD(today());
  const start = addDays(ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay())), off * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return {
    title: off === 0 ? 'This week' : off === -1 ? 'Last week' : 'Week of ' + fmtDate(start, false),
    range: `${fmtDate(days[0], false)} – ${fmtDate(days[6])}`,
    labels: days.map((d, i) => DAYS[i]), subs: days.map(d => String(parseYMD(d).getDate())),
    values: days.map(d => countBy(x => x === d)), cur: off === 0 ? parseYMD(today()).getDay() : -1,
  };
}
function monthData(off) {
  const t = new Date(); const first = new Date(t.getFullYear(), t.getMonth() + off, 1);
  const y = first.getFullYear(), m = first.getMonth() + 1, n = daysInMonth(y, m);
  const buckets = []; let day = 1;
  while (day <= n) {
    const dow = new Date(y, m - 1, day).getDay();
    const end = Math.min(n, day + (6 - dow));
    buckets.push([day, end]); day = end + 1;
  }
  const ds = (d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const tod = today();
  return {
    title: off === 0 ? 'This month' : off === -1 ? 'Last month' : MONTHS[m - 1] + ' ' + y,
    range: `${MONTHS[m - 1]} ${y}`,
    labels: buckets.map((_, i) => `W${i + 1}`), subs: buckets.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)),
    values: buckets.map(([a, b]) => countBy(inRange(ds(a), ds(b)))),
    cur: off === 0 ? buckets.findIndex(([a, b]) => tod >= ds(a) && tod <= ds(b)) : -1,
  };
}
function yearData(off) {
  const y = new Date().getFullYear() + off;
  return {
    title: off === 0 ? 'This year' : off === -1 ? 'Last year' : String(y), range: String(y),
    labels: MON3.slice(), subs: MON3.map(() => ''),
    values: MON3.map((_, i) => countBy(inRange(`${y}-${pad2(i + 1)}-01`, `${y}-${pad2(i + 1)}-31`))),
    cur: off === 0 ? new Date().getMonth() : -1,
  };
}

function barChart({ labels, subs, values, cur }) {
  const W = 360, H = 200, L = 26, R = 6, T = 18, B = subs.some(Boolean) ? 44 : 30;
  const max = Math.max(1, ...values);
  const step = Math.max(1, Math.ceil(max / 4)), top = step * Math.ceil(max / step);
  const ih = H - T - B, iw = W - L - R, band = iw / values.length, bw = Math.min(34, band * 0.62);
  const y = (v) => T + ih - (v / top) * ih;
  const svg = s('svg.chart', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bar chart of brews: ' + labels.map((l, i) => `${l} ${values[i]}`).join(', ') });
  for (let v = 0; v <= top; v += step) {
    svg.append(s('line.grid', { x1: L, x2: W - R, y1: y(v), y2: y(v) }), s('text.ytick', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, String(v)));
  }
  values.forEach((v, i) => {
    const cx = L + band * i + band / 2, hgt = Math.max(0, (v / top) * ih);
    if (v > 0) {
      svg.append(s('rect.bar' + (i === cur ? '.cur' : ''), { x: cx - bw / 2, y: y(v), width: bw, height: hgt, rx: 5 }));
      svg.append(s('text.val', { x: cx, y: y(v) - 5, 'text-anchor': 'middle' }, String(v)));
    } else svg.append(s('rect.bar.zero', { x: cx - bw / 2, y: T + ih - 2, width: bw, height: 2, rx: 1 }));
    svg.append(s('text.xl' + (i === cur ? '.cur' : ''), { x: cx, y: H - B + 16, 'text-anchor': 'middle' }, labels[i]));
    if (subs[i]) svg.append(s('text.xs', { x: cx, y: H - B + 30, 'text-anchor': 'middle' }, subs[i]));
  });
  return svg;
}

function chartCard(kind, data, root) {
  const total = data.values.reduce((a, b) => a + b, 0);
  const move = (d) => () => { offsets[kind] += d; renderStats(root); };
  return h('section.chart-card',
    h('header.chart-head',
      h('div', h('h2', data.title), h('p.muted.small', data.range)),
      h('div.chart-nav',
        h('span.chart-total', h('b', total), total === 1 ? ' brew' : ' brews'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Previous', onclick: move(-1) }, icon('chevronL', 20)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Next', disabled: offsets[kind] >= 0, onclick: move(1) }, icon('chevronR', 20)))),
    barChart(data));
}

export function renderStats(root) {
  clear(root);
  root.append(pageHead('Stats', 'How much you brew'));
  if (!S.brews.length) {
    root.append(emptyState({ iconName: 'stats', title: 'No stats yet', text: 'Log your first brew and your charts will appear here.', action: h('button.btn.primary', { type: 'button', onclick: () => nav.go('brews') }, 'Go to Brews') }));
    return;
  }
  root.append(
    h('section.total', h('div.total-n', String(S.brews.length)), h('div.total-k', S.brews.length === 1 ? 'brew in total' : 'brews in total')),
    h('div.charts',
      chartCard('week', weekData(offsets.week), root),
      chartCard('month', monthData(offsets.month), root),
      chartCard('year', yearData(offsets.year), root)));
}
