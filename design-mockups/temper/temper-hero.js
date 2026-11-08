/* Temper — hero showpiece.
   A procedurally modelled titanium exhaust: a double-wall rolled-lip tip (LatheGeometry)
   welded to a mid-pipe (TubeGeometry along a CatmullRomCurve3), with a stacked-dime weld bead.
   The material is a custom shader: brushed titanium lit by a procedural studio, coloured
   only by thin-film interference in the oxide layer. Oxide thickness comes from a heat field:
   a weld-hot base gradient, a cursor torch that spreads and cools, and scroll. The thin-film
   function and constants are the same ones temper.js uses for the DOM afterglow. */
import * as THREE from "three";

const T = window.Temper;
const hero = document.querySelector("[data-hero]");
const canvas = hero && hero.querySelector(".hero__canvas");

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

if (hero && canvas && T && webglAvailable()) {
  try { start(); } catch (e) { hero.classList.remove("is-live"); }
}

function start() {
  const reduced = T.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  let failed = false;
  renderer.debug.onShaderError = () => { failed = true; };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  const CAM_Z = 9.2;
  camera.position.set(0, 0.25, CAM_Z);

  /* ---------------- geometry ---------------- */
  const R_OUT = 0.66, R_IN = 0.58, R_GAS = 0.47, LIP_Y = 1.86, LIP_R = (R_OUT - R_IN) / 2;

  // Profile with rounded corners, sampled densely so lathe normals stay true.
  function rounded(points, radius, steps) {
    const out = [points[0].clone()];
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], a = points[i - 1], b = points[i + 1];
      const da = a.clone().sub(p), db = b.clone().sub(p);
      const ra = Math.min(radius, da.length() / 2), rb = Math.min(radius, db.length() / 2);
      const p0 = p.clone().add(da.normalize().multiplyScalar(ra));
      const p1 = p.clone().add(db.normalize().multiplyScalar(rb));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, u = 1 - t;
        out.push(new THREE.Vector2(u * u * p0.x + 2 * u * t * p.x + t * t * p1.x, u * u * p0.y + 2 * u * t * p.y + t * t * p1.y));
      }
    }
    out.push(points[points.length - 1].clone());
    return out;
  }
  function densify(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
      for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
    }
    return out;
  }
  function tipProfile() {
    const V = (x, y) => new THREE.Vector2(x, y);
    const inner = rounded([V(R_GAS, -0.75), V(R_GAS, 0.3), V(R_IN, 0.56), V(R_IN, LIP_Y)], 0.07, 8);
    const lip = [];
    for (let k = 1; k < 18; k++) {
      const a = Math.PI - (k / 18) * Math.PI;
      lip.push(V(R_OUT - LIP_R + Math.cos(a) * LIP_R, LIP_Y + Math.sin(a) * LIP_R));
    }
    const outer = rounded([V(R_OUT, LIP_Y), V(R_OUT, 0.58), V(0.535, 0.22), V(0.528, 0.0), V(0.505, -0.03)], 0.08, 8);
    return densify(inner.concat(lip, outer), 0.035);
  }

  function withAttributes(geo, fn) {
    const pos = geo.attributes.position, uv = geo.attributes.uv, n = pos.count;
    const aS = new Float32Array(n), aPhi = new Float32Array(n), aInner = new Float32Array(n), aTan = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      const r = fn(v, uv.getX(i), uv.getY(i));
      aS[i] = r.s; aPhi[i] = r.phi; aInner[i] = r.inner;
      aTan[i * 3] = r.tan.x; aTan[i * 3 + 1] = r.tan.y; aTan[i * 3 + 2] = r.tan.z;
    }
    geo.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
    geo.setAttribute("aPhi", new THREE.BufferAttribute(aPhi, 1));
    geo.setAttribute("aInner", new THREE.BufferAttribute(aInner, 1));
    geo.setAttribute("aTan", new THREE.BufferAttribute(aTan, 3));
    return geo;
  }
  const UP = new THREE.Vector3(0, 1, 0);
  const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  function tipGeometry(segments) {
    const g = new THREE.LatheGeometry(tipProfile(), segments);
    return withAttributes(g, (v, u) => ({ s: v.y, phi: u, inner: sstep(0.62, 0.59, Math.hypot(v.x, v.z)), tan: UP }));
  }

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0, -1.4, 0),
    new THREE.Vector3(0.02, -2.3, -0.08), new THREE.Vector3(0.1, -3.3, -0.32), new THREE.Vector3(0.24, -4.4, -0.75),
    new THREE.Vector3(0.4, -5.6, -1.35), new THREE.Vector3(0.55, -7.2, -2.1), new THREE.Vector3(0.7, -9.5, -3.0)
  ], false, "centripetal");
  const pipeLen = curve.getLength();
  function pipeGeometry(tubular, radial) {
    const g = new THREE.TubeGeometry(curve, tubular, 0.5, radial, false);
    const tans = [];
    for (let i = 0; i <= tubular; i++) tans.push(curve.getTangentAt(i / tubular).negate());
    return withAttributes(g, (v, u, w) => ({ s: -u * pipeLen, phi: w, inner: 0, tan: tans[Math.round(u * tubular)] }));
  }

  function beadGeometry(tubular) {
    const R = 0.516, r = 0.046;
    const g = new THREE.TorusGeometry(R, r, 20, tubular);
    g.rotateX(Math.PI / 2);
    const pos = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const th = Math.atan2(v.z, v.x);
      c.set(Math.cos(th) * R, 0, Math.sin(th) * R);
      const ripple = 1 + 0.11 * Math.pow(0.5 + 0.5 * Math.sin(th * 84 + Math.sin(th * 5.0) * 1.6), 2.0) + 0.06 * Math.sin(th * 7.0 + 1.3) + 0.03 * Math.sin(th * 23.0);
      v.sub(c).multiplyScalar(ripple).add(c);
      v.y *= 0.82;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return withAttributes(g, (vv) => ({ s: 0.0, phi: Math.atan2(vv.z, vv.x) / (Math.PI * 2) + 0.5, inner: 0, tan: UP }));
  }

  /* ---------------- material ---------------- */
  const TORCH_N = 24;
  const torchPos = Array.from({ length: TORCH_N }, () => new THREE.Vector4(0, 0, 0, -100));
  const torchAmp = new Float32Array(TORCH_N);

  const uniforms = {
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uExposure: { value: 1.25 },
    uLam: { value: T.LAMBDA.slice() },
    uN1: { value: T.N1.slice() },
    uN2: { value: T.N2.map((c) => new THREE.Vector2(c[0], c[1])) },
    uW: { value: T.W.map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
    uDRaw: { value: T.D_RAW },
    uDSpan: { value: T.D_SPAN },
    uTorch: { value: torchPos },
    uTorchAmp: { value: torchAmp }
  };

  const vertexShader = /* glsl */ `
    attribute float aS;
    attribute float aPhi;
    attribute float aInner;
    attribute vec3 aTan;
    varying vec3 vWPos;
    varying vec3 vWNrm;
    varying vec3 vWTan;
    varying vec3 vLPos;
    varying float vS;
    varying float vPhi;
    varying float vInner;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWPos = wp.xyz;
      vWNrm = normalize(mat3(modelMatrix) * normal);
      vWTan = normalize(mat3(modelMatrix) * aTan);
      vLPos = position;
      vS = aS; vPhi = aPhi; vInner = aInner;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;

  const fragmentShader = /* glsl */ `
    precision highp float;
    #define PI 3.141592653589793
    #define NL 10
    #define TORCH_N ${TORCH_N}
    uniform float uTime;
    uniform float uScroll;
    uniform float uExposure;
    uniform float uLam[NL];
    uniform float uN1[NL];
    uniform vec2 uN2[NL];
    uniform vec3 uW[NL];
    uniform float uDRaw;
    uniform float uDSpan;
    uniform vec4 uTorch[TORCH_N];
    uniform float uTorchAmp[TORCH_N];
    varying vec3 vWPos;
    varying vec3 vWNrm;
    varying vec3 vWTan;
    varying vec3 vLPos;
    varying float vS;
    varying float vPhi;
    varying float vInner;

    /* --- thin-film interference: air / TiO2 / Ti (mirrors temper.js film()) --- */
    vec2 cdiv(vec2 a, vec2 b) { float d = dot(b, b); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }
    float refl(float r01, vec2 r12, float ph) {
      vec2 e = vec2(cos(ph), sin(ph));
      vec2 t = vec2(r12.x * e.x - r12.y * e.y, r12.x * e.y + r12.y * e.x);
      vec2 num = vec2(r01 + t.x, t.y);
      vec2 den = vec2(1.0 + r01 * t.x, r01 * t.y);
      return dot(num, num) / dot(den, den);
    }
    vec3 thinFilm(float d, float c0) {
      float s2 = 1.0 - c0 * c0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < NL; i++) {
        float n1 = uN1[i];
        vec2 n2 = uN2[i];
        float c1 = sqrt(1.0 - s2 / (n1 * n1));
        float r01s = (c0 - n1 * c1) / (c0 + n1 * c1);
        vec2 r12s = cdiv(vec2(n1 * c1 - n2.x, -n2.y), vec2(n1 * c1 + n2.x, n2.y));
        float r01p = (n1 * c0 - c1) / (n1 * c0 + c1);
        vec2 r12p = cdiv(vec2(n2.x * c1 - n1, n2.y * c1), vec2(n2.x * c1 + n1, n2.y * c1));
        float ph = 4.0 * PI * n1 * d * c1 / uLam[i];
        acc += uW[i] * 0.5 * (refl(r01s, r12s, ph) + refl(r01p, r12p, ph));
      }
      return max(acc, vec3(0.0));
    }

    /* --- noise --- */
    float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise3(vec3 x) {
      vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p *= 2.03; a *= 0.5; } return s; }
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float pnoise(vec2 p, float period) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = hash2(vec2(mod(i.x, period), i.y));
      float b = hash2(vec2(mod(i.x + 1.0, period), i.y));
      float c = hash2(vec2(mod(i.x, period), i.y + 1.0));
      float d = hash2(vec2(mod(i.x + 1.0, period), i.y + 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    /* --- procedural studio: achromatic, so every colour on the metal is oxide --- */
    float soft(float x, float c, float w, float f) { return 1.0 - smoothstep(w, w + f, abs(x - c)); }
    vec3 env(vec3 r) {
      float az = atan(r.x, r.z);
      float el = asin(clamp(r.y, -1.0, 1.0));
      // broad studio dome: soft grey card overhead, falling to black below the horizon
      float L = 0.012 + 0.16 * smoothstep(-0.15, 1.0, r.y) + 0.05 * smoothstep(0.2, -0.9, r.y) * smoothstep(-1.0, -0.4, r.y);
      // large overhead softbox
      L += 1.9 * soft(el, 1.1, 0.22, 0.32) * soft(az, -0.3, 1.2, 0.8);
      // tall key strip, camera-left
      L += 5.5 * soft(az, -1.15, 0.07, 0.05) * soft(el, 0.2, 0.62, 0.12);
      // second, thinner strip for a double highlight
      L += 2.2 * soft(az, -0.62, 0.025, 0.03) * soft(el, 0.15, 0.5, 0.15);
      // rim strip behind, right
      L += 2.6 * soft(az, 2.05, 0.06, 0.07) * soft(el, 0.25, 0.65, 0.2);
      // broad soft fill, right and behind: keeps the weld side of the cone readable
      L += 0.85 * soft(az, 1.45, 0.55, 0.5) * soft(el, 0.15, 0.55, 0.35);
      // low grey card, front-right, lifts the underside
      L += 0.35 * soft(az, 0.55, 0.45, 0.4) * soft(el, -0.18, 0.16, 0.2);
      return vec3(L);
    }

    /* --- heat field --- */
    float heatField() {
      float s = vS;
      float h = s >= 0.0 ? 1.08 * exp(-s * 1.45) : 1.04 * exp(s * 1.3) + 0.22 * smoothstep(-2.0, -5.5, s);
      h += vInner * 0.34 * smoothstep(1.9, 0.4, s);
      h += 0.16 * exp(-s * s * 55.0);
      h += (fbm(vLPos * 2.4 + 3.1) - 0.5) * 0.2 * smoothstep(1.6, 0.2, abs(s));
      float torch = 0.0;
      for (int i = 0; i < TORCH_N; i++) {
        float amp = uTorchAmp[i];
        if (amp <= 0.0) continue;
        float age = uTime - uTorch[i].w;
        if (age < 0.0) continue;
        float sig = 0.11 + 0.2 * sqrt(age);
        vec3 dv = vLPos - uTorch[i].xyz;
        float g = exp(-dot(dv, dv) / (2.0 * sig * sig));
        torch += amp * (exp(-age / 1.05) + 0.14 * exp(-age / 9.0)) * g;
      }
      h += min(torch, 1.1) + uScroll * 0.38;
      return clamp(h, 0.0, 1.25);
    }

    void main() {
      vec3 N = normalize(vWNrm);
      float inner = vInner;
      if (!gl_FrontFacing) { N = -N; inner = 1.0; }
      vec3 V = normalize(cameraPosition - vWPos);
      vec3 Ta = normalize(vWTan - N * dot(N, vWTan));
      vec3 Tc = normalize(cross(N, Ta));

      // brushed: fine streaks running along the pipe's axis, faded where they would alias
      float P1 = 260.0, P2 = 900.0;
      float aa1 = clamp(1.0 - fwidth(vPhi * P1) * 0.9, 0.0, 1.0);
      float aa2 = clamp(1.0 - fwidth(vPhi * P2) * 0.9, 0.0, 1.0);
      float streak = 0.5 + (pnoise(vec2(vPhi * P1, vS * 1.6), P1) - 0.5) * 0.6 * aa1
                         + (pnoise(vec2(vPhi * P2, vS * 5.0), P2) - 0.5) * 0.4 * aa2;
      vec3 wav = vec3(fbm(vLPos * 3.3), fbm(vLPos * 3.3 + 7.1), fbm(vLPos * 3.3 + 13.7)) - 0.5;
      vec3 Nb = normalize(N + Tc * (streak - 0.5) * 0.16 + wav * 0.05);

      float h = heatField();
      float d = uDRaw + uDSpan * pow(h, 0.9);
      float cosT = clamp(dot(Nb, V), 0.03, 1.0);
      vec3 F = thinFilm(d, cosT) * (0.78 + 0.44 * streak);

      // anisotropic reflection: highlights stretch across the brushing
      vec3 R = reflect(-V, Nb);
      vec3 spec = vec3(0.0); float ws = 0.0;
      for (int k = -3; k <= 3; k++) {
        float fk = float(k);
        float w = exp(-fk * fk * 0.28);
        spec += env(normalize(R + Tc * fk * 0.07 + Ta * fk * 0.012)) * w;
        ws += w;
      }
      spec /= ws;
      vec3 amb = vec3(0.025 + 0.05 * smoothstep(-0.3, 1.0, Nb.y));
      vec3 col = F * (spec + amb);

      // the gas side is dark and sooty; occlusion deepens away from the opening
      float depth = pow(smoothstep(-0.4, 1.86, vS), 1.7);
      float ao = mix(1.0, 0.025 + 0.975 * depth, inner);
      col *= ao;
      col = mix(col, col * vec3(0.55, 0.52, 0.5), inner * (1.0 - depth) * 0.6);

      col = vec3(1.0) - exp(-col * uExposure);
      gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    }`;

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });

  /* ---------------- scene graph ---------------- */
  const pivot = new THREE.Group();
  const group = new THREE.Group();
  pivot.add(group);
  scene.add(pivot);
  const tip = new THREE.Mesh(tipGeometry(200), material);
  const pipe = new THREE.Mesh(pipeGeometry(220, 140), material);
  const bead = new THREE.Mesh(beadGeometry(480), material);
  group.add(tip, pipe, bead);

  // low-poly twins for raycasting the torch
  const hidden = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const proxies = [new THREE.Mesh(tipGeometry(40), hidden), new THREE.Mesh(pipeGeometry(50, 20), hidden)];
  proxies.forEach((p) => { p.visible = false; group.add(p); });

  // Opening faces camera-left; the pipe runs away back-right. The pivot sits at the tip's centre.
  const facing = new THREE.Vector3(-0.86, -0.24, 0.45).normalize();
  group.quaternion.setFromUnitVectors(UP, facing);
  group.position.copy(new THREE.Vector3(0, 1.05, 0).applyQuaternion(group.quaternion).negate());

  /* ---------------- layout ---------------- */
  let W = 1, H = 1, base = new THREE.Vector3();
  function layout() {
    const r = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
    const halfW = halfH * camera.aspect;
    if (camera.aspect >= 1.05) {
      base.set(halfW * 0.5, -halfH * 0.04, 0);
      pivot.scale.setScalar(Math.min(1.3, Math.max(0.9, camera.aspect / 1.45)));
    } else {
      base.set(halfW * 0.18, halfH * 0.56, 0);
      pivot.scale.setScalar(Math.max(0.46, Math.min(0.75, camera.aspect * 1.05)));
    }
    pivot.position.copy(base);
  }
  layout();

  /* ---------------- torch ---------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerIn = false, pointerDirty = false, lastDeposit = -1, lastPoint = new THREE.Vector3(1e3, 0, 0), torchHead = 0;
  let px = 0, py = 0, lastInteract = -10;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const tmp = new THREE.Vector3();

  function deposit(p, amp, t) {
    torchPos[torchHead].set(p.x, p.y, p.z, t);
    torchAmp[torchHead] = amp;
    torchHead = (torchHead + 1) % TORCH_N;
  }
  function castAt(nx, ny, amp, t, force) {
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    if (!hit) return false;
    hit.object.worldToLocal(tmp.copy(hit.point));
    if (force || t - lastDeposit > 0.05 || tmp.distanceTo(lastPoint) > 0.07) {
      deposit(tmp, amp, t);
      lastDeposit = t;
      lastPoint.copy(tmp);
    }
    return true;
  }
  function toNdc(e) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1];
  }
  if (!reduced) {
    hero.addEventListener("pointermove", (e) => {
      const n = toNdc(e);
      ndc.set(n[0], n[1]);
      px = n[0]; py = n[1];
      pointerIn = true; pointerDirty = true;
    });
    hero.addEventListener("pointerleave", () => { pointerIn = false; px = 0; py = 0; });
    hero.addEventListener("pointerdown", (e) => {
      const n = toNdc(e);
      if (castAt(n[0], n[1], 0.95, now(), true)) lastInteract = now();
    });
  }

  // An unattended torch pass shows the idea before anyone touches it, and again when idle.
  let sweep = null;
  function planSweep(t) {
    pivot.updateMatrixWorld(true);
    const a = new THREE.Vector3(0, 0.35, 0), b = new THREE.Vector3(0, 1.75, 0);
    group.localToWorld(a); group.localToWorld(b);
    a.project(camera); b.project(camera);
    const off = (Math.random() - 0.5) * 0.06;
    sweep = { t0: t, dur: 2.4, ax: a.x, ay: a.y + 0.06 + off, bx: b.x, by: b.y + 0.02 + off };
  }

  /* ---------------- loop ---------------- */
  let running = false, visible = true, onscreen = true, rafId = 0, firstFrame = false;
  let camX = 0, camY = 0.25;
  function frame() {
    rafId = 0;
    const t = now();
    uniforms.uTime.value = t;

    if (!reduced) {
      const heroH = hero.offsetHeight || H;
      const sc = Math.min(1, Math.max(0, window.scrollY / (heroH * 0.85)));
      uniforms.uScroll.value += (sc - uniforms.uScroll.value) * 0.08;

      if (pointerIn && pointerDirty) {
        pointerDirty = false;
        if (castAt(ndc.x, ndc.y, 0.42, t, false)) lastInteract = t;
      }
      if (sweep) {
        const k = (t - sweep.t0) / sweep.dur;
        if (k >= 1) sweep = null;
        else {
          const e = k * k * (3 - 2 * k);
          castAt(sweep.ax + (sweep.bx - sweep.ax) * e, sweep.ay + (sweep.by - sweep.ay) * e + Math.sin(k * Math.PI * 3) * 0.035, 0.4, t, false);
        }
      } else if (t - lastInteract > 9 && t > 3) {
        planSweep(t);
        lastInteract = t;
      }

      pivot.rotation.y = Math.sin(t * 0.13) * 0.2 + px * 0.12 + sc * 0.25;
      pivot.rotation.x = Math.sin(t * 0.09) * 0.05 - py * 0.06;
      pivot.rotation.z = Math.sin(t * 0.07) * 0.02;
      camX += (px * 0.3 - camX) * 0.04;
      camY += (0.25 + py * 0.18 - camY) * 0.04;
      camera.position.set(camX, camY - sc * 0.6, CAM_Z);
      camera.lookAt(camX * 0.4, camY * 0.3 - sc * 0.45, 0);
    } else {
      camera.lookAt(0, 0.08, 0);
    }

    renderer.render(scene, camera);
    if (failed) { stop(); hero.classList.remove("is-live"); return; }
    if (!firstFrame) { firstFrame = true; hero.classList.add("is-live"); if (!reduced) planSweep(t + 0.6); }
    if (running) rafId = requestAnimationFrame(frame);
  }
  function play() {
    if (reduced) { if (!rafId) rafId = requestAnimationFrame(frame); return; }
    if (running || !visible || !onscreen) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  document.addEventListener("visibilitychange", () => {
    visible = document.visibilityState === "visible";
    if (visible) play(); else stop();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onscreen = entries[0].isIntersecting;
      if (onscreen) play(); else stop();
    }, { threshold: 0.01 }).observe(hero);
  }
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { layout(); if (reduced || !running) { rafId = requestAnimationFrame(frame); } }, 120);
  });

  play();
}
