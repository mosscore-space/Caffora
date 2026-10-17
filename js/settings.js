// Settings tab: themes only (for now).
import { h, icon, clear } from './util.js';
import { pageHead } from './parts.js';
import { db } from './db.js';
import { field, confirmDialog, toast, openSheet, segmented } from './ui.js';
import { auth, canEdit, lock, setPasscode, removePasscode, setAutoLock, AUTO_LOCK_OPTIONS } from './auth.js';
import { sync, onSyncState, syncConfig, connect, disconnect, syncNow, setAuto, isPublicRepo } from './sync.js';

export const THEMES = [
  { id: 'auto', name: 'Match device', note: 'Latte in light mode, Mocha in dark mode', sw: ['#eff1f5', '#1e1e2e', '#fe640b'] },
  { id: 'latte', name: 'Latte', note: 'Light', sw: ['#eff1f5', '#ccd0da', '#fe640b', '#4c4f69'] },
  { id: 'frappe', name: 'Frappé', note: 'Soft dark', sw: ['#303446', '#414559', '#ef9f76', '#c6d0f5'] },
  { id: 'macchiato', name: 'Macchiato', note: 'Medium dark', sw: ['#24273a', '#363a4f', '#f5a97f', '#cad3f5'] },
  { id: 'mocha', name: 'Mocha', note: 'Darkest', sw: ['#1e1e2e', '#313244', '#fab387', '#cdd6f4'] },
];
const META = { latte: '#eff1f5', frappe: '#303446', macchiato: '#24273a', mocha: '#1e1e2e' };

export function getTheme() { try { return localStorage.getItem('caffora-theme') || 'mocha'; } catch { return 'mocha'; } }
export function applyTheme(id) {
  const resolved = id === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'latte' : 'mocha') : id;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[resolved]);
}
export async function setTheme(id) {
  try { localStorage.setItem('caffora-theme', id); } catch { /* private mode */ }
  applyTheme(id);
  try { await db.kvSet('theme', id); } catch { /* ignore */ }
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (getTheme() === 'auto') applyTheme('auto'); });

