// Caffora — app shell: tabs, routing, boot.
import { h, icon, $ } from './util.js';
import { load, onChange, S } from './store.js';
import { persistStorage } from './db.js';
import { initSync, stopSync, reseal, onSyncState } from './sync.js';
import { auth, initAuth, onAuth, lock } from './auth.js';
import { showLock, hideLock } from './lock.js';
import { nav } from './nav.js';
import { whenHistoryIdle, toast, closeAllSheets } from './ui.js';
import { renderBrews } from './brews.js';
import { renderBeans } from './beans.js';
import { renderGrinders } from './grinders.js';
import { renderStats } from './stats.js';
import { renderMap } from './map.js';
import { renderSettings, getTheme, applyTheme } from './settings.js';

const TABS = [
  { id: 'brews', label: 'Brews', icon: 'brews', render: renderBrews },
  { id: 'beans', label: 'Beans', icon: 'beans', render: renderBeans },
  { id: 'grinders', label: 'Grinders', icon: 'grinders', render: renderGrinders },
  { id: 'stats', label: 'Stats', icon: 'stats', render: renderStats },
  { id: 'map', label: 'Map', icon: 'map', render: renderMap },
  { id: 'settings', label: 'Settings', icon: 'settings', render: renderSettings },
];
let current = '';
const view = () => $('#view');

function buildNav() {
  const navEl = $('#nav');
  navEl.replaceChildren(
    h('div.brand', h('img', { src: 'icons/icon-192.png', alt: '' }), 'Caffora'),
    ...TABS.map(t => h('button', { type: 'button', dataset: { tab: t.id }, onclick: () => nav.go(t.id) }, h('span.pill', icon(t.icon, 22)), h('span', t.label))));
}
function route() {
  if (auth.mode === 'locked') return;
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const tab = TABS.find(t => t.id === id) || TABS[0];
  if (tab.id !== current) window.scrollTo(0, 0);
  current = tab.id;
  document.querySelectorAll('#nav button').forEach(b => { if (b.dataset.tab === tab.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  view().classList.toggle('full', tab.id === 'map');
  tab.render(view());
}
function rerender() {
  if (auth.mode === 'locked') return;
  const y = window.scrollY;
  const tab = TABS.find(t => t.id === current);
  if (tab) { tab.render(view()); window.scrollTo(0, y); }
}
nav.go = (id) => whenHistoryIdle(() => { if (location.hash === '#/' + id) route(); else location.hash = '#/' + id; });
nav.current = () => current;

/* ---------- sign-in state: locked, peek (read-only) or editable ---------- */
const peekPill = h('button.peek-pill', { type: 'button', onclick: () => lock() }, icon('eye', 16), h('span', 'Viewing only'), h('b', 'Sign in to edit'));
let wasEditable = null;
async function applyMode() {
  const m = auth.mode, editable = m === 'open' || m === 'edit';
  if (m === 'locked') {
    closeAllSheets();
    document.body.classList.add('locked');
    peekPill.remove();
    current = ''; view().replaceChildren();
    wasEditable = false;
    await stopSync();
    showLock();
    return;
  }
  hideLock();
  document.body.classList.remove('locked');
  if (m === 'peek') document.body.append(peekPill); else peekPill.remove();
  const stayedEditable = wasEditable && editable;      // passcode set, changed or removed while signed in
  wasEditable = editable;
  if (stayedEditable) await reseal();                  // re-save the GitHub token under the new protection
  if (stayedEditable) rerender(); else route();
  if (editable && !stayedEditable) initSync();
}

async function boot() {
  applyTheme(getTheme());
  buildNav();
  try { await load(); } catch (e) { console.error(e); view().replaceChildren(h('div.map-loading', 'Caffora could not open its storage. Reload the page, and make sure private browsing is off.')); return; }
  window.addEventListener('hashchange', route);
  onChange(() => rerender());
  onAuth(() => applyMode());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rerender(); });
  onSyncState((s, ev) => { if (ev === 'toast') toast('GitHub sync: ' + s.message); });
  await initAuth();                                    // shows the lock screen when a passcode is set
  persistStorage();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
  }
}
boot();
