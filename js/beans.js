// Beans tab: list, add/edit form (with flavor picker), detail sheet.
import { h, fill, icon, clear, IS_PHONE, shrinkImage, blobURL, numericInput, fmtDate, fmtDateLong, today, round1, nf0, fmtG, cap } from './util.js';
import {
  S, countries, countryByName, varieties, processes, flavorLibrary, saveFlavorLibrary, addCustomVariety, addCustomProcess,
  saveBean, deleteBean, consumedBy, remaining, freshness, ROAST_LABEL, brewsOfBean, WINDOW, onChange,
} from './store.js';
import { openSheet, toast, confirmDialog, field, group, section, selectButton, segmented, pickFromList, pickDate } from './ui.js';
import { beanThumb, catColor, noteChip, altitudeText, roastLabel, chip, freshnessSlide, stockBar, emptyState, pageHead, searchText } from './parts.js';
import { loadWorld, regionNames } from './geo.js';
import { openBrewForm } from './brews.js';
import { canEdit } from './auth.js';

let filter = 'active';

/* =========================================================
   List
   ========================================================= */
export function renderBeans(root) {
  clear(root);
  const active = S.beans.filter(b => !b.finished), finished = S.beans.filter(b => b.finished);
  const add = () => openBeanForm();
  root.append(
    pageHead('Beans', S.beans.length ? `${active.length} in the cupboard${finished.length ? ` · ${finished.length} finished` : ''}` : 'Your coffee shelf',
      h('button.btn.primary.head-add', { type: 'button', onclick: add }, icon('plus', 18), 'Add beans'), { search: true }),
  );
  if (!S.beans.length) {
    root.append(emptyState({
      iconName: 'beans', title: 'No beans yet',
      text: 'Add the coffees you buy. Their origins appear on the map and you can brew from them.',
      action: h('button.btn.primary', { type: 'button', onclick: add }, icon('plus', 18), 'Add your first beans'),
    }));
  } else {
    const seg = segmented({
      options: [{ v: 'active', label: `Active ${active.length}` }, { v: 'finished', label: `Finished ${finished.length}` }, { v: 'all', label: `All ${S.beans.length}` }],
      value: filter, onChange: (v) => { filter = v; renderBeans(root); },
    });
    seg.el.classList.add('filter-seg');
    const list = filter === 'active' ? active : filter === 'finished' ? finished : S.beans;
    root.append(seg.el);
    if (!list.length) root.append(emptyState({ iconName: 'beans', title: filter === 'active' ? 'No active beans' : 'Nothing finished yet', text: filter === 'active' ? 'Every bag is marked finished. Add a new one.' : 'Bags you mark as finished show up here.' }));
    else root.append(h('div.bean-list', list.map(beanCard)));
  }
  root.append(h('button.fab', { type: 'button', 'aria-label': 'Add beans', onclick: add }, icon('plus', 26)));
}

function beanCard(b) {
  const f = b.finished ? null : freshness(b);
  const origin = [b.country, b.region].filter(Boolean).join(' · ');
  const facts = [roastLabel(b.roast), b.process, b.variety, altitudeText(b)].filter(Boolean);
  const notes = (b.notes || []);
  const card = h('article.bean' + (b.finished ? '.finished' : '') + (f ? '.st-' + f.state : ''), { tabindex: 0, role: 'button', onclick: () => openBeanDetail(b.id), onkeydown: (e) => { if (e.key === 'Enter') openBeanDetail(b.id); },
      dataset: { search: searchText(b.name, b.country, b.region, b.variety, b.process, b.farm, b.producer, b.washStation, roastLabel(b.roast), notes.map(n => n.n).join(' ')) } },
    h('div.bean-top',
      beanThumb(b, 72),
      h('div.bean-main',
        h('h3.bean-name', b.name),
        h('p.bean-origin', origin),
        h('div.bean-facts', facts.map(t => chip(t))),
        notes.length ? h('div.bean-notes', notes.slice(0, 5).map(n => noteChip(n, { small: true })), notes.length > 5 ? h('span.more', `+${notes.length - 5}`) : null) : null)),
    f ? freshnessSlide(b) : null,
    stockBar(b),
    h('div.bean-foot',
      h('span.muted', b.finished ? `Roasted ${fmtDate(b.roastDate)}` : `Roasted ${fmtDate(b.roastDate, false)} · best ${fmtDate(f.start, false)} – ${fmtDate(f.end, false)}`),
      !canEdit() ? null : b.finished
        ? h('button.link', { type: 'button', onclick: (e) => { e.stopPropagation(); reopen(b); } }, 'Reopen bag')
        : h('button.link', { type: 'button', onclick: (e) => { e.stopPropagation(); markFinished(b); } }, 'Mark finished')));
  return card;
}

