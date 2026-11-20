// Stats tab: total brews + bar charts (week by day, month by week, year by month).
import { h, s, icon, clear, MON3, MONTHS, ymd, parseYMD, addDays, today, daysInMonth, pad2, fmtDate, fmtDateLong, fmtG, fmtTime, nf0, round1 } from './util.js';
import { S, beanById, grinderById, methodById } from './store.js';
import { pageHead, emptyState, beanThumb } from './parts.js';
import { segmented, StarsStatic } from './ui.js';
import { openBrewDetail, openBrewForm, isPending, ratioText } from './brews.js';
import { canEdit } from './auth.js';
import { nav } from './nav.js';

const offsets = { week: 0, month: 0, year: 0, caffeine: 0 };
const view = { tab: 'overview', avgBy: 'method', avgAll: false, recipeBean: null };
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

function barChart({ labels, subs, values, cur, ref = null, nice = false, unit = '' }) {
  const W = 360, H = 200, L = 30, R = 6, T = 18, B = subs.some(Boolean) ? 44 : 30;
  const max = Math.max(1, ...values, ref ? ref.v : 0);
  let step = Math.max(1, Math.ceil(max / 4));
  if (nice) { const raw = max / 4, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow; step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow; }
  const top = step * Math.ceil(max / step);
  const ih = H - T - B, iw = W - L - R, band = iw / values.length, bw = Math.min(34, band * 0.62);
  const showVals = band >= 30;
  const y = (v) => T + ih - (v / top) * ih;
  const svg = s('svg.chart', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bar chart: ' + labels.map((l, i) => `${l}${subs[i] ? ' ' + subs[i] : ''} ${values[i]}${unit}`).join(', ') });
  for (let v = 0; v <= top; v += step) {
    svg.append(s('line.grid', { x1: L, x2: W - R, y1: y(v), y2: y(v) }), s('text.ytick', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, String(v)));
  }
  if (ref) svg.append(s('line.ref', { x1: L, x2: W - R, y1: y(ref.v), y2: y(ref.v) }), s('text.ref-t', { x: W - R, y: y(ref.v) - 4, 'text-anchor': 'end' }, ref.label));
  values.forEach((v, i) => {
    const cx = L + band * i + band / 2, hgt = Math.max(0, (v / top) * ih);
    const tip = s('title', `${labels[i]}${subs[i] ? ' ' + subs[i] : ''}: ${v}${unit}`);
    if (v > 0) {
      svg.append(s('rect.bar' + (i === cur ? '.cur' : '') + (ref && v > ref.v ? '.over' : ''), { x: cx - bw / 2, y: y(v), width: bw, height: hgt, rx: 5 }, tip));
      if (showVals) svg.append(s('text.val', { x: cx, y: y(v) - 5, 'text-anchor': 'middle' }, String(v)));
    } else svg.append(s('rect.bar.zero', { x: cx - bw / 2, y: T + ih - 2, width: bw, height: 2, rx: 1 }, tip));
    svg.append(s('text.xl' + (i === cur ? '.cur' : ''), { x: cx, y: H - B + 16, 'text-anchor': 'middle' }, labels[i]));
    if (subs[i]) svg.append(s('text.xs', { x: cx, y: H - B + 30, 'text-anchor': 'middle' }, subs[i]));
  });
  return svg;
}

/** Card shell shared by every section. */
function card(title, sub, ...body) {
  return h('section.chart-card.stat-card', h('header.chart-head', h('div', h('h2', title), sub ? h('p.muted.small', sub) : null)), ...body);
}
const note = (text) => h('p.stat-note', text);
const methodImg = (id, size = 28) => h('img.method-ico', { src: `icons/methods/${id}.webp`, alt: '', width: size, height: size, loading: 'lazy', draggable: false });
const isRated = (b) => b.rating > 0 && !isPending(b);
const bestFirst = (a, b) => b.rating - a.rating || (b.accuracy || 0) - (a.accuracy || 0) || b.date.localeCompare(a.date);
const plural = (n, w) => `${nf0.format(n)} ${w}${n === 1 ? '' : 's'}`;

function chartCard(kind, data, root, extra = {}) {
  const total = data.values.reduce((a, b) => a + b, 0);
  const move = (d) => () => { offsets[kind] += d; renderStats(root); };
  return h('section.chart-card',
    h('header.chart-head',
      h('div', h('h2', data.title), h('p.muted.small', data.range)),
      h('div.chart-nav',
        h('span.chart-total', h('b', total), total === 1 ? ' brew' : ' brews'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Previous', onclick: move(-1) }, icon('chevronL', 20)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Next', disabled: offsets[kind] >= 0, onclick: move(1) }, icon('chevronR', 20)))),
    barChart({ ...data, ...extra }));
}

