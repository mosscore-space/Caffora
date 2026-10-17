// Passcode lock, read-only "Quick peek", and sign-in from any browser.
//
// How "any browser" works: after you connect a data repo and set a passcode, Caffora can export `caffora.config.json`.
// You upload that one file to your site. A browser that has never seen your data loads it, shows the lock screen, and the
// passcode decrypts the GitHub token inside it, which then pulls your data. The file holds only the repo name and an
// AES-GCM encrypted token. Without the passcode it is useless, so the passcode must be strong (see validate.passcodeProblem).
//
// This is a gate against casual access, not encryption of your coffee data on the device.
//
// Modes: open (no passcode set, everything editable) | locked | peek (read-only) | edit (signed in)
import { db, closeDb } from './db.js';
import { passcodeProblem } from './validate.js';

export const auth = { mode: 'open', hasPasscode: false, autoLock: 5, remote: false, fresh: false };   // autoLock: minutes, 0 = every time you leave, null = never
const subs = new Set();
export const onAuth = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const set = (mode) => { auth.mode = mode; document.body.classList.toggle('peek', mode === 'peek'); subs.forEach(fn => fn(auth)); };

export const canEdit = () => auth.mode === 'open' || auth.mode === 'edit';
export const AUTO_LOCK_OPTIONS = [{ v: 0, label: 'Always' }, { v: 1, label: '1 min' }, { v: 5, label: '5 min' }, { v: 30, label: '30 min' }, { v: null, label: 'Never' }];
export { passcodeProblem };

/* ---------- crypto ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const ITER = 600000;                       // PBKDF2-HMAC-SHA256 rounds for new passcodes; older ones keep the count they were made with
const CONFIG_FILE = 'caffora.config.json';
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** One PBKDF2 run gives 64 bytes: the first half is the stored check value, the second half becomes the AES key. */
async function derive(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 512));
  const key = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { check: b64(bits.slice(0, 32)), key };
}
export async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function unseal(key, box) {
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}
const newRev = () => b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[+/=]/g, 'x');
/** A new revision id marks "the sign-in details changed", so Settings can tell when the file on your site is out of date. */
export async function bumpRev() { await db.kvSet('cfgRev', newRev()); }

