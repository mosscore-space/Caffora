// Brews tab: history list, brew form (with pre-fill from the last brew of the same coffee), detail sheet.
import { h, fill, icon, clear, numericInput, today, fmtDate, fmtDateLong, relDay, fmtTime, fmtG, round1, nf0 } from './util.js';
import {
  S, beanById, grinderById, methodById, methods, saveBrew, deleteBrew, saveBean, remaining, lastBrewOf, onChange,
} from './store.js';
import { openSheet, toast, confirmDialog, field, group, section, selectButton, pickFromList, pickTime, pickDate, StarSlider, StarsStatic, Radar, SENSORY, Stepper } from './ui.js';
import { beanThumb, emptyState, pageHead, chip, searchText } from './parts.js';
import { grinderSummary } from './grinders.js';
import { canEdit } from './auth.js';
import { nav } from './nav.js';

export const isPending = (b) => b.stage === 'logged' || b.stage === 'timed';
export const ratioText = (dose, water) => (dose > 0 && water > 0 ? `1 : ${round1(water / dose)}` : '—');
const methodIcon = (id, size = 44) => h('img.method-ico', { src: `icons/methods/${id}.webp`, alt: '', width: size, height: size, loading: 'lazy', draggable: false });

/* =========================================================
   List
   ========================================================= */
export function renderBrews(root) {
  clear(root);
  const hasBeans = S.beans.some(b => !b.finished);
  const add = () => openBrewForm();
  root.append(pageHead('Brews', S.brews.length ? `${S.brews.length} ${S.brews.length === 1 ? 'brew' : 'brews'} logged` : 'Your brew log',
    h('button.btn.primary.head-add', { type: 'button', onclick: add }, icon('plus', 18), 'New brew'), { search: true }));
  if (!S.brews.length) {
    root.append(hasBeans
      ? emptyState({ iconName: 'brews', title: 'No brews yet', text: 'Log a brew to track your recipe, taste and ratings, and to see your stats.', action: h('button.btn.primary', { type: 'button', onclick: add }, icon('plus', 18), 'Log your first brew') })
      : emptyState({ iconName: 'beans', title: 'Add beans before you brew', text: 'A brew is linked to a bag of beans, so add one first.', action: h('button.btn.primary', { type: 'button', onclick: () => nav.go('beans') }, 'Go to Beans') }));
  } else {
    const groups = [];
    for (const b of S.brews) {
      const label = relDay(b.date);
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) groups.push(g = { label, items: [] });
      g.items.push(b);
    }
    root.append(h('div.brew-groups', groups.map(g => h('section.brew-group', h('h2.group-h', g.label), h('div.brew-list', g.items.map(brewRow))))));
  }
  root.append(h('button.fab', { type: 'button', 'aria-label': 'New brew', onclick: add }, icon('plus', 26)));
}

function brewRow(b) {
  const bean = beanById(b.beanId), m = methodById(b.methodId), g = grinderById(b.grinderId);
  const pending = isPending(b);
  const bits = [m?.name, b.dose ? fmtG(b.dose) : null, b.water ? `→ ${fmtG(b.water)}` : null, b.dose && b.water ? ratioText(b.dose, b.water) : null, b.temp ? `${b.temp}°C` : null, b.time ? fmtTime(b.time) : null,
    pending && b.stage === 'logged' && b.grind != null && b.grind !== '' ? `grind ${b.grind}` : null].filter(Boolean);
  const tier = pending || !b.rating ? null : b.rating >= 4.5 ? ['hi', 'Perfect'] : b.rating >= 3.5 ? ['good', 'Good'] : b.rating >= 2.5 ? ['ok', 'Okay'] : ['low', 'Off'];
  const hint = b.stage === 'logged' ? 'Add water and time' : 'Add taste and rating';
  return h('article.brew' + (pending ? '.t-pend' : tier ? '.t-' + tier[0] : ''), {
    tabindex: 0, role: 'button', onclick: () => openBrewDetail(b.id), onkeydown: (e) => { if (e.key === 'Enter') openBrewDetail(b.id); },
    dataset: { search: searchText(bean?.name, bean?.country, bean?.region, bean?.variety, m?.name, g?.name, b.date, pending ? 'needs review' : '') } },
    h('div.brew-ico', m ? methodIcon(m.id, 46) : icon('brews', 26)),
    h('div.brew-main',
      h('div.brew-title', h('h3', bean?.name || 'Deleted beans'), pending ? h('span.tier.t-pend', 'Needs review') : tier ? h('span.tier.t-' + tier[0], tier[1]) : null),
      h('p.brew-bits', bits.join(' · ')),
      pending
        ? (canEdit()
          ? h('button.brew-review', { type: 'button', onclick: (e) => { e.stopPropagation(); openBrewReview(b.id); } }, h('span', 'Review the brew'), h('small', hint))
          : h('span.muted.small', 'Not reviewed yet'))
        : h('div.brew-rate', b.rating ? [StarsStatic(b.rating), h('span.rate-n', b.rating.toFixed(1))] : h('span.muted.small', 'Not rated'))),
    pending ? null : h('div.brew-radar', Radar({ values: b.sensory || {}, size: 76, compact: true }).el));
}

