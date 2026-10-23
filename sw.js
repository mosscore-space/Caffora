/* Caffora service worker: precache the app shell, then serve cache-first and refresh in the background. */
const VERSION = 'caffora-v6';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/parts.js', 'js/geo.js', 'js/nav.js',
  'js/beans.js', 'js/brews.js', 'js/grinders.js', 'js/stats.js', 'js/map.js', 'js/settings.js', 'js/sync.js', 'js/auth.js', 'js/lock.js', 'js/validate.js', 'js/boot.js',
  'vendor/d3.min.js', 'vendor/topojson-client.min.js',
  'fonts/fraunces-latin-wght-normal.woff2', 'fonts/figtree-latin-wght-normal.woff2',
  'data/lists.json', 'data/region-aliases.json', 'data/world.topo.json',
  'icons/icon.svg', 'icons/icon-monochrome-512.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  '__METHOD_ICONS__',
];

const METHOD_ICONS = ["icons/methods/french-press.webp", "icons/methods/aeropress.webp", "icons/methods/aeropress-inverted.webp", "icons/methods/delter.webp", "icons/methods/v60.webp", "icons/methods/clever-dripper.webp", "icons/methods/lilydrip.webp", "icons/methods/immersion-switch.webp", "icons/methods/origami.webp", "icons/methods/koar.webp", "icons/methods/kalita.webp", "icons/methods/kalita-wave.webp", "icons/methods/melitta.webp", "icons/methods/kono.webp", "icons/methods/daiso.webp", "icons/methods/torch-mountain.webp", "icons/methods/april.webp", "icons/methods/tricolate.webp", "icons/methods/vacone.webp", "icons/methods/fellow-stagg.webp", "icons/methods/phoenix.webp", "icons/methods/miir-pourigami.webp", "icons/methods/gina.webp", "icons/methods/chemex.webp", "icons/methods/woodneck.webp", "icons/methods/funnex.webp", "icons/methods/moka.webp", "icons/methods/espresso.webp", "icons/methods/handpresso.webp", "icons/methods/rok.webp", "icons/methods/flair.webp", "icons/methods/cafelat-robot.webp", "icons/methods/leverpresso.webp", "icons/methods/picopresso.webp", "icons/methods/nanopresso.webp", "icons/methods/minipresso.webp", "icons/methods/pipamoka.webp", "icons/methods/cuppamoka.webp", "icons/methods/staresso-mini.webp", "icons/methods/staresso.webp", "icons/methods/staresso-pro.webp", "icons/methods/trinity-zero.webp", "icons/methods/trinity-one.webp", "icons/methods/cold-brew.webp", "icons/methods/cold-aero.webp", "icons/methods/cold-drip.webp", "icons/methods/batch-brew.webp", "icons/methods/vacuum-pot.webp", "icons/methods/eva-solo.webp", "icons/methods/cafflano-klassic.webp", "icons/methods/cafflano-kompact.webp", "icons/methods/cafflano-kompresso.webp", "icons/methods/neapolitan-flip.webp", "icons/methods/karlsbader.webp", "icons/methods/cezve.webp", "icons/methods/orea.webp", "icons/methods/drip-bag.webp", "icons/methods/melodrip-colum.webp", "icons/methods/phin.webp", "icons/methods/pour-over.webp"];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const urls = SHELL.flatMap(u => (u === '__METHOD_ICONS__' ? METHOD_ICONS : [u]));
    await Promise.all(urls.map(async (u) => { try { await cache.add(new Request(u, { cache: 'reload' })); } catch (e) { /* skip missing */ } }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/caffora.config.json')) return;      // the sign-in file must always come fresh from the network
  if (url.pathname.endsWith('/manifest.webmanifest')) {            // the manifest decides the installed icon, so never serve a stale one while online
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try { const res = await fetch(req, { cache: 'no-store' }); if (res && res.ok) { cache.put(req, res.clone()); return res; } } catch { /* offline */ }
      return (await cache.match(req, { ignoreSearch: true })) || new Response('', { status: 503 });
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(refresh); return hit; }
    const res = await refresh;
    if (res) return res;
    if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
