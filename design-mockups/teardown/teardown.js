/* TEARDOWN — scroll-driven disassembly scene, part tags, 3D wheel viewer, drawer. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const gbp = n => '£' + n.toLocaleString('en-GB');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = x => x * x * (3 - 2 * x);
const easeOut = x => 1 - Math.pow(1 - x, 3);
const lerp = (a, b, k) => a + (b - a) * k;

/* ------------------------------------------------------------------ data */
const PARTS = [
  { id: 'wheel',       name: 'Volk TE37 18×10 ET25, set of four', price: 2800, fits: 'Supra A80, 5×114.3', cond: 'Used, two light kerb marks', when: '3 October', size: 1.55, home: [-1.55, -0.40, -0.05], out: [-3.5, 0.55, 1.2], spin: [0.15, 0.0, 0.45] },
  { id: 'coilover',    name: 'HKS Hipermax IV coilovers, set',     price: 1150, fits: 'Supra A80, all years', cond: 'Used, 8,000 miles',        when: '3 October', size: 1.35, home: [-1.35, 0.15, -0.05], out: [-1.9, 2.05, 0.2],  spin: [0.0, 0.0, -0.35] },
  { id: 'turbo',       name: 'Precision 6766 turbo, T4 .96 A/R',  price: 1480, fits: '2JZ-GTE single kit',   cond: 'Used, rebuilt last year',  when: '5 October', size: 1.3,  home: [1.85, 0.25, -0.05],  out: [0.5, 2.25, -0.5],   spin: [0.3, 0.2, 0.2] },
  { id: 'seat',        name: 'Bride Zeta III carbon seat, driver', price: 720,  fits: 'Supra A80 with Bride rail', cond: 'Used, no tears',     when: '5 October', size: 1.55, home: [0.1, 0.1, -0.05],    out: [3.1, 1.35, 0.5],    spin: [0.0, 0.25, 0.15] },
  { id: 'steering',    name: 'Nardi 350mm suede wheel, Works Bell hub', price: 330, fits: 'Universal, 70mm PCD', cond: 'Used, light wear',       when: '9 October', size: 1.1,  home: [0.7, 0.25, -0.05],   out: [1.1, -2.2, 1.3],   spin: [0.2, 0.0, -0.6] },
  { id: 'intercooler', name: 'GReddy 24-row front mount intercooler', price: 410, fits: 'Supra A80, OEM crash bar', cond: 'Used, fins straight', when: '9 October', size: 1.35, home: [2.55, -0.3, -0.05],  out: [3.7, -0.6, -0.3], spin: [0.0, -0.3, 0.1] },
  { id: 'exhaust',     name: 'HKS Hi-Power titanium muffler',      price: 560,  fits: 'Supra A80, cat-back', cond: 'Used, blue tips intact',     when: '12 October', size: 1.3, home: [-2.45, -0.72, -0.05], out: [2.7, -2.1, 0.2],  spin: [0.1, 0.0, 0.4] },
  { id: 'caliper',     name: 'AP Racing CP5555 6-pot kit, 362mm',  price: 2150, fits: 'Supra A80, 18 inch minimum', cond: 'Used, 60% pads',     when: '12 October', size: 1.1, home: [1.55, -0.40, -0.05], out: [-0.2, -1.2, 0.9],  spin: [0.0, 0.0, -0.25] },
];
const TOTAL = PARTS.reduce((s, p) => s + p.price, 0);

/* ------------------------------------------------------------------ stage */
const pin = $('#pin'), stage = $('#stage'), canvas = $('#scene'), tagsEl = $('#tags');
const title = $('#title'), beats = $$('#title h1 span'), titleP = $('#titleP'), cta = $('.hud__cta');
const offCount = $('#offCount'), offBar = $('#offBar'), totalLabel = $('#totalLabel'), totalPrice = $('#totalPrice');