/* ---------- guess limiting (persists across reloads; it slows a person at the screen, not an offline attacker) ---------- */
const FAILS_KEY = 'caffora-auth-fails';
const readFails = () => { try { return JSON.parse(localStorage.getItem(FAILS_KEY)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } };
const writeFails = (f) => { try { localStorage.setItem(FAILS_KEY, JSON.stringify(f)); } catch { /* ignore */ } };
/** Milliseconds you still have to wait before another try. */
export const lockoutLeft = () => Math.max(0, readFails().until - Date.now());
function recordFail() {
  const f = readFails(); f.n++;
  if (f.n % 5 === 0) f.until = Date.now() + Math.min(3600, 30 * 2 ** (f.n / 5 - 1)) * 1000;
  writeFails(f);
}
const clearFails = () => writeFails({ n: 0, until: 0 });

/* ---------- state ---------- */
let rec = null;          // stored: { salt, check, iter, autoLock }
let vault = null;        // AES key while signed in
let remote = null;       // the config file found on the site, when this browser has no passcode of its own yet
export const vaultKey = () => vault;

/** The sign-in file from this site, or null. Strictly validated, because it is fetched, not trusted. */
async function fetchSiteConfig() {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(CONFIG_FILE, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > 4000) return null;
    const c = JSON.parse(text);
    const ok = c && c.app === 'caffora-config' && c.v === 1 && typeof c.rev === 'string' && c.rev.length <= 40
      && typeof c.salt === 'string' && typeof c.check === 'string' && Number.isInteger(c.iter) && c.iter >= 100000 && c.iter <= 5000000
      && /^[\w.-]{1,39}\/[\w.-]{1,100}$/.test(c.repo) && (c.branch === '' || /^[\w./-]{1,100}$/.test(c.branch) && !c.branch.includes('..'))
      && c.tokenEnc && typeof c.tokenEnc.iv === 'string' && typeof c.tokenEnc.ct === 'string';
    return ok ? c : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function initAuth() {
  try { rec = await db.kvGet('auth'); } catch { rec = null; }
  auth.hasPasscode = !!rec;
  auth.autoLock = rec ? (rec.autoLock === undefined ? 5 : rec.autoLock) : 5;
  if (!rec) { remote = await fetchSiteConfig(); auth.remote = !!remote; }
  set(rec || remote ? 'locked' : 'open');
}

const save = () => db.kvSet('auth', rec);
const verifyWith = async (pass, salt, iter, check) => { const d = await derive(pass, unb64(salt), iter); return same(d.check, check) ? d : null; };

/** Sign in from a config file this browser has not seen: check the passcode, then keep the details locally. */
async function installFromConfig(cfg, pass) {
  const d = await verifyWith(pass, cfg.salt, cfg.iter, cfg.check);
  if (!d) return false;
  try { await unseal(d.key, cfg.tokenEnc); } catch { return false; }
  const old = (await db.kvGet('sync')) || {};
  rec = { salt: cfg.salt, check: cfg.check, iter: cfg.iter, autoLock: auth.autoLock };
  await save();
  await db.kvSet('sync', { auto: true, lastSync: 0, headSha: null, dirty: true, ...old, repo: cfg.repo, branch: cfg.branch, tokenEnc: cfg.tokenEnc });
  await db.kvSet('cfgRev', cfg.rev);
  auth.hasPasscode = true;
  vault = d.key; remote = null; auth.remote = false;
  auth.fresh = !old.repo;                      // nothing here yet: the app should load your data before showing anything
  return true;
}

/** Try a passcode. Returns true and switches to edit mode when it is right. */
export async function unlock(pass) {
  if (lockoutLeft() > 0) return false;
  let ok = false;
  if (rec) {
    const d = await verifyWith(pass, rec.salt, rec.iter || 210000, rec.check);
    if (d) { vault = d.key; ok = true; }
    else {
      // changed on another browser? the file on the site is newer
      const cfg = await fetchSiteConfig();
      if (cfg && cfg.check !== rec.check) ok = await installFromConfig(cfg, pass);
    }
  } else if (remote) ok = await installFromConfig(remote, pass);
  if (!ok) { recordFail(); return false; }
  clearFails(); set('edit');
  return true;
}

export function peek() { vault = null; set('peek'); }
export function lock() { if (!auth.hasPasscode) return; vault = null; set('locked'); }

/** Set or change the passcode (when changing, `current` must be right). Signs you in. */
export async function setPasscode(pass, current) {
  const problem = passcodeProblem(pass);
  if (problem) throw new Error(problem);
  if (rec && !(await verifyWith(current || '', rec.salt, rec.iter || 210000, rec.check))) throw new Error('That is not your current passcode.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const d = await derive(pass, salt, ITER);
  rec = { salt: b64(salt), check: d.check, iter: ITER, autoLock: auth.autoLock };
  await save(); await bumpRev();
  vault = d.key; auth.hasPasscode = true;
  set('edit');
}

export async function removePasscode(current) {
  if (!rec || !(await verifyWith(current, rec.salt, rec.iter || 210000, rec.check))) throw new Error('That is not your passcode.');
  rec = null; vault = null; auth.hasPasscode = false;
  await db.kvSet('auth', null);
  set('open');
}

export async function setAutoLock(minutes) {
  auth.autoLock = minutes;
  if (rec) { rec.autoLock = minutes; await save(); }
}

/** For "forgot passcode": wipe everything stored on this device. Data that was synced to GitHub can be restored from there. */
export async function eraseDevice() {
  try { localStorage.removeItem('caffora-theme'); localStorage.removeItem(FAILS_KEY); } catch { /* ignore */ }
  await closeDb();
  await new Promise((res) => { const r = indexedDB.deleteDatabase('caffora'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

/* ---------- the sign-in file for your site ---------- */
/** Text of caffora.config.json for this device's current passcode and repo, or null when there is nothing to export yet. */
export async function buildConfigFile() {
  const s = await db.kvGet('sync');
  if (!rec || !s?.repo || !s.tokenEnc) return null;
  const rev = (await db.kvGet('cfgRev')) || newRev();
  await db.kvSet('cfgRev', rev);
  return JSON.stringify({ app: 'caffora-config', v: 1, rev, iter: rec.iter || 210000, salt: rec.salt, check: rec.check, repo: s.repo, branch: s.branch || '', tokenEnc: s.tokenEnc }, null, 1) + '\n';
}
/** Is the file on the site current? 'missing' | 'current' | 'stale' | 'unavailable' (nothing to export). */
export async function siteConfigState() {
  const mine = await buildConfigFile();
  if (!mine) return 'unavailable';
  const site = await fetchSiteConfig();
  if (!site) return 'missing';
  const m = JSON.parse(mine);
  return site.rev === m.rev && site.check === m.check && site.repo === m.repo && site.branch === m.branch ? 'current' : 'stale';
}
export const CONFIG_FILENAME = CONFIG_FILE;

/* ---------- auto-lock when you leave the app ---------- */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (auth.mode !== 'edit' || auth.autoLock == null || !hiddenAt) return;
  if (Date.now() - hiddenAt >= auth.autoLock * 60000) lock();
});