async function markFinished(b) {
  const used = Math.min(consumedBy(b.id), b.grams), others = Math.max(0, b.grams - used);
  const ok = await confirmDialog({
    title: 'Mark this bag as finished?',
    text: `${b.name}: you brewed ${fmtG(used)}. The other ${fmtG(others)} will count as consumed by others.`,
    confirmLabel: 'Mark finished',
  });
  if (!ok) return;
  await saveBean({ ...b, finished: true, finishedAt: today() });
  toast('Bag marked as finished');
}
async function reopen(b) {
  await saveBean({ ...b, finished: false, finishedAt: null });
  toast('Bag is active again');
}

/* =========================================================
   Detail
   ========================================================= */
export function openBeanDetail(id) {
  const render = () => {
    const b = S.beans.find(x => x.id === id);
    if (!b) { sheet.close(); return; }
    const f = b.finished ? null : freshness(b);
    const [wf, wt] = WINDOW[b.roast] || [0, 0];
    const rows = [
      ['Country', b.country], ['Region / area', b.region], ['Variety', b.variety], ['Processing', b.process],
      ['Roast level', ROAST_LABEL[b.roast]], ['Altitude', altitudeText(b)],
      ['Roast date', fmtDateLong(b.roastDate)], ['Best consumed', `${fmtDate(freshness(b).start)} – ${fmtDate(freshness(b).end)}`],
      ['Harvest date', b.harvestDate ? fmtDateLong(b.harvestDate) : ''],
      ['Farm', b.farm], ['Wash station', b.washStation], ['Producer', b.producer],
    ].filter(r => r[1]);
    const brews = brewsOfBean(b.id);
    sheet.setTitle(b.name);
    fill(sheet.body, 
      h('div.detail-hero',
        b.image ? h('img.hero-img', { src: blobURL(b.image), alt: `Bag of ${b.name}` }) : h('div.hero-img.ph', beanThumb(b, 96)),
        h('div.hero-meta', h('p.bean-origin', [b.country, b.region].filter(Boolean).join(' · ')),
          h('div.bean-facts', chip(roastLabel(b.roast)), b.process ? chip(b.process) : null, b.variety ? chip(b.variety) : null))),
      f ? freshnessSlide(b) : null,
      stockBar(b),
      h('dl.facts', rows.map(([k, v]) => [h('dt', k), h('dd', v)])),
      (b.notes || []).length ? h('div.detail-notes', h('h4', 'Flavor notes'), h('div.chips', b.notes.map(n => noteChip(n)))) : null,
      h('p.muted.small', brews.length ? `${brews.length} ${brews.length === 1 ? 'brew' : 'brews'} logged with this coffee.` : 'No brews logged with this coffee yet.'),
    );
    fill(sheet.foot, ...(!canEdit() ? [h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Close')] : [
      !b.finished ? h('button.btn.primary', { type: 'button', onclick: () => { sheet.close(); openBrewForm({ beanId: b.id }); } }, 'Brew this') : null,
      h('button.btn', { type: 'button', onclick: () => { sheet.close(); openBeanForm(b); } }, icon('edit', 16), 'Edit'),
      b.finished ? h('button.btn', { type: 'button', onclick: () => reopen(b) }, 'Reopen bag') : h('button.btn', { type: 'button', onclick: () => markFinished(b) }, 'Mark finished'),
      h('button.btn.danger-ghost', { type: 'button', onclick: async () => {
        const n = brews.length;
        const ok = await confirmDialog({ title: 'Delete these beans?', text: n ? `${b.name} and its ${n} ${n === 1 ? 'brew' : 'brews'} will be deleted. This can't be undone.` : `${b.name} will be deleted. This can't be undone.`, confirmLabel: 'Delete', danger: true });
        if (ok) { await deleteBean(b.id); sheet.close(); toast('Beans deleted'); }
      } }, icon('trash', 16), 'Delete'),
    ]));
  };
  const sheet = openSheet({ title: '', size: 'lg', className: 'detail', body: h('div'), footer: h('div.foot-actions') });
  sheet.foot = sheet.el.querySelector('.sheet-foot');
  render();
  const off = onChange((what) => { if (what === 'beans' || what === 'brews') render(); });
  sheet.done.then(off);
}

