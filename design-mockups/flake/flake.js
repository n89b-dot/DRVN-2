/* FLAKE — paint shader hero + paint-driven page state. */
import * as THREE from 'three';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const gbp = n => '£' + n.toLocaleString('en-GB');

/* ------------------------------------------------------------------ data */
const PAINTS = {
  lp2: {
    name: 'Midnight Purple', maker: 'Nissan', code: 'LP2',
    paint: '#2F1B52', shift: '#1E4E86', hi: '#B39CF2', ui: '#3A2367', uiInk: '#F7F7F4', flake: 1.0,
    car: { name: '1999 Nissan Skyline GT-R R34', short: 'the R34', owner: '@teovas', img: '../assets/flake-car-purple.png', alt: 'A Midnight Purple R34 GT-R in a pale studio', builds: 1, parts: 14 },
    listings: [
      { id: 'lp2-1', name: 'Volk TE37SL 18×9.5 ET22, set of four', price: 2400, img: '../assets/flake-part-wheel.png', fits: 'R34 GT-R, 5×114.3', cond: 'Used, fitted 11 months', seller: '@teovas', ships: 'Leeds, UK' },
      { id: 'lp2-2', name: 'Carbon GT wing, 1600mm, aluminium uprights', price: 690, img: '../assets/flake-part-wing.png', fits: 'Universal, drilled for R34 boot', cond: 'Used, fitted', seller: '@teovas', ships: 'Leeds, UK' },
      { id: 'lp2-3', name: 'Garrett G30-770 turbo, 0.83 A/R', price: 1150, img: '../assets/teardown-src-turbo.png', fits: 'RB26DETT, T3 flange', cond: 'Used, 4,000 miles', seller: '@teovas', ships: 'Leeds, UK' },
      { id: 'lp2-4', name: 'Front-mount intercooler, bar and plate 600×300', price: 320, img: '../assets/teardown-src-intercooler.png', fits: 'R34 GT-R, OEM crash bar', cond: 'Used, one small dent', seller: '@teovas', ships: 'Leeds, UK' },
    ],
  },
  '02c': {
    name: 'World Rally Blue', maker: 'Subaru', code: '02C',
    paint: '#1848B0', shift: '#1B2F78', hi: '#7FB2FF', ui: '#1E49A8', uiInk: '#F7F7F4', flake: 0.7,
    car: { name: '1998 Subaru Impreza 22B STI', short: 'the 22B', owner: '@hollyrigg', img: '../assets/flake-car-blue.png', alt: 'A World Rally Blue Impreza 22B in a pale studio', builds: 3, parts: 27 },
    listings: [
      { id: '02c-1', name: 'Bilstein B16 PSS10 coilovers, pair of fronts', price: 540, img: '../assets/teardown-src-coilover.png', fits: 'GC8 Impreza, all years', cond: 'Used, 9,000 miles', seller: '@hollyrigg', ships: 'Stirling, UK' },
      { id: '02c-2', name: 'Prodrive P1 17×7.5 wheels, set of four', price: 1300, img: '../assets/flake-part-wheel.png', fits: 'GC8, 5×100', cond: 'Used, refurbished', seller: '@hollyrigg', ships: 'Stirling, UK' },
      { id: '02c-3', name: 'STI Group N top mounts', price: 95, img: '../assets/teardown-src-coilover.png', fits: 'GC8 Impreza', cond: 'New, unopened', seller: '@hollyrigg', ships: 'Stirling, UK' },
    ],
  },
  nh0: {
    name: 'Championship White', maker: 'Honda', code: 'NH-0',
    paint: '#ECEBE3', shift: '#C9CDC6', hi: '#FFFFFF', ui: '#15151B', uiInk: '#F7F7F4', flake: 0.3,
    car: { name: '1999 Honda Civic Type R EK9', short: 'the EK9', owner: '@mikehuang', img: '../assets/flake-car-white.png', alt: 'A Championship White Civic Type R in a pale studio', builds: 5, parts: 41 },
    listings: [
      { id: 'nh0-1', name: 'Recaro SR3 seat, carbon back, driver side', price: 780, img: '../assets/teardown-src-seat.png', fits: 'EK9 with Bride rails', cond: 'Used, no tears', seller: '@mikehuang', ships: 'Manchester, UK' },
      { id: 'nh0-2', name: 'Mugen flat-bottom steering wheel, 350mm', price: 410, img: '../assets/teardown-src-steering.png', fits: 'Universal, Works Bell hub', cond: 'Used, light wear', seller: '@mikehuang', ships: 'Manchester, UK' },
      { id: 'nh0-3', name: 'Spoon Sports N1 exhaust, titanium tip', price: 560, img: '../assets/teardown-src-exhaust.png', fits: 'EK9, cat-back', cond: 'Used, fitted', seller: '@mikehuang', ships: 'Manchester, UK' },
    ],
  },
  '46v': {
    name: 'Soul Red Crystal', maker: 'Mazda', code: '46V',
    paint: '#A4101C', shift: '#5A0A14', hi: '#FF6B6B', ui: '#9C1420', uiInk: '#F7F7F4', flake: 0.85,
    car: { name: '1996 Mazda RX-7 FD3S', short: 'the FD', owner: '@saraobi', img: '../assets/flake-car-red.png', alt: 'A Soul Red RX-7 FD in a pale studio', builds: 2, parts: 19 },
    listings: [
      { id: '46v-1', name: 'Brembo 6-pot kit with 355mm discs, fronts', price: 1900, img: '../assets/teardown-src-caliper.png', fits: 'FD3S, 17 inch minimum', cond: 'Used, 30% pads', seller: '@saraobi', ships: 'Bristol, UK' },
      { id: '46v-2', name: 'HKS front-mount intercooler, V-mount delete', price: 450, img: '../assets/teardown-src-intercooler.png', fits: 'FD3S', cond: 'Used, fitted', seller: '@saraobi', ships: 'Bristol, UK' },
      { id: '46v-3', name: 'Turbo, rebuilt single conversion', price: 870, img: '../assets/teardown-src-turbo.png', fits: '13B-REW, single kit', cond: 'Rebuilt', seller: '@saraobi', ships: 'Bristol, UK' },
    ],
  },
};
const ORDER = ['lp2', '02c', 'nh0', '46v'];
let active = 'lp2';

