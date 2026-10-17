// Map tab: world map of origin countries, zoom to a country to see its regions and the bags bought there.
import { h, s, icon, clear, blobURL, clamp, debounce, norm, fmtG, uid } from './util.js';
import { S } from './store.js';
import { loadWorld, matchRegion } from './geo.js';
import { beanThumb, roastLabel } from './parts.js';
import { nav } from './nav.js';
import { openBeanDetail } from './beans.js';

let inst = null;

export function renderMap(root) {
  if (!inst) {
    root.replaceChildren(h('div.map-loading', 'Loading the world map…'));
    inst = { loading: true };
    loadWorld().then(world => {
      inst = createMap(world);
      if (root.isConnected && nav.current() === 'map') attach(root);
    }).catch(err => {
      console.error(err);
      inst = null;
      root.replaceChildren(h('div.map-loading', 'The map could not be loaded. Reload the app while online once to cache it.'));
    });
    return;
  }
  if (inst.loading) return;
  attach(root);
}

function attach(root) {
  if (inst.el.parentNode !== root) root.replaceChildren(inst.el);
  inst.refresh();
}

/* =========================================================
   Map instance
   ========================================================= */
function createMap(world) {
  const d3 = window.d3;
  const NS = 'http://www.w3.org/2000/svg';
  const el = h('div.map-view');
  const stage = h('div.map-stage');
  const svgEl = document.createElementNS(NS, 'svg');
  svgEl.setAttribute('class', 'map'); svgEl.setAttribute('role', 'img'); svgEl.setAttribute('aria-label', 'World map of where your coffee comes from');
  const inView = h('div.map-inview');
  const controls = h('div.map-controls',
    h('button.icon-btn.mc', { type: 'button', 'aria-label': 'Zoom in', onclick: () => svg.transition().duration(250).call(zoom.scaleBy, 1.8) }, icon('plus', 20)),
    h('button.icon-btn.mc', { type: 'button', 'aria-label': 'Zoom out', onclick: () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.8) }, h('span.minus')),
    h('button.icon-btn.mc', { type: 'button', 'aria-label': 'Show whole world', onclick: () => worldView() }, icon('expand', 18)));
  const empty = h('div.map-empty', { hidden: true },
    h('h3', 'Your coffee map is empty'), h('p', 'Add beans with a country of origin and those countries light up here.'),
    h('button.btn.primary', { type: 'button', onclick: () => nav.go('beans') }, 'Add beans'));
  const panel = h('aside.map-panel', { 'aria-live': 'polite' });
  stage.append(svgEl, inView, controls, empty);
  el.append(stage, panel);

  const svg = d3.select(svgEl);
  svg.append('rect').attr('class', 'ocean-bg').attr('width', '100%').attr('height', '100%');
  const gZoom = svg.append('g').attr('class', 'zoom');
  const gCountries = gZoom.append('g').attr('class', 'countries');
  const gRegions = gZoom.append('g').attr('class', 'regions');
  const gOverlay = svg.append('g').attr('class', 'map-ov');
  const gLabels = gOverlay.append('g').attr('class', 'labels');
  const gMarkers = gOverlay.append('g').attr('class', 'markers');

  let W = 0, H = 0, projection, path, t = d3.zoomIdentity;
  let focusA3 = null, selRegion = null;
  const countryPath = new Map(), regionPath = new Map(), anchorCache = new Map(), boundsCache = new Map();
  let origins = new Map(); // a3 -> { regions: Map(feature|null -> {feature, label, beans:[]}), beans:[] }
  let markers = [];        // {kind:'pin'|'region', a3, group, node, anchor}
  let lastSig = '';

  const zoom = d3.zoom().scaleExtent([1, 220]).on('zoom', (e) => { t = e.transform; gZoom.attr('transform', t); overlay(); });
  svg.call(zoom).on('dblclick.zoom', null);

  /* ---------- geometry helpers ---------- */
  function polys(f) { const g = f.geometry; return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
  function mainPolys(f) {
    const ps = polys(f).map(c => ({ c, a: d3.geoArea({ type: 'Polygon', coordinates: c }) }));
    const mx = Math.max(...ps.map(p => p.a));
    return { all: ps, main: ps.filter(p => p.a >= mx * 0.22), mx };
  }
  function anchor(f) {
    if (anchorCache.has(f)) return anchorCache.get(f);
    const { all, mx } = mainPolys(f);
    const big = all.find(p => p.a === mx);
    const ll = d3.geoCentroid({ type: 'Polygon', coordinates: big.c });
    const pt = projection(ll);
    anchorCache.set(f, pt); return pt;
  }
  function unionBounds(bs) {
    return [[Math.min(...bs.map(b => b[0][0])), Math.min(...bs.map(b => b[0][1]))], [Math.max(...bs.map(b => b[1][0])), Math.max(...bs.map(b => b[1][1]))]];
  }
  function countryFitBounds(a3) {
    const f = world.countryBy[a3];
    const { main } = mainPolys(f);
    const mainB = unionBounds(main.map(p => path.bounds({ type: 'Polygon', coordinates: p.c })));
    const o = origins.get(a3);
    const matched = o ? [...o.regions.values()].filter(r => r.feature).map(r => path.bounds(r.feature)) : [];
    if (matched.length) {
      const mu = unionBounds(matched);
      const inside = mu[0][0] >= mainB[0][0] - 1 && mu[0][1] >= mainB[0][1] - 1 && mu[1][0] <= mainB[1][0] + 1 && mu[1][1] <= mainB[1][1] + 1;
      if (!inside) return mu;
    }
    return mainB;
  }

  /* ---------- layout ---------- */
  function visibleInsets() {
    const panelOpen = !!focusA3;
    if (!panelOpen) return { l: 0, r: 0, t: 0, b: 0 };
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    return desktop ? { l: 0, r: Math.min(400, W * 0.4), t: 0, b: 0 } : { l: 0, r: 0, t: 40, b: Math.min(H * 0.5, 360) };
  }
  function fitTransform(bounds, pad = 0.82) {
    const ins = visibleInsets();
    const vw = W - ins.l - ins.r, vh = H - ins.t - ins.b;
    const dx = Math.max(1, bounds[1][0] - bounds[0][0]), dy = Math.max(1, bounds[1][1] - bounds[0][1]);
    const k = clamp(Math.min(vw / dx, vh / dy) * pad, 1, 220);
    const cx = (bounds[0][0] + bounds[1][0]) / 2, cy = (bounds[0][1] + bounds[1][1]) / 2;
    return d3.zoomIdentity.translate(ins.l + vw / 2 - k * cx, ins.t + vh / 2 - k * cy).scale(k);
  }
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    if (!W || !H) return false;
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
    path = d3.geoPath(projection);
    zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.15, -H * 0.15], [W * 1.15, H * 1.15]]);
    anchorCache.clear(); boundsCache.clear();
    return true;
  }

  /* ---------- build static geometry ---------- */
  function drawGeometry() {
    gCountries.selectAll('*').remove(); gRegions.selectAll('*').remove(); countryPath.clear(); regionPath.clear();
    for (const f of world.countries) {
      const a3 = f.properties.c;
      const p = gCountries.append('path').attr('class', 'country').attr('d', path(f)).attr('data-c', a3)
        .on('click', () => onCountryClick(a3, f));
      p.append('title').text(f.properties.cn);
      countryPath.set(a3, p);
    }
    for (const [a3] of origins) {
      for (const rf of world.regionsBy[a3] || []) {
        const p = gRegions.append('path').attr('class', 'region').attr('d', path(rf)).attr('data-c', a3)
          .on('click', (ev) => { ev.stopPropagation(); onRegionClick(a3, rf); });
        p.append('title').text(rf.properties.e || rf.properties.n);
        regionPath.set(rf, p);
      }
    }
  }

  /* ---------- data ---------- */
  function computeOrigins() {
    origins = new Map();
    for (const b of S.beans) {
      if (!b.countryCode || !world.countryBy[b.countryCode]) continue;
      let o = origins.get(b.countryCode);
      if (!o) origins.set(b.countryCode, o = { a3: b.countryCode, name: b.country, regions: new Map(), beans: [] });
      o.beans.push(b);
      const feat = matchRegion(world, b.countryCode, b.region);
      let g = o.regions.get(feat || null);
      if (!g) o.regions.set(feat || null, g = { feature: feat, label: feat ? (feat.properties.e || feat.properties.n) : '', beans: [] });
      g.beans.push(b);
    }
    // unmatched: group by typed text so the panel can still list them
    for (const o of origins.values()) {
      const g = o.regions.get(null);
      if (g) g.label = 'Other areas';
    }
  }
  const signature = () => JSON.stringify(S.beans.map(b => [b.id, b.countryCode, b.region, !!b.image, b.name, b.finished]));

  function paintClasses() {
    countryPath.forEach((p, a3) => p.classed('origin', origins.has(a3)).classed('focus', a3 === focusA3).classed('dim', !!focusA3 && a3 !== focusA3));
    regionPath.forEach((p, rf) => {
      const a3 = rf.properties.c, o = origins.get(a3);
      const has = !!o && [...o.regions.values()].some(r => r.feature === rf);
      p.classed('has-bean', has).classed('sel', rf === selRegion);
    });
  }

  function buildMarkers() {
    gMarkers.selectAll('*').remove(); markers = [];
    let n = 0;
    for (const [a3, o] of origins) {
      const cf = world.countryBy[a3];
      // country pin
      const pin = gMarkers.append('g').attr('class', 'pin').attr('tabindex', 0).attr('role', 'button').attr('aria-label', `${o.name}, ${o.beans.length} ${o.beans.length === 1 ? 'bean' : 'beans'}`)
        .on('click', () => focusCountry(a3)).on('keydown', (e) => { if (e.key === 'Enter') focusCountry(a3); });
      pin.append('circle').attr('r', 12);
      pin.append('text').attr('dy', '0.35em').text(o.beans.length);
      markers.push({ kind: 'pin', a3, node: pin, anchor: () => anchor(cf) });
      // region markers (photos)
      for (const g of o.regions.values()) {
        const bean = g.beans.find(b => b.image) || g.beans[0];
        const id = 'mk' + (n++);
        const m = gMarkers.append('g').attr('class', 'rmark').attr('tabindex', 0).attr('role', 'button')
          .attr('aria-label', `${g.label || o.name}: ${g.beans.map(b => b.name).join(', ')}`)
          .on('click', () => (g.feature ? focusRegion(a3, g.feature) : focusCountry(a3))).on('keydown', (e) => { if (e.key === 'Enter') (g.feature ? focusRegion(a3, g.feature) : focusCountry(a3)); });
        const R = 22;
        m.append('circle').attr('class', 'ring').attr('r', R + 3);
        m.append('clipPath').attr('id', id).append('circle').attr('r', R);
        if (bean.image) m.append('image').attr('href', blobURL(bean.image)).attr('x', -R).attr('y', -R).attr('width', R * 2).attr('height', R * 2).attr('preserveAspectRatio', 'xMidYMid slice').attr('clip-path', `url(#${id})`);
        else { m.append('circle').attr('class', 'ph').attr('r', R); m.append('text').attr('class', 'phg').attr('dy', '0.36em').text('☕'); }
        if (g.beans.length > 1) { const bd = m.append('g').attr('class', 'badge').attr('transform', `translate(${R - 3},${-R + 3})`); bd.append('circle').attr('r', 9); bd.append('text').attr('dy', '0.35em').text(g.beans.length); }
        markers.push({ kind: 'region', a3, group: g, node: m, anchor: () => (g.feature ? anchor(g.feature) : anchor(cf)) });
      }
    }
  }

  /* ---------- overlay (labels, markers, chips) ---------- */
  function inViewport(x, y, pad = 40) { return x > -pad && y > -pad && x < W + pad && y < H + pad; }
  function overlay() {
    const k = t.k;
    const showRegions = !!focusA3 || k >= 2.4;
    gRegions.style('opacity', focusA3 ? 1 : clamp((k - 2.2) / 1.6, 0, 1)).classed('on', showRegions);
    gCountries.classed('zoomed', k >= 2.4);
    const regionMode = (a3) => (focusA3 ? a3 === focusA3 : k >= 4);
    for (const m of markers) {
      const [x, y] = t.apply(m.anchor());
      const visible = m.kind === 'pin' ? (!focusA3 && k < 4) : regionMode(m.a3);
      m.node.style('display', visible && inViewport(x, y) ? null : 'none').attr('transform', `translate(${x},${y})`);
    }
    // region labels in focused country
    gLabels.selectAll('*').remove();
    if (focusA3) {
      const o = origins.get(focusA3);
      const withBeans = new Set(o ? [...o.regions.values()].map(r => r.feature).filter(Boolean) : []);
      let count = 0;
      for (const rf of world.regionsBy[focusA3] || []) {
        let b = boundsCache.get(rf); if (!b) boundsCache.set(rf, b = path.bounds(rf));
        const wpx = (b[1][0] - b[0][0]) * k, hpx = (b[1][1] - b[0][1]) * k;
        const name = rf.properties.e || rf.properties.n;
        if ((wpx < name.length * 5.6 || hpx < 12) && !withBeans.has(rf)) continue;
        const [x, y] = t.apply(anchor(rf));
        if (!inViewport(x, y, 0) || ++count > 60) continue;
        gLabels.append('text').attr('class', 'rlabel' + (withBeans.has(rf) ? ' has' : '')).attr('x', x).attr('y', withBeans.has(rf) ? y + 36 : y).attr('text-anchor', 'middle').text(name);
      }
    }
    chips();
  }
  const chips = debounce(() => {
    inView.replaceChildren();
    if (!origins.size || focusA3) return;
    const [x0, y0] = t.invert([0, 0]), [x1, y1] = t.invert([W, H]);
    const seen = [];
    for (const [a3, o] of origins) {
      const b = boundsCache.get('c' + a3) || (boundsCache.set('c' + a3, path.bounds(world.countryBy[a3])), boundsCache.get('c' + a3));
      if (b[1][0] >= x0 && b[0][0] <= x1 && b[1][1] >= y0 && b[0][1] <= y1) seen.push(o);
    }
    if (!seen.length) return;
    inView.append(...[h('span.iv-label', 'In view'), ...seen.slice(0, 6).map(o => h('button.chip.iv', { type: 'button', onclick: () => focusCountry(o.a3) }, `${o.name} · ${o.beans.length}`)), seen.length > 6 ? h('span.chip.iv.more', `+${seen.length - 6}`) : null].filter(Boolean));
  }, 90);

  /* ---------- interaction ---------- */
  function onCountryClick(a3, f) {
    if (origins.has(a3)) { focusCountry(a3); return; }
    if (focusA3) return;
    const empty = !origins.size;
    inView.replaceChildren(...[h('span.iv-label', f.properties.cn), empty ? null : h('span.iv-label', 'No beans from here yet')].filter(Boolean));
    setTimeout(chips, 1800);
  }
  function onRegionClick(a3, rf) {
    if (focusA3 !== a3) { focusCountry(a3); return; }
    focusRegion(a3, rf);
  }
  function animateTo(tr, ms = 900) { svg.transition().duration(ms).ease(d3.easeCubicInOut).call(zoom.transform, tr); }
  function focusCountry(a3) {
    selRegion = null; focusA3 = a3;
    el.classList.add('has-focus'); paintClasses(); renderPanel();
    requestAnimationFrame(() => animateTo(fitTransform(countryFitBounds(a3))));
  }
  function focusRegion(a3, rf) {
    focusA3 = a3; selRegion = rf; el.classList.add('has-focus'); paintClasses(); renderPanel();
    const b = path.bounds(rf);
    const ins = visibleInsets();
    // keep some context around small regions
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    const w = Math.max(b[1][0] - b[0][0], 14), hh = Math.max(b[1][1] - b[0][1], 14);
    animateTo(fitTransform([[cx - w / 2, cy - hh / 2], [cx + w / 2, cy + hh / 2]], 0.6));
  }
  function worldView() {
    focusA3 = null; selRegion = null; el.classList.remove('has-focus'); paintClasses(); renderPanel();
    animateTo(d3.zoomIdentity, 700);
  }

  /* ---------- panel ---------- */
  function renderPanel() {
    panel.replaceChildren();
    if (!focusA3) return;
    const o = origins.get(focusA3);
    const groups = [...o.regions.values()].sort((a, b) => (a.feature ? 0 : 1) - (b.feature ? 0 : 1) || a.label.localeCompare(b.label));
    panel.append(
      h('header.panel-head',
        h('button.icon-btn', { type: 'button', 'aria-label': 'Back to the world map', onclick: worldView }, icon('back', 20)),
        h('div', h('h2', o.name), h('p.muted.small', `${o.beans.length} ${o.beans.length === 1 ? 'bean' : 'beans'} from ${[...o.regions.values()].filter(g => g.feature).length || 'unlisted'} ${[...o.regions.values()].filter(g => g.feature).length === 1 ? 'region' : 'regions'}`))),
      h('div.panel-body',
        groups.map(g => h('section.region-group' + (g.feature && g.feature === selRegion ? '.sel' : ''),
          h('button.region-h', { type: 'button', disabled: !g.feature, onclick: () => g.feature && focusRegion(focusA3, g.feature) }, icon('pin', 16), h('span', g.label || 'Other areas'), g.feature ? icon('chevronR', 16, 'go') : null),
          g.beans.map(b => h('button.bean-row', { type: 'button', onclick: () => openBeanDetail(b.id) },
            beanThumb(b, 52),
            h('div.bean-row-main', h('b', b.name), h('span.muted.small', [roastLabel(b.roast), b.process].filter(Boolean).join(' · ')), b.region && !g.feature ? h('span.muted.small', `Area: ${b.region}`) : null),
            h('span.muted.small', b.finished ? 'Finished' : fmtG(b.grams))))))));
    panel.scrollTop = 0;
  }

  /* ---------- refresh ---------- */
  function refresh() {
    const had = W;
    const nw = stage.clientWidth, nh = stage.clientHeight;
    const resized = !W || Math.abs(nw - W) > 24 || Math.abs(nh - H) > 24;
    const sig = signature();
    if (resized) { if (!layout()) { requestAnimationFrame(refresh); return; } }
    if (resized || sig !== lastSig) {
      lastSig = sig;
      computeOrigins();
      if (focusA3 && !origins.has(focusA3)) { focusA3 = null; selRegion = null; el.classList.remove('has-focus'); }
      drawGeometry(); buildMarkers(); paintClasses(); renderPanel();
      empty.hidden = origins.size > 0;
      if (resized) { svg.call(zoom.transform, focusA3 ? fitTransform(countryFitBounds(focusA3)) : d3.zoomIdentity); }
      else overlay();
    } else overlay();
  }
  new ResizeObserver(() => { if (el.isConnected) refresh(); }).observe(stage);

  return { el, refresh, loading: false };
}
