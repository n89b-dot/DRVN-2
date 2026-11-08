/* DRVN — Concept 19 · One Question
   The particle car. 48,000 points per car, prebuilt from real models.
   Morphs run on the GPU: each point travels from its current position to its
   place in the next car along a curl-field-bent path, staggered nose-to-tail so
   the new car is drawn rather than swapped. Falls back to a 2D canvas
   projection of the same points when WebGL is unavailable. */
import * as THREE from 'three';

const OQ = window.OQ;
const N = 48000;
const KEYS = ['rx7', 'e46', 'ek9', '964'];
const MORPH_MS = 1400;
const STAGGER = 0.55;
const AMP = 0.42;
const YAW = 0.78;          // 3/4 front: nose (−X) swung toward the camera
const ELEV = 0.24;        // camera a little above the beltline
const FOV = 26;

const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* The curl-style flow field. GLSL and JS versions must stay identical so a
   morph can be interrupted mid-flight without a jump. */
const FIELD_GLSL = /* glsl */`
vec3 field(vec3 p, float s) {
  vec3 q = p + 0.45 * sin(p.zxy * 1.7 + s);
  float k1 = 1.0; float k2 = 2.3; float n = 1.0 / (k1 + 0.5 * k2);
  return vec3(
    0.5 * k2 * cos(q.y * k2 + 0.7 * s) - k1 * cos(q.z * k1 + 1.1 * s),
    0.5 * k2 * cos(q.z * k2 + 1.3 * s) - k1 * cos(q.x * k1 + 0.9 * s),
    0.5 * k2 * cos(q.x * k2 + 1.7 * s) - k1 * cos(q.y * k1 + s)
  ) * n;
}`;
function fieldJS(x, y, z, s, out) {
  const qx = x + 0.45 * Math.sin(z * 1.7 + s);
  const qy = y + 0.45 * Math.sin(x * 1.7 + s);
  const qz = z + 0.45 * Math.sin(y * 1.7 + s);
  const k1 = 1.0, k2 = 2.3, n = 1 / (k1 + 0.5 * k2);
  out[0] = (0.5 * k2 * Math.cos(qy * k2 + 0.7 * s) - k1 * Math.cos(qz * k1 + 1.1 * s)) * n;
  out[1] = (0.5 * k2 * Math.cos(qz * k2 + 1.3 * s) - k1 * Math.cos(qx * k1 + 0.9 * s)) * n;
  out[2] = (0.5 * k2 * Math.cos(qx * k2 + 1.7 * s) - k1 * Math.cos(qy * k1 + s)) * n;
}

const VERT = /* glsl */`
uniform float uProgress;
uniform float uTime;
uniform float uSeed;
uniform float uAmp;
uniform float uStagger;
uniform float uLoose;
uniform float uFlare;
uniform float uKick;
uniform float uSize;
uniform float uPR;
uniform float uOpacity;
uniform float uNear;
uniform float uFar;
uniform float uGlow;
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec4 aRand;
attribute float aOrder;
varying float vAlpha;
${FIELD_GLSL}
float easeIO(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
void main() {
  float lt = clamp(uProgress * (1.0 + uStagger) - aOrder * uStagger, 0.0, 1.0);
  float e = easeIO(lt);
  float arc = sin(3.14159265 * e);
  vec3 base = mix(aFrom, aTo, e);
  vec3 p = base * (1.0 + 0.06 * arc) + field(base * 1.6, uSeed) * uAmp * arc;
  float t = uTime;
  p += field(p * 2.2 + vec3(t * 0.06, 0.0, -t * 0.05), 11.3) * 0.006;
  p += field(p * 1.05 + vec3(0.0, t * 0.05, t * 0.03), 3.7) * 0.16 * uLoose;
  vec3 dir = normalize(p + vec3(0.0001, 0.0002, 0.0));
  p += dir * uFlare * (0.18 + aRand.y * 0.85) + field(p * 1.4, 7.1) * uFlare * 0.3;
  p += (aRand.xyz - 0.5) * uKick * 0.022;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  // Approximate surface normal from the car's bounding ellipsoid: rim light + a soft top light.
  vec3 nObj = normalize(base / vec3(1.0, 0.13, 0.27));
  vec3 nView = normalize(normalMatrix * nObj);
  float fres = 1.0 - abs(dot(nView, normalize(-mv.xyz)));
  float light = mix(0.6, 1.65, pow(fres, 1.7)) * (0.82 + 0.4 * max(nObj.y, 0.0));
  light = mix(1.0, light, 1.0 - max(uLoose, uFlare));
  float size = uSize * (0.55 + aRand.y * 0.7) * (1.0 + uFlare * 0.5 + uKick * 0.25 + arc * 0.4);
  size *= mix(1.0, 5.0, uGlow);
  gl_PointSize = max(size * uPR / depth, 1.0);
  float near = smoothstep(uFar, uNear, depth);
  float shimmer = 0.7 + 0.3 * sin(t * 1.7 + aRand.z * 6.2831853);
  vAlpha = uOpacity * light * shimmer * mix(0.2, 1.0, near) * (1.0 + uFlare * 0.8 + uKick * 0.5 + arc * 0.2);
  vAlpha *= mix(1.0, 0.065, uGlow);
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uGlow;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = mix(1.0 - smoothstep(0.1, 0.5, d), pow(1.0 - d * 2.0, 2.0), uGlow);
  gl_FragColor = vec4(uColor, a * vAlpha);
}`;

