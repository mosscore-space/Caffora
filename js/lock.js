// The lock screen: passcode sign-in, or a read-only quick peek.
import { h, icon, IS_PHONE } from './util.js';
import { unlock, peek, eraseDevice } from './auth.js';
import { confirmDialog } from './ui.js';

let el = null;

export function showLock() {
  hideLock();
  let fails = 0, waitUntil = 0, ticker = 0;
  const input = h('input', { type: 'password', placeholder: 'Passcode', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'go', 'aria-label': 'Passcode' });
  const msg = h('p.lock-msg', { role: 'alert' });
  const go = h('button.btn.primary.lock-go', { type: 'submit' }, 'Sign in to edit');

  const tick = () => {
    const left = Math.ceil((waitUntil - Date.now()) / 1000);
    if (left > 0) { msg.textContent = `Too many tries. Wait ${left}s.`; go.disabled = true; return; }
    clearInterval(ticker); go.disabled = false; msg.textContent = '';
  };
  const form = h('form.lock-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (Date.now() < waitUntil || !input.value) return;
      go.disabled = true;
      const ok = await unlock(input.value);
      if (ok) return;                                   // the app takes it from here
      fails++; input.value = ''; input.focus();
      el?.classList.remove('shake'); void el?.offsetWidth; el?.classList.add('shake');
      if (fails % 5 === 0) { waitUntil = Date.now() + Math.min(300, 15 * 2 ** (fails / 5)) * 1000; tick(); clearInterval(ticker); ticker = setInterval(tick, 500); }
      else { msg.textContent = 'That passcode is not right.'; go.disabled = false; }
    },
  }, input, msg, go);

  el = h('div#lock.lock', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Caffora is locked' },
    h('div.lock-card',
      h('img.lock-logo', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 }),
      h('h1', 'Caffora'),
      h('p.lock-sub', 'Sign in to make changes, or take a quick look around.'),
      form,
      h('div.lock-or', h('span', 'or')),
      h('button.btn.lock-peek', { type: 'button', onclick: () => peek() }, icon('eye', 18), 'Quick peek'),
      h('p.lock-note', 'View only. Nothing can be added, changed or deleted.'),
      h('button.lock-forgot', { type: 'button', onclick: forgot }, 'Forgot passcode?')));
  document.body.append(el);
  if (!IS_PHONE) setTimeout(() => input.focus(), 50);
}

export function hideLock() { el?.remove(); el = null; }

async function forgot() {
  const ok = await confirmDialog({
    title: 'Erase this device?',
    text: 'A forgotten passcode cannot be recovered. You can start over by erasing everything Caffora stored on this device. If you synced with GitHub, connect again afterwards and your data comes back. Anything that was not synced is lost.',
    confirmLabel: 'Erase and start over', danger: true,
  });
  if (!ok) return;
  await eraseDevice();
  location.reload();
}
