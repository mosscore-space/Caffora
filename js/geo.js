// World geometry (countries + admin-1 regions) loaded once from data/world.topo.json.
import { norm } from './util.js';
import { S } from './store.js';

let worldP;
const STOP = new Set(['province', 'region', 'department', 'departamento', 'state', 'district', 'zone', 'county', 'prefecture', 'governorate', 'municipality', 'of', 'the', 'de', 'del', 'la', 'el']);
const clean = (str) => norm(str).split(' ').filter(w => !STOP.has(w)).join(' ');

export function loadWorld() {
  if (worldP) return worldP;
  worldP = fetch('data/world.topo.json').then(r => r.json()).then(topo => {
    const tj = window.topojson;
    const countries = tj.feature(topo, topo.objects.countries).features;
    const regions = tj.feature(topo, topo.objects.regions).features.filter(f => f.properties.n);
    const regionsBy = {};
    for (const f of regions) (regionsBy[f.properties.c] = regionsBy[f.properties.c] || []).push(f);
    const countryBy = {};
    for (const f of countries) countryBy[f.properties.c] = f;
    return { topo, countries, regions, regionsBy, countryBy, idx: {} };
  });
  return worldP;
}

function index(world, a3) {
  if (world.idx[a3]) return world.idx[a3];
  const m = new Map(), byName = new Map();
  for (const f of world.regionsBy[a3] || []) {
    const p = f.properties;
    byName.set(p.n, f);
    const names = [p.n, p.e, ...(p.a ? p.a.split('|') : [])].filter(Boolean);
    for (const nm of names) { for (const k of [clean(nm), norm(nm)]) if (k && !m.has(k)) m.set(k, f); }
  }
  return (world.idx[a3] = { m, byName });
}

/** Sorted unique region names for a country (for suggestions). */
export function regionNames(world, a3) {
  const set = new Set();
  for (const f of world.regionsBy[a3] || []) set.add(f.properties.e || f.properties.n);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Find the admin-1 feature that a free-typed region/area refers to. */
export function matchRegion(world, a3, text) {
  if (!a3 || !text || !text.trim()) return null;
  const { m, byName } = index(world, a3);
  const aliases = S.aliases[a3] || {};
  const tokens = text.split(/[,;/&|]|\band\b| - /i).map(t => t.trim()).filter(Boolean);
  if (!tokens.includes(text.trim())) tokens.push(text.trim());
  // 1) alias, then exact
  for (const t of tokens) {
    const nt = norm(t), ct = clean(t);
    const al = aliases[nt] || aliases[ct];
    if (al && byName.get(al)) return byName.get(al);
    const hit = m.get(ct) || m.get(nt);
    if (hit) return hit;
  }
  // 2) whole-word containment (e.g. "Southern Huila", "Huila highlands")
  let best = null, bestLen = 0;
  for (const t of tokens) {
    const ct = ` ${clean(t)} `;
    for (const [name, f] of m) {
      if (name.length < 4) continue;
      if (ct.includes(` ${name} `) && name.length > bestLen) { best = f; bestLen = name.length; }
    }
    // alias phrases inside the token
    for (const [ak, target] of Object.entries(aliases)) {
      if (ak.length >= 4 && ct.includes(` ${ak} `) && ak.length > bestLen && byName.get(target)) { best = byName.get(target); bestLen = ak.length; }
    }
  }
  return best;
}