/* ---------------------------------------------------------- shared data */

const sorted = {};
/* Sort each cloud nose→tail, then around the long axis, so index i lands on a
   similar place in every car: morphs read as one form re-drawing itself. */
async function getCloud(key) {
  if (sorted[key]) return sorted[key];
  const raw = await OQ.cloud(key);
  const k = new Float32Array(N), idx = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    const x = raw[i * 3], y = raw[i * 3 + 1], z = raw[i * 3 + 2];
    const bin = Math.floor((x + 1) * 0.5 * 140);
    const ang = (Math.atan2(z, y) + Math.PI) / (2 * Math.PI);
    k[i] = bin + ang * 0.999;
    idx[i] = i;
  }
  idx.sort((a, b) => k[a] - k[b]);
  const out = new Float32Array(N * 3);
  for (let j = 0; j < N; j++) { const i = idx[j]; out[j * 3] = raw[i * 3]; out[j * 3 + 1] = raw[i * 3 + 1]; out[j * 3 + 2] = raw[i * 3 + 2]; }
  sorted[key] = out;
  return out;
}
function gauss(rnd) { const u = rnd() || 1e-6, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v); }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
/* Unknown car: the last car loosens into a hovering cloud that remembers its mass. */
function makeCloud(base) {
  const out = new Float32Array(N * 3), rnd = seeded(91);
  for (let i = 0; i < N; i++) {
    out[i * 3] = base[i * 3] * 0.72 + gauss(rnd) * 0.26;
    out[i * 3 + 1] = base[i * 3 + 1] * 0.45 + gauss(rnd) * 0.13 + 0.08;
    out[i * 3 + 2] = base[i * 3 + 2] * 0.72 + gauss(rnd) * 0.22;
  }
  return out;
}
function makeDust() {
  const out = new Float32Array(N * 3), rnd = seeded(5);
  for (let i = 0; i < N; i++) {
    out[i * 3] = gauss(rnd) * 1.5; out[i * 3 + 1] = gauss(rnd) * 0.9; out[i * 3 + 2] = gauss(rnd) * 1.2;
  }
  return out;
}
function readFrame(el, attr, fallback) {
  const v = (el.getAttribute(attr) || '').split(',').map(Number);
  return v.length === 3 && v.every((n) => !Number.isNaN(n)) ? v : fallback;
}
function inkColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  return v || 'white';
}

/* ------------------------------------------------------- base controller */

