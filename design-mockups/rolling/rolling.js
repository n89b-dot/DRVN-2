/* ROLLING — the rolling shot: velocity-driven background streak, sharp car, real 3D wheels spinning at speed. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const gbp = n => '£' + n.toLocaleString('en-GB');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;

/* ------------------------------------------------------------------ the shot */
const hero = $('#hero'), canvas = $('#shot'), mphEl = $('#mph');
const PLATES = { mountain: '../assets/rolling-road-mountain.png', industrial: '../assets/rolling-road-industrial.png', coast: '../assets/rolling-road-coast.png' };
const PLATE_ASPECT = 2688 / 1152;
const CAR_ASPECT = 2688 / 1520;
/* wheel centres on the Supra cutout, as fractions of its width/height */
const WHEELS = [{ x: 0.219, y: 0.594 }, { x: 0.766, y: 0.594 }];
const WHEEL_D = 0.152;

function buildShot() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (e) { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  hero.classList.add('is-webgl');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-3, 5, 6); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.6));

  const loader = new THREE.TextureLoader();
  const plateTex = file => { const t = loader.load(file); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.MirroredRepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; return t; };
  const plates = Object.fromEntries(Object.entries(PLATES).map(([k, f]) => [k, plateTex(f)]));

  /* background: the world, streaked by speed */
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: plates.mountain }, uB: { value: plates.mountain }, uMix: { value: 0 }, uOffset: { value: 0 }, uBlur: { value: 0 }, uCover: { value: new THREE.Vector4(1, 1, 0, 0) }, uBob: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uA, uB; uniform float uMix, uOffset, uBlur, uBob; uniform vec4 uCover; varying vec2 vUv;
      vec3 plate(vec2 uv){ return mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMix); }
      void main(){
        vec2 uv = vUv * uCover.xy + uCover.zw;
        uv.x += uOffset; uv.y += uBob;
        /* directional blur along the road; the near ground streaks more than the far hills */
        float near = smoothstep(0.55, 0.0, vUv.y);
        float b = uBlur * (0.35 + 0.65 * near);
        vec3 c = vec3(0.0);
        const int N = 14;
        for (int i = 0; i < N; i++){
          float t = (float(i) / float(N - 1) - 0.5);
          c += plate(uv + vec2(t * b, 0.0));
        }
        c /= float(N);
        /* speed washes the colour out slightly, like a pan at 1/30 */
        c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), uBlur * 2.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
  bg.position.z = -2; scene.add(bg);

  /* the car: sharp, on a contact shadow */
  const carTex = loader.load('../assets/teardown-cut-car.png'); carTex.colorSpace = THREE.SRGBColorSpace; carTex.anisotropy = 8;
  const car = new THREE.Group(); scene.add(car);
  const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / CAR_ASPECT), new THREE.MeshBasicMaterial({ map: carTex, transparent: true, depthWrite: false }));
  body.renderOrder = 1; car.add(body);
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 64;
  const g = sc.getContext('2d'); const gr = g.createRadialGradient(128, 32, 4, 128, 32, 120);
  gr.addColorStop(0, 'rgba(17,19,22,0.7)'); gr.addColorStop(0.6, 'rgba(17,19,22,0.25)'); gr.addColorStop(1, 'rgba(17,19,22,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.position.set(0, -0.5 / CAR_ASPECT + 0.02, -0.01); shadow.renderOrder = 0; car.add(shadow);

  /* the wheels: the real mesh, twice, spinning at road speed */
  const wheelPivots = WHEELS.map(w => { const p = new THREE.Group(); p.position.set(w.x - 0.5, (0.5 - w.y) / CAR_ASPECT, 0.12); car.add(p); return p; });
  let wheelReady = false, wheelR = WHEEL_D / 2;
  new GLTFLoader().load('../assets/teardown-wheel.glb', gltf => {
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    src.position.sub(center);
    /* the axle is the thin axis; turn it to face the camera (world z) */
    const axis = size.x < size.y && size.x < size.z ? 'x' : size.y < size.z ? 'y' : 'z';
    const dia = Math.max(size.x, size.y, size.z);
    wheelPivots.forEach(p => {
      const m = src.clone(true);
      const holder = new THREE.Group();
      if (axis === 'x') holder.rotation.y = Math.PI / 2;
      if (axis === 'y') holder.rotation.x = Math.PI / 2;
      holder.add(m);
      holder.scale.setScalar((WHEEL_D * 1.04) / dia);
      p.add(holder);
    });
    wheelReady = true;
  }, undefined, err => console.warn('Wheel model failed to load; the cutout wheels stay.', err));

  /* fit everything to the viewport */
  let visW = 1, visH = 1, carW = 1;
  const resize = () => {
    const w = hero.clientWidth, h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z - bg.position.z);
    visW = visH * camera.aspect;
    bg.scale.set(visW, visH, 1);
    const aspect = w / h;
    if (aspect > PLATE_ASPECT) { const s = PLATE_ASPECT / aspect; bgMat.uniforms.uCover.value.set(1, s, 0, (1 - s) / 2); }
    else { const s = aspect / PLATE_ASPECT; bgMat.uniforms.uCover.value.set(s, 1, (1 - s) / 2, 0); }
    /* the car sits low in frame, around 62% of the width on wide screens */
    const visHc = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const visWc = visHc * camera.aspect;
    carW = Math.min(visWc * 0.64, visHc * 1.3);
    car.scale.setScalar(carW);
    car.position.set(visWc * 0.02, -visHc * 0.16, 0);
    wheelR = (WHEEL_D * 1.04) / 2 * carW;
  };
  new ResizeObserver(resize).observe(hero); resize();

  /* speed model: idle cruise plus whatever the scroll gives it */
  const IDLE = reduceMotion ? 0 : 1.15;        /* world units per second */
  let lastY = scrollY, vel = 0, speed = IDLE, dist = 0, lastT = performance.now();
  let mix = 0, mixT = 0, from = 'mountain', to = 'mountain';
  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(hero);

  const frame = now => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    if (!visible) return;
    const dy = scrollY - lastY; lastY = scrollY;
    vel = lerp(vel, Math.abs(dy) / Math.max(dt, 1e-3), 0.12);          /* px per second, smoothed */
    const target = IDLE + (reduceMotion ? 0 : vel * 0.0045);
    speed = lerp(speed, target, 0.08);
    dist += speed * dt;
    const plateUnits = visW;                                           /* one plate width = visW world units */
    bgMat.uniforms.uOffset.value = (dist / plateUnits) * bgMat.uniforms.uCover.value.x;
    bgMat.uniforms.uBlur.value = reduceMotion ? 0 : clamp((speed - IDLE * 0.6) * 0.016, 0.004, 0.16);
    bgMat.uniforms.uBob.value = reduceMotion ? 0 : Math.sin(now / 240) * 0.0015 * speed;
    /* the car breathes with the road and squats under throttle */
    const sq = reduceMotion ? 0 : clamp((speed - IDLE) * 0.02, 0, 0.06);
    car.rotation.z = -sq * 0.35;
    body.position.y = reduceMotion ? 0 : Math.sin(now / 150) * 0.0012 * speed;
    /* wheels */
    if (wheelReady) { const dTheta = (speed * dt) / wheelR; wheelPivots.forEach(p => p.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -dTheta)); }
    /* plate crossfade */
    if (mixT > 0) { mix = Math.min(1, mix + dt / 0.9); bgMat.uniforms.uMix.value = mix; if (mix >= 1) { mixT = 0; bgMat.uniforms.uA.value = plates[to]; bgMat.uniforms.uMix.value = 0; from = to; } }
    /* speedo: idle cruise reads about 30, scrolling flat out past 100 */
    const mph = Math.round(28 + (speed - IDLE) * 22);
    if (mphEl.textContent !== String(mph)) mphEl.textContent = mph;
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);

  return {
    setPlate: key => { if (key === to) return; from = to; to = key; bgMat.uniforms.uA.value = plates[from]; bgMat.uniforms.uB.value = plates[to]; mix = 0; mixT = 1; },
  };
}
let shot = null;
try { shot = buildShot(); } catch (e) { console.warn('Rolling shot unavailable; static fallback shown.', e); }
$$('.plates button').forEach(b => b.addEventListener('click', () => {
  $$('.plates button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  shot?.setPlate(b.dataset.plate);
}));

/* ------------------------------------------------------------------ driven this week */
const CARS = [
  { car: '1999 Nissan Skyline GT-R R34', who: '@teovas', img: '../assets/flake-car-purple.png', miles: 212, where: 'Snake Pass, Sunday', parts: ['turbo', 'intercooler'] },
  { car: '1998 Subaru Impreza 22B STI', who: '@hollyrigg', img: '../assets/flake-car-blue.png', miles: 486, where: 'Glencoe and back', parts: ['coilover', 'caliper'] },
  { car: '1999 Honda Civic Type R EK9', who: '@mikehuang', img: '../assets/flake-car-white.png', miles: 94, where: 'Cat and Fiddle, twice', parts: ['seat', 'steering', 'exhaust'] },
];
$('#drivenGrid').innerHTML = CARS.map(c => `
  <a class="car" href="#parts" aria-label="${c.car}, ${c.miles} miles this week">
    <span class="car__img"><img src="${c.img}" alt="" loading="lazy"></span>
    <span class="car__body">
      <span><b>${c.car}</b><br><span>${c.who} · ${c.where}</span></span>
      <span class="car__miles"><b class="num">${c.miles}</b>miles this week</span>
      <span class="car__parts">${c.parts.map(p => `<span><img src="../assets/teardown-cut-${p}.png" alt="" loading="lazy"></span>`).join('')}<span style="width:auto;height:auto;background:none">${c.parts.length} for sale</span></span>
    </span>
  </a>`).join('');

/* ------------------------------------------------------------------ parts rail */
const PARTS = [
  { id: 'exhaust', name: 'HKS Hi-Power titanium muffler', price: 560, car: 'the Supra', fits: 'Supra A80, cat-back', cond: 'Used, blue tips intact', miles: '6,200', ships: 'Leeds, UK' },
  { id: 'wheel', name: 'Volk TE37 18×10, set of four', price: 2800, car: 'the Supra', fits: 'Supra A80, 5×114.3', cond: 'Used, two light kerb marks', miles: '9,800', ships: 'Leeds, UK' },
  { id: 'turbo', name: 'Garrett G30-770 turbo', price: 1150, car: 'the R34', fits: 'RB26DETT, T3 flange', cond: 'Used', miles: '4,000', ships: 'Leeds, UK' },
  { id: 'coilover', name: 'Bilstein B16 coilovers, set', price: 1080, car: 'the 22B', fits: 'GC8 Impreza', cond: 'Used, rebuilt', miles: '11,500', ships: 'Stirling, UK' },
  { id: 'seat', name: 'Recaro SR3 seat, driver', price: 780, car: 'the EK9', fits: 'EK9 with Bride rails', cond: 'Used, no tears', miles: '14,000', ships: 'Manchester, UK' },
  { id: 'caliper', name: 'AP Racing CP5555 6-pot kit', price: 2150, car: 'the 22B', fits: 'GC8, 18 inch minimum', cond: 'Used, 60% pads', miles: '3,100', ships: 'Stirling, UK' },
  { id: 'intercooler', name: 'GReddy 24-row intercooler', price: 410, car: 'the R34', fits: 'R34 GT-R, OEM crash bar', cond: 'Used, fins straight', miles: '7,700', ships: 'Leeds, UK' },
];
$('#rail').innerHTML = PARTS.map(p => `
  <button class="part" data-id="${p.id}" aria-label="${p.name}, ${gbp(p.price)}">
    <span class="part__img"><img src="../assets/teardown-cut-${p.id}.png" alt="" loading="lazy"></span>
    <span class="part__body"><b>${p.name}</b><span>off ${p.car} · ${p.miles} miles</span><span class="part__price num">${gbp(p.price)}</span></span>
  </button>`).join('');
$$('.part').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.id)));