/* =========================================================
   Detail
   ========================================================= */
export function openBrewDetail(id) {
  const render = () => {
    const b = S.brews.find(x => x.id === id);
    if (!b) { sheet.close(); return; }
    const bean = beanById(b.beanId), m = methodById(b.methodId), g = grinderById(b.grinderId);
    sheet.setTitle(bean?.name || 'Brew');
    const stat = (k, v) => v ? h('div.stat', h('span.stat-v', v), h('span.stat-k', k)) : null;
    fill(sheet.body, 
      h('div.detail-hero.brew-hero', h('div.brew-ico.big', m ? methodIcon(m.id, 64) : null), h('div.hero-meta', h('p.bean-origin', `${m?.name || 'Brew'} · ${fmtDateLong(b.date)}`), bean ? h('p.muted', [bean.country, bean.region].filter(Boolean).join(' · ')) : null)),
      h('div.stats-grid',
        stat('Coffee', b.dose ? fmtG(b.dose) : ''), stat('Water', b.water ? fmtG(b.water) : ''), stat('Ratio', b.dose && b.water ? ratioText(b.dose, b.water) : ''),
        stat('Temp', b.temp ? `${b.temp}°C` : ''), stat('Time', b.time ? fmtTime(b.time) : ''),
        stat('Grind', b.grind != null && b.grind !== '' ? `${b.grind}${g ? ` / ${g.clicks}` : ''}` : '')),
      g ? h('p.muted.small', `Grinder: ${g.name} (${grinderSummary(g)})`) : null,
      isPending(b)
        ? h('p.form-note', b.stage === 'logged' ? 'Still to add: water, extraction time, taste and rating.' : 'Still to add: taste and rating.')
        : [h('div.radar-box', Radar({ values: b.sensory || {}, size: 300 }).el),
          h('div.rate-block',
            h('div.rate-line', h('span', 'Flavor profile accuracy'), b.accuracy ? [StarsStatic(b.accuracy), h('b', b.accuracy.toFixed(1))] : h('span.muted', 'Not rated')),
            h('div.rate-line', h('span', 'Overall'), b.rating ? [StarsStatic(b.rating), h('b', b.rating.toFixed(1))] : h('span.muted', 'Not rated')))],
    );
    fill(sheet.foot, ...(!canEdit() ? [h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Close')] : [
      isPending(b) ? h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openBrewReview(b.id); } }, 'Review the brew') : null,
      !isPending(b) && bean && !bean.finished ? h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openBrewForm({ beanId: b.beanId }); } }, 'Brew again') : null,
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); openBrewForm({ brew: b }); } }, icon('edit', 16), 'Edit'),
      h('button.btn.danger-ghost', { type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: 'Delete this brew?', text: 'Its dose goes back to the bag’s remaining grams.', confirmLabel: 'Delete', danger: true });
        if (ok) { await deleteBrew(b.id); sheet.close(); toast('Brew deleted'); }
      } }, icon('trash', 16), 'Delete')]));
  };
  const sheet = openSheet({ title: '', size: 'lg', className: 'detail', body: h('div'), footer: h('div') });
  sheet.foot = sheet.el.querySelector('.sheet-foot');
  render();
  const off = onChange((w) => { if (w === 'brews' || w === 'beans' || w === 'grinders') render(); });
  sheet.done.then(off);
}