class BaseStage {
  constructor(el) {
    this.el = el;
    this.id = el.dataset.stage;
    this.frame = readFrame(el, 'data-frame', [0.5, 0.5, 0.6]);
    this.frameSm = readFrame(el, 'data-frame-sm', this.frame);
    this.shownKey = null;
    this.token = 0;
    this.idle = false;
    this.cycleI = 0;
    this.looseTarget = 0;
    this.visible = true;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.yaw = YAW; this.pitch = 0;
    this.static = reduceMQ.matches;
    reduceMQ.addEventListener && reduceMQ.addEventListener('change', (e) => { this.static = e.matches; this.wake(); });
  }
  observe() {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; this.wake(); }, { rootMargin: '80px' }).observe(this.el);
    }
    document.addEventListener('visibilitychange', () => this.wake());
    window.addEventListener('pointermove', (e) => {
      this.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
    let rT;
    const ro = () => { clearTimeout(rT); rT = setTimeout(() => { this.resize(); this.paintOnce(); }, 60); };
    if ('ResizeObserver' in window) new ResizeObserver(ro).observe(this.el); else window.addEventListener('resize', ro);
  }
  get running() { return this.visible && !document.hidden && !this.static; }
  wake() {
    if (this.running && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.tick(t)); }
    if (!this.running) this.paintOnce();
  }
  tick(now) {
    this.raf = 0;
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(now, dt);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
  async show(key, opts = {}) {
    const token = ++this.token;
    let target;
    try {
      if (key === 'cloud') {
        const baseKey = this.shownKey && this.shownKey !== 'cloud' ? this.shownKey : 'rx7';
        target = makeCloud(await getCloud(baseKey));
      } else target = await getCloud(key);
    } catch (e) { return; }
    if (token !== this.token) return;
    this.looseTarget = key === 'cloud' ? 1 : 0;
    if (key === this.shownKey && !opts.force) return;
    this.shownKey = key;
    this.retarget(target, !!opts.instant || this.static);
  }
  setIdle(on) {
    if (on === this.idle) return;
    this.idle = on;
    clearTimeout(this.idleT);
    if (!on) return;
    const run = () => {
      const key = KEYS[this.cycleI++ % KEYS.length];
      this.show(key);
      document.dispatchEvent(new CustomEvent('oq:stage-cycle', { detail: { id: this.id, key } }));
      if (!this.static) this.idleT = setTimeout(run, 4600);
    };
    run();
  }
  setLoose(v) { this.looseTarget = v; }
  flare() { if (!this.static) { this.flareT0 = performance.now(); this.wake(); } }
  kick() { if (!this.static) this.kickV = 1; }
  frameNow(w) { return w < 760 ? this.frameSm : this.frame; }
  updatePointer(dt, t) {
    const p = this.pointer;
    p.x += (p.tx - p.x) * Math.min(1, dt * 2.2);
    p.y += (p.ty - p.y) * Math.min(1, dt * 2.2);
    this.yaw = YAW + Math.sin(t * 0.11) * 0.2 + p.x * 0.16;
    this.pitch = p.y * 0.05;
  }
  flareValue(now) {
    if (!this.flareT0) return 0;
    const f = (now - this.flareT0) / 1500;
    if (f >= 1) { this.flareT0 = 0; return 0; }
    return f < 0.22 ? easeOut(f / 0.22) : 1 - easeIO((f - 0.22) / 0.78);
  }
}

/* ------------------------------------------------------------ WebGL stage */

