// App state, derived values and the reference lists (varieties, processes, flavors, methods, countries).
import { db } from './db.js';
import { today, daysBetween, parseYMD, addDays, uid, norm } from './util.js';

export const S = {
  beans: [], brews: [], grinders: [],
  lists: null,           // raw lists.json
  custom: { varieties: [], processes: [], flavors: {} }, // user additions
  deleted: {},           // tombstones for sync: 'beans:<id>' -> deleted-at (ms)
  aliases: {},           // region aliases
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// Data listeners hear about every change to the user's data (including custom lists); the sync engine uses them.
const dataListeners = new Set();
export const onData = (fn) => { dataListeners.add(fn); return () => dataListeners.delete(fn); };
const touched = (what) => dataListeners.forEach(fn => fn(what));
export const emit = (what) => { listeners.forEach(fn => fn(what)); touched(what); };

async function readData() {
  const [beans, brews, grinders, cv, cp, cf, del] = await Promise.all([
    db.all('beans'), db.all('brews'), db.all('grinders'),
    db.kvGet('customVarieties'), db.kvGet('customProcesses'), db.kvGet('customFlavors'), db.kvGet('deleted'),
  ]);
  S.beans = beans.sort((a, b) => b.created - a.created);
  S.brews = brews.sort((a, b) => (b.date + b.created).toString().localeCompare((a.date + a.created).toString()));
  S.grinders = grinders.sort((a, b) => a.created - b.created);
  S.custom.varieties = cv || []; S.custom.processes = cp || []; S.custom.flavors = cf || {};
  S.deleted = del || {};
}
export async function load() {
  const [lists, aliases] = await Promise.all([
    fetch('data/lists.json').then(r => r.json()),
    fetch('data/region-aliases.json').then(r => r.json()),
  ]);
  S.lists = lists; S.aliases = aliases;
  await readData();
}

/** Remember that a record was deleted, so sync doesn't bring it back from another device. */
async function tombstone(kind, ids) {
  const now = Date.now();
  for (const id of ids) S.deleted[kind + ':' + id] = now;
  await db.kvSet('deleted', S.deleted);
}

/** Replace local data with a merged snapshot from sync. Writes only what changed, then reloads state. */
export async function applyMerged({ beans, brews, grinders, lists, deleted }) {
  for (const [store, next, cur] of [['beans', beans, S.beans], ['brews', brews, S.brews], ['grinders', grinders, S.grinders]]) {
    const keep = new Set(next.map(x => x.id));
    const gone = cur.filter(x => !keep.has(x.id)).map(x => x.id);
    if (gone.length) await db.delMany(store, gone);
    if (next.length) await db.putMany(store, next);
  }
  await db.kvSet('customVarieties', lists.varieties); await db.kvSet('customProcesses', lists.processes); await db.kvSet('customFlavors', lists.flavors);
  await db.kvSet('deleted', deleted);
  await readData();
  listeners.forEach(fn => fn('sync'));
}

/* ---------- reference lists (base + user additions) ---------- */
const byAlpha = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
function merge(base, extra) {
  const seen = new Set(), out = [];
  for (const v of [...base, ...extra]) { const k = v.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } }
  return out.sort(byAlpha);
}
export const varieties = () => merge(S.lists.varieties, S.custom.varieties);
export const processes = () => merge(S.lists.processes, S.custom.processes);
export const methods = () => S.lists.methods;
export const methodById = (id) => S.lists.methods.find(m => m.id === id);
export const countries = () => S.lists.countries;
export const countryByCode = (c) => S.lists.countries.find(x => x.c === c);
export const countryByName = (n) => S.lists.countries.find(x => norm(x.n) === norm(n));

