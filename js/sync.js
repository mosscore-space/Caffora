// GitHub sync: keeps a copy of your data in a separate (private) GitHub repo and merges it back on any device.
//
// Repo layout (written by this app):
//   caffora.json          beans, brews, grinders, custom lists and deletion records (no photos)
//   photos/<sha>.jpg      bag photos, named by their git blob hash, so a file never changes once written
//
// Every sync is one commit made through the Git Data API. Records carry an `updated` time; when the same
// record differs on two devices the newer edit wins, and deletions are remembered so they don't come back.
import { db } from './db.js';
import { S, onData, applyMerged } from './store.js';

const API = 'https://api.github.com';
const DATA_FILE = 'caffora.json';
const SCHEMA = 1;
const AUTO_DELAY = 5000;

/* =========================================================
   State (observable)
   ========================================================= */
let cfg = null;                         // { repo, branch, token, auto, lastSync, headSha, dirty, defaultBranch }
export const sync = { ready: false, status: 'off', message: '', lastSync: 0 };   // status: off | idle | syncing | ok | error
const subs = new Set();
export const onSyncState = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const publish = (patch) => { Object.assign(sync, patch); subs.forEach(fn => fn(sync)); };

export const syncConfig = () => (cfg ? { repo: cfg.repo, branch: cfg.branch || cfg.defaultBranch || '', auto: cfg.auto !== false } : null);
const saveCfg = () => db.kvSet('sync', cfg);

/* =========================================================
   Merge (pure, exported for testing)
   ========================================================= */
const stamp = (r) => r.updated ?? r.created ?? 0;

function mergeKind(kind, local = [], remote = [], deleted = {}) {
  const byId = new Map();
  for (const r of local) byId.set(r.id, { l: r });
  for (const r of remote) { const e = byId.get(r.id); if (e) e.r = r; else byId.set(r.id, { r }); }
  const out = [];
  for (const [id, { l, r }] of byId) {
    const pick = !r ? l : !l ? r : (stamp(r) > stamp(l) ? r : l);
    const t = deleted[kind + ':' + id];
    if (t != null && t >= stamp(pick)) continue;          // deleted after its last edit
    out.push(pick);
  }
  return out;
}
const union = (a = [], b = []) => {
  const seen = new Set(), out = [];
  for (const v of [...a, ...b]) { const k = String(v).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } }
  return out;
};
function mergeFlavors(a = {}, b = {}) {
  const out = {};
  for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) out[c] = union(a[c], b[c]);
  return out;
}

/** Merge two snapshots shaped { beans, brews, grinders, lists, deleted }. `remote` may be null. */
export function mergeData(local, remote) {
  const r = remote || {};
  const deleted = { ...(r.deleted || {}) };
  for (const [k, t] of Object.entries(local.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  const beans = mergeKind('beans', local.beans, r.beans, deleted);
  const ids = new Set(beans.map(b => b.id));
  const brews = mergeKind('brews', local.brews, r.brews, deleted).filter(b => ids.has(b.beanId));   // no orphans
  const grinders = mergeKind('grinders', local.grinders, r.grinders, deleted);
  const lists = {
    varieties: union(local.lists?.varieties, r.lists?.varieties),
    processes: union(local.lists?.processes, r.lists?.processes),
    flavors: mergeFlavors(local.lists?.flavors, r.lists?.flavors),
  };
  return { beans, brews, grinders, lists, deleted };
}

/** Stable JSON: sorted records and sorted keys, so an unchanged snapshot is byte-identical every time. */
export function serialize(d) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
    return v;
  };
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = {
    app: 'caffora', schema: SCHEMA,
    beans: [...d.beans].sort(byId), brews: [...d.brews].sort(byId), grinders: [...d.grinders].sort(byId),
    lists: d.lists, deleted: d.deleted,
  };
  return JSON.stringify(sortKeys(out), null, 1) + '\n';
}

/* =========================================================
   Bytes, hashes
   ========================================================= */