/* ------------------------------------------------------------------ sheet */
const sheet = $('#sheet');
let lastFocus = null;
function openSheet(id) {
  const p = PARTS.find(x => x.id === id); if (!p) return;
  lastFocus = document.activeElement;
  $('#shImg').src = `../assets/teardown-cut-${p.id}.png`; $('#shImg').alt = p.name;
  $('#shTitle').textContent = p.name; $('#shPrice').textContent = gbp(p.price);
  $('#shFits').textContent = p.fits; $('#shCond').textContent = p.cond; $('#shMiles').textContent = p.miles; $('#shShips').textContent = p.ships;
  $('#shOff').textContent = `Off ${p.car}`; $('#shDone').textContent = ''; sheet.classList.remove('is-done');
  sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add('is-open'));
  document.body.style.overflow = 'hidden'; $('#shBuy').focus();
}
function closeSheet() { sheet.classList.remove('is-open'); document.body.style.overflow = ''; setTimeout(() => { sheet.hidden = true; lastFocus?.focus(); }, reduceMotion ? 0 : 380); }
$$('[data-close]', sheet).forEach(el => el.addEventListener('click', closeSheet));
addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
$('#shBuy').addEventListener('click', () => { $('#shDone').textContent = 'Bought. The seller has been told, and you will hear the moment it ships.'; sheet.classList.add('is-done'); });