/** Flavor library: { Category: [notes...] }, sorted. */
export function flavorLibrary() {
  const lib = {};
  for (const [c, notes] of Object.entries(S.lists.flavors)) lib[c] = [...notes];
  for (const [c, notes] of Object.entries(S.custom.flavors)) lib[c] = merge(lib[c] || [], notes);
  for (const c of Object.keys(lib)) lib[c].sort(byAlpha);
  return lib;
}
/** Persist the user's additions (lib is a full library object from a form). */
export async function saveFlavorLibrary(lib) {
  const custom = {};
  for (const [c, notes] of Object.entries(lib)) {
    const base = new Set((S.lists.flavors[c] || []).map(n => n.toLowerCase()));
    const add = notes.filter(n => !base.has(n.toLowerCase()));
    if (add.length || !S.lists.flavors[c]) custom[c] = add;
  }
  S.custom.flavors = custom;
  await db.kvSet('customFlavors', custom); touched('lists');
}
export async function addCustomVariety(name) {
  if (!name || varieties().some(v => v.toLowerCase() === name.toLowerCase())) return;
  S.custom.varieties = [...S.custom.varieties, name];
  await db.kvSet('customVarieties', S.custom.varieties); touched('lists');
}
export async function addCustomProcess(name) {
  if (!name || processes().some(v => v.toLowerCase() === name.toLowerCase())) return;
  S.custom.processes = [...S.custom.processes, name];
  await db.kvSet('customProcesses', S.custom.processes); touched('lists');
}

/* ---------- CRUD ---------- */
export async function saveBean(bean) {
  if (!bean.id) { bean.id = uid(); bean.created = Date.now(); }
  bean.updated = Date.now();
  const i = S.beans.findIndex(b => b.id === bean.id);
  if (i >= 0) S.beans[i] = bean; else S.beans.unshift(bean);
  await db.put('beans', bean); emit('beans'); return bean;
}
export async function deleteBean(id) {
  const brewIds = S.brews.filter(b => b.beanId === id).map(b => b.id);
  S.beans = S.beans.filter(b => b.id !== id);
  S.brews = S.brews.filter(b => b.beanId !== id);
  await tombstone('beans', [id]); await tombstone('brews', brewIds);
  await db.del('beans', id); await db.delMany('brews', brewIds); emit('beans');
}
export async function saveBrew(brew) {
  if (!brew.id) { brew.id = uid(); brew.created = Date.now(); }
  brew.updated = Date.now();
  const i = S.brews.findIndex(b => b.id === brew.id);
  if (i >= 0) S.brews[i] = brew; else S.brews.unshift(brew);
  S.brews.sort((a, b) => (b.date + String(b.created).padStart(15, '0')).localeCompare(a.date + String(a.created).padStart(15, '0')));
  await db.put('brews', brew); emit('brews'); return brew;
}
export async function deleteBrew(id) { S.brews = S.brews.filter(b => b.id !== id); await tombstone('brews', [id]); await db.del('brews', id); emit('brews'); }
export async function saveGrinder(g) {
  if (!g.id) { g.id = uid(); g.created = Date.now(); }
  g.updated = Date.now();
  const i = S.grinders.findIndex(x => x.id === g.id);
  if (i >= 0) S.grinders[i] = g; else S.grinders.push(g);
  await db.put('grinders', g); emit('grinders'); return g;
}
export async function deleteGrinder(id) { S.grinders = S.grinders.filter(g => g.id !== id); await tombstone('grinders', [id]); await db.del('grinders', id); emit('grinders'); }

/* ---------- derived ---------- */
export const beanById = (id) => S.beans.find(b => b.id === id);
export const grinderById = (id) => S.grinders.find(g => g.id === id);
export const brewsOfBean = (id) => S.brews.filter(b => b.beanId === id);
export const consumedBy = (beanId, exceptBrewId) => S.brews.filter(b => b.beanId === beanId && b.id !== exceptBrewId).reduce((a, b) => a + (Number(b.dose) || 0), 0);
export const remaining = (bean, exceptBrewId) => Math.max(0, (bean.grams || 0) - consumedBy(bean.id, exceptBrewId));
export const lastBrewOf = (beanId) => S.brews.find(b => b.beanId === beanId) || null; // brews are sorted newest first

/* ---------- freshness ---------- */
export const ROAST_LABEL = { 'ultra-light': 'Ultra light', light: 'Light', medium: 'Medium', dark: 'Dark' };
// best-consumed window, in days after the roast date
export const WINDOW = { dark: [4, 12], medium: [9, 21], light: [14, 28], 'ultra-light': [14, 28] };

export function freshness(bean, now = today()) {
  const [from, to] = WINDOW[bean.roast] || WINDOW.medium;
  const days = daysBetween(bean.roastDate, now);
  const start = addDays(bean.roastDate, from), end = addDays(bean.roastDate, to);
  const domain = Math.ceil(to * 1.5);
  let state = 'resting';
  if (days >= from && days <= to) state = 'peak'; else if (days > to) state = 'past';
  return { days, from, to, start, end, domain, state, pos: Math.min(1, Math.max(0, days / domain)) };
}