const enc = new TextEncoder();
function b64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
const unb64 = (str) => Uint8Array.from(atob(str.replace(/\s/g, '')), c => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
/** The same hash git gives a file with these bytes, so a photo's name tells us whether GitHub already has it. */
async function gitSha(bytes) {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length); all.set(head); all.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}
const shaCache = new WeakMap();   // Blob -> { sha, bytes }
async function blobInfo(blob) {
  let e = shaCache.get(blob);
  if (!e) { const bytes = new Uint8Array(await blob.arrayBuffer()); e = { sha: await gitSha(bytes), bytes }; shaCache.set(blob, e); }
  return e;
}

/* =========================================================
   GitHub API
   ========================================================= */
export class GhError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function gh(path, { method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  let res;
  try {
    res = await fetch(API + path, {
      method, signal: ctl.signal, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new GhError(0, e.name === 'AbortError' ? 'GitHub took too long to answer.' : 'Could not reach GitHub. Check your connection.');
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    let msg = ''; try { msg = (await res.json()).message || ''; } catch { /* no body */ }
    if (res.status === 401) msg = 'GitHub rejected the token. It may be wrong or expired.';
    else if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') msg = 'GitHub rate limit reached. Try again in a few minutes.';
    else if (res.status === 403) msg = 'The token is not allowed to do that. It needs "Contents: Read and write" on the data repo.';
    else if (res.status === 404) msg = 'Repository not found, or the token has no access to it.';
    throw new GhError(res.status, msg || res.statusText);
  }
  return res.status === 204 ? null : res.json();
}
const repoPath = () => `/repos/${cfg.repo}`;
const branchName = () => cfg.branch || cfg.defaultBranch;

/** What GitHub currently holds: head commit, file hashes, and the parsed data file. Empty repo gives head = null. */
async function readRemote() {
  let ref = null;
  try { ref = await gh(`${repoPath()}/git/ref/heads/${encodeURI(branchName())}`); }
  catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
  if (!ref) return { head: null, tree: null, files: new Map(), data: null, text: null };
  const head = ref.object.sha;
  if (cfg.headSha === head && !cfg.dirty) return { head, unchanged: true };      // nothing new anywhere
  const commit = await gh(`${repoPath()}/git/commits/${head}`);
  const tree = await gh(`${repoPath()}/git/trees/${commit.tree.sha}?recursive=1`);
  const files = new Map(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
  let data = null, text = null;
  if (files.has(DATA_FILE)) {
    const blob = await gh(`${repoPath()}/git/blobs/${files.get(DATA_FILE)}`);
    text = new TextDecoder().decode(unb64(blob.content));
    try { data = JSON.parse(text); } catch { throw new GhError(0, `${DATA_FILE} in the repo is not valid JSON, so Caffora left it alone.`); }
    if (data.app !== 'caffora') throw new GhError(0, `${DATA_FILE} in the repo was not written by Caffora, so it was left alone.`);
    if (data.schema > SCHEMA) throw new GhError(0, 'The repo data is from a newer version of Caffora. Update the app first.');
  }
  return { head, tree: commit.tree.sha, files, data, text };
}

/* =========================================================
   Snapshots
   ========================================================= */
/** Local data as plain JSON, with each bean's photo replaced by the hash of its image. */
async function localSnapshot() {
  const photos = new Map();   // path -> Blob
  const beans = [];
  for (const b of S.beans) {
    const { image, ...rest } = b;
    if (image) { const { sha } = await blobInfo(image); rest.photo = sha; photos.set(`photos/${sha}.jpg`, image); }
    else delete rest.photo;
    beans.push(rest);
  }
  const data = {
    beans, brews: S.brews.map(x => ({ ...x })), grinders: S.grinders.map(x => ({ ...x })),
    lists: { varieties: [...S.custom.varieties], processes: [...S.custom.processes], flavors: structuredClone(S.custom.flavors) },
    deleted: { ...S.deleted },
  };
  return { data, photos };
}

async function pool(items, n, fn) {
  const q = [...items]; const run = async () => { while (q.length) await fn(q.shift()); };
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, run));
}

/** Turn merged JSON beans back into stored beans: reuse the local photo when identical, else download it. */
async function withPhotos(merged, remote) {
  const localBySha = new Map();
  for (const b of S.beans) if (b.image) localBySha.set((await blobInfo(b.image)).sha, b.image);
  const missing = [];
  const beans = merged.beans.map(b => {
    const bean = { ...b };
    if (b.photo) {
      const have = localBySha.get(b.photo);
      if (have) bean.image = have; else missing.push(bean);
    }
    return bean;
  });
  await pool(missing, 4, async (bean) => {
    const sha = remote.files.get(`photos/${bean.photo}.jpg`);
    if (!sha) return;                                     // photo not in the repo (yet): keep the bean without it
    const blob = await gh(`${repoPath()}/git/blobs/${sha}`);
    bean.image = new Blob([unb64(blob.content)], { type: 'image/jpeg' });
  });
  for (const b of beans) delete b.photo;                    // the hash is only for the repo copy
  return beans;
}

/* =========================================================
   Sync
   ========================================================= */
let running = null, again = false, timer = 0, toastedError = false, seq = 0;

function commitMessage(d) {
  const t = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `Caffora sync ${t} (${d.beans.length} beans, ${d.brews.length} brews)`;
}

async function pushOnce(remote, text, merged, photos) {
  const msg = commitMessage(merged);
  if (!remote.head) {
    // Brand-new empty repo: the Git Data API can't write yet, so create the first file the simple way.
    await gh(`${repoPath()}/contents/${DATA_FILE}`, { method: 'PUT', body: { message: msg, content: b64(enc.encode(text)), ...(cfg.branch ? { branch: cfg.branch } : {}) } });
    return 'retry';
  }
  const entries = [];
  const fresh = [...photos].filter(([path]) => !remote.files.has(path));
  await pool(fresh, 3, async ([path, blob]) => {
    const { bytes } = await blobInfo(blob);
    const b = await gh(`${repoPath()}/git/blobs`, { method: 'POST', body: { content: b64(bytes), encoding: 'base64' } });
    entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
  });
  if (text !== remote.text) {
    const b = await gh(`${repoPath()}/git/blobs`, { method: 'POST', body: { content: b64(enc.encode(text)), encoding: 'base64' } });
    entries.push({ path: DATA_FILE, mode: '100644', type: 'blob', sha: b.sha });
  }
  if (!entries.length) return remote.head;
  const tree = await gh(`${repoPath()}/git/trees`, { method: 'POST', body: { base_tree: remote.tree, tree: entries } });
  const commit = await gh(`${repoPath()}/git/commits`, { method: 'POST', body: { message: msg, tree: tree.sha, parents: [remote.head] } });
  try {
    await gh(`${repoPath()}/git/refs/heads/${encodeURI(branchName())}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
  } catch (e) {
    if (e.status === 422 || e.status === 409) return 'retry';   // someone pushed in between: merge again
    throw e;
  }
  return commit.sha;
}

async function runSync() {
  if (!cfg) return;
  if (!navigator.onLine) { publish({ status: 'error', message: 'Offline. Changes will sync when you are back online.' }); return; }
  publish({ status: 'syncing', message: 'Syncing…' });
  let summary = '';
  const seqAtStart = seq;
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await readRemote();
    if (remote.unchanged) { summary = 'Up to date'; break; }
    const local = await localSnapshot();
    const merged = mergeData(local.data, remote.data);
    const text = serialize(merged);
    const localText = serialize(local.data);

    // 1. bring remote changes in
    if (text !== localText) {
      const beans = await withPhotos(merged, remote);
      await applyMerged({ ...merged, beans });
    }
    // 2. push anything GitHub doesn't have
    const photoPaths = new Map(merged.beans.filter(b => b.photo).map(b => [`photos/${b.photo}.jpg`, null]));
    for (const [p, blob] of local.photos) if (photoPaths.has(p)) photoPaths.set(p, blob);
    const toPush = new Map([...photoPaths].filter(([, blob]) => blob));
    const needsPush = text !== remote.text || [...toPush.keys()].some(p => !remote.files.has(p));
    let head = remote.head;
    if (needsPush) {
      head = await pushOnce(remote, text, merged, toPush);
      if (head === 'retry') { continue; }
      summary = 'Backed up';
    } else summary = text !== localText ? 'Updated from GitHub' : 'Up to date';
    if (text !== localText && needsPush) summary = 'Merged and backed up';

    cfg.headSha = head;
    if (seq === seqAtStart) cfg.dirty = false;                // edits made while syncing stay marked
    break;
  }
  if (!summary) throw new GhError(0, 'GitHub kept changing while syncing. Try again.');
  cfg.lastSync = Date.now();
  await saveCfg();
  publish({ status: 'ok', message: summary, lastSync: cfg.lastSync });
}

/** Run a sync now. Safe to call often: overlapping calls collapse into one follow-up run. */
export function syncNow() {
  if (!cfg) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await runSync(); } while (again);
      toastedError = false;
    } catch (e) {
      publish({ status: 'error', message: e.message || 'Sync failed.' });
      if (!toastedError && e.status !== 0) { toastedError = true; subs.forEach(fn => fn(sync, 'toast')); }
      if (e.status === 0 && !navigator.onLine) toastedError = false;
    } finally { running = null; }
  })();
  return running;
}

function schedule(delay = AUTO_DELAY) {
  clearTimeout(timer);
  if (!cfg || cfg.auto === false) return;
  timer = setTimeout(() => syncNow(), delay);
}

/* =========================================================
   Setup / teardown
   ========================================================= */
export function parseRepo(input) {
  const m = String(input || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Check the repo and token, then save them. Throws GhError with a readable message. */
export async function connect({ repo, token, branch }) {
  const clean = parseRepo(repo);
  if (!clean) throw new GhError(0, 'Enter the repo as owner/name, for example shaiman/caffora-data.');
  if (!token || !token.trim()) throw new GhError(0, 'Paste a GitHub token.');
  const prev = cfg;
  cfg = { repo: clean, token: token.trim(), branch: (branch || '').trim(), auto: true, lastSync: 0, headSha: null, dirty: true };
  try {
    const info = await gh(repoPath());
    if (info.permissions && !info.permissions.push) throw new GhError(403, 'The token can read this repo but not write to it. It needs "Contents: Read and write".');
    cfg.defaultBranch = info.default_branch || 'main';
    if (cfg.branch === cfg.defaultBranch) cfg.branch = '';
    if (!info.private) cfg.public = true;
  } catch (e) { cfg = prev; throw e; }
  await saveCfg();
  publish({ status: 'idle', message: '', lastSync: 0, public: !!cfg.public });
  return syncNow();
}

export async function disconnect() {
  clearTimeout(timer);
  cfg = null;
  await db.kvSet('sync', null);
  publish({ status: 'off', message: '', lastSync: 0, public: false });
}

export async function setAuto(on) {
  if (!cfg) return;
  cfg.auto = !!on; await saveCfg();
  if (on) schedule(500);
}

export const isPublicRepo = () => !!cfg?.public;

/** Called once at boot: restore saved settings, pull right away, and watch for changes. */
export async function initSync() {
  try { cfg = (await db.kvGet('sync')) || null; } catch { cfg = null; }
  publish({ ready: true, status: cfg ? 'idle' : 'off', lastSync: cfg?.lastSync || 0, public: !!cfg?.public });
  onData(() => {
    if (!cfg) return;
    seq++; cfg.dirty = true; saveCfg();
    schedule();
  });
  addEventListener('online', () => schedule(800));
  document.addEventListener('visibilitychange', () => {
    if (!cfg) return;
    if (document.hidden) { if (cfg.dirty && cfg.auto !== false) syncNow(); }       // push before the app goes away
    else if (cfg.auto !== false && Date.now() - (cfg.lastSync || 0) > 60000) schedule(300);
  });
  if (cfg && cfg.auto !== false) schedule(1200);
}