/* ------------------------------------------------------------------ sell, nav, reveal */
$('#sellForm').addEventListener('submit', e => {
  e.preventDefault();
  const car = $('#sCar').value.trim(), part = $('#sPart').value.trim();
  $('#sellDone').textContent = `Listed${part ? `: ${part}` : ''}${car ? `, off the ${car.replace(/^\d{4}\s/, '')}` : ''}. Followers of the car have been told. Go for a drive.`;
  $('#sellDone').classList.add('is-on');
});
const nav = $('#nav');
new IntersectionObserver(([en]) => nav.classList.toggle('is-light', !en.isIntersecting), { rootMargin: '-60px 0px 0px 0px' }).observe(hero);
const menuBtn = $('#menuBtn');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') === 'true';
  menuBtn.setAttribute('aria-expanded', String(!open));
  const links = $('.nav__links');
  if (open) links.removeAttribute('style');
  else links.style.cssText = 'display:flex;position:fixed;top:60px;left:0;right:0;flex-direction:column;gap:0;padding:12px var(--gutter) 20px;background:var(--sky);color:var(--tarmac);border-bottom:1px solid var(--line);';
});
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach(el => io.observe(el));
setTimeout(() => $$('.reveal').forEach(el => el.classList.add('is-in')), 1600);
