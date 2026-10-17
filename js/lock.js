// The lock screen: passcode sign-in, or a read-only quick peek.
import { h, icon, IS_PHONE } from './util.js';
import { auth, unlock, peek, eraseDevice, lockoutLeft } from './auth.js';
import { confirmDialog } from './ui.js';

let el = null, ticker = 0;

export function showLock() {
  hideLock();
  const newBrowser = !auth.hasPasscode && auth.remote;           // this browser has no data yet; the site's config file will load it
  const input = h('input', { type: 'password', placeholder: 'Passcode', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterkeyhint: 'go', 'aria-label': 'Passcode' });
  const msg = h('p.lock-msg', { role: 'alert' });
  const go = h('button.btn.primary.lock-go', { type: 'submit' }, newBrowser ? 'Sign in and load my coffee' : 'Sign in to edit');

  const tick = () => {
    const left = Math.ceil(lockoutLeft() / 1000);
    if (left > 0) { msg.textContent = `Too many tries. Wait ${left < 90 ? left + 's' : Math.ceil(left / 60) + ' min'}.`; go.disabled = true; return; }
    clearInterval(ticker); go.disabled = false; if (msg.dataset.wait) { msg.textContent = ''; delete msg.dataset.wait; }
  };
  const startTicker = () => { msg.dataset.wait = '1'; tick(); clearInterval(ticker); ticker = setInterval(tick, 500); };

  const form = h('form.lock-form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (lockoutLeft() > 0 || !input.value) return;
      go.disabled = true; msg.textContent = '';
      const ok = await unlock(input.value);
      input.value = '';
      if (ok) return;                                   // the app takes it from here
      el?.classList.remove('shake'); void el?.offsetWidth; el?.classList.add('shake');
      if (lockoutLeft() > 0) startTicker(); else { msg.textContent = 'That passcode is not right.'; go.disabled = false; input.focus(); }
    },
  }, input, msg, go);

  el = h('div#lock.lock', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Caffora is locked' },
    h('div.lock-card',
      h('img.lock-logo', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 }),
      h('h1', 'Caffora'),
      h('p.lock-sub', newBrowser ? 'Welcome back. Enter your passcode to load your coffee data on this browser.' : 'Sign in to make changes, or take a quick look around.'),
      form,
      h('div.lock-or', h('span', 'or')),
      h('button.btn.lock-peek', { type: 'button', onclick: () => peek() }, icon('eye', 18), 'Quick peek'),
      h('p.lock-note', 'View only. Nothing can be added, changed or deleted.'),
      h('button.lock-forgot', { type: 'button', onclick: forgot }, 'Forgot passcode?'),
      h('p.lock-origin', 'Only enter your passcode at ', h('b', location.host || 'this page'), '.')));
  document.body.append(el);
  if (lockoutLeft() > 0) startTicker();
  if (!IS_PHONE) setTimeout(() => input.focus(), 50);
}

export function hideLock() { clearInterval(ticker); el?.remove(); el = null; }

async function forgot() {
  if (!auth.hasPasscode && auth.remote) {
    await confirmDialog({
      title: 'Forgot your passcode?', confirmLabel: 'OK', cancelLabel: 'Close',
      text: 'There is no way to recover it. To start over, delete caffora.config.json from your site repository on GitHub, then open the site again. Your data repo is untouched, and you can connect it again with a new token.',
    });
    return;
  }
  const ok = await confirmDialog({
    title: 'Erase this device?',
    text: 'A forgotten passcode cannot be recovered. You can start over by erasing everything Caffora stored on this device. If you synced with GitHub, connect again afterwards and your data comes back. Anything that was not synced is lost. If your site has a caffora.config.json, delete it from the site repository too, or this screen will come back.',
    confirmLabel: 'Erase and start over', danger: true,
  });
  if (!ok) return;
  await eraseDevice();
  location.reload();
}