function buildStage() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  pin.classList.add('is-webgl');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 0, 10.5);
  const group = new THREE.Group();
  scene.add(group);

  const loader = new THREE.TextureLoader();
  const tex = file => { const t = loader.load(`../assets/${file}.png`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

  /* soft shadow sprite texture */
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const g = sc.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(17,20,24,0.55)'); grad.addColorStop(0.55, 'rgba(17,20,24,0.18)'); grad.addColorStop(1, 'rgba(17,20,24,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(sc);

  /* the car */
  const carAspect = 2688 / 1520;
  const carW = 5.8;
  const carMat = new THREE.MeshBasicMaterial({ map: tex('teardown-cut-car'), transparent: true, depthWrite: false });
  const car = new THREE.Mesh(new THREE.PlaneGeometry(carW, carW / carAspect), carMat);
  car.renderOrder = 1;
  group.add(car);
  const carShadow = new THREE.Mesh(new THREE.PlaneGeometry(carW * 0.92, 0.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
  carShadow.position.set(0, -1.25, -0.4); carShadow.renderOrder = 0;
  group.add(carShadow);

  /* the parts */
  const items = PARTS.map((p, i) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex(`teardown-cut-${p.id}`), transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 2;
    mesh.userData.i = i;
    group.add(mesh);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.32), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    sh.renderOrder = 0;
    group.add(sh);
    const tag = document.createElement('button');
    tag.className = 'tag'; tag.type = 'button'; tag.dataset.id = p.id;
    tag.innerHTML = `<b>${p.name}</b><span class="price">${gbp(p.price)}</span>`;
    tag.addEventListener('click', () => openDrawer(p.id));
    tag.addEventListener('pointerenter', () => setHot(i, true));
    tag.addEventListener('pointerleave', () => setHot(i, false));
    tagsEl.appendChild(tag);
    return { p, mesh, sh, tag, hot: 0, pos: new THREE.Vector3(), scale: 1, knoll: new THREE.Vector3(), knollSize: 1 };
  });

  /* layout: knolled grid depends on the viewport */
  let visW = 1, visH = 1;
  const spread = new THREE.Vector2(1, 1);
  let carFit = 1;
  const resize = () => {
    const w = pin.clientWidth, h = pin.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    visW = visH * camera.aspect;
    const fit = Math.min(1, visW / 7.2);
    car.scale.setScalar(fit); carShadow.scale.setScalar(fit);
    carFit = fit;
    const cols = camera.aspect > 1.05 ? 4 : 2, rows = 8 / cols;
    const cellW = visW * (cols === 4 ? 0.21 : 0.40), cellH = visH * (cols === 4 ? 0.30 : 0.165);
    /* exploded vectors were drawn for a wide frame; squeeze them for narrow ones */
    spread.set(clamp(visW / 9.6, 0.42, 1), clamp(visH / 6.0, 0.6, 1));
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      it.knoll.set((c - (cols - 1) / 2) * cellW, ((rows - 1) / 2 - r) * cellH + (cols === 4 ? 0.35 : -0.1), 0.2);
      it.knollSize = Math.min(it.p.size, cellW * 0.78, cellH * 0.62);
    });
  };
  new ResizeObserver(resize).observe(pin);
  resize();

  /* pointer: parallax + hover */
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2(-9, -9), tilt = new THREE.Vector2(), tiltT = new THREE.Vector2();
  let hover = -1;
  pin.addEventListener('pointermove', e => {
    const r = pin.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    tiltT.set(ptr.x, ptr.y);
  }, { passive: true });
  pin.addEventListener('pointerleave', () => { ptr.set(-9, -9); tiltT.set(0, 0); });
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('click', () => { if (hover >= 0 && progress > 0.4) openDrawer(items[hover].p.id); });
  const setHot = (i, on) => { items[i].hot = on ? 1 : 0; items[i].tag.classList.toggle('is-hot', on); };

  /* timeline */
  let progress = 0;
  const win = i => ({ a: 0.04 + i * 0.05, b: 0.40 + i * 0.05 });     /* each part leaves the car in its own window */
  const KN0 = 0.62, KN1 = 0.95;                                        /* then everything settles into the grid */
  const v = new THREE.Vector3();
  const project = (x, y, z) => { v.set(x, y, z).applyMatrix4(group.matrixWorld).project(camera); return [(v.x + 1) / 2 * pin.clientWidth, (1 - v.y) / 2 * pin.clientHeight]; };

  let visible = true, lastBeat = -1, lastCount = -1;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(stage);

  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    const r = stage.getBoundingClientRect();
    const raw = clamp(-r.top / (r.height - pin.clientHeight), 0, 1);
    progress = reduceMotion ? 1 : raw;
    const kn = smooth(clamp((progress - KN0) / (KN1 - KN0), 0, 1));

    /* tilt */
    tilt.lerp(tiltT, 0.05);
    group.rotation.y = tilt.x * 0.07 * (1 - kn * 0.6);
    group.rotation.x = -tilt.y * 0.045 * (1 - kn * 0.6);

    /* car */
    const carFade = smooth(clamp((progress - 0.12) / 0.45, 0, 1));
    carMat.opacity = lerp(1, 0.16, carFade) * (1 - kn * 0.75);
    carShadow.material.opacity = 0.5 * (1 - carFade);
    car.position.z = lerp(0, -0.8, carFade);
    car.position.y = lerp(0, 0.35, kn);

    /* parts */
    let count = 0;
    items.forEach((it, i) => {
      const { a, b } = win(i);
      const k = smooth(clamp((progress - a) / (b - a), 0, 1));
      if (progress > a + 0.02) count++;
      const px = lerp(it.p.home[0] * carFit, it.p.out[0] * spread.x, k), py = lerp(it.p.home[1] * carFit, it.p.out[1] * spread.y, k), pz = lerp(it.p.home[2], it.p.out[2], k);
      it.pos.set(lerp(px, it.knoll.x, kn), lerp(py, it.knoll.y, kn), lerp(pz, it.knoll.z, kn));
      const s0 = lerp(it.p.size * 0.42 * carFit, it.p.size * (0.7 + 0.3 * spread.x), easeOut(k));
      const hot = lerp(it.hot ? 1.07 : 1, 1, 0);
      it.scale += ((lerp(s0, it.knollSize, kn) * hot) - it.scale) * 0.18;
      it.mesh.position.copy(it.pos);
      it.mesh.scale.setScalar(it.scale);
      /* a part only exists once it has come off: it emerges from inside the car */
      it.mesh.material.opacity = clamp(k / 0.14, 0, 1);
      it.mesh.renderOrder = k > 0.05 ? 2 : 0;
      const wob = reduceMotion ? 0 : Math.sin(performance.now() / 1400 + i) * 0.015 * k * (1 - kn);
      it.mesh.rotation.set(it.p.spin[0] * k * (1 - kn) + wob, it.p.spin[1] * k * (1 - kn), it.p.spin[2] * k * (1 - kn) + wob);
      it.mesh.position.y += wob * 3;
      it.sh.position.set(it.pos.x, it.pos.y - it.scale * 0.5 - 0.08, it.pos.z - 0.03);
      it.sh.scale.set(it.scale * 1.15, it.scale * 1.0, 1);
      it.sh.material.opacity = 0.35 * k;
      /* tag */
      const show = k > 0.75;
      it.tag.classList.toggle('is-on', show);
      if (show) {
        const [x, y] = project(it.pos.x, it.pos.y - it.scale * 0.5 - 0.12, it.pos.z);
        it.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateX(-50%)`;
      }
    });

    /* hover via raycast (only once things are off the car) */
    if (ptr.x > -2 && progress > 0.3) {
      ray.setFromCamera(ptr, camera);
      const hits = ray.intersectObjects(items.map(it => it.mesh));
      const h = hits.length ? hits[0].object.userData.i : -1;
      if (h !== hover) { if (hover >= 0) setHot(hover, false); hover = h; if (hover >= 0) setHot(hover, true); canvas.style.cursor = hover >= 0 ? 'pointer' : ''; }
    } else if (hover >= 0) { setHot(hover, false); hover = -1; canvas.style.cursor = ''; }

    /* HUD */
    if (count !== lastCount) {
      lastCount = count;
      offCount.textContent = count;
      offBar.style.width = `${(count / PARTS.length) * 100}%`;
      const listed = items.slice(0, count).reduce((s, it) => s + it.p.price, 0);
      totalLabel.textContent = `${count} part${count === 1 ? '' : 's'}`;
      totalPrice.textContent = gbp(listed);
    }
    const beat = progress < 0.3 ? 0 : progress < 0.62 ? 1 : 2;
    if (beat !== lastBeat) {
      lastBeat = beat;
      beats.forEach((s, i) => s.classList.toggle('is-on', i === beat));
      titleP.style.opacity = cta.style.opacity = beat === 0 ? 1 : 0;
      cta.style.pointerEvents = beat === 0 ? 'auto' : 'none';
    }
    title.classList.toggle('is-dim', progress > 0.86);

    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
  return true;
}
let stageOK = false;
try { stageOK = !!buildStage(); } catch (e) { console.warn('Stage unavailable, static fallback shown.', e); }
if (!stageOK) { totalLabel.textContent = `${PARTS.length} parts`; totalPrice.textContent = gbp(TOTAL); offCount.textContent = PARTS.length; offBar.style.width = '100%'; }

/* ------------------------------------------------------------------ teardowns in progress */
const TEARS = [
  { car: '1999 Nissan Skyline GT-R R34', who: '@teovas', img: '../assets/flake-car-purple.png', off: 6, of: 14, parts: ['wheel', 'turbo', 'intercooler'] },
  { car: '1998 Subaru Impreza 22B STI', who: '@hollyrigg', img: '../assets/flake-car-blue.png', off: 2, of: 9, parts: ['coilover', 'caliper'] },
  { car: '1999 Honda Civic Type R EK9', who: '@mikehuang', img: '../assets/flake-car-white.png', off: 9, of: 12, parts: ['seat', 'steering', 'exhaust'] },
];
$('#tears').innerHTML = TEARS.map(t => `
  <a class="tear" href="#stage" aria-label="${t.car}, ${t.off} of ${t.of} parts off">
    <span class="tear__img"><img src="${t.img}" alt="" loading="lazy"></span>
    <span class="tear__body">
      <span><b>${t.car}</b><br><span>${t.who}</span></span>
      <span class="tear__prog num"><span>${t.off} of ${t.of} parts off</span><span class="price">${t.off} listed</span><i><b style="--p:${(t.off / t.of) * 100}%"></b></i></span>
      <span class="tear__parts">${t.parts.map(p => `<span><img src="../assets/teardown-cut-${p}.png" alt="" loading="lazy"></span>`).join('')}</span>
    </span>
  </a>`).join('');

/* ------------------------------------------------------------------ 3D wheel viewer */
const viewer = $('#viewer');
function buildViewer() {
  const c = $('#wheel');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true }); } catch (e) { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.6, 4.2);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 4, 3); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xC9CED3, 0.5));
  const root = new THREE.Group(); scene.add(root);
  const resize = () => { const s = viewer.clientWidth; renderer.setSize(s, s, false); camera.aspect = 1; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(viewer); resize();

  new GLTFLoader().load('../assets/teardown-wheel.glb', gltf => {
    const m = gltf.scene;
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    m.position.sub(center);
    const s = 2.3 / Math.max(size.x, size.y, size.z);
    m.scale.setScalar(s);
    root.add(m);
    viewer.classList.add('is-3d');
  }, undefined, err => console.warn('Wheel model failed to load', err));

  /* drag to turn, with inertia; slow auto-turn when idle */
  let vel = 0.006, dragging = false, lastX = 0, lastT = 0, idle = 0;
  viewer.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastT = performance.now(); viewer.setPointerCapture(e.pointerId); $('#hint').classList.add('is-off'); });
  viewer.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - lastX; const now = performance.now(); vel = dx / Math.max(1, now - lastT) * 0.012; root.rotation.y += dx * 0.012; lastX = e.clientX; lastT = now; });
  const stop = () => { dragging = false; idle = 0; };
  viewer.addEventListener('pointerup', stop); viewer.addEventListener('pointercancel', stop);

  let visible = false;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(viewer);
  const frame = () => {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (!dragging) {
      idle++;
      vel *= 0.95;
      const auto = reduceMotion ? 0 : 0.004;
      root.rotation.y += vel + (idle > 60 ? auto : 0);
    }
    root.rotation.x = 0.12;
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}
const vio = new IntersectionObserver(([en]) => { if (en.isIntersecting) { vio.disconnect(); try { buildViewer(); } catch (e) { console.warn(e); } } }, { rootMargin: '600px' });
vio.observe(viewer);

/* ------------------------------------------------------------------ drawer */
const drawer = $('#drawer');
let lastFocus = null;
function openDrawer(id) {
  const p = PARTS.find(x => x.id === id); if (!p) return;
  lastFocus = document.activeElement;
  $('#dImg').src = `../assets/teardown-cut-${p.id}.png`; $('#dImg').alt = p.name;
  $('#dTitle').textContent = p.name;
  $('#dPrice').textContent = gbp(p.price);
  $('#dFits').textContent = p.fits; $('#dCond').textContent = p.cond; $('#dWhen').textContent = p.when;
  drawer.classList.remove('is-done'); $('#dDone').textContent = '';
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  document.body.style.overflow = 'hidden';
  $('#dBuy').focus();
}
function closeDrawer() {
  drawer.classList.remove('is-open'); document.body.style.overflow = '';
  setTimeout(() => { drawer.hidden = true; lastFocus?.focus(); }, reduceMotion ? 0 : 380);
}
$$('[data-close]', drawer).forEach(el => el.addEventListener('click', closeDrawer));
addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
$('#dBuy').addEventListener('click', () => { $('#dDone').textContent = 'Reserved until this time tomorrow. @danbrookes has been told, and nobody else can buy it while you decide.'; drawer.classList.add('is-done'); });
$$('[data-open]').forEach(b => b.addEventListener('click', () => openDrawer(b.dataset.open)));

/* ------------------------------------------------------------------ start form, menu, reveal */
$('#startForm').addEventListener('submit', e => {
  e.preventDefault();
  const b = $('#startBtn'); const car = $('#sCar').value.trim();
  b.textContent = car ? `Garage opened for the ${car.replace(/^\d{4}\s/, '')}.` : 'Garage opened.';
  b.disabled = true; setTimeout(() => { b.textContent = 'Open the garage'; b.disabled = false; }, 2600);
});
const menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') === 'true';
  menuBtn.setAttribute('aria-expanded', String(!open));
  const links = $('.nav__links');
  if (open) links.removeAttribute('style');
  else links.style.cssText = 'display:flex;position:fixed;top:60px;left:0;right:0;flex-direction:column;gap:0;padding:12px var(--gutter) 20px;background:var(--paper);border-bottom:1px solid var(--line);';
});
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach(el => io.observe(el));
setTimeout(() => $$('.reveal').forEach(el => el.classList.add('is-in')), 1600);