/* =========================================================
   Form
   ========================================================= */
const defaultSensory = () => ({ aroma: 5, sweetness: 5, acidity: 5, sourness: 5, bitterness: 5, body: 5 });
const sensoryFor = (b) => (hasSensory(b) ? { ...defaultSensory(), sourness: 0, ...b.sensory } : defaultSensory());   // a brew saved before Sourness existed starts at 0, not an invented 5
const hasSensory = (b) => Object.values(b.sensory || {}).some(v => v > 0);

export function openBrewForm({ beanId, brew, from } = {}) {
  if (!canEdit()) { toast('Sign in to edit.'); return; }
  const editing = !!brew;
  const quick = !editing;            // a new brew only asks for what you know before brewing; water, time, taste and rating come later
  const activeBeans = S.beans.filter(b => !b.finished);
  if (!editing && !activeBeans.length) {
    toast('Add an active bean first.', { action: { label: 'Go to Beans', fn: () => nav.go('beans') } });
    return;
  }
  const d = editing ? { ...brew, sensory: sensoryFor(brew) } : {
    beanId: null, methodId: 'v60', grinderId: S.brews[0]?.grinderId && grinderById(S.brews[0].grinderId) ? S.brews[0].grinderId : (S.grinders[0]?.id || null),
    grind: null, dose: '', water: '', temp: '', time: 0, sensory: defaultSensory(), accuracy: 0, rating: 0, date: today(),
  };
  let prefilledFrom = null;

  /* ---- bean ---- */
  const beanBtn = selectButton({ placeholder: 'Choose a bean', onclick: async () => {
    const items = (editing && beanById(d.beanId) && beanById(d.beanId).finished ? [beanById(d.beanId)] : []).concat(activeBeans).map(b => ({
      id: b.id, label: b.name, sub: `${b.country} · ${fmtG(remaining(b, brew?.id))} left`, lead: () => beanThumb(b, 40),
    }));
    const r = await pickFromList({ title: 'Choose a bean', placeholder: 'Search your beans', items, selected: d.beanId });
    if (r?.item) { setBean(r.item.id); }
  } });

  /* ---- method ---- */
  const methodBtn = selectButton({ placeholder: 'Choose a method', onclick: async () => {
    const r = await pickFromList({ title: 'Brew method', placeholder: 'Search methods', selected: d.methodId, items: methods().map(m => ({ id: m.id, label: m.name, lead: () => methodIcon(m.id, 36) })) });
    if (r?.item) { d.methodId = r.item.id; paintMethod(); }
  } });
  const paintMethod = () => { const m = methodById(d.methodId); methodBtn.set(m?.name || '', m ? methodIcon(m.id, 26) : null); };

  /* ---- grinder + grind ---- */
  const grindStep = Stepper({ value: d.grind ?? '', step: 1, min: 0, max: 999, onChange: (v) => { d.grind = v; } });
  const grindHint = h('div.field-hint');
  const grinderBtn = selectButton({ placeholder: S.grinders.length ? 'Choose a grinder' : 'No grinders added', onclick: async () => {
    if (!S.grinders.length) { toast('Add a grinder in the Grinders tab first.', { action: { label: 'Go to Grinders', fn: () => { sheet.close(); nav.go('grinders'); } } }); return; }
    const items = [...S.grinders.map(g => ({ id: g.id, label: g.name, sub: `${grinderSummary(g)} · ${g.clicks} clicks` })), { id: '__none', label: 'No grinder', sub: 'Skip the grind size limit' }];
    const r = await pickFromList({ title: 'Grinder', placeholder: 'Search grinders', selected: d.grinderId || '__none', items });
    if (r?.item) { d.grinderId = r.item.id === '__none' ? null : r.item.id; paintGrinder(); }
  } });
  function paintGrinder() {
    const g = grinderById(d.grinderId);
    grinderBtn.set(g?.name || (S.grinders.length ? '' : ''));
    if (g) {
      grindStep.config({ step: g.step, max: g.clicks, min: 0 });
      const cur = grindStep.get();
      if (cur != null && cur > g.clicks) { grindStep.set(g.clicks); d.grind = g.clicks; }
      grindHint.textContent = `Steps of ${g.step}, up to ${g.clicks} clicks.`;
    } else { grindStep.config({ step: 1, max: 999, min: 0 }); grindHint.textContent = S.grinders.length ? 'No grinder selected, so there is no upper limit.' : 'Add a grinder to cap the grind size at its maximum clicks.'; }
  }

  /* ---- process numbers ---- */
  const mkNum = (key, ph, unit) => {
    const i = numericInput(h('input', { type: 'text', value: d[key] === '' || d[key] == null ? '' : String(d[key]), placeholder: ph, 'aria-label': ph }), { decimal: true });
    i.addEventListener('input', () => { d[key] = i.value === '' ? '' : parseFloat(i.value); i.classList.remove('invalid'); calc(); });
    return h('div.unit-input', i, h('span.unit', unit));
  };
  const doseW = mkNum('dose', 'Coffee dose', 'g'), waterW = mkNum('water', 'Water / yield', 'g'), tempW = mkNum('temp', 'Temperature', '°C');
  const doseIn = doseW.querySelector('input'), waterIn = waterW.querySelector('input'), tempIn = tempW.querySelector('input');
  const doseHint = h('div.field-hint');
  const timeBtn = selectButton({ placeholder: '00:00:00', onclick: async () => {
    const r = await pickTime({ value: d.time || 0 }); if (r !== null) { d.time = r; paintTime(); }
  } });
  const paintTime = () => { const t = d.time || 0; timeBtn.set(`${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); };

  /* ---- ratio ---- */
  const ratioBig = h('div.ratio-big'), ratioSub = h('div.ratio-sub');
  function calc() {
    ratioBig.textContent = ratioText(d.dose, d.water);
    ratioSub.textContent = d.dose > 0 && d.water > 0 ? `${round1(d.dose / d.water * 1000)} g of coffee per litre` : 'Enter coffee and water to see the ratio.';
    const bean = beanById(d.beanId);
    if (bean && d.dose > 0) {
      const left = remaining(bean, brew?.id);
      doseHint.textContent = d.dose > left ? `Only ${fmtG(left)} left in this bag.` : `${fmtG(left - d.dose)} will be left in the bag after this brew.`;
      doseHint.classList.toggle('warn', d.dose > left);
    } else { doseHint.textContent = ''; doseHint.classList.remove('warn'); }
  }

  /* ---- sensory ---- */
  const radar = Radar({ values: d.sensory, size: 300 });
  const sliders = SENSORY.map(m => {
    const out = h('output', String(d.sensory[m.k]));
    const input = h('input', { type: 'range', min: 0, max: 10, step: 1, value: d.sensory[m.k], 'aria-label': m.label });
    const paint = () => input.style.setProperty('--p', (input.value / 10 * 100) + '%');
    input.addEventListener('input', () => { d.sensory[m.k] = Number(input.value); out.textContent = input.value; paint(); radar.update(d.sensory); });
    paint();
    return { m, input, out, paint, row: h('div.slide-row', h('label', m.label), input, out) };
  });

  /* ---- ratings ---- */
  const accuracy = StarSlider({ value: d.accuracy, label: 'Flavor profile accuracy', onChange: (v) => { d.accuracy = v; } });
  const rating = StarSlider({ value: d.rating, label: 'Overall rating', onChange: (v) => { d.rating = v; } });

  /* ---- date ---- */
  const dateBtn = selectButton({ placeholder: 'Today', onclick: async () => { const r = await pickDate({ title: 'Brew date', value: d.date }); if (r) { d.date = r; paintDate(); } } });
  const paintDate = () => dateBtn.set(d.date === today() ? `Today · ${fmtDate(d.date)}` : fmtDateLong(d.date));

  /* ---- prefill banner ---- */
  const banner = h('div.prefill', { hidden: true });
  function setBean(id, silent) {
    d.beanId = id;
    const bean = beanById(id);
    beanBtn.set(bean ? bean.name : '', bean ? beanThumb(bean, 28) : null); beanBtn.markInvalid(false);
    if (!editing) {
      const prev = from && from.beanId === id ? from : lastBrewOf(id);
      if (prev) {
        Object.assign(d, {
          methodId: prev.methodId || d.methodId, grinderId: prev.grinderId && grinderById(prev.grinderId) ? prev.grinderId : d.grinderId,
          grind: prev.grind ?? null, dose: prev.dose ?? '', water: prev.water ?? '', temp: prev.temp ?? '', time: prev.time || 0,
          sensory: { ...defaultSensory(), ...(prev.sensory || {}) }, accuracy: prev.accuracy || 0, rating: prev.rating || 0,
        });
        prefilledFrom = prev;
      } else {
        prefilledFrom = null;
        Object.assign(d, { grind: null, dose: '', water: '', temp: '', time: 0, sensory: defaultSensory(), accuracy: 0, rating: 0 });
      }
    }
    paintAll();
  }
  function paintBanner() {
    banner.hidden = !prefilledFrom;
    if (!prefilledFrom) return;
    fill(banner, h('span', `Started from your ${prefilledFrom === from ? 'best' : 'last'} brew of this coffee (${fmtDate(prefilledFrom.date)}). Change anything you like.`),
      h('button.link', { type: 'button', onclick: () => {
        prefilledFrom = null;
        Object.assign(d, { grind: null, dose: '', water: '', temp: '', time: 0, sensory: defaultSensory(), accuracy: 0, rating: 0 });
        paintAll();
      } }, 'Start fresh'));
  }
  function paintAll() {
    paintMethod(); paintGrinder(); paintTime(); paintDate(); paintBanner();
    grindStep.set(d.grind);
    doseIn.value = d.dose === '' || d.dose == null ? '' : String(d.dose);
    waterIn.value = d.water === '' || d.water == null ? '' : String(d.water);
    tempIn.value = d.temp === '' || d.temp == null ? '' : String(d.temp);
    sliders.forEach(s => { s.input.value = d.sensory[s.m.k]; s.out.textContent = String(d.sensory[s.m.k]); s.paint(); });
    radar.update(d.sensory);
    accuracy.set(d.accuracy); rating.set(d.rating);
    calc();
  }

  const err = h('div.form-err', { role: 'alert' });
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    banner,
    section('', group('Bean', beanBtn), group('Method', methodBtn)),
    section('Grind', group('Grinder', grinderBtn), group('Grind size', grindStep.el, null), grindHint),
    quick
      ? section('Process', h('div.two.stackable', group('Coffee dose', doseW), group('Temperature', tempW)), doseHint)
      : section('Process',
        h('div.two', group('Coffee dose', doseW), group('Water / yield', waterW)), doseHint,
        h('div.two', group('Temperature', tempW), group('Extraction time', timeBtn)),
        h('div.ratio', h('span.ratio-k', 'Coffee to brew ratio'), ratioBig, ratioSub)),
    quick ? null : section('Sensory profile', h('div.sensory', h('div.sliders', sliders.map(s => s.row)), h('div.radar-box', radar.el))),
    quick ? null : section('Ratings',
      group('Flavor profile accuracy', accuracy.el, 'How closely the cup matched the flavor notes on the bag.'),
      group('Overall rating', rating.el)),
    section('', group('Date of the brew', dateBtn)),
  );
  if (quick) form.prepend(h('p.form-note', 'Save the basics now and put the phone down. After the brew, tap “Review the brew” on this brew to add water and time, then taste and rating.'));

  const sheet = openSheet({
    title: editing ? 'Edit brew' : 'New brew', size: 'lg', className: 'form-sheet brew-form', body: form,
    footer: [err, h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: () => save() }, editing ? 'Save changes' : 'Save brew')],
  });

  // initial state
  if (editing) { setBean(d.beanId); }
  else if (beanId && beanById(beanId) && !beanById(beanId).finished) setBean(beanId);
  else if (activeBeans.length === 1) setBean(activeBeans[0].id);
  else paintAll();

  async function save() {
    const bean = beanById(d.beanId);
    const missing = [];
    if (!bean) { missing.push('bean'); beanBtn.markInvalid(true); }
    if (!(d.dose > 0)) { missing.push('coffee dose'); doseIn.classList.add('invalid'); }
    if (missing.length) { err.textContent = `Fill in: ${missing.join(', ')}.`; form.querySelector('.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const later = quick ? { water: null, time: 0, sensory: { aroma: 0, sweetness: 0, acidity: 0, sourness: 0, bitterness: 0, body: 0 }, accuracy: 0, rating: 0 }
      : { water: d.water === '' ? null : Number(d.water), time: d.time || 0, sensory: { ...d.sensory }, accuracy: d.accuracy || 0, rating: d.rating || 0 };
    // a brew that is still being reviewed moves forward when this form already fills in the next step
    const stage = quick ? 'logged' : !isPending(brew) ? 'done' : later.rating > 0 ? 'done' : later.water > 0 ? 'timed' : 'logged';
    const saved = await saveBrew({
      ...(brew || {}), beanId: d.beanId, methodId: d.methodId, grinderId: d.grinderId || null,
      grind: d.grind, dose: Number(d.dose), temp: d.temp === '' ? null : Number(d.temp), date: d.date, ...later, stage,
    });
    sheet.close();
    const left = remaining(bean);
    if (left <= 0) {
      toast('Brew saved. That bag is empty.', { action: { label: 'Mark finished', fn: async () => { await saveBean({ ...bean, finished: true, finishedAt: today() }); toast('Bag marked as finished'); } }, ms: 7000 });
    } else toast(editing ? 'Brew updated' : `Brew saved · ${fmtG(left)} left in the bag. Tap “Review the brew” when you are done.`, { ms: editing ? undefined : 6000 });
  }
}

/* =========================================================
   Review: step 2 (water + time), then step 3 (taste + rating)
   ========================================================= */
export function openBrewReview(id) {
  if (!canEdit()) { toast('Sign in to edit.'); return; }
  const b = S.brews.find(x => x.id === id);
  if (!b) return;
  if (b.stage === 'logged') openWaterTimeSheet(b);
  else if (b.stage === 'timed') openTasteSheet(b);
  else openBrewDetail(id);
}

function reviewHead(b, step, what) {
  const bean = beanById(b.beanId), m = methodById(b.methodId);
  const bits = [m?.name, b.dose ? fmtG(b.dose) : null, b.temp ? `${b.temp}°C` : null, b.water ? `→ ${fmtG(b.water)}` : null].filter(Boolean).join(' · ');
  return h('div.review-head', h('span.review-step', `Step ${step} of 3 · ${what}`), h('h3.review-bean', bean?.name || 'Deleted beans'), h('p.muted.small', bits));
}

function openWaterTimeSheet(b0) {
  const d = { water: '', time: 0 };
  const waterIn = numericInput(h('input', { type: 'text', value: '', placeholder: 'Water / yield', 'aria-label': 'Water / yield', inputmode: 'decimal' }), { decimal: true });
  const waterW = h('div.unit-input', waterIn, h('span.unit', 'g'));
  const ratio = h('div.ratio-big'), ratioSub = h('div.ratio-sub');
  const last = S.brews.find(x => x.id !== b0.id && x.beanId === b0.beanId && x.water > 0);
  const lastHint = h('div.field-hint', last ? `Last time with this coffee: ${fmtG(last.water)}${last.time ? ' in ' + fmtTime(last.time) : ''}.` : '');
  const calcRatio = () => {
    ratio.textContent = ratioText(b0.dose, d.water);
    ratioSub.textContent = b0.dose > 0 && d.water > 0 ? `${round1(b0.dose / d.water * 1000)} g of coffee per litre` : 'Enter the water to see the ratio.';
  };
  waterIn.addEventListener('input', () => { d.water = waterIn.value === '' ? '' : parseFloat(waterIn.value); waterIn.classList.remove('invalid'); calcRatio(); });
  const timeBtn = selectButton({ placeholder: '00:00:00', onclick: async () => { const r = await pickTime({ value: d.time || 0 }); if (r !== null) { d.time = r; paintTime(); } } });
  const paintTime = () => { const t = d.time || 0; timeBtn.set(`${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`); };
  paintTime(); calcRatio();
  const err = h('div.form-err', { role: 'alert' });
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    reviewHead(b0, 2, 'Water and time'),
    section('', group('Water / yield', waterW), lastHint, group('Extraction time', timeBtn), h('div.ratio', h('span.ratio-k', 'Coffee to brew ratio'), ratio, ratioSub)));
  const sheet = openSheet({
    title: 'Review the brew', size: 'lg', className: 'form-sheet brew-form', body: form,
    footer: [err, h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: () => save() }, 'Save')],
  });
  setTimeout(() => waterIn.focus({ preventScroll: true }), 260);
  async function save() {
    if (!(d.water > 0)) { err.textContent = 'Fill in: water / yield.'; waterIn.classList.add('invalid'); return; }
    const cur = S.brews.find(x => x.id === b0.id);
    if (!cur) { sheet.close(); return; }
    try { await saveBrew({ ...cur, water: Number(d.water), time: d.time || 0, stage: 'timed' }); }
    catch (e) { console.error(e); err.textContent = 'Could not save. Check the numbers and try again.'; return; }
    sheet.close();
    toast('Saved. Tap “Review the brew” again once you have tasted it.', { ms: 5000 });
  }
}

function openTasteSheet(b0) {
  const d = { sensory: sensoryFor(b0), accuracy: b0.accuracy || 0, rating: b0.rating || 0 };
  const radar = Radar({ values: d.sensory, size: 300 });
  const sliders = SENSORY.map(m => {
    const out = h('output', String(d.sensory[m.k]));
    const input = h('input', { type: 'range', min: 0, max: 10, step: 1, value: d.sensory[m.k], 'aria-label': m.label });
    const paint = () => input.style.setProperty('--p', (input.value / 10 * 100) + '%');
    input.addEventListener('input', () => { d.sensory[m.k] = Number(input.value); out.textContent = input.value; paint(); radar.update(d.sensory); });
    paint();
    return h('div.slide-row', h('label', m.label), input, out);
  });
  const accuracy = StarSlider({ value: d.accuracy, label: 'Flavor profile accuracy', onChange: (v) => { d.accuracy = v; } });
  const rating = StarSlider({ value: d.rating, label: 'Overall rating', onChange: (v) => { d.rating = v; err.textContent = ''; } });
  const err = h('div.form-err', { role: 'alert' });
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    reviewHead(b0, 3, 'Taste and rating'),
    section('Sensory profile', h('div.sensory', h('div.sliders', sliders), h('div.radar-box', radar.el))),
    section('Ratings',
      group('Flavor profile accuracy', accuracy.el, 'How closely the cup matched the flavor notes on the bag.'),
      group('Overall rating', rating.el)));
  const sheet = openSheet({
    title: 'Review the brew', size: 'lg', className: 'form-sheet brew-form', body: form,
    footer: [err, h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: () => save() }, 'Save review')],
  });
  async function save() {
    if (!(d.rating > 0)) { err.textContent = 'Give the brew an overall rating.'; return; }
    const cur = S.brews.find(x => x.id === b0.id);
    if (!cur) { sheet.close(); return; }
    try { await saveBrew({ ...cur, sensory: { ...d.sensory }, accuracy: d.accuracy || 0, rating: d.rating, stage: 'done' }); }
    catch (e) { console.error(e); err.textContent = 'Could not save. Try again.'; return; }
    sheet.close();
    toast('Review saved');
  }
}