/* ------------------------------------------------------------------ shader hero */
const panel = $('#panel');
const canvas = $('#paint');
let gl = null;

function initPaint() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  panel.classList.add('is-webgl');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0, 4.6);

  const toLin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const p = PAINTS[active];
  const uniforms = {
    uPaint: { value: toLin(p.paint) }, uShift: { value: toLin(p.shift) }, uHi: { value: toLin(p.hi) },
    uFlake: { value: p.flake },
    uLight: { value: new THREE.Vector3(1.2, 1.4, 2.6) },
    uCam: { value: camera.position },
    uTime: { value: 0 },
  };

  const vert = /* glsl */`
    varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
    float h(vec2 p){
      /* a door skin: one long swage line, a softer lower crease, gentle tumblehome */
      float swage  = 0.34 * exp(-pow((p.y - 0.35) * 1.9, 2.0)) * (0.8 + 0.2 * cos(p.x * 0.5 + 0.6));
      float crease = 0.16 * exp(-pow((p.y + 1.05) * 2.6, 2.0));
      float tumble = -0.09 * p.x * p.x - 0.12 * pow(max(p.y - 0.2, 0.0), 2.0);
      float wave   = 0.03 * sin(p.x * 0.9 - p.y * 0.6);
      return swage + crease + tumble + wave;
    }
    void main(){
      vUv = uv;
      vec2 xy = position.xy;
      float e = 0.012;
      float z = h(xy);
      vec3 dx = vec3(e, 0.0, h(xy + vec2(e, 0.0)) - z);
      vec3 dy = vec3(0.0, e, h(xy + vec2(0.0, e)) - z);
      vec3 n = normalize(cross(dx, dy));
      vN = normalize(mat3(modelMatrix) * n);
      vec4 wp = modelMatrix * vec4(xy, z, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  const frag = /* glsl */`
    precision highp float;
    uniform vec3 uPaint, uShift, uHi, uLight, uCam; uniform float uFlake, uTime;
    varying vec3 vWorld; varying vec3 vN; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    vec3 hash3(vec2 p){ return vec3(hash(p), hash(p + 19.19), hash(p + 7.31)); }
    vec3 env(vec3 r){
      /* a studio: pale floor, soft ceiling, one long softbox overhead and slightly behind camera */
      vec3 sky = mix(vec3(0.07, 0.07, 0.08), vec3(0.50, 0.50, 0.49), smoothstep(-0.4, 0.95, r.y));
      vec3 boxDir = normalize(vec3(-0.10, 1.0, 0.62));
      float box = smoothstep(0.93, 0.992, dot(r, boxDir));
      float rim  = smoothstep(0.010, 0.0, abs(r.y + 0.22)) * smoothstep(0.1, 0.6, r.z);
      return sky + box * 3.2 + rim * 0.5;
    }
    void main(){
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vWorld);
      vec3 L = normalize(uLight - vWorld);
      vec3 H = normalize(L + V);
      float NdV = clamp(dot(N, V), 0.0, 1.0);
      float NdL = clamp(dot(N, L), 0.0, 1.0);

      /* base coat with angle-dependent colour shift */
      vec3 base = mix(uPaint, uShift, pow(1.0 - NdV, 1.8));
      vec3 col = base * (0.55 + 0.9 * NdL);

      /* metallic flake: hashed micro-normals, only a fraction of cells catch the light */
      vec2 cell = floor(vUv * vec2(900.0, 560.0));
      vec3 r3 = hash3(cell);
      vec3 fN = normalize(N + (r3 - 0.5) * 1.3);
      float sparkle = pow(clamp(dot(fN, H), 0.0, 1.0), 70.0);
      float gate = smoothstep(0.84, 0.88, r3.x);
      /* flakes also pick up the softbox through the clear coat */
      float boxSparkle = pow(clamp(dot(reflect(-V, fN), normalize(vec3(-0.10, 1.0, 0.62))), 0.0, 1.0), 180.0);
      col += mix(uHi, vec3(1.0), 0.35) * (sparkle * 1.3 + boxSparkle * 0.55) * gate * uFlake * (0.25 + 0.75 * NdL);
      /* a soft metallic sheen where the light grazes, so the flake reads as a field, not dots */
      col += uHi * pow(clamp(dot(N, H), 0.0, 1.0), 6.0) * 0.18 * uFlake;

      /* clear coat */
      float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
      vec3 R = reflect(-V, N);
      vec3 e = env(R);
      col = col * (1.0 - F * 0.5) + e * (F * 1.5 + 0.035);

      /* pointer light specular */
      float spec = pow(clamp(dot(N, H), 0.0, 1.0), 320.0);
      col += vec3(1.0) * spec * 0.45;

      /* gentle vignette toward the top left so the chip reads */
      col *= 0.92 + 0.08 * smoothstep(-0.2, 1.0, vUv.x + (1.0 - vUv.y) * 0.4);
      col = pow(max(col, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(col, 1.0);
    }`;

  const geo = new THREE.PlaneGeometry(6.4, 4.2, 180, 120);
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(-0.08, 0.12, 0.0);
  scene.add(mesh);

  /* pointer → light, smoothed; idle drift when the pointer is away */
  const target = new THREE.Vector2(0.6, 0.55);
  const pos = new THREE.Vector2(0.6, 0.55);
  let lastMove = 0;
  const onMove = (x, y) => {
    const r = panel.getBoundingClientRect();
    target.set((x - r.left) / r.width, 1 - (y - r.top) / r.height);
    lastMove = performance.now();
  };
  addEventListener('pointermove', e => onMove(e.clientX, e.clientY), { passive: true });

  /* paint transitions */
  const from = { paint: new THREE.Color(), shift: new THREE.Color(), hi: new THREE.Color(), flake: 0 };
  const to = { paint: new THREE.Color(), shift: new THREE.Color(), hi: new THREE.Color(), flake: 0 };
  let tStart = -1;
  const setPaint = key => {
    const q = PAINTS[key];
    from.paint.copy(uniforms.uPaint.value); from.shift.copy(uniforms.uShift.value); from.hi.copy(uniforms.uHi.value); from.flake = uniforms.uFlake.value;
    to.paint.copy(toLin(q.paint)); to.shift.copy(toLin(q.shift)); to.hi.copy(toLin(q.hi)); to.flake = q.flake;
    tStart = performance.now();
  };

  const resize = () => {
    const w = panel.clientWidth, h = panel.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    /* keep the panel filling the frame at any aspect */
    const vis = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const s = Math.max(vis * camera.aspect / 6.0, vis / 3.8);
    mesh.scale.setScalar(s * 1.08);
  };
  new ResizeObserver(resize).observe(panel);
  resize();

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(panel);

  const easeOut = x => 1 - Math.pow(1 - x, 3);
  const frame = now => {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = now / 1000;
    uniforms.uTime.value = t;
    if (!reduceMotion && now - lastMove > 2200) {
      target.set(0.58 + Math.sin(t * 0.37) * 0.22, 0.55 + Math.cos(t * 0.29) * 0.18);
    }
    pos.lerp(target, reduceMotion ? 1 : 0.06);
    uniforms.uLight.value.set((pos.x - 0.5) * 7.0, (pos.y - 0.5) * 5.0 + 0.8, 2.8);
    mesh.rotation.y = 0.12 + (pos.x - 0.5) * 0.06;
    mesh.rotation.x = -0.08 + (pos.y - 0.5) * -0.05;
    if (tStart >= 0) {
      const k = easeOut(Math.min(1, (now - tStart) / (reduceMotion ? 1 : 700)));
      uniforms.uPaint.value.lerpColors(from.paint, to.paint, k);
      uniforms.uShift.value.lerpColors(from.shift, to.shift, k);
      uniforms.uHi.value.lerpColors(from.hi, to.hi, k);
      uniforms.uFlake.value = from.flake + (to.flake - from.flake) * k;
      if (k >= 1) tStart = -1;
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
  return { setPaint };
}
try { gl = initPaint(); } catch (e) { console.warn('Paint shader unavailable, using CSS fallback.', e); }

/* ------------------------------------------------------------------ paint → page */
const root = document.documentElement;
function applyPaint(key, { scroll = false } = {}) {
  active = key;
  const p = PAINTS[key];
  root.style.setProperty('--paint', p.paint);
  root.style.setProperty('--paint-shift', p.shift);
  root.style.setProperty('--paint-hi', p.hi);
  root.style.setProperty('--paint-ui', p.ui);
  root.style.setProperty('--paint-ui-ink', p.uiInk);
  root.style.setProperty('--paint-soft', p.ui + '1A');
  gl?.setPaint(key);

  $$('.swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paint === key)));
  $('#chipName').textContent = p.name;
  $('#chipMeta').textContent = `${p.maker} ${p.code} · ${p.car.builds} build${p.car.builds > 1 ? 's' : ''}, ${p.car.parts} parts listed`;
  $('#bandName').textContent = p.name;
  countTo($('#bandBuilds'), p.car.builds);
  countTo($('#bandParts'), p.car.parts);
  $('#partsCar').textContent = p.car.short;
  renderBuilds();
  renderRail();
  $('#sellCar').value = key;
  updatePreview();
  if (scroll) $('#builds').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function countTo(el, n) {
  const start = parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
  if (reduceMotion || start === n) { el.textContent = n; return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 500);
    el.textContent = Math.round(start + (n - start) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderBuilds() {
  const wrap = $('#buildGrid');
  const order = [active, ...ORDER.filter(k => k !== active)];
  const cls = ['build--lead', 'build--a', 'build--b', 'build--c'];
  wrap.innerHTML = order.map((k, i) => {
    const p = PAINTS[k];
    return `
      <a class="build ${cls[i]}" href="#parts" data-paint="${k}" aria-label="${p.car.name}, ${p.car.parts} parts listed">
        <img src="${p.car.img}" alt="${p.car.alt}" loading="${i ? 'lazy' : 'eager'}">
        <span class="build__paint" style="--c:${p.paint};--c-shift:${p.shift};--c-hi:${p.hi}"><i aria-hidden="true"></i>${p.name}</span>
        <span class="build__meta">
          <b>${p.car.name}</b>
          <span>${p.car.owner}</span>
          <span class="num"><b>${p.car.parts}</b>parts</span>
        </span>
      </a>`;
  }).join('');
  $$('.build', wrap).forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    }, { passive: true });
    card.addEventListener('click', e => {
      if (card.dataset.paint !== active) { e.preventDefault(); applyPaint(card.dataset.paint); }
    });
  });
}

function renderRail() {
  const p = PAINTS[active];
  $('#rail').innerHTML = p.listings.map(l => `
    <button class="part" data-id="${l.id}" aria-label="${l.name}, ${gbp(l.price)}">
      <span class="part__edge" aria-hidden="true"></span>
      <span class="part__img"><img src="${l.img}" alt="" loading="lazy"></span>
      <span class="part__body">
        <b>${l.name}</b>
        <span>${l.fits}</span>
        <span class="part__foot">
          <span class="part__price num">${gbp(l.price)}</span>
          <span class="part__from"><i aria-hidden="true"></i>off ${p.car.short}</span>
        </span>
      </span>
    </button>`).join('');
  $$('.part', $('#rail')).forEach(b => b.addEventListener('click', () => openSheet(b.dataset.id)));
}

/* ------------------------------------------------------------------ swatches + code lookup */
$$('.swatch').forEach(b => b.addEventListener('click', () => applyPaint(b.dataset.paint)));

const codeForm = $('#codeForm'), codeInput = $('#codeInput'), codeHint = $('#codeHint');
const findCode = v => {
  const q = v.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!q) return null;
  return ORDER.find(k => PAINTS[k].code.replace(/[^a-z0-9]/gi, '').toLowerCase() === q)
    || ORDER.find(k => PAINTS[k].name.toLowerCase().startsWith(q));
};
codeInput.addEventListener('input', () => {
  const k = findCode(codeInput.value);
  codeHint.classList.remove('is-bad');
  codeHint.textContent = k ? `${PAINTS[k].maker} · ${PAINTS[k].name}` : (codeInput.value ? 'No match yet. Try LP2, 02C, NH-0 or 46V.' : '');
  if (!k && codeInput.value.length >= 3) codeHint.classList.add('is-bad');
});
codeForm.addEventListener('submit', e => {
  e.preventDefault();
  const k = findCode(codeInput.value);
  if (k) { applyPaint(k, { scroll: true }); codeInput.value = ''; codeHint.textContent = ''; }
  else { codeHint.textContent = 'We do not know that code yet. Try LP2, 02C, NH-0 or 46V.'; codeHint.classList.add('is-bad'); }
});

/* ------------------------------------------------------------------ sell preview */
const pv = { name: $('#pvName'), meta: $('#pvMeta'), price: $('#pvPrice') };
function updatePreview() {
  const k = $('#sellCar').value, p = PAINTS[k];
  const name = $('#sellPart').value.trim() || 'Untitled part';
  const price = parseInt($('#sellPrice').value.replace(/\D/g, ''), 10);
  pv.name.textContent = name;
  pv.meta.textContent = `Off a ${p.car.name.replace(/^\d{4}\s/, '')} in ${p.name} · ${$('#sellCond').value}`;
  pv.price.textContent = Number.isFinite(price) ? gbp(price) : '£0';
  if (k !== active) applyPaint(k);
}
['sellCar', 'sellPart', 'sellPrice', 'sellCond'].forEach(id => $('#' + id).addEventListener('input', updatePreview));
$('#sellForm').addEventListener('submit', e => {
  e.preventDefault();
  const btn = $('#sellBtn');
  btn.textContent = 'Listed. Followers of this build have been told.';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = 'Publish listing'; btn.disabled = false; }, 2600);
});

/* ------------------------------------------------------------------ listing sheet */
const sheet = $('#sheet');
let lastFocus = null;
function openSheet(id) {
  const p = PAINTS[active];
  const l = p.listings.find(x => x.id === id);
  if (!l) return;
  lastFocus = document.activeElement;
  $('#sheetImg').src = l.img; $('#sheetImg').alt = l.name;
  $('#sheetTitle').textContent = l.name;
  $('#sheetPrice').textContent = gbp(l.price);
  $('#sheetFits').textContent = l.fits;
  $('#sheetCond').textContent = l.cond;
  $('#sheetSeller').textContent = l.seller;
  $('#sheetShips').textContent = l.ships;
  $('#sheetFrom').textContent = `Off ${p.car.short}`;
  $('#sheetCar').textContent = `${p.car.name} in ${p.name}, ${p.car.owner}`;
  $('#sheetDone').textContent = '';
  sheet.classList.remove('is-done');
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  document.body.style.overflow = 'hidden';
  $('#buyBtn').focus();
}
function closeSheet() {
  sheet.classList.remove('is-open');
  document.body.style.overflow = '';
  setTimeout(() => { sheet.hidden = true; lastFocus?.focus(); }, reduceMotion ? 0 : 420);
}
$$('[data-close]', sheet).forEach(el => el.addEventListener('click', closeSheet));
addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
$('#buyBtn').addEventListener('click', () => {
  const p = PAINTS[active];
  $('#sheetDone').textContent = `Bought. ${p.car.owner} has been asked to post it, and you will hear the moment it ships.`;
  sheet.classList.add('is-done');
});

/* ------------------------------------------------------------------ nav menu (small screens) */
const menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') === 'true';
  menuBtn.setAttribute('aria-expanded', String(!open));
  const links = $('.nav__links');
  links.style.display = open ? '' : 'flex';
  links.style.cssText += open ? '' : 'position:fixed;top:64px;left:0;right:0;flex-direction:column;gap:0;padding:12px var(--gutter) 20px;background:var(--primer-2);border-bottom:1px solid var(--line);';
  if (open) links.removeAttribute('style');
});

/* ------------------------------------------------------------------ reveal */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach(el => io.observe(el));
setTimeout(() => $$('.reveal').forEach(el => el.classList.add('is-in')), 1600);

/* ------------------------------------------------------------------ boot */
applyPaint('lp2');