function ago(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function syncSection() {
  const box = h('section.settings-sec.sync');
  let unsub = () => {};
  const paint = () => {
    if (box.dataset.painted && !box.isConnected) { unsub(); return; }      // the page was re-rendered: stop listening
    box.dataset.painted = '1';
    const conf = syncConfig();
    box.replaceChildren(h('h2', 'Backup & sync'), conf ? connected(conf) : disconnected());
  };

  function disconnected() {
    const repo = h('input', { type: 'text', placeholder: 'your-name/caffora-data', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Data repository' });
    const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'GitHub token' });
    const branch = h('input', { type: 'text', placeholder: 'default branch', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Branch' });
    const err = h('p.sync-err', { role: 'alert', hidden: true });
    const go = h('button.btn.primary', { type: 'button' }, 'Connect and sync');
    go.onclick = async () => {
      err.hidden = true; go.disabled = true; go.textContent = 'Connecting…';
      try { await connect({ repo: repo.value, token: token.value, branch: branch.value }); toast('Connected. Your data is backed up.'); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
      finally { go.disabled = false; go.textContent = 'Connect and sync'; }
    };
    return h('div.sync-body',
      h('p.muted', 'Save your beans, brews, grinders and bag photos to a GitHub repo of your own, and load them on any device. It merges, so nothing is overwritten.'),
      h('div.sync-form',
        field('Data repository', repo, 'A separate, private repo (not the one hosting the app).'),
        field('Access token', token, 'A fine-grained token for that one repo, with Contents: Read and write.'),
        field('Branch (optional)', branch)),
      err, go,
      h('details.sync-help',
        h('summary', 'How to set this up'),
        h('ol',
          h('li', 'On GitHub, create a new ', h('b', 'private'), ' repository, for example caffora-data. Tick “Add a README” so it is not empty.'),
          h('li', 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'Settings > Developer settings > Fine-grained tokens'), ' and generate a new token. Under Repository access choose “Only select repositories” and pick your data repo.'),
          h('li', 'Under Repository permissions set ', h('b', 'Contents'), ' to “Read and write”. Nothing else is needed.'),
          h('li', 'Copy the token, paste it above, and connect. On your other devices, do the same with the same repo and token.')),
        h('p.muted.small', 'The token is kept in this browser only. Anyone with this device unlocked could use it, which is why it should be limited to the one repo.')));
  }

  function connected(conf) {
    const dot = { syncing: 'busy', ok: 'ok', error: 'bad', idle: 'ok' }[sync.status] || 'ok';
    const line = sync.status === 'syncing' ? 'Syncing…'
      : sync.status === 'error' ? sync.message
      : `${sync.message || 'Connected'} · last sync ${ago(sync.lastSync)}`;
    const auto = h('input', { type: 'checkbox', checked: conf.auto, onchange: (e) => setAuto(e.target.checked) });
    return h('div.sync-body',
      h('div.sync-status',
        h('span.sync-dot.' + dot),
        h('div', h('div.sync-repo', conf.repo, h('span.muted.small', ' · ' + conf.branch)), h('div.sync-line' + (sync.status === 'error' ? '.bad' : ''), line))),
      isPublicRepo() ? h('p.sync-warn', 'This repository is public, so anyone can read your data. Make it private in the repo’s settings on GitHub.') : null,
      h('label.sync-toggle', auto, h('span', h('b', 'Sync automatically'), h('br'), h('span.muted.small', 'A few seconds after each change, and when you open the app.'))),
      h('div.sync-actions',
        h('button.btn.primary', { type: 'button', disabled: sync.status === 'syncing', onclick: () => syncNow() }, 'Sync now'),
        h('button.btn.danger-ghost', { type: 'button', onclick: async () => {
          if (await confirmDialog({ title: 'Disconnect GitHub?', text: 'This device forgets the token. The data stays here and in your repo; nothing is deleted.', confirmLabel: 'Disconnect', danger: true })) { await disconnect(); }
        } }, 'Disconnect')));
  }

  unsub = onSyncState((_s, ev) => { if (ev !== 'toast') paint(); });
  paint();
  return box;
}

/** A small sheet that asks for one or more passwords. onSubmit may throw an Error to show its message. */
function passSheet({ title, intro, fields, confirmLabel, danger, onSubmit }) {
  const inputs = fields.map(f => h('input', { type: 'password', autocomplete: 'off', placeholder: f.placeholder || '', 'aria-label': f.label }));
  const err = h('p.sync-err', { role: 'alert', hidden: true });
  const submit = async () => {
    err.hidden = true; ok.disabled = true;
    try { await onSubmit(inputs.map(i => i.value)); sheet.close(); }
    catch (e) { err.textContent = e.message; err.hidden = false; ok.disabled = false; }
  };
  const ok = h('button.btn.primary' + (danger ? '.danger' : ''), { type: 'button', onclick: submit }, confirmLabel);
  const sheet = openSheet({
    title, size: 'sm', className: 'confirm',
    body: h('form.sync-form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
      intro ? h('p.muted', intro) : null, ...fields.map((f, i) => field(f.label, inputs[i], f.hint)), err, h('button', { type: 'submit', hidden: true })),
    footer: [h('button.btn', { type: 'button', onclick: () => sheet.close() }, 'Cancel'), ok],
  });
  setTimeout(() => inputs[0]?.focus(), 250);
}

function securitySection(root) {
  const again = () => renderSettings(root);
  if (!auth.hasPasscode) {
    const p1 = h('input', { type: 'password', autocomplete: 'off', placeholder: 'New passcode', 'aria-label': 'New passcode' });
    const p2 = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Repeat passcode', 'aria-label': 'Repeat passcode' });
    const err = h('p.sync-err', { role: 'alert', hidden: true });
    const go = h('button.btn.primary', { type: 'button' }, 'Set passcode');
    go.onclick = async () => {
      err.hidden = true;
      if (p1.value.length < 4) { err.textContent = 'Use at least 4 characters.'; err.hidden = false; return; }
      if (p1.value !== p2.value) { err.textContent = 'The two passcodes do not match.'; err.hidden = false; return; }
      go.disabled = true;
      try { await setPasscode(p1.value); toast('Passcode set. Caffora will ask for it next time.'); } catch (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; }
    };
    return h('section.settings-sec',
      h('h2', 'Passcode'),
      h('div.sync-body',
        h('p.muted', 'Lock Caffora so that only you can edit. Anyone else can take a quick peek, which is view only. A longer passcode is safer, and it also keeps your GitHub token encrypted.'),
        h('div.sync-form', p1, p2), err, go));
  }
  return h('section.settings-sec',
    h('h2', 'Passcode'),
    h('div.sync-body',
      h('div.field', h('div.field-label', 'Lock when I leave the app'),
        segmented({ options: AUTO_LOCK_OPTIONS.map(o => ({ v: o.v === null ? 'never' : o.v, label: o.label })), value: auth.autoLock === null ? 'never' : auth.autoLock, onChange: (v) => setAutoLock(v === 'never' ? null : Number(v)) }).el,
        h('div.field-hint', 'How long Caffora can be out of sight before it asks for the passcode again.')),
      h('div.sync-actions',
        h('button.btn.primary', { type: 'button', onclick: () => lock() }, icon('lock', 16), 'Lock now'),
        h('button.btn', { type: 'button', onclick: () => passSheet({
          title: 'Change passcode', confirmLabel: 'Change',
          fields: [{ label: 'Current passcode' }, { label: 'New passcode' }, { label: 'Repeat new passcode' }],
          onSubmit: async ([cur, a, b]) => {
            if (a.length < 4) throw new Error('Use at least 4 characters.');
            if (a !== b) throw new Error('The two new passcodes do not match.');
            await setPasscode(a, cur); toast('Passcode changed');
          } }) }, 'Change'),
        h('button.btn.danger-ghost', { type: 'button', onclick: () => passSheet({
          title: 'Remove passcode', intro: 'Caffora will open without asking, and anyone can edit.', confirmLabel: 'Remove', danger: true,
          fields: [{ label: 'Current passcode' }],
          onSubmit: async ([cur]) => { await removePasscode(cur); toast('Passcode removed'); } }) }, 'Remove'))));
}

export function renderSettings(root) {
  clear(root);
  const cur = getTheme();
  root.append(
    pageHead('Settings', 'Make Caffora yours'),
    ...(canEdit() ? [syncSection(), securitySection(root)] : [h('p.muted.peek-note', 'You are viewing only. Sign in to change settings, beans, brews and grinders.')]),
    h('section.settings-sec',
      h('h2', 'Theme'),
      h('div.themes', { role: 'radiogroup', 'aria-label': 'Theme' }, THEMES.map(t =>
        h('button.theme' + (t.id === cur ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(t.id === cur), onclick: async () => { await setTheme(t.id); renderSettings(root); } },
          h('span.swatch', t.sw.map(c => h('i', { style: { background: c } }))),
          h('span.theme-name', t.name), h('span.theme-note', t.note),
          t.id === cur ? icon('check', 18, 'theme-check') : null)))),
    h('p.muted.small.about', 'Caffora keeps everything on this device and works offline once installed.'),
  );
}