class GLStage extends BaseStage {
  constructor(el, renderer) {
    super(el);
    this.renderer = renderer;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.from = makeDust();
    this.to = this.from.slice();
    this.order = new Float32Array(N);
    const rand = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) rand[i] = Math.random();
    this.rand = rand;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.aFrom = new THREE.BufferAttribute(this.from, 3);
    this.aTo = new THREE.BufferAttribute(this.to, 3);
    this.aOrder = new THREE.BufferAttribute(this.order, 1);
    g.setAttribute('aFrom', this.aFrom);
    g.setAttribute('aTo', this.aTo);
    g.setAttribute('aOrder', this.aOrder);
    g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));

    this.u = {
      uProgress: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 1 }, uAmp: { value: AMP }, uStagger: { value: STAGGER },
      uLoose: { value: 0 }, uFlare: { value: 0 }, uKick: { value: 0 }, uSize: { value: 10 }, uPR: { value: 1 },
      uOpacity: { value: 0.3 }, uNear: { value: 3 }, uFar: { value: 6 }, uColor: { value: new THREE.Color(inkColor()) }, uGlow: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
    });
    // Glow pass: same points, five times larger, a twentieth as bright. Reads as light, not glitter.
    const glowU = Object.assign({}, this.u, { uGlow: { value: 1 } });
    const glowMat = new THREE.ShaderMaterial({
      uniforms: glowU, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending
    });
    this.glow = new THREE.Points(g, glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 0;
    this.group.add(this.glow);
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.group.add(this.points);
    this.kickV = 0;

    renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.visible = false; });
    this.resize();
    this.observe();
    this.wake();
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const [cx, cy, wf] = this.frameNow(w);
    const cam = this.camera;
    cam.aspect = w / h;
    const vh = 2 * Math.tan((FOV * Math.PI) / 360);
    let d = 2.2 / (wf * vh * cam.aspect);
    d = Math.max(d, 1.05 / (0.9 * vh));
    cam.position.set(0, d * Math.sin(ELEV), d * Math.cos(ELEV));
    cam.lookAt(0, 0, 0);
    cam.setViewOffset(w, h, (0.5 - cx) * w, (0.5 - cy) * h, w, h);
    cam.updateProjectionMatrix();
    const carPx = (2.2 / (vh * cam.aspect * d)) * w;
    this.u.uPR.value = pr;
    this.u.uSize.value = clamp(2.0 * Math.sqrt(carPx / 720), 1.3, 2.5) * d;
    this.u.uOpacity.value = clamp(0.78 * Math.pow(carPx / 720, 0.85), 0.32, 0.9);
    this.u.uNear.value = d - 0.9;
    this.u.uFar.value = d + 0.9;
  }
  retarget(target, instant) {
    const u = this.u, from = this.from, to = this.to, order = this.order, rand = this.rand;
    if (instant) {
      from.set(target); to.set(target);
      u.uProgress.value = 1; this.anim = null;
    } else {
      const P = u.uProgress.value;
      if (P < 1) {
        const S = u.uStagger.value, amp = u.uAmp.value, seed = u.uSeed.value, f = [0, 0, 0];
        for (let i = 0; i < N; i++) {
          const lt = clamp(P * (1 + S) - order[i] * S, 0, 1);
          const e = easeIO(lt), arc = Math.sin(Math.PI * e), j = i * 3;
          const bx = from[j] + (to[j] - from[j]) * e, by = from[j + 1] + (to[j + 1] - from[j + 1]) * e, bz = from[j + 2] + (to[j + 2] - from[j + 2]) * e;
          fieldJS(bx * 1.6, by * 1.6, bz * 1.6, seed, f);
          from[j] = bx * (1 + 0.06 * arc) + f[0] * amp * arc;
          from[j + 1] = by * (1 + 0.06 * arc) + f[1] * amp * arc;
          from[j + 2] = bz * (1 + 0.06 * arc) + f[2] * amp * arc;
        }
      } else from.set(to);
      to.set(target);
      u.uSeed.value = Math.random() * 20;
      u.uProgress.value = 0;
      this.anim = { start: performance.now() };
    }
    for (let i = 0; i < N; i++) order[i] = clamp(0.62 * ((to[i * 3] + 1) * 0.5) + 0.38 * rand[i * 4], 0, 1);
    this.aFrom.needsUpdate = true; this.aTo.needsUpdate = true; this.aOrder.needsUpdate = true;
    this.wake();
    this.paintOnce();
  }
  step(now, dt) {
    const u = this.u;
    if (this.anim) {
      const k = clamp((now - this.anim.start) / MORPH_MS, 0, 1);
      u.uProgress.value = k;
      if (k >= 1) this.anim = null;
    }
    u.uLoose.value += (this.looseTarget - u.uLoose.value) * Math.min(1, dt * 2.4);
    u.uFlare.value = this.flareValue(now);
    this.kickV *= Math.exp(-dt * 7);
    u.uKick.value = this.kickV;
    u.uTime.value += dt;
    this.updatePointer(dt, u.uTime.value);
    this.render();
  }
  render() {
    this.group.rotation.set(this.pitch, this.yaw, 0);
    this.group.position.y = this.static ? 0 : Math.sin(this.u.uTime.value * 0.6) * 0.012;
    this.renderer.render(this.scene, this.camera);
  }
  paintOnce() {
    if (this.running) return;
    if (this.static) { this.u.uProgress.value = 1; this.u.uFlare.value = 0; this.u.uKick.value = 0; this.u.uLoose.value = this.looseTarget; }
    this.yaw = YAW; this.pitch = 0;
    this.render();
  }
}

/* ------------------------------------------------- 2D canvas fallback stage */

