// Input hygiene. Everything that reaches storage, from a form or from GitHub, goes through here first:
// text is normalised and stripped of invisible/control characters, numbers are range-checked, and only known fields survive.
// (The UI also never renders data as HTML, so this is a second wall, not the only one.)

// control chars, zero-width, bidi overrides/isolates, BOM, interlinear annotation, and "tag" characters (U+E0000–E007F)
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-︍﻿ﾠ￹-￼]|[\u{E0000}-\u{E0FFF}]/gu;

/** Safe single-line text: NFC, no invisible characters, collapsed spaces, length-capped. */
export function cleanText(v, max = 120) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  try { s = s.normalize('NFC'); } catch { /* lone surrogates */ }
  return s.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
const num = (v, min, max, { int = false, blank = null } = {}) => {
  if (v === '' || v == null) return blank;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return blank;
  return int ? Math.round(n) : Math.round(n * 1000) / 1000;
};
const date = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(v + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || +v.slice(0, 4) < 1990 || +v.slice(0, 4) > 2100 ? '' : v;
};
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
const ts = (v) => num(v, 0, 4102444800000, { int: true, blank: 0 });
export const isId = (v) => typeof v === 'string' && /^[a-z0-9]{6,32}$/.test(v);
export const isSha = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const bool = (v) => v === true;

export const ROASTS = ['ultra-light', 'light', 'medium', 'dark'];

export function normalizeBean(r) {
  if (!r || typeof r !== 'object' || !isId(r.id)) return null;
  const name = cleanText(r.name, 80);
  const roastDate = date(r.roastDate);
  const grams = num(r.grams, 0.1, 100000);
  if (!name || !roastDate || grams == null || !ROASTS.includes(r.roast)) return null;
  const notes = (Array.isArray(r.notes) ? r.notes : []).slice(0, 80)
    .map(n => ({ c: cleanText(n?.c, 40), n: cleanText(n?.n, 40) })).filter(n => n.c && n.n);
  const out = {
    id: r.id, name, country: cleanText(r.country, 80), countryCode: /^[A-Z]{2,3}$/.test(r.countryCode) ? r.countryCode : '',
    region: cleanText(r.region, 80), variety: cleanText(r.variety, 80), process: cleanText(r.process, 80), roast: r.roast,
    altFrom: num(r.altFrom, 0, 9000, { int: true, blank: '' }), altTo: num(r.altTo, 0, 9000, { int: true, blank: '' }), altUnit: pick(r.altUnit, ['m', 'ft'], 'm'),
    notes, roastDate, harvestDate: date(r.harvestDate),
    farm: cleanText(r.farm, 80), washStation: cleanText(r.washStation, 80), producer: cleanText(r.producer, 80),
    grams, finished: bool(r.finished), finishedAt: date(r.finishedAt) || null,
    created: ts(r.created), updated: ts(r.updated),
  };
  if (r.photo !== undefined && isSha(r.photo)) out.photo = r.photo;           // repo copy only
  if (typeof Blob !== 'undefined' && r.image instanceof Blob && r.image.size > 0 && r.image.size <= 4 * 1024 * 1024) out.image = r.image;
  return out;
}

export function normalizeBrew(r) {
  if (!r || typeof r !== 'object' || !isId(r.id) || !isId(r.beanId)) return null;
  const dose = num(r.dose, 0.1, 5000);
  const d = date(r.date);
  if (dose == null || !d) return null;
  const s = (k) => num(r.sensory?.[k], 0, 10, { blank: 0 });
  return {
    id: r.id, beanId: r.beanId, methodId: typeof r.methodId === 'string' && /^[a-z0-9-]{1,40}$/.test(r.methodId) ? r.methodId : 'v60',
    grinderId: isId(r.grinderId) ? r.grinderId : null, grind: num(r.grind, 0, 2000, { blank: '' }),
    dose, water: num(r.water, 0, 20000, { blank: null }), temp: num(r.temp, 0, 100, { blank: null }), time: num(r.time, 0, 86400, { int: true, blank: 0 }),
    sensory: { aroma: s('aroma'), sweetness: s('sweetness'), acidity: s('acidity'), bitterness: s('bitterness'), body: s('body') },
    accuracy: num(r.accuracy, 0, 5, { blank: 0 }), rating: num(r.rating, 0, 5, { blank: 0 }), date: d,
    created: ts(r.created), updated: ts(r.updated),
  };
}