/* ---------- coffee consumed ---------- */
function consumedCard() {
  const t = parseYMD(today());
  const wk = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - t.getDay()));
  const yr = today().slice(0, 4), mo = today().slice(0, 7);
  const sum = (pred) => S.brews.filter(b => pred(b.date)).reduce((a, b) => ({ g: a.g + (Number(b.dose) || 0), ml: a.ml + (Number(b.water) || 0) }), { g: 0, ml: 0 });
  const all = sum(() => true);
  const rows = [['This week', sum(d => d >= wk)], ['This month', sum(d => d.startsWith(mo))], ['This year', sum(d => d.startsWith(yr))]];
  const noWater = S.brews.filter(b => !(b.water > 0)).length;
  const kpi = (n, unit, what) => h('div.kpi', h('div.kpi-n', nf0.format(Math.round(n)), h('span.kpi-u', ' ' + unit)), h('div.kpi-k', what));
  return card('Coffee consumed', 'Everything you have brewed so far',
    h('div.kpi-row', kpi(all.g, 'g', 'of beans'), kpi(all.ml, 'ml', 'of drink')),
    h('table.period', h('tbody', rows.map(([name, v]) => h('tr', h('th', name), h('td', `${nf0.format(Math.round(v.g))} g`), h('td', `${nf0.format(Math.round(v.ml))} ml`))))),
    note(`Beans is the dose of every brew. Drink is the water or yield you entered${noWater ? `, and ${plural(noWater, 'brew')} ${noWater === 1 ? 'has' : 'have'} none yet` : ''}.`));
}

/* ---------- time of day ---------- */
const DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYFULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourName = (hr) => `${hr % 12 || 12} ${hr < 12 ? 'AM' : 'PM'}`;
function heatCard() {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  let used = 0, skipped = 0;
  for (const b of S.brews) {
    const c = new Date(b.created);
    if (!b.created || Number.isNaN(c.getTime()) || ymd(c) !== b.date) { skipped++; continue; }   // logged on another day: the clock time says nothing about when it was brewed
    grid[c.getDay()][c.getHours()]++; used++;
  }
  if (!used) return card('When you brew', 'Time of day', note('Your brews will show up here once they have a time. Brews logged on a different day than they were made are left out.'));
  const max = Math.max(...grid.flat());
  const byHour = Array.from({ length: 24 }, (_, i) => grid.reduce((a, r) => a + r[i], 0));
  const byDay = grid.map(r => r.reduce((a, n) => a + n, 0));
  const peakH = byHour.indexOf(Math.max(...byHour)), peakD = byDay.indexOf(Math.max(...byDay));
  const cells = [];
  grid.forEach((row, d) => {
    cells.push(h('span.heat-y', DAY3[d]));
    row.forEach((n, hr) => cells.push(h('i.heat-c' + (n ? '' : '.zero'), { style: { '--v': n ? (0.22 + 0.78 * n / max).toFixed(2) : 0 }, title: `${DAY3[d]} ${hourName(hr)}: ${plural(n, 'brew')}` })));
  });
  cells.push(h('span'));
  for (let hr = 0; hr < 24; hr++) cells.push(h('span.heat-x', hr % 6 === 0 ? ['12a', '6a', '12p', '6p'][hr / 6] : ''));
  return card('When you brew', 'Time of day, by weekday',
    h('div.heat', { role: 'img', 'aria-label': `Brews by weekday and hour. Busiest hour ${hourName(peakH)}, busiest day ${DAY3[peakD]}.` }, cells),
    h('div.heat-legend', h('span', 'fewer'), ...[0.22, 0.45, 0.7, 1].map(v => h('i.heat-c', { style: { '--v': v } })), h('span', 'more')),
    h('p.heat-sum', h('b', hourName(peakH)), ' is your busiest hour and ', h('b', DAYFULL[peakD]), ' your busiest day.'),
    note(`Based on when each brew was logged${skipped ? `. ${plural(skipped, 'brew')} logged on a different day than they were made ${skipped === 1 ? 'is' : 'are'} left out` : ''}.`));
}