class CanvasStage extends BaseStage {
  constructor(el) {
    super(el);
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.M = 16000; // every third point
    this.from = new Float32Array(this.M * 3);
    this.to = new Float32Array(this.M * 3);
    this.order = new Float32Array(this.M);
    this.rand = new Float32Array(this.M);
    const dust = makeDust();
    for (let i = 0; i < this.M; i++) { this.rand[i] = Math.random(); for (let c = 0; c < 3; c++) { this.from[i * 3 + c] = dust[i * 9 + c]; this.to[i * 3 + c] = dust[i * 9 + c]; } }
    this.P = 1; this.loose = 0; this.time = 0; this.kickV = 0;
    this.color = inkColor();
    this.resize();
    this.observe();
    this.wake();
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * pr); this.canvas.height = Math.round(h * pr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx.setTransform(pr, 0, 0, pr, 0, 0);
    this.w = w; this.h = h;
  }
  pos(i, e, out) {
    const j = i * 3, f = this.from, t = this.to;
    out[0] = f[j] + (t[j] - f[j]) * e; out[1] = f[j + 1] + (t[j + 1] - f[j + 1]) * e; out[2] = f[j + 2] + (t[j + 2] - f[j + 2]) * e;
  }
  retarget(target, instant) {
    const M = this.M, tmp = [0, 0, 0];
    if (!instant && this.P < 1) {
      for (let i = 0; i < M; i++) { const e = easeIO(clamp(this.P * (1 + STAGGER) - this.order[i] * STAGGER, 0, 1)); this.pos(i, e, tmp); this.from.set(tmp, i * 3); }
    } else if (!instant) this.from.set(this.to);
    for (let i = 0; i < M; i++) { for (let c = 0; c < 3; c++) this.to[i * 3 + c] = target[i * 9 + c]; }
    if (instant) { this.from.set(this.to); this.P = 1; this.anim = null; } else { this.P = 0; this.anim = { start: performance.now() }; }
    for (let i = 0; i < M; i++) this.order[i] = clamp(0.62 * ((this.to[i * 3] + 1) * 0.5) + 0.38 * this.rand[i], 0, 1);
    this.wake(); this.paintOnce();
  }
  step(now, dt) {
    if (this.anim) { this.P = clamp((now - this.anim.start) / MORPH_MS, 0, 1); if (this.P >= 1) this.anim = null; }
    this.loose += (this.looseTarget - this.loose) * Math.min(1, dt * 2.4);
    this.time += dt;
    this.kickV *= Math.exp(-dt * 7);
    this.updatePointer(dt, this.time);
    this.draw(this.flareValue(now));
  }
  draw(flare) {
    const { ctx, w, h, M } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const [cx, cy, wf] = this.frameNow(w);
    const scale = (wf * w) / 2.2;
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw), ce = Math.cos(ELEV + this.pitch), se = Math.sin(ELEV + this.pitch);
    const dist = 5.2, tmp = [0, 0, 0];
    ctx.fillStyle = this.color;
    ctx.globalCompositeOperation = 'lighter';
    const alpha = clamp(0.32 * Math.pow((wf * w) / 720, 0.8), 0.14, 0.42);
    const t = this.time;
    for (let i = 0; i < M; i++) {
      const e = easeIO(clamp(this.P * (1 + STAGGER) - this.order[i] * STAGGER, 0, 1));
      this.pos(i, e, tmp);
      let [x, y, z] = tmp;
      const arc = Math.sin(Math.PI * e);
      x += Math.sin(i * 1.7 + e * 6) * 0.25 * arc; y += Math.cos(i * 2.3 + e * 5) * 0.12 * arc;
      if (this.loose > 0.01) { x += Math.sin(t * 0.5 + i) * 0.08 * this.loose; y += Math.cos(t * 0.4 + i * 1.3) * 0.06 * this.loose; }
      if (flare > 0) { const l = Math.hypot(x, y, z) || 1; const k = flare * (0.25 + this.rand[i] * 1.3); x += (x / l) * k; y += (y / l) * k; z += (z / l) * k; }
      const xr = x * cs + z * sn, zr = -x * sn + z * cs;
      const yr = y * ce - zr * se, zz = y * se + zr * ce;
      const persp = dist / (dist - zz);
      const px = cx * w + xr * scale * persp, py = cy * h - yr * scale * persp;
      ctx.globalAlpha = alpha * (0.45 + 0.55 * clamp((zz + 1) / 2, 0, 1)) * (1 + flare);
      const s = 1.3 * persp;
      ctx.fillRect(px, py, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  paintOnce() {
    if (this.running) return;
    if (this.static) this.P = 1;
    this.yaw = YAW; this.pitch = 0;
    this.draw(0);
  }
}

/* ------------------------------------------------------------------ boot */

function createRenderer() {
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    return new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', premultipliedAlpha: true });
  } catch (e) {
    return null;
  }
}

document.querySelectorAll('[data-stage]').forEach((el) => {
  let stage = null;
  const renderer = createRenderer();
  if (renderer) { try { stage = new GLStage(el, renderer); } catch (e) { stage = null; } }
  if (!stage) stage = new CanvasStage(el);
  el.dataset.renderer = stage instanceof GLStage ? 'webgl' : 'canvas';
  OQ.registerStage(el.dataset.stage, stage);
});