export function normalizeGrinder(r) {
  if (!r || typeof r !== 'object' || !isId(r.id)) return null;
  const name = cleanText(r.name, 60), clicks = num(r.clicks, 1, 5000, { int: true });
  if (!name || clicks == null) return null;
  return {
    id: r.id, name, type: pick(r.type, ['manual', 'automatic'], 'manual'), burr: pick(r.burr, ['conical', 'flat'], 'conical'),
    step: pick(Number(r.step), [0.1, 0.5, 1, 2], 1), clicks, created: ts(r.created), updated: ts(r.updated),
  };
}

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const listOf = (a, max = 2000, len = 80) => [...new Set((Array.isArray(a) ? a : []).slice(0, max).map(x => cleanText(x, len)).filter(Boolean))];

/** Validate a whole data file from GitHub. Never trust it: unknown fields are dropped, bad records are skipped. */
export function sanitizeSnapshot(d) {
  const o = d && typeof d === 'object' ? d : {};
  const many = (arr, fn, max) => (Array.isArray(arr) ? arr.slice(0, max) : []).map(fn).filter(Boolean);
  const flavors = {};
  if (o.lists?.flavors && typeof o.lists.flavors === 'object') {
    for (const [k, v] of Object.entries(o.lists.flavors).slice(0, 200)) {
      const c = cleanText(k, 40);
      if (c && !BAD_KEYS.has(c)) flavors[c] = listOf(v, 500, 40);
    }
  }
  const deleted = {};
  if (o.deleted && typeof o.deleted === 'object') {
    for (const [k, v] of Object.entries(o.deleted).slice(0, 200000)) {
      if (/^(beans|brews|grinders):[a-z0-9]{6,32}$/.test(k) && Number.isFinite(v) && v > 0 && v < 4102444800000) deleted[k] = v;
    }
  }
  return {
    beans: many(o.beans, normalizeBean, 5000), brews: many(o.brews, normalizeBrew, 100000), grinders: many(o.grinders, normalizeGrinder, 200),
    lists: { varieties: listOf(o.lists?.varieties), processes: listOf(o.lists?.processes), flavors }, deleted,
  };
}

/** Passcode rules. The config file on your site is public, so the passcode is the only thing standing between it and a guesser. */
const COMMON = ['password', 'passw0rd', 'qwerty', 'letmein', 'welcome', 'coffee', 'caffora', 'iloveyou', 'admin', '123456', 'abc123', 'maldives', 'monkey'];
export function passcodeProblem(p) {
  p = String(p || '');
  if (p.length < 12) return 'Use at least 12 characters. A few random words in a row works well, for example "river lamp orbit cedar".';
  const lower = p.toLowerCase();
  if (/^(.)\1+$/.test(p)) return 'That is too repetitive.';
  if (COMMON.some(w => lower.replace(/[^a-z0-9]/g, '') === w || (lower.replace(/[^a-z0-9]/g, '').length < w.length + 6 && lower.includes(w)))) return 'That is too easy to guess. Pick something less obvious.';
  const pool = (/[a-z]/.test(p) ? 26 : 0) + (/[A-Z]/.test(p) ? 26 : 0) + (/\d/.test(p) ? 10 : 0) + (/[^A-Za-z0-9]/.test(p) ? 33 : 0);
  const distinct = new Set(p).size;
  if (Math.log2(pool || 1) * Math.min(p.length, distinct * 2) < 60) return 'That is too predictable. Mix in more different characters, or use more words.';
  return null;
}
