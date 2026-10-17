// Runs before anything is painted. A classic script (not inline) so the page can forbid inline scripts.
(function () {
  'use strict';
  // 1. Only ever run over HTTPS (localhost is fine for development).
  try {
    var host = location.hostname;
    if (location.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      location.replace('https://' + location.host + location.pathname + location.search + location.hash);
      return;
    }
  } catch (e) { /* ignore */ }
  // 2. Refuse to run inside someone else's page (clickjacking). A meta CSP cannot do this, so do it here.
  if (window.top !== window.self) {
    try { window.stop(); } catch (e) { /* ignore */ }
    document.documentElement.replaceChildren();
    throw new Error('Caffora does not run inside a frame.');
  }
  // 3. Apply the saved theme before first paint (phones default to Espresso, larger screens to Mocha).
  try {
    var ids = ['espresso', 'matcha', 'auto', 'latte', 'frappe', 'macchiato', 'mocha'];
    var t = null;
    try { t = localStorage.getItem('caffora-theme'); } catch (e) { /* private mode */ }
    if (ids.indexOf(t) < 0) t = matchMedia('(max-width: 899.98px)').matches ? 'espresso' : 'mocha';
    if (t === 'auto') t = matchMedia('(prefers-color-scheme: light)').matches ? 'latte' : 'mocha';
    document.documentElement.setAttribute('data-theme', t);
    var m = { latte: '#eff1f5', frappe: '#303446', macchiato: '#24273a', mocha: '#1e1e2e', espresso: '#1a110d', matcha: '#eef2e4' }[t];
    var meta = document.querySelector('meta[name="theme-color"]');
    if (m && meta) meta.setAttribute('content', m);
  } catch (e) { /* ignore */ }
})();