/* =========================================================
   Flavor picker (accordion by main flavor)
   ========================================================= */
function FlavorPicker(selected) {
  const lib = flavorLibrary();
  const open = new Set();
  const root = h('div.flavors');
  const summary = h('div.flavor-summary');
  const cats = h('div.acc');
  const newWrap = h('div.new-flavor');
  const isSel = (c, n) => selected.some(x => x.c === c && x.n === n);
  const alpha = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

  function paintSummary() {
    fill(summary, 
      selected.length
        ? [h('span.sum-count', `${selected.length} selected`), h('div.chips', selected.map(n => noteChip(n, { on: true, onclick: () => toggle(n.c, n.n) })))]
        : h('span.muted.small', 'Tap a flavor to see its notes, then tap notes to select them.'));
  }
  function toggle(c, n) {
    const i = selected.findIndex(x => x.c === c && x.n === n);
    if (i >= 0) selected.splice(i, 1); else selected.push({ c, n });
    paintSummary(); renderCats();
  }
  function renderCats() {
    const scrollHost = root.closest('.sheet-body');
    const st = scrollHost ? scrollHost.scrollTop : 0;
    cats.replaceChildren(...Object.keys(lib).sort(alpha).map(c => {
      const isOpen = open.has(c), count = selected.filter(x => x.c === c).length;
      const head = h('button.acc-head', { type: 'button', 'aria-expanded': String(isOpen), style: { '--chip': catColor(c) }, onclick: () => { isOpen ? open.delete(c) : open.add(c); renderCats(); } },
        h('i.acc-dot'), h('span.acc-name', c), count ? h('span.acc-count', count) : null, icon('chevron', 18, 'acc-chev'));
      const item = h('div.acc-item' + (isOpen ? '.open' : ''), head);
      if (isOpen) {
        const msg = h('p.add-msg', { role: 'status' });
        const inp = h('input', { type: 'text', placeholder: `Add a note under ${c}`, autocomplete: 'off', maxlength: 40, 'aria-label': `New ${c} note` });
        const submit = () => {
          const v = inp.value.trim().replace(/\s+/g, ' ');
          if (!v) return;
          const hit = Object.entries(lib).find(([, notes]) => notes.some(n => n.toLowerCase() === v.toLowerCase()));
          if (hit) { msg.textContent = `“${v}” already exists under ${hit[0]}.`; msg.className = 'add-msg warn'; return; }
          lib[c].push(v); lib[c].sort(alpha);
          selected.push({ c, n: v });
          paintSummary(); renderCats();
          const again = cats.querySelector(`.acc-item.open input[aria-label="New ${CSS.escape(c)} note"]`);
          const m = cats.querySelector('.acc-item.open .add-msg');
          if (m) { m.textContent = `Added “${v}” under ${c} and selected it.`; m.className = 'add-msg ok'; }
          (again || inp).focus?.();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        inp.addEventListener('input', () => { msg.textContent = ''; msg.className = 'add-msg'; });
        item.append(h('div.acc-body',
          h('div.chips', lib[c].map(n => noteChip({ c, n }, { on: isSel(c, n), onclick: () => toggle(c, n) }))),
          h('div.add-note', inp, h('button.btn.sm', { type: 'button', onclick: submit }, icon('plus', 16), 'Add')),
          msg));
      }
      return item;
    }));
    if (scrollHost) scrollHost.scrollTop = st;
  }
  function renderNew() {
    newWrap.replaceChildren();
    const btn = h('button.btn.ghost.sm', { type: 'button', onclick: () => {
      const msg = h('p.add-msg', { role: 'status' });
      const inp = h('input', { type: 'text', placeholder: 'Name of the new flavor', maxlength: 30, autocomplete: 'off', 'aria-label': 'New flavor name' });
      const go = () => {
        const v = inp.value.trim().replace(/\s+/g, ' ');
        if (!v) return;
        const ex = Object.keys(lib).find(k => k.toLowerCase() === v.toLowerCase());
        if (ex) { msg.textContent = `“${ex}” already exists. Open it to add notes.`; msg.className = 'add-msg warn'; return; }
        lib[v] = []; open.add(v); renderCats(); renderNew();
        requestAnimationFrame(() => { cats.querySelector(`.acc-item.open:last-child input`)?.focus?.(); [...cats.querySelectorAll('.acc-item')].find(el => el.textContent.startsWith(v))?.scrollIntoView({ block: 'nearest' }); });
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      inp.addEventListener('input', () => { msg.textContent = ''; msg.className = 'add-msg'; });
      newWrap.replaceChildren(h('div.add-note', inp, h('button.btn.sm.primary', { type: 'button', onclick: go }, 'Create'), h('button.btn.sm.ghost', { type: 'button', onclick: renderNew }, 'Cancel')), msg);
      inp.focus();
    } }, icon('plus', 16), 'New flavor');
    newWrap.append(btn);
  }
  root.append(summary, cats, newWrap);
  paintSummary(); renderCats(); renderNew();
  return { el: root, lib };
}

/* =========================================================
   Add / edit form
   ========================================================= */
const UNIT_G = { g: 1, oz: 28.349523125, lb: 453.59237 };

export function openBeanForm(existing = null) {
  if (!canEdit()) { toast('Sign in to edit.'); return; }
  const editing = !!existing;
  const d = existing ? { ...existing, notes: [...(existing.notes || [])] } : {
    name: '', country: '', countryCode: '', region: '', variety: '', roast: '', process: '', altFrom: '', altTo: '', altUnit: 'm',
    notes: [], roastDate: '', harvestDate: '', farm: '', washStation: '', producer: '', grams: 0, image: null,
  };
  let gAmount = editing && d.grams ? String(round1(d.grams)) : '', gUnit = 'g';

  /* --- photo --- */
  const photoBox = h('div.photo-box');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const paintPhoto = () => {
    photoBox.replaceChildren(
      d.image ? h('img', { src: blobURL(d.image), alt: 'Bag preview' }) : h('div.photo-ph', icon('image', 30), h('span', 'Picture of the bag')),
    );
    removeBtn.hidden = !d.image;
  };
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]; if (!file) return;
    try { d.image = await shrinkImage(file); paintPhoto(); } catch { toast('That image could not be read. Try another one.'); }
    fileInput.value = '';
  });
  const removeBtn = h('button.btn.ghost', { type: 'button', onclick: () => { d.image = null; paintPhoto(); } }, 'Remove');
  const photoRow = h('div.photo-row', photoBox, h('div.photo-btns',
    h('button.btn', { type: 'button', onclick: () => fileInput.click() }, icon('image', 18), IS_PHONE ? 'Gallery' : 'Add photo'),
    removeBtn, fileInput));
  paintPhoto();

  /* --- name --- */
  const nameIn = h('input', { type: 'text', value: d.name, placeholder: 'e.g. Ethiopia Guji Hambela', autocomplete: 'off', maxlength: 80 });
  nameIn.addEventListener('input', () => { d.name = nameIn.value; nameIn.classList.remove('invalid'); });

  /* --- country --- */
  const regionList = h('datalist#region-opts');
  const countryBtn = selectButton({ placeholder: 'Choose a country', onclick: async () => {
    const r = await pickFromList({
      title: 'Country of origin', placeholder: 'Type a country name', selected: d.countryCode,
      items: countries().map(c => ({ id: c.c, label: c.n, alt: c.a })),
    });
    if (r?.item) { d.country = r.item.label; d.countryCode = r.item.id; countryBtn.set(d.country); countryBtn.markInvalid(false); loadRegionHints(); }
  } });
  countryBtn.set(d.country);
  async function loadRegionHints() {
    regionList.replaceChildren();
    if (!d.countryCode) return;
    try {
      const w = await loadWorld();
      regionList.replaceChildren(...regionNames(w, d.countryCode).map(n => h('option', { value: n })));
    } catch { /* offline first load: suggestions are optional */ }
  }
  loadRegionHints();

  /* --- region --- */
  const regionIn = h('input', { type: 'text', value: d.region, placeholder: 'e.g. Guji, Huila, Antigua', autocomplete: 'off', maxlength: 80 });
  regionIn.setAttribute('list', 'region-opts');
  regionIn.addEventListener('input', () => { d.region = regionIn.value; });

  /* --- variety / process (searchable, can add) --- */
  const clearable = (btn, get, clr) => {
    const x = h('button.sel-clear', { type: 'button', 'aria-label': 'Clear', onclick: () => { clr(); sync(); } }, icon('close', 16));
    const sync = () => { x.hidden = !get(); };
    sync();
    const wrap = h('div.sel-wrap', btn, x); wrap.sync = sync; return wrap;
  };
  const varietyBtn = selectButton({ placeholder: 'Search or add a variety', onclick: async () => {
    const r = await pickFromList({ title: 'Variety', placeholder: 'Type to filter, e.g. A', grouped: true, allowNew: true, newNoun: 'variety', selected: d.variety, items: varieties().map(v => ({ id: v, label: v })) });
    if (r?.item) d.variety = r.item.label; else if (r?.create) d.variety = r.create; else return;
    varietyBtn.set(d.variety); varietyWrap.sync();
  } });
  varietyBtn.set(d.variety);
  const varietyWrap = clearable(varietyBtn, () => d.variety, () => { d.variety = ''; varietyBtn.set(''); });

  const processBtn = selectButton({ placeholder: 'Search or add a process', onclick: async () => {
    const r = await pickFromList({ title: 'Processing', placeholder: 'Type to filter, e.g. W', grouped: true, allowNew: true, newNoun: 'process', selected: d.process, items: processes().map(v => ({ id: v, label: v })) });
    if (r?.item) d.process = r.item.label; else if (r?.create) d.process = r.create; else return;
    processBtn.set(d.process); processWrap.sync();
  } });
  processBtn.set(d.process);
  const processWrap = clearable(processBtn, () => d.process, () => { d.process = ''; processBtn.set(''); });

  /* --- roast level --- */
  const roastSel = h('select.sel-native', { 'aria-label': 'Roast level' },
    h('option', { value: '', disabled: true, selected: !d.roast }, 'Select roast level'),
    ...Object.entries(ROAST_LABEL).map(([v, l]) => h('option', { value: v, selected: d.roast === v }, l)));
  roastSel.addEventListener('change', () => { d.roast = roastSel.value; roastSel.classList.remove('invalid'); });

  /* --- altitude --- */
  const altFrom = numericInput(h('input', { type: 'text', value: d.altFrom || '', placeholder: 'From (optional)', 'aria-label': 'Altitude from' }));
  const altTo = numericInput(h('input', { type: 'text', value: d.altTo || '', placeholder: 'To', 'aria-label': 'Altitude to' }));
  altFrom.addEventListener('input', () => { d.altFrom = altFrom.value ? Number(altFrom.value) : ''; });
  altTo.addEventListener('input', () => { d.altTo = altTo.value ? Number(altTo.value) : ''; });
  const altUnit = segmented({ options: [{ v: 'm', label: 'm' }, { v: 'ft', label: 'ft' }], value: d.altUnit || 'm', onChange: (v) => { d.altUnit = v; }, cls: 'compact' });

  /* --- flavor notes --- */
  const flavor = FlavorPicker(d.notes);

  /* --- dates --- */
  const dateBtn = (key, title, optional) => {
    const btn = selectButton({ placeholder: optional ? 'Select date (optional)' : 'Select date', onclick: async () => {
      const r = await pickDate({ title, value: d[key] || today(), optional });
      if (r === null) return;
      d[key] = r; paint(); btn.markInvalid(false);
    } });
    const paint = () => btn.set(d[key] ? fmtDateLong(d[key]) : '');
    paint(); return btn;
  };
  const roastBtn = dateBtn('roastDate', 'Roast date', false);
  const harvestBtn = dateBtn('harvestDate', 'Harvest date', true);

  /* --- source --- */
  const txt = (key, ph) => { const i = h('input', { type: 'text', value: d[key] || '', placeholder: ph, autocomplete: 'off', maxlength: 80 }); i.addEventListener('input', () => { d[key] = i.value; }); return i; };

  /* --- grams --- */
  const amountIn = numericInput(h('input', { type: 'text', value: gAmount, placeholder: '0', 'aria-label': 'Amount' }), { decimal: true });
  const conv = h('div.conv');
  const unitSeg = segmented({ options: [{ v: 'g', label: 'Grams' }, { v: 'oz', label: 'Oz' }, { v: 'lb', label: 'Lb' }], value: gUnit, onChange: (v) => { gUnit = v; calc(); } });
  function calc() {
    gAmount = amountIn.value;
    const n = parseFloat(gAmount);
    d.grams = Number.isFinite(n) ? round1(n * UNIT_G[gUnit]) : 0;
    amountIn.classList.remove('invalid');
    conv.textContent = d.grams ? (gUnit === 'g' ? `${nf0.format(d.grams)} g in the bag` : `${gAmount} ${gUnit} = ${nf0.format(d.grams)} g`) : 'Oz and lb are converted to grams.';
  }
  amountIn.addEventListener('input', calc); calc();

  /* --- assemble --- */
  const form = h('form.form', { onsubmit: (e) => { e.preventDefault(); save(); }, novalidate: true },
    section('', photoRow),
    section('Coffee',
      field('Name', nameIn),
      group('Country of origin', countryBtn),
      field('Region, area', regionIn, null), regionList,
      group('Variety', varietyWrap),
      field('Roast level', roastSel),
      group('Processing', processWrap),
      group('Altitude', h('div.alt-row', altFrom, altTo, altUnit.el))),
    section('Flavor notes', flavor.el),
    section('Dates',
      h('div.two', group('Roast date', roastBtn), group('Harvest date', harvestBtn))),
    section('Source', field('Farm', txt('farm', 'Farm or estate')), field('Wash station', txt('washStation', 'Wash station or mill')), field('Producer', txt('producer', 'Producer or importer'))),
    section('Grams', group('Amount in the bag', h('div.grams-row', amountIn, unitSeg.el), null), conv),
  );

  const err = h('div.form-err', { role: 'alert' });
  const saveBtn = h('button.btn.primary', { type: 'button', onclick: () => save() }, editing ? 'Save changes' : 'Add beans');
  const sheet = openSheet({
    title: editing ? 'Edit beans' : 'New beans', size: 'lg', className: 'form-sheet',
    body: form,
    footer: [err, h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), saveBtn],
  });
  if (!editing) setTimeout(() => nameIn.focus({ preventScroll: true }), 260);

  async function save() {
    const missing = [];
    if (!d.name.trim()) { missing.push('name'); nameIn.classList.add('invalid'); }
    if (!d.countryCode) { missing.push('country'); countryBtn.markInvalid(true); }
    if (!d.roast) { missing.push('roast level'); roastSel.classList.add('invalid'); }
    if (!d.roastDate) { missing.push('roast date'); roastBtn.markInvalid(true); }
    if (!(d.grams > 0)) { missing.push('grams'); amountIn.classList.add('invalid'); }
    if (missing.length) {
      err.textContent = `Fill in: ${missing.join(', ')}.`;
      form.querySelector('.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    saveBtn.disabled = true;
    const bean = {
      ...(existing || {}),
      id: existing?.id, name: d.name.trim(), country: d.country, countryCode: d.countryCode, region: (d.region || '').trim(),
      variety: (d.variety || '').trim(), roast: d.roast, process: (d.process || '').trim(),
      altFrom: d.altFrom || '', altTo: d.altTo || '', altUnit: d.altUnit || 'm',
      notes: d.notes, roastDate: d.roastDate, harvestDate: d.harvestDate || '', farm: (d.farm || '').trim(), washStation: (d.washStation || '').trim(), producer: (d.producer || '').trim(),
      grams: d.grams, image: d.image || null, finished: existing?.finished || false,
    };
    if (bean.altFrom && bean.altTo && bean.altFrom > bean.altTo) [bean.altFrom, bean.altTo] = [bean.altTo, bean.altFrom];
    try {
      if (bean.variety) await addCustomVariety(bean.variety);
      if (bean.process) await addCustomProcess(bean.process);
      await saveFlavorLibrary(flavor.lib);
      await saveBean(bean);
      sheet.close();
      toast(editing ? 'Changes saved' : `${bean.name} added`);
    } catch (e) {
      console.error(e); saveBtn.disabled = false; err.textContent = 'Could not save. Check your device storage and try again.';
    }
  }
}
