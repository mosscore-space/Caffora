// Passcode lock with a read-only "Quick peek" mode.
//
// This is a gate for casual snooping, not encryption of your coffee data: beans and brews stay readable on the device.
// What the passcode does protect properly is the GitHub token, which is stored encrypted with a key made from it.
//
// Modes: open (no passcode set, everything editable) | locked | peek (read-only) | edit (signed in)
import { db, closeDb } from './db.js';

export const auth = { mode: 'open', hasPasscode: false, autoLock: 5 };    // autoLock: minutes, 0 = every time you leave, null = never
const subs = new Set();
export const onAuth = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const set = (mode) => { auth.mode = mode; document.body.classList.toggle('peek', mode === 'peek'); subs.forEach(fn => fn(auth)); };

export const canEdit = () => auth.mode === 'open' || auth.mode === 'edit';
export const AUTO_LOCK_OPTIONS = [{ v: 0, label: 'Always' }, { v: 1, label: '1 min' }, { v: 5, label: '5 min' }, { v: 30, label: '30 min' }, { v: null, label: 'Never' }];

/* ---------- crypto ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
const ITER = 210000;
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** One PBKDF2 run gives 64 bytes: the first half is the stored check value, the second half becomes the AES key. */
async function derive(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 512));
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

/* ---------- state ---------- */
let rec = null;          // stored: { salt, check, autoLock }
let vault = null;        // AES key while signed in
export const vaultKey = () => vault;

export async function initAuth() {
  try { rec = await db.kvGet('auth'); } catch { rec = null; }
  auth.hasPasscode = !!rec;
  auth.autoLock = rec ? (rec.autoLock === undefined ? 5 : rec.autoLock) : 5;
  set(rec ? 'locked' : 'open');
}

const save = () => db.kvSet('auth', rec);

async function verify(pass) {
  if (!rec) return null;
  const d = await derive(pass, unb64(rec.salt));
  return d.check === rec.check ? d : null;
}

/** Try a passcode. Returns true and switches to edit mode when it is right. */
export async function unlock(pass) {
  const d = await verify(pass);
  if (!d) return false;
  vault = d.key; set('edit');
  return true;
}

export function peek() { vault = null; set('peek'); }
export function lock() { if (!auth.hasPasscode) return; vault = null; set('locked'); }

/** Set or change the passcode (when changing, `current` must be right). Signs you in. */
export async function setPasscode(pass, current) {
  if (rec && !(await verify(current || ''))) throw new Error('That is not your current passcode.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const d = await derive(pass, salt);
  rec = { salt: b64(salt), check: d.check, autoLock: auth.autoLock };
  await save();
  vault = d.key; auth.hasPasscode = true;
  set('edit');
}

export async function removePasscode(current) {
  if (!(await verify(current))) throw new Error('That is not your passcode.');
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
  try { localStorage.removeItem('caffora-theme'); } catch { /* ignore */ }
  await closeDb();
  await new Promise((res) => { const r = indexedDB.deleteDatabase('caffora'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

/* ---------- auto-lock when you leave the app ---------- */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (auth.mode !== 'edit' || auth.autoLock == null || !hiddenAt) return;
  if (Date.now() - hiddenAt >= auth.autoLock * 60000) lock();
});