/* ---------- caffeine ---------- */
const MG_PER_G = 10;       // rough: about 10 mg of caffeine per gram of ground Arabica after a normal extraction
const LIMIT_MG = 400;      // amount commonly cited as not linked to harm for most healthy adults
function caffeineCard(root) {
  const end = addDays(today(), offsets.caffeine * 14);
  const days = Array.from({ length: 14 }, (_, i) => addDays(end, i - 13));
  const mg = (d) => Math.round(S.brews.filter(b => b.date === d).reduce((a, b) => a + (Number(b.dose) || 0), 0) * MG_PER_G);
  const values = days.map(mg);
  const brewed = values.filter(v => v > 0);
  const avg = brewed.length ? Math.round(brewed.reduce((a, b) => a + b, 0) / brewed.length) : 0;
  const todayMg = mg(today());
  const data = {
    title: 'Caffeine', range: offsets.caffeine === 0 ? 'Last 14 days' : `${fmtDate(days[0], false)} – ${fmtDate(days[13])}`,
    labels: days.map(d => DAY3[parseYMD(d).getDay()][0]), subs: days.map(d => String(parseYMD(d).getDate())), values,
    cur: offsets.caffeine === 0 ? 13 : -1,
  };
  const tile = (n, k, over) => h('div.kpi.small' + (over ? '.over' : ''), h('div.kpi-n', n), h('div.kpi-k', k));
  return h('section.chart-card.stat-card',
    h('header.chart-head', h('div', h('h2', 'Caffeine'), h('p.muted.small', data.range + ' · rough estimate')),
      h('div.chart-nav',
        h('button.icon-btn', { type: 'button', 'aria-label': 'Previous 14 days', onclick: () => { offsets.caffeine--; renderStats(root); } }, icon('chevronL', 20)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Next 14 days', disabled: offsets.caffeine >= 0, onclick: () => { offsets.caffeine++; renderStats(root); } }, icon('chevronR', 20)))),
    h('div.kpi-row.three',
      tile(`${nf0.format(todayMg)} mg`, 'today', todayMg > LIMIT_MG),
      tile(`${nf0.format(avg)} mg`, 'average on days you brewed'),
      tile(`${nf0.format(Math.max(0, ...values))} mg`, 'highest day', Math.max(0, ...values) > LIMIT_MG)),
    barChart({ ...data, ref: { v: LIMIT_MG, label: `${LIMIT_MG} mg` }, nice: true, unit: ' mg' }),
    note(`Estimated as about ${MG_PER_G} mg per gram of coffee you brewed, so real values vary with the bean, roast and method. It counts the whole dose of each brew and nothing you drink outside Caffora. ${LIMIT_MG} mg a day is the amount commonly cited as fine for most healthy adults. This is a rough guide, not medical advice.`));
}

/* ---------- ratings ---------- */
const AVG_OPTIONS = [{ v: 'method', label: 'Method' }, { v: 'bean', label: 'Bean' }, { v: 'grinder', label: 'Grinder' }, { v: 'origin', label: 'Origin' }];
function groupAverages(by) {
  const map = new Map();
  for (const b of S.brews.filter(isRated)) {
    const bean = beanById(b.beanId);
    let key, label, lead = null;
    if (by === 'method') { key = b.methodId; label = methodById(key)?.name || key; lead = methodImg(b.methodId, 26); }
    else if (by === 'bean') { key = b.beanId; label = bean?.name || 'Deleted beans'; }
    else if (by === 'grinder') { key = b.grinderId || '-'; label = grinderById(b.grinderId)?.name || 'No grinder'; }
    else { key = bean?.countryCode || '?'; label = bean?.country || 'Unknown'; }
    const r = map.get(key) || { label, lead, n: 0, sum: 0 };
    r.n++; r.sum += b.rating; map.set(key, r);
  }
  return [...map.values()].map(r => ({ ...r, avg: r.sum / r.n })).sort((a, b) => b.avg - a.avg || b.n - a.n);
}
function avgCard(root) {
  const rows = groupAverages(view.avgBy);
  const nRated = S.brews.filter(isRated).length;
  const seg = segmented({ options: AVG_OPTIONS, value: view.avgBy, onChange: (v) => { view.avgBy = v; view.avgAll = false; renderStats(root); } });
  const shown = view.avgAll ? rows : rows.slice(0, 8);
  return card('Average rating', `By ${view.avgBy} · ${plural(nRated, 'rated brew')}`,
    seg.el,
    rows.length
      ? h('ol.avg-list', shown.map(r => h('li.avg-row', r.lead,
        h('div.avg-main', h('div.avg-top', h('span.avg-name', r.label), h('span.avg-val', r.avg.toFixed(1))),
          h('div.avg-bar', h('i', { style: { width: (r.avg / 5 * 100) + '%' } })), h('span.avg-n', plural(r.n, 'brew'))))))
      : note('Rate a few brews to see averages here.'),
    rows.length > 8 ? h('button.link.avg-more', { type: 'button', onclick: () => { view.avgAll = !view.avgAll; renderStats(root); } }, view.avgAll ? 'Show fewer' : `Show all ${rows.length}`) : null);
}

/* ---------- best-rated brews, side by side ---------- */
function bestBrewsCard() {
  const top = S.brews.filter(isRated).sort(bestFirst).slice(0, 5);
  if (!top.length) return card('Best-rated brews', 'Recipes side by side', note('Your top brews and their recipes will line up here once you have rated some.'));
  const grindCell = (b) => { const g = grinderById(b.grinderId); return b.grind != null && b.grind !== '' ? h('span', String(b.grind), g ? h('small', g.name) : null) : '—'; };
  const rows = [
    ['Rating', b => h('span.cmp-rate', StarsStatic(b.rating), h('b', b.rating.toFixed(1)))],
    ['Method', b => methodById(b.methodId)?.name || '—'],
    ['Dose', b => (b.dose ? fmtG(b.dose) : '—')],
    ['Water', b => (b.water ? fmtG(b.water) : '—')],
    ['Ratio', b => (b.dose && b.water ? ratioText(b.dose, b.water) : '—')],
    ['Grind', grindCell],
    ['Temp', b => (b.temp ? `${b.temp}°C` : '—')],
    ['Time', b => (b.time ? fmtTime(b.time) : '—')],
  ];
  return card('Best-rated brews', `Top ${top.length}, recipes side by side`,
    h('div.cmp-scroll', h('table.cmp',
      h('thead', h('tr', h('th'), top.map((b, i) => h('th', h('button.cmp-head', { type: 'button', onclick: () => openBrewDetail(b.id) },
        h('span.cmp-rank', `#${i + 1}`), h('span.cmp-bean', beanById(b.beanId)?.name || 'Deleted beans'), h('small', fmtDate(b.date))))))),
      h('tbody', rows.map(([label, fn]) => h('tr', h('th', label), top.map(b => h('td', fn(b)))))))));
}

/* ---------- your best recipe for this bean ---------- */
function bestRecipeCard(root) {
  const ratedBrews = S.brews.filter(isRated);
  const beanIds = [...new Set(ratedBrews.map(b => b.beanId))].filter(id => beanById(id));
  if (!beanIds.length) return card('Your best recipe', 'For each coffee', note('Rate a brew and the best one for each coffee will show up here, ready to brew again.'));
  if (!beanIds.includes(view.recipeBean)) view.recipeBean = ratedBrews[0] && beanById(ratedBrews[0].beanId) ? ratedBrews[0].beanId : beanIds[0];   // newest rated brew first
  const bean = beanById(view.recipeBean);
  const mine = ratedBrews.filter(b => b.beanId === bean.id).sort(bestFirst);
  const best = mine[0], g = grinderById(best.grinderId), m = methodById(best.methodId);
  const sel = h('select.sel-native', { 'aria-label': 'Choose a bean' }, beanIds.map(id => h('option', { value: id, selected: id === bean.id }, beanById(id).name)));
  sel.addEventListener('change', () => { view.recipeBean = sel.value; renderStats(root); });
  const tile = (k, v) => (v ? h('div.stat', h('span.stat-v', v), h('span.stat-k', k)) : null);
  return card('Your best recipe', 'The highest-rated brew for a coffee',
    sel,
    h('div.recipe-head', beanThumb(bean, 54), h('div', h('h3.recipe-bean', bean.name), h('p.muted.small', [bean.country, bean.region].filter(Boolean).join(' · ')))),
    h('div.recipe-badge', StarsStatic(best.rating), h('b', best.rating.toFixed(1)), h('span.muted.small', ` · ${fmtDateLong(best.date)} · best of ${plural(mine.length, 'rated brew')}`)),
    h('div.stats-grid',
      tile('Method', m?.name), tile('Coffee', best.dose ? fmtG(best.dose) : ''), tile('Water', best.water ? fmtG(best.water) : ''),
      tile('Ratio', best.dose && best.water ? ratioText(best.dose, best.water) : ''), tile('Temp', best.temp ? `${best.temp}°C` : ''), tile('Time', best.time ? fmtTime(best.time) : ''),
      tile(g ? `Grind · ${g.name}` : 'Grind', best.grind != null && best.grind !== '' ? String(best.grind) : '')),
    h('div.recipe-actions',
      canEdit() && !bean.finished ? h('button.btn.primary', { type: 'button', onclick: () => openBrewForm({ beanId: bean.id, from: best }) }, icon('plus', 18), 'Brew this recipe') : null,
      h('button.btn', { type: 'button', onclick: () => openBrewDetail(best.id) }, 'View brew')));
}

/* ---------- most-used grinder setting per method ---------- */
function settingsCard() {
  const byMethod = new Map();
  for (const b of S.brews) {
    if (!b.grinderId || b.grind == null || b.grind === '') continue;
    const e = byMethod.get(b.methodId) || { total: 0, combos: new Map() };
    e.total++;
    const k = `${b.grinderId}|${b.grind}`;
    const c = e.combos.get(k) || { grinderId: b.grinderId, grind: b.grind, n: 0, last: '', ratings: [] };
    c.n++; if (b.date > c.last) c.last = b.date; if (isRated(b)) c.ratings.push(b.rating);
    e.combos.set(k, c); byMethod.set(b.methodId, e);
  }
  const rows = [...byMethod.entries()].map(([id, e]) => {
    const top = [...e.combos.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))[0];
    return { id, total: e.total, ...top };
  }).sort((a, b) => b.total - a.total);
  if (!rows.length) return card('Go-to grind settings', 'Most used setting for each method', note('Log brews with a grinder and a grind size to see your usual setting for each method.'));
  return card('Go-to grind settings', 'Most used setting for each method',
    h('ul.set-list', rows.map(r => {
      const g = grinderById(r.grinderId), avg = r.ratings.length ? r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length : 0;
      return h('li.set-row', methodImg(r.id, 40),
        h('div.set-main', h('div.set-name', methodById(r.id)?.name || r.id),
          h('div.set-sub', `${g?.name || 'Deleted grinder'} · used in ${r.n} of ${r.total}`, avg ? ` · avg ${round1(avg).toFixed(1)}` : '')),
        h('div.set-val', String(r.grind)));
    })));
}

/* ---------- page ---------- */
export function renderStats(root) {
  clear(root);
  root.append(pageHead('Stats', 'Your coffee, in numbers'));
  if (!S.brews.length) {
    root.append(emptyState({ iconName: 'stats', title: 'No stats yet', text: 'Log your first brew and your charts will appear here.', action: h('button.btn.primary', { type: 'button', onclick: () => nav.go('brews') }, 'Go to Brews') }));
    return;
  }
  const tabs = segmented({ options: [{ v: 'overview', label: 'Overview' }, { v: 'ratings', label: 'Ratings & recipes' }], value: view.tab, onChange: (v) => { view.tab = v; renderStats(root); window.scrollTo(0, 0); }, cls: 'stat-tabs' });
  root.append(tabs.el);
  if (view.tab === 'overview') {
    root.append(
      h('section.total', h('div.total-n', String(S.brews.length)), h('div.total-k', S.brews.length === 1 ? 'brew in total' : 'brews in total')),
      h('div.stat-grid',
        consumedCard(),
        chartCard('week', weekData(offsets.week), root),
        chartCard('month', monthData(offsets.month), root),
        chartCard('year', yearData(offsets.year), root),
        heatCard(),
        caffeineCard(root)));
  } else {
    root.append(h('div.stat-grid',
      avgCard(root),
      bestRecipeCard(root),
      h('div.span2', bestBrewsCard()),
      h('div.span2', settingsCard())));
  }
}
