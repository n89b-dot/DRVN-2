/* Temper — DRVN concept 17. Shared engine, data and interactions.
   1. Thin-film oxide model (the same physics the hero shader runs).
   2. Heat engine: elements heat fast on attention and cool slowly (afterglow).
   3. Data: sellers, cars, listings.
   4. Components: nav, cart + checkout drawer, cards, reveals.
   5. Page controllers: index, market, part, garage, sell. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     1. THIN-FILM OXIDE MODEL
     Air / TiO2 film / Ti metal. Reflectance at 10 wavelengths for an oxide
     thickness d (nm), unpolarised average of s and p, view-angle dependent
     optical path 2·n·d·cosθt. Spectral reflectance -> linear sRGB via CIE 1931
     colour-matching functions (Wyman et al. analytic fit), white-balanced.
     ------------------------------------------------------------------ */
  var LAMBDA = [410, 440, 470, 500, 530, 560, 590, 620, 650, 680];
  function g(x, m, s1, s2) { var t = (x - m) / (x < m ? s1 : s2); return Math.exp(-0.5 * t * t); }
  function xBar(l) { return 1.056 * g(l, 599.8, 37.9, 31) + 0.362 * g(l, 442, 16, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2); }
  function yBar(l) { return 0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1); }
  function zBar(l) { return 1.217 * g(l, 437, 11.8, 36) + 0.681 * g(l, 459, 26, 13.8); }

  var W = LAMBDA.map(function (l) {
    var X = xBar(l), Y = yBar(l), Z = zBar(l);
    return [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  });
  (function balance() {
    for (var c = 0; c < 3; c++) {
      var s = 0, i;
      for (i = 0; i < W.length; i++) s += W[i][c];
      for (i = 0; i < W.length; i++) W[i][c] /= s;
    }
  })();
  // TiO2 film index (Cauchy) and Ti metal complex index n + ik, per wavelength.
  var N1 = LAMBDA.map(function (l) { var um = l / 1000; return 2.2 + 0.05 / (um * um); });
  var N2 = LAMBDA.map(function (l) { return [1.75 + ((l - 400) / 300) * 1.15, 2.55 + ((l - 400) / 300) * 0.85]; });

  function cdiv(ar, ai, br, bi) { var d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; }
  function refl(r01, r12, ph) {
    var er = Math.cos(ph), ei = Math.sin(ph);
    var tr = r12[0] * er - r12[1] * ei, ti = r12[0] * ei + r12[1] * er;
    var nr = r01 + tr, dr = 1 + r01 * tr, di = r01 * ti;
    return (nr * nr + ti * ti) / (dr * dr + di * di);
  }
  /** Linear-sRGB reflectance of oxidised titanium. d in nm, c0 = cos(view angle). */
  function film(d, c0) {
    if (c0 === undefined) c0 = 1;
    var s2 = 1 - c0 * c0, out = [0, 0, 0];
    for (var i = 0; i < LAMBDA.length; i++) {
      var n1 = N1[i], n = N2[i][0], k = N2[i][1];
      var c1 = Math.sqrt(1 - s2 / (n1 * n1));
      var r01s = (c0 - n1 * c1) / (c0 + n1 * c1);
      var r12s = cdiv(n1 * c1 - n, -k, n1 * c1 + n, k);
      var r01p = (n1 * c0 - c1) / (n1 * c0 + c1);
      var r12p = cdiv(n * c1 - n1, k * c1, n * c1 + n1, k * c1);
      var ph = (4 * Math.PI * n1 * d * c1) / LAMBDA[i];
      var R = 0.5 * (refl(r01s, r12s, ph) + refl(r01p, r12p, ph));
      out[0] += R * W[i][0]; out[1] += R * W[i][1]; out[2] += R * W[i][2];
    }
    return out;
  }
  function enc(x) { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }

  /** Heat (0..1.25) -> oxide thickness in nm. Shared with the shader. */
  var D_RAW = 2, D_SPAN = 50;
  function thickness(h) { h = Math.max(0, Math.min(1.25, h)); return D_RAW + D_SPAN * Math.pow(h, 0.9); }

  // Lookup tables: 256 steps over heat 0..1.25.
  var LUT = [], LUT_PALE = [];
  (function buildLut() {
    var raw = film(D_RAW, 1);
    var paleGain = 0.84 / (0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2]);
    for (var i = 0; i < 256; i++) {
      var h = (i / 255) * 1.25;
      var c = film(thickness(h), 1);
      LUT.push([Math.round(enc(c[0]) * 255), Math.round(enc(c[1]) * 255), Math.round(enc(c[2]) * 255)]);
      // Pale: the gentle straw end only, normalised so raw titanium reads as bone.
      var p = film(thickness(h * 0.42), 1);
      LUT_PALE.push([Math.round(enc(p[0] * paleGain) * 255), Math.round(enc(p[1] * paleGain) * 255), Math.round(enc(p[2] * paleGain) * 255)]);
    }
  })();
  function lut(table, h) { var i = Math.max(0, Math.min(255, Math.round((h / 1.25) * 255))); return table[i]; }
  function rgb(c) { return "rgb(" + c[0] + " " + c[1] + " " + c[2] + ")"; }
  function oxide(h) { return rgb(lut(LUT, h)); }

  /** Heat-affected zone: a gradient that tempers outward from x (percent). */
  function haz(h, x, angle) {
    if (h < 0.004) return "linear-gradient(var(--cool), var(--cool))";
    var N = 6, spread = 26 + 64 * Math.min(1, h), stops = [];
    for (var i = -N; i <= N; i++) {
      var f = Math.abs(i) / N;
      var lh = h * Math.pow(1 - f, 1.35);
      var m = Math.min(1, lh * 2.6) * 100;
      var pos = x + (i / N) * spread;
      stops.push("color-mix(in srgb, " + oxide(lh) + " " + m.toFixed(1) + "%, var(--cool)) " + pos.toFixed(1) + "%");
    }
    return "linear-gradient(" + (angle || "90deg") + ", " + stops.join(", ") + ")";
  }
  /** A travelling torch trail: hot at p, cooling behind it. */
  function trail(p, h) {
    var N = 14, stops = [];
    for (var i = 0; i <= N; i++) {
      var x = i / N;
      var lh = x <= p ? h * Math.exp(-(p - x) / 0.32) : h * Math.exp(-(x - p) / 0.04);
      var m = Math.min(1, lh * 2.2) * 100;
      stops.push("color-mix(in srgb, " + oxide(lh) + " " + m.toFixed(1) + "%, var(--cool)) " + (x * 100).toFixed(1) + "%");
    }
    return "linear-gradient(90deg, " + stops.join(", ") + ")";
  }

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     2. HEAT ENGINE
     ------------------------------------------------------------------ */
  var TAU_RISE = 0.055, TAU_COOL = 0.42, TAU_POS = 0.09;
  var states = new WeakMap(), active = new Set(), raf = 0, last = 0;

  function write(el, s) {
    var st = el.style;
    var hot = s.floor >= 1 ? 0 : Math.max(0, Math.min(1, (s.h - s.floor) / (1 - s.floor)));
    st.setProperty("--heat", s.h.toFixed(3));
    st.setProperty("--hot", hot.toFixed(3));
    st.setProperty("--floor", s.floor.toFixed(3));
    st.setProperty("--hx", s.x.toFixed(1) + "%");
    st.setProperty("--hy", s.y.toFixed(1) + "%");
    st.setProperty("--ox", oxide(Math.max(s.h, 0.02)));
    st.setProperty("--ox-mid", oxide(s.h * 0.55));
    st.setProperty("--ox-pale", rgb(lut(LUT_PALE, s.h)));
    st.setProperty("--temper", s.vertical ? haz(s.h, s.y, "180deg") : haz(s.h, s.x));
  }
  function tick(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    active.forEach(function (el) {
      var s = states.get(el);
      if (!s) { active.delete(el); return; }
      if (s.target > s.h) s.h += (s.target - s.h) * (1 - Math.exp(-dt / TAU_RISE));
      else s.h = s.target + (s.h - s.target) * Math.exp(-dt / TAU_COOL);
      s.x += (s.tx - s.x) * (1 - Math.exp(-dt / TAU_POS));
      s.y += (s.ty - s.y) * (1 - Math.exp(-dt / TAU_POS));
      if (Math.abs(s.h - s.target) < 0.003 && Math.abs(s.x - s.tx) < 0.2 && Math.abs(s.y - s.ty) < 0.2) {
        s.h = s.target; s.x = s.tx; s.y = s.ty;
        active.delete(el);
      }
      write(el, s);
    });
    raf = active.size ? requestAnimationFrame(tick) : 0;
  }
  function wake(el) {
    var s = states.get(el);
    if (reduced) { s.h = s.target; s.x = s.tx; s.y = s.ty; write(el, s); return; }
    active.add(el);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function aim(el, e) {
    var s = states.get(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    s.tx = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    s.ty = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
  }
  function bind(el) {
    if (states.has(el)) return;
    var floor = parseFloat(el.getAttribute("data-heat-floor")) || 0;
    var max = parseFloat(el.getAttribute("data-heat-max")) || 1;
    var s = { h: floor, target: floor, floor: floor, max: max, x: 50, y: 50, tx: 50, ty: 50, vertical: el.hasAttribute("data-heat-vertical") };
    states.set(el, s);
    write(el, s);
    if (el.hasAttribute("data-heat-view")) {
      viewHeat.observe(el);
      return;
    }
    el.addEventListener("pointerenter", function (e) {
      aim(el, e);
      if (s.h <= s.floor + 0.02) { s.x = s.tx; s.y = s.ty; }
      s.target = Math.max(s.floor, s.max); wake(el);
    });
    el.addEventListener("pointermove", function (e) { aim(el, e); wake(el); });
    el.addEventListener("pointerdown", function () { s.h = Math.min(1.2, Math.max(s.h, s.max) + 0.12); wake(el); });
    el.addEventListener("pointerleave", function () { s.target = s.floor; wake(el); });
    el.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t && t.matches && !t.matches(":focus-visible") && t.tagName !== "INPUT" && t.tagName !== "SELECT" && t.tagName !== "TEXTAREA") return;
      s.tx = s.vertical ? 50 : 18; s.ty = 50;
      s.target = Math.max(s.floor, s.max); wake(el);
    });
    el.addEventListener("focusout", function () { s.target = s.floor; wake(el); });
  }
  var viewHeat = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var s = states.get(en.target);
      if (!s) return;
      s.target = en.isIntersecting ? s.max : s.floor;
      en.target.classList.toggle("is-hot", en.isIntersecting);
      wake(en.target);
    });
  }, { threshold: 0.35 }) : { observe: function () {} };

  function scan(root) { (root || document).querySelectorAll("[data-heat]").forEach(bind); }
  function setFloor(el, floor, max) {
    bind(el);
    var s = states.get(el);
    s.floor = floor;
    if (max !== undefined) s.max = max;
    if (s.target < floor || !el.matches(":hover")) s.target = floor;
    wake(el);
  }
  function pulse(el, h) { bind(el); var s = states.get(el); s.h = Math.max(s.h, h || 1); s.tx = s.x = 50; wake(el); }

  window.Temper = {
    film: film, thickness: thickness, oxide: oxide, haz: haz, trail: trail,
    LAMBDA: LAMBDA, W: W, N1: N1, N2: N2, D_RAW: D_RAW, D_SPAN: D_SPAN,
    scan: scan, setFloor: setFloor, pulse: pulse, reduced: reduced
  };

  /* ------------------------------------------------------------------
     3. DATA
     ------------------------------------------------------------------ */
  var A = "../assets/";
  var CARS = [
    { key: "r35", make: "Nissan", name: "Nissan GT-R", code: "R35", short: "GT-R" },
    { key: "a90", make: "Toyota", name: "Toyota GR Supra", code: "A90", short: "Supra" },
    { key: "e46", make: "BMW", name: "BMW M3", code: "E46", short: "M3" },
    { key: "964", make: "Porsche", name: "Porsche 911", code: "964", short: "964" },
    { key: "fd", make: "Mazda", name: "Mazda RX-7", code: "FD3S", short: "RX-7" },
    { key: "ek9", make: "Honda", name: "Honda Civic Type R", code: "EK9", short: "EK9" },
    { key: "dc2", make: "Acura", name: "Acura Integra Type R", code: "DC2", short: "Integra" },
    { key: "sti", make: "Subaru", name: "Subaru WRX STI", code: "GD", short: "STI" }
  ];
  var CAR = {}; CARS.forEach(function (c) { CAR[c.key] = c; });

  var SELLERS = {
    ada: { handle: "ada.fab", name: "Ada Okafor", initials: "AO", city: "Portland, OR", car: "Ink, 2017 Nissan GT-R", sales: 63, href: "garage.html" },
    vos: { handle: "vos.r35", name: "Pieter Vos", initials: "PV", city: "Phoenix, AZ", car: "2012 Nissan GT-R", sales: 21 },
    hollis: { handle: "hollis_e46", name: "Grace Hollis", initials: "GH", city: "Asheville, NC", car: "2004 BMW M3", sales: 14 },
    tamsin: { handle: "tamsin.964", name: "Tamsin Reyes", initials: "TR", city: "Austin, TX", car: "1991 Porsche 911 Carrera 2", sales: 9 },
    sato: { handle: "fd.sato", name: "Ren Sato", initials: "RS", city: "Seattle, WA", car: "1993 Mazda RX-7", sales: 31 },
    bell: { handle: "bell.ek9", name: "Marcus Bell", initials: "MB", city: "Columbus, OH", car: "1998 Honda Civic Type R", sales: 17 },
    noor: { handle: "noor.sti", name: "Noor Haddad", initials: "NH", city: "Denver, CO", car: "2006 Subaru WRX STI", sales: 26 },
    kade: { handle: "kade.a90", name: "Kade Lin", initials: "KL", city: "Las Vegas, NV", car: "2021 Toyota GR Supra", sales: 6 }
  };

  var CATS = [
    { key: "exhaust", name: "Exhaust", tags: "exhaust tips header muffler downpipe titanium ti" },
    { key: "boost", name: "Forced induction", tags: "turbo turbocharger boost intercooler wastegate" },
    { key: "wheels", name: "Wheels & hardware", tags: "wheels rims lug nuts" },
    { key: "chassis", name: "Suspension & chassis" },
    { key: "brakes", name: "Brakes" },
    { key: "aero", name: "Aero & body" },
    { key: "interior", name: "Interior" },
    { key: "electronics", name: "Engine management" }
  ];
  var CAT = {}; CATS.forEach(function (c) { CAT[c.key] = c; });
  var CONDS = { "new": "New", "used-excellent": "Used, excellent", "used-good": "Used, good" };

  var LISTINGS = [
    { id: "ti-tips", title: "Ti 4″ double-wall burnt tips, pair", price: 640, cat: "exhaust", cond: "used-excellent", fits: ["r35", "a90"], seller: "ada", from: "Ink, 2017 GT-R",
      img: "c17-hero-exhaust.jpg", watching: 41, days: 3, ship: 38,
      blurb: "Grade 2 titanium, 1.2 mm wall, double-wall with a rolled 4″ lip. I made these for Ink in 2024 and ran them for about 1,900 miles before going to quad 3.5s. The colour is real: back-purged welds, then heat-cycled on the car.",
      specs: [["Material", "Grade 2 titanium, 1.2 mm wall"], ["Inlet", "3.0″ slip-on, clamps included"], ["Outlet", "4.0″ double-wall, rolled lip"], ["Length", "7.5″ each"], ["Weight", "1.1 lb each"], ["Miles on them", "About 1,900"]],
      fitNote: { r35: "Slips straight onto the stock 3.0″ R35 mid-pipe outlets. Clamps included.", a90: "Fits with the 3.5″ to 3.0″ step-down sleeves Ada includes for Supra buyers." } },
    { id: "g35-turbo", title: "Garrett G35-1050 with Ti downpipe flange", price: 1420, cat: "boost", cond: "used-good", fits: ["r35", "a90", "fd"], seller: "ada", from: "Ink, 2017 GT-R",
      img: "c17-turbo.jpg", watching: 57, days: 1, ship: 45,
      blurb: "Ran Ink's single-turbo conversion from 2023 until I went to a Precision 8685. 8,000 miles, zero shaft play, compressor wheel is clean. The titanium T4 flange and 3″ downpipe stub are my welds.",
      specs: [["Turbo", "Garrett G35-1050, 0.83 A/R"], ["Miles", "8,000"], ["Shaft play", "None axial, normal radial"], ["Flange", "T4 divided, titanium"], ["Rated", "Up to 1,050 hp"]] },
    { id: "k20-header", title: "K20 Ti 4-1 header, EK9 / DC2 swap", price: 1850, cat: "exhaust", cond: "new", fits: ["ek9", "dc2"], seller: "ada", from: "Bench-built, never fitted",
      img: "c17-headers.jpg", watching: 33, days: 6, ship: 52,
      blurb: "Equal-length 1.75″ primaries into a 2.5″ collector, built for K-swapped EK9 and DC2 chassis. Back-purged, every bead TIG. Built for a customer whose swap fell through.",
      specs: [["Primaries", "1.75″, equal length"], ["Collector", "2.5″ merge"], ["Flange", "K20 / K24, 3/8″ plate"], ["Weight", "6.2 lb"]] },
    { id: "ti-lugs", title: "Burnt Ti lug nuts, set of 20, M12×1.25", price: 189, cat: "wheels", cond: "new", fits: ["r35", "sti"], seller: "noor", from: "New in box",
      img: "c17-bolts.jpg", watching: 18, days: 9, ship: 9,
      blurb: "Grade 5 titanium, 60° conical seat, 19 mm hex. Bought two sets by mistake. These never touched a wheel.",
      specs: [["Thread", "M12×1.25"], ["Seat", "60° conical"], ["Hex", "19 mm"], ["Material", "Grade 5 titanium"]] },
    { id: "forged-6", title: "Forged 6-spoke 20×10.5 +15, gunmetal, set of 4", price: 3200, cat: "wheels", cond: "used-excellent", fits: ["r35"], seller: "vos", from: "2012 GT-R",
      img: "c17-wheel.jpg", watching: 29, days: 4, ship: 120,
      blurb: "Square setup, 5×114.3, centre-bore matched to the R35. One season, no curb rash, freshly powdered gunmetal.",
      specs: [["Size", "20×10.5, +15"], ["Bolt pattern", "5×114.3"], ["Finish", "Gunmetal powder"], ["Weight", "21.4 lb each"]] },
    { id: "nismo-muffler", title: "Nismo titanium muffler, R35", price: 1950, cat: "exhaust", cond: "used-good", fits: ["r35"], seller: "ada", from: "Ink, 2017 GT-R", spec: "Came off when Ada built her own 3.5″ system.", watching: 24, days: 12, ship: 85 },
    { id: "ti-strut", title: "Ti front strut bar, R35", price: 410, cat: "chassis", cond: "new", fits: ["r35"], seller: "ada", from: "Fabricated to order", spec: "1.25″ Grade 9 tube, CNC end plates.", watching: 12, days: 2, ship: 28 },
    { id: "ic-piping", title: "Ti intercooler piping kit, 3″ / 2.5″", price: 560, cat: "boost", cond: "used-excellent", fits: ["r35"], seller: "vos", from: "2012 GT-R", spec: "Hot and cold side, silicone couplers included.", watching: 15, days: 5, ship: 40 },
    { id: "e46-diffuser", title: "Carbon rear diffuser, CSL-style", price: 1100, cat: "aero", cond: "used-good", fits: ["e46"], seller: "hollis", from: "2004 M3", spec: "Dry carbon, one strake chip repaired.", watching: 22, days: 8, ship: 75 },
    { id: "pss10", title: "Bilstein PSS10 coilovers", price: 1280, cat: "chassis", cond: "used-good", fits: ["964"], seller: "tamsin", from: "1991 Carrera 2", spec: "12,000 miles, rebuilt 2025.", watching: 9, days: 15, ship: 60 },
    { id: "te37", title: "Rays TE37 Sonic 15×8 +35, set of 4", price: 1650, cat: "wheels", cond: "used-good", fits: ["ek9", "dc2"], seller: "bell", from: "1998 Civic Type R", spec: "4×100, bronze, two light scuffs.", watching: 37, days: 2, ship: 90 },
    { id: "kpro", title: "Hondata K-Pro v4 ECU", price: 520, cat: "electronics", cond: "used-excellent", fits: ["ek9", "dc2"], seller: "bell", from: "1998 Civic Type R", spec: "Unlocked, base K20A2 map loaded.", watching: 14, days: 7, ship: 18 },
    { id: "fd-downpipe", title: "FD3S Ti downpipe, 3″", price: 690, cat: "exhaust", cond: "used-good", fits: ["fd"], seller: "sato", from: "1993 RX-7", spec: "Off a twin-to-single conversion. V-band outlet.", watching: 11, days: 10, ship: 42 },
    { id: "recaro-pp", title: "Recaro Pole Position, FIA", price: 890, cat: "interior", cond: "used-excellent", fits: [], universal: true, seller: "bell", from: "1998 Civic Type R", spec: "Expires 2029. Side mounts, no bracket.", watching: 19, days: 6, ship: 70 },
    { id: "wg-dump", title: "Ti wastegate dump tube, 44 mm", price: 180, cat: "boost", cond: "new", fits: [], universal: true, seller: "ada", from: "Fabricated to order", spec: "V-band inlet, 18″ run, open or recirc.", watching: 8, days: 4, ship: 14 },
    { id: "a90-hood", title: "Vented carbon hood, A90", price: 1400, cat: "aero", cond: "used-excellent", fits: ["a90"], seller: "kade", from: "2021 GR Supra", spec: "Twill weave, OEM latch points.", watching: 26, days: 3, ship: 180 },
    { id: "964-bbk", title: "Wilwood 6-pot front brake kit", price: 2100, cat: "brakes", cond: "used-good", fits: ["964"], seller: "tamsin", from: "1991 Carrera 2", spec: "330 mm two-piece rotors, 40% pads left.", watching: 13, days: 11, ship: 55 },
    { id: "sti-dp", title: "Catless downpipe, STI GD", price: 260, cat: "exhaust", cond: "used-good", fits: ["sti"], seller: "noor", from: "2006 WRX STI", spec: "Off-road use only. Gaskets included.", watching: 7, days: 13, ship: 35 },
    { id: "ti-hangers", title: "Ti hangers & V-band clamp kit, 6 pcs", price: 95, cat: "exhaust", cond: "new", fits: [], universal: true, seller: "ada", from: "Fabricated to order", spec: "3″ and 3.5″ clamps, poly bushings.", watching: 5, days: 1, ship: 8 }
  ];
  var BY_ID = {}; LISTINGS.forEach(function (l) { BY_ID[l.id] = l; });
  // Demand is heat. Watchers set a resting floor; the hottest parts sit visibly tempered.
  LISTINGS.forEach(function (l) { l.heat = Math.min(0.62, Math.pow(l.watching / 60, 0.9) * 0.62); });

  function fitsCar(l, key) { return !key || l.universal || l.fits.indexOf(key) > -1; }
  function money(n) { return "$" + n.toLocaleString("en-US"); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function fitLabel(l) {
    if (l.universal) return "Universal";
    return l.fits.map(function (k) { return CAR[k].code; }).join(" / ");
  }

  /* ------------------------------------------------------------------
     storage (never required for correctness)
     ------------------------------------------------------------------ */
  var mem = {};
  function load(k, fallback) {
    try { var v = window.localStorage.getItem("drvn.temper." + k); if (v !== null) return JSON.parse(v); } catch (e) { /* storage unavailable */ }
    return k in mem ? mem[k] : fallback;
  }
  function save(k, v) {
    mem[k] = v;
    try { window.localStorage.setItem("drvn.temper." + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  }

  /* ------------------------------------------------------------------
     4. COMPONENTS
     ------------------------------------------------------------------ */
  function photo(src, alt, ratioClass, extra) {
    return '<div class="ph ' + (ratioClass || "ph--45") + (extra ? " " + extra : "") + '">' +
      '<img class="ph__base" src="' + A + src + '" alt="' + esc(alt) + '" decoding="async">' +
      '<img class="ph__heat" src="' + A + src + '" alt="" aria-hidden="true" decoding="async"></div>';
  }
  function card(l, opts) {
    opts = opts || {};
    var s = SELLERS[l.seller];
    var media = l.img
      ? photo(l.img, l.title, opts.ratio || "ph--45")
      : '<div class="tcard"><span class="label">' + esc(CAT[l.cat].name) + '</span><span class="tcard__name" aria-hidden="true">' + esc(l.title) + '</span><span class="tcard__spec">' + esc(l.spec || "") + "</span></div>";
    return '<article class="lcard' + (l.img ? "" : " lcard--type") + (l.sold ? " is-sold" : "") + '" data-heat data-heat-floor="' + (l.sold ? 0 : l.heat.toFixed(3)) + '">' +
      '<a class="lcard__link" href="part.html?id=' + l.id + '">' +
      '<div class="lcard__media">' + media + (l.sold ? '<span class="lcard__sold label">Sold</span>' : "") + "</div>" +
      '<div class="lcard__body">' +
      '<h3 class="lcard__title">' + esc(l.title) + "</h3>" +
      '<p class="lcard__meta">@' + s.handle + " · " + (opts.hideFrom ? s.city : (/^(\d{4}|Ink)/.test(l.from) ? "Off " : "") + esc(l.from)) + "</p>" +
      '<div class="lcard__row"><span class="lcard__price price">' + money(l.price) + "</span>" +
      '<span class="lcard__demand">' + (l.sold ? "Sold" : l.watching + " watching") + "</span></div>" +
      "</div></a>" +
      '<span class="band lcard__band" aria-hidden="true"></span></article>';
  }

  // nav
  function initNav() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var solidAlways = nav.hasAttribute("data-solid");
    function onScroll() { nav.classList.toggle("is-solid", solidAlways || window.scrollY > 24); }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    var btn = nav.querySelector(".menu-btn"), menu = document.querySelector(".menu");
    if (btn && menu) {
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Close" : "Menu";
        menu.hidden = !open;
        document.body.classList.toggle("is-locked", open);
        nav.classList.toggle("is-solid", open || solidAlways || window.scrollY > 24);
        if (open) { var first = menu.querySelector("a, input"); if (first) first.focus(); }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { btn.click(); btn.focus(); }
      });
    }
  }

  // cart + checkout drawer
  var cart = load("cart", []);
  if (!Array.isArray(cart)) cart = [];
  cart = cart.filter(function (id) { return BY_ID[id]; });
  function renderCartCount() {
    document.querySelectorAll(".cart").forEach(function (b) {
      var c = b.querySelector(".cart__count");
      if (c) c.textContent = String(cart.length);
      b.classList.toggle("has-items", cart.length > 0);
      b.setAttribute("aria-label", "Cart, " + cart.length + (cart.length === 1 ? " item" : " items"));
    });
  }
  function addToCart(id) {
    if (cart.indexOf(id) === -1) cart.push(id);
    save("cart", cart);
    renderCartCount();
    document.querySelectorAll(".cart").forEach(function (b) { pulse(b, 1.05); });
  }

  var drawer = null, lastFocus = null, mode = "cart", buyNow = null;
  function buildDrawer() {
    drawer = document.createElement("div");
    drawer.className = "drawer";
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="drawer__scrim" data-close></div>' +
      '<section class="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="drawer-title">' +
      '<header class="drawer__head"><h2 id="drawer-title">Cart</h2><button class="x-btn" type="button" data-close data-heat aria-label="Close"></button></header>' +
      '<div class="drawer__body"></div><footer class="drawer__foot"></footer></section>';
    document.body.appendChild(drawer);
    drawer.addEventListener("click", function (e) {
      var t = e.target.closest("[data-close], [data-act]");
      if (!t) return;
      if (t.hasAttribute("data-close")) closeDrawer();
      var act = t.getAttribute("data-act");
      if (act === "remove") { cart = cart.filter(function (id) { return id !== t.getAttribute("data-id"); }); save("cart", cart); renderCartCount(); renderDrawer(); }
      if (act === "checkout") { mode = "checkout"; renderDrawer(); }
      if (act === "back") { mode = "cart"; renderDrawer(); }
      if (act === "shop") { closeDrawer(); }
    });
    drawer.addEventListener("submit", function (e) {
      e.preventDefault();
      var form = e.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var items = drawerItems();
      if (!buyNow) { cart = cart.filter(function (id) { return items.every(function (l) { return l.id !== id; }); }); save("cart", cart); renderCartCount(); }
      mode = "done"; renderDrawer(items, form.querySelector("[name=email]").value);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawer && !drawer.hidden) { e.preventDefault(); closeDrawer(); }
    });
    drawer.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(drawer.querySelectorAll("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])"), function (n) { return n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    });
  }
  function drawerItems() { return buyNow ? [BY_ID[buyNow]] : cart.map(function (id) { return BY_ID[id]; }); }
  function itemRow(l, removable) {
    var s = SELLERS[l.seller];
    var thumb = l.img ? '<div class="ph"><img src="' + A + l.img + '" alt=""></div>' : '<div class="tthumb" aria-hidden="true">Ti</div>';
    return '<div class="ditem">' + thumb + '<div><h3>' + esc(l.title) + "</h3><p>@" + s.handle + " · " + s.city + "</p>" +
      (removable ? '<button type="button" class="ditem__x" data-act="remove" data-id="' + l.id + '">Remove</button>' : "") +
      '</div><span class="price num">' + money(l.price) + "</span></div>";
  }
  function renderDrawer(doneItems, email) {
    var title = drawer.querySelector("#drawer-title"), body = drawer.querySelector(".drawer__body"), foot = drawer.querySelector(".drawer__foot");
    var items = doneItems || drawerItems();
    var sub = items.reduce(function (a, l) { return a + l.price; }, 0);
    var ship = items.reduce(function (a, l) { return a + (l.ship || 0); }, 0);
    if (mode === "cart") {
      title.textContent = "Cart";
      if (!items.length) {
        body.innerHTML = '<div class="done"><h3>Nothing on the bench yet.</h3><p>Parts you add show up here. You can check out without an account.</p></div>';
        foot.innerHTML = '<a class="btn btn--primary btn--block" data-heat href="market.html"><span>Browse the marketplace</span><span class="btn__arrow" aria-hidden="true">→</span><span class="band" aria-hidden="true"></span></a>';
      } else {
        body.innerHTML = items.map(function (l) { return itemRow(l, true); }).join("");
        foot.innerHTML = '<div class="drawer__total"><span class="muted">Subtotal</span><span class="price num">' + money(sub) + "</span></div>" +
          '<button type="button" class="btn btn--primary btn--block" data-heat data-act="checkout"><span>Check out</span><span class="btn__arrow" aria-hidden="true">→</span><span class="band" aria-hidden="true"></span></button>' +
          '<p class="label">Payment held until delivery</p>';
      }
    } else if (mode === "checkout") {
      title.textContent = "Checkout";
      var seller = SELLERS[items[0].seller];
      body.innerHTML = items.map(function (l) { return itemRow(l, false); }).join("") +
        '<dl class="rows"><div><dt>Subtotal</dt><dd class="num">' + money(sub) + "</dd></div><div><dt>Tracked shipping</dt><dd class=\"num\">" + money(ship) + "</dd></div><div><dt>Buyer protection</dt><dd>Included</dd></div></dl>" +
        '<form class="co" id="co-form" novalidate>' +
        '<div class="field"><label class="field__label" for="co-email">Email for tracking</label><div class="ctl" data-heat><input id="co-email" name="email" type="email" autocomplete="email" required placeholder="you@garage.com"></div><span class="field__hint">No account needed.</span></div>' +
        '<div class="field" style="margin-top:var(--s-4)"><label class="field__label" for="co-zip">Shipping ZIP</label><div class="ctl" data-heat><input id="co-zip" name="zip" inputmode="numeric" autocomplete="postal-code" required pattern="[0-9]{5}" placeholder="97214"></div></div>' +
        "</form>" +
        '<div><p class="label" style="margin-bottom:var(--s-3)">Where your money sits</p><ol class="held">' +
        '<li class="is-now"><div>Today<span>You pay. DRVN holds it, not the seller.</span></div></li>' +
        "<li><div>In transit<span>" + esc(seller.name.split(" ")[0]) + " ships tracked within two days.</span></div></li>" +
        "<li><div>Delivered<span>Check it over. Raise anything within 48 hours.</span></div></li>" +
        "<li><div>Two days after delivery<span>The seller is paid. Not before.</span></div></li></ol></div>";
      foot.innerHTML = '<div class="drawer__total"><span class="muted">Total</span><span class="price num">' + money(sub + ship) + "</span></div>" +
        '<button type="submit" form="co-form" class="btn btn--primary btn--block" data-heat><span>Pay ' + money(sub + ship) + " — held until delivery</span><span class=\"band\" aria-hidden=\"true\"></span></button>" +
        (buyNow ? "" : '<button type="button" class="btn btn--ghost btn--block btn--sm" data-heat data-act="back"><span>Back to cart</span><span class="band" aria-hidden="true"></span></button>');
    } else {
      title.textContent = "Paid. Held.";
      var who = SELLERS[items[0].seller].name.split(" ")[0];
      body.innerHTML = '<div class="done"><p class="label">Order DRVN-' + (40000 + sub % 9973) + "</p><h3>Your money is with us until it lands.</h3>" +
        "<p>" + esc(who) + " has two days to ship. Tracking goes to " + esc(email || "your inbox") + ". The seller is paid two days after delivery.</p></div>" +
        items.map(function (l) { return itemRow(l, false); }).join("");
      foot.innerHTML = '<button type="button" class="btn btn--ghost btn--block" data-heat data-act="shop"><span>Keep browsing</span><span class="band" aria-hidden="true"></span></button>';
    }
    scan(drawer);
    if (drawer.classList.contains("is-open") && !drawer.contains(document.activeElement)) {
      var f = drawer.querySelector(".drawer__body input, .drawer__foot .btn, .x-btn");
      if (f) f.focus();
    }
    var heat = drawer.querySelector(".held .is-now");
    if (heat) heat.style.setProperty("--ox", oxide(1));
  }
  function openDrawer(m, id, opener) {
    if (!drawer) buildDrawer();
    mode = m; buyNow = id || null;
    lastFocus = opener || document.activeElement;
    renderDrawer();
    drawer.hidden = false;
    document.body.classList.add("is-locked");
    requestAnimationFrame(function () { requestAnimationFrame(function () { drawer.classList.add("is-open"); }); });
    setTimeout(function () { var f = drawer.querySelector(".drawer__body input, .drawer__foot .btn, .x-btn"); if (f) f.focus(); }, 60);
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove("is-open");
    document.body.classList.remove("is-locked");
    setTimeout(function () { drawer.hidden = true; }, reduced ? 0 : 560);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function initCart() {
    renderCartCount();
    document.querySelectorAll(".cart").forEach(function (b) { b.addEventListener("click", function () { openDrawer("cart", null, b); }); });
  }

  // search (nav + menu) -> market
  function initSearch() {
    document.querySelectorAll("form.search").forEach(function (f) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = f.querySelector("input").value.trim();
        window.location.href = "market.html" + (q ? "?q=" + encodeURIComponent(q) : "");
      });
    });
  }

  function initReveal() {
    if (reduced || !("IntersectionObserver" in window)) return;
    var els = document.querySelectorAll("[data-reveal]");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.remove("is-pending"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (e) {
      if (e.getBoundingClientRect().top > window.innerHeight) { e.classList.add("is-pending"); io.observe(e); }
    });
  }

  // A video band that fades at its loop point (the source clip is not a seamless loop).
  function initVideoFades() {
    document.querySelectorAll("video.vfade").forEach(function (v) {
      v.addEventListener("timeupdate", function () {
        if (v.duration && v.currentTime > v.duration - 0.75) v.classList.add("is-fading");
        else if (v.currentTime > 0.1 && v.currentTime < v.duration - 0.75) v.classList.remove("is-fading");
      });
      v.addEventListener("seeked", function () { setTimeout(function () { v.classList.remove("is-fading"); }, 60); });
      if (reduced) { v.removeAttribute("autoplay"); v.pause(); }
    });
  }

  /* ------------------------------------------------------------------
     5. PAGES
     ------------------------------------------------------------------ */
  function myCar() { var k = load("car", null); return CAR[k] ? k : null; }

  function pageIndex() {
    // hot right now
    var hot = document.querySelector("[data-hot]");
    if (hot) {
      var a = BY_ID["g35-turbo"], b = BY_ID["k20-header"];
      hot.innerHTML = card(a) + card(b) + '<div class="hot__stack">' + card(BY_ID.te37) + card(BY_ID["a90-hood"]) + "</div>";
    }
    var scale = document.querySelector("[data-scale]");
    if (scale) scale.style.setProperty("--temper", "linear-gradient(90deg, " + [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map(function (h, i) { return oxide(h) + " " + (i / 7 * 100).toFixed(0) + "%"; }).join(", ") + ")");

    // car picker
    var list = document.querySelector("[data-picker]");
    var result = document.querySelector("[data-picker-result]");
    if (list) {
      list.innerHTML = CARS.map(function (c) {
        var n = LISTINGS.filter(function (l) { return fitsCar(l, c.key); }).length;
        return '<button type="button" class="carrow" role="radio" aria-checked="false" data-car="' + c.key + '" data-heat>' +
          '<span class="carrow__name">' + c.name + ' <span class="label">' + c.code + "</span></span>" +
          '<span class="carrow__mine label">Your car</span>' +
          '<span class="carrow__count num">' + n + (n === 1 ? " part" : " parts") + "</span>" +
          '<span class="band" aria-hidden="true"></span></button>';
      }).join("");
      var rows = Array.prototype.slice.call(list.querySelectorAll(".carrow"));
      function choose(key, focus) {
        rows.forEach(function (r) {
          var on = r.getAttribute("data-car") === key;
          r.setAttribute("aria-checked", String(on));
          r.tabIndex = on ? 0 : -1;
          setFloor(r, on ? 1.05 : 0, on ? 1.15 : 1);
          if (on && focus) r.focus();
        });
        if (!key) { rows[0].tabIndex = 0; result.innerHTML = '<p>Nothing chosen yet. <strong>Every listing shows fitment either way.</strong></p>'; return; }
        save("car", key);
        var c = CAR[key];
        var n = LISTINGS.filter(function (l) { return fitsCar(l, key); }).length;
        result.innerHTML = "<p><strong>" + n + " parts fit your " + c.short + ".</strong> We’ll check fitment on every listing you open.</p>" +
          '<a class="btn btn--ghost" data-heat href="market.html?fits=' + key + '"><span>Shop parts for the ' + c.short + '</span><span class="btn__arrow" aria-hidden="true">→</span></a>';
        scan(result);
      }
      list.addEventListener("click", function (e) { var r = e.target.closest(".carrow"); if (r) choose(r.getAttribute("data-car")); });
      list.addEventListener("keydown", function (e) {
        var i = rows.indexOf(document.activeElement);
        if (i < 0) return;
        var n = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % rows.length;
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + rows.length) % rows.length;
        if (n !== null) { e.preventDefault(); choose(rows[n].getAttribute("data-car"), true); }
      });
      choose(myCar());
    }

    // buying line: a torch travels the money's route
    var line = document.querySelector("[data-trail]");
    if (line) {
      var started = false;
      var run = function () {
        if (started) return; started = true;
        if (reduced) { line.style.setProperty("--temper", trail(1, 0.9)); return; }
        var t0 = performance.now(), dur = 3200;
        (function step(now) {
          var p = Math.min(1, (now - t0) / dur);
          var e = 1 - Math.pow(1 - p, 2.2);
          line.style.setProperty("--temper", trail(e, 1.05));
          if (p < 1) requestAnimationFrame(step);
          else cool(now);
        })(t0);
        function cool(t1) {
          (function step(now) {
            var k = Math.min(1, (now - t1) / 2200);
            line.style.setProperty("--temper", trail(1, 1.05 - 0.15 * k));
            if (k < 1) requestAnimationFrame(step);
          })(t1);
        }
      };
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { run(); io.disconnect(); } }, { threshold: 0.6 });
        io.observe(line);
      } else run();
    }
  }

  function pageMarket() {
    var grid = document.querySelector("[data-grid]"), count = document.querySelector("[data-count]"), form = document.querySelector("[data-filters]");
    var sortSel = document.querySelector("[data-sort]"), empty = document.querySelector("[data-empty]");
    var params = new URLSearchParams(window.location.search);
    var q = (params.get("q") || "").trim().toLowerCase();

    var fitsSel = form.querySelector("[name=fits]");
    fitsSel.innerHTML = '<option value="">Any car</option>' + CARS.map(function (c) { return '<option value="' + c.key + '">' + c.name + " (" + c.code + ")</option>"; }).join("");
    var catBox = form.querySelector("[data-cats]");
    catBox.innerHTML = CATS.map(function (c) {
      return '<label class="check" data-heat><input type="checkbox" name="cat" value="' + c.key + '"><span class="check__box" aria-hidden="true"></span>' + c.name + '<span class="check__count" data-catcount="' + c.key + '"></span></label>';
    }).join("");

    var startFits = params.get("fits") || myCar() || "";
    if (CAR[startFits]) fitsSel.value = startFits;
    if (params.get("cat")) { var cb = form.querySelector('[name=cat][value="' + params.get("cat") + '"]'); if (cb) cb.checked = true; }
    if (params.get("sort")) sortSel.value = params.get("sort");
    var qInput = document.querySelector("[data-q]");
    if (qInput) qInput.value = params.get("q") || "";

    function state() {
      var cats = Array.prototype.map.call(form.querySelectorAll("[name=cat]:checked"), function (i) { return i.value; });
      var conds = Array.prototype.map.call(form.querySelectorAll("[name=cond]:checked"), function (i) { return i.value; });
      var min = parseFloat(form.querySelector("[name=min]").value), max = parseFloat(form.querySelector("[name=max]").value);
      return { fits: fitsSel.value, cats: cats, conds: conds, min: isNaN(min) ? 0 : min, max: isNaN(max) ? Infinity : max, sort: sortSel.value, q: qInput ? qInput.value.trim().toLowerCase() : q };
    }
    function matches(l, s, skipCat) {
      if (!fitsCar(l, s.fits)) return false;
      if (!skipCat && s.cats.length && s.cats.indexOf(l.cat) === -1) return false;
      if (s.conds.length && s.conds.indexOf(l.cond) === -1) return false;
      if (l.price < s.min || l.price > s.max) return false;
      if (s.q) {
        var hay = (l.title + " " + CAT[l.cat].name + " " + (CAT[l.cat].tags || "") + " " + (l.spec || "") + " " + l.from + " " + SELLERS[l.seller].handle + " " + l.fits.map(function (k) { return CAR[k].name + " " + CAR[k].code; }).join(" ")).toLowerCase();
        if (s.q.split(/\s+/).some(function (w) { return hay.indexOf(w) === -1; })) return false;
      }
      return true;
    }
    var sorters = {
      hot: function (a, b) { return b.watching - a.watching; },
      new: function (a, b) { return a.days - b.days; },
      low: function (a, b) { return a.price - b.price; },
      high: function (a, b) { return b.price - a.price; }
    };
    function render() {
      var s = state();
      var res = LISTINGS.filter(function (l) { return matches(l, s); }).sort(sorters[s.sort] || sorters.hot);
      grid.innerHTML = res.map(function (l) { return card(l); }).join("");
      scan(grid);
      empty.hidden = res.length > 0;
      grid.hidden = res.length === 0;
      var bits = [];
      if (s.fits) bits.push("fit the " + CAR[s.fits].name + " " + CAR[s.fits].code);
      if (s.q) bits.push("match “" + esc(s.q) + "”");
      count.innerHTML = "<strong>" + res.length + (res.length === 1 ? " part" : " parts") + "</strong>" + (bits.length ? " <span>that " + bits.join(" and ") + "</span>" : " <span>listed</span>");
      CATS.forEach(function (c) {
        var n = LISTINGS.filter(function (l) { return l.cat === c.key && matches(l, s, true); }).length;
        var el = form.querySelector('[data-catcount="' + c.key + '"]');
        if (el) el.textContent = n;
      });
      var u = new URLSearchParams();
      if (s.fits) u.set("fits", s.fits);
      if (s.cats.length === 1) u.set("cat", s.cats[0]);
      if (s.sort !== "hot") u.set("sort", s.sort);
      if (s.q) u.set("q", s.q);
      var qs = u.toString();
      try { history.replaceState(null, "", qs ? "?" + qs : window.location.pathname); } catch (e) { /* sandboxed */ }
    }
    form.addEventListener("input", render);
    form.addEventListener("change", render);
    form.addEventListener("submit", function (e) { e.preventDefault(); render(); });
    sortSel.addEventListener("change", render);
    if (qInput) qInput.addEventListener("input", render);
    document.querySelectorAll("[data-reset]").forEach(function (b) {
      b.addEventListener("click", function () {
        form.reset(); fitsSel.value = ""; if (qInput) qInput.value = ""; sortSel.value = "hot"; render();
      });
    });
    var tog = document.querySelector(".rail__toggle"), rail = document.querySelector(".rail");
    if (tog && rail) {
      tog.addEventListener("click", function () {
        var open = rail.getAttribute("data-open") !== "true";
        rail.setAttribute("data-open", String(open));
        tog.setAttribute("aria-expanded", String(open));
        tog.querySelector("span").textContent = open ? "Hide filters" : "Filters";
      });
    }
    render();
  }

  function pagePart() {
    var params = new URLSearchParams(window.location.search);
    var l = BY_ID[params.get("id")] || BY_ID["ti-tips"];
    var s = SELLERS[l.seller];
    function set(k, v, html) { document.querySelectorAll('[data-f="' + k + '"]').forEach(function (n) { if (html) n.innerHTML = v; else n.textContent = v; }); }
    if (l.id !== "ti-tips") {
      document.title = l.title + " — DRVN";
      set("title", l.title); set("price", money(l.price)); set("ship", "+ " + money(l.ship) + " tracked shipping");
      set("cond", CONDS[l.cond]); set("watching", l.watching + " watching this week"); set("cat", CAT[l.cat].name);
      set("from", l.from); set("fitlist", fitLabel(l)); set("blurb", l.blurb || l.spec || "");
      set("handle", "@" + s.handle); set("seller", s.name); set("city", s.city); set("initials", s.initials);
      set("sellerline", s.city + " · drives " + s.car + " · " + s.sales + " sales");
      set("sellerfirst", s.name.split(" ")[0]);
      var specs = document.querySelector("[data-specs]");
      if (specs) {
        var rows = (l.specs || []).concat([["Condition", CONDS[l.cond]], ["Came off", l.from], ["Fits", fitLabel(l)]]);
        specs.innerHTML = rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");
      }
      var thumbs = document.querySelector("[data-thumbs]");
      var stage = document.querySelector("[data-stage]");
      if (l.img) {
        stage.innerHTML = '<img class="ph__base" src="' + A + l.img + '" alt="' + esc(l.title) + '">';
        if (thumbs) thumbs.hidden = true;
      } else {
        stage.classList.remove("ph--whole");
        stage.innerHTML = '<div class="tcard" style="position:absolute;inset:0"><span class="label">' + esc(CAT[l.cat].name) + '</span><span class="tcard__name" style="font-size:clamp(36px,4vw,64px);max-width:14ch">' + esc(l.title) + '</span><span class="tcard__spec">' + esc(l.spec || "") + " Photos on request — message the seller.</span></div>";
        if (thumbs) thumbs.hidden = true;
      }
      if (!s.href) document.querySelectorAll("[data-seller-link]").forEach(function (a) { a.hidden = true; });
      var demandBand = document.querySelector("[data-demand]");
      if (demandBand) demandBand.setAttribute("data-heat-floor", l.heat.toFixed(3));
    }
    var db = document.querySelector("[data-demand]");
    if (db) { bind(db); setFloor(db, l.heat); }

    // gallery
    var stageEl = document.querySelector("[data-stage]");
    document.querySelectorAll("[data-thumbs] .thumb").forEach(function (t, i, all) {
      t.addEventListener("click", function () {
        all.forEach(function (o) { o.setAttribute("aria-pressed", String(o === t)); });
        var kind = t.getAttribute("data-kind"), src = t.getAttribute("data-file"), alt = t.getAttribute("data-alt");
        if (kind === "video") {
          stageEl.innerHTML = '<video class="vfade" src="' + A + src + '" poster="' + A + 'c17-hero-exhaust.jpg" muted ' + (reduced ? "" : "autoplay ") + 'loop playsinline controls aria-label="' + esc(alt) + '"></video>';
          initVideoFades();
        } else {
          stageEl.innerHTML = '<img class="ph__base" src="' + A + src + '" alt="' + esc(alt) + '">';
        }
        pulse(stageEl, 1);
      });
    });

    // fitment
    var fitSel = document.querySelector("[data-fit]"), verdict = document.querySelector("[data-verdict]"), fitPanel = document.querySelector("[data-fitpanel]");
    if (fitSel) {
      fitSel.innerHTML = '<option value="">Choose your car</option>' + CARS.map(function (c) { return '<option value="' + c.key + '">' + c.name + " (" + c.code + ")</option>"; }).join("");
      var judge = function () {
        var k = fitSel.value;
        if (!k) { verdict.innerHTML = "<strong>Pick your car to check.</strong><p>Fitment comes from the seller and from buyers who fitted it.</p>"; setFloor(fitPanel, 0); return; }
        save("car", k);
        var c = CAR[k];
        if (l.universal) {
          verdict.innerHTML = "<strong>Universal — fits with the right mounting.</strong><p>Check the sizes in the specs against your " + c.short + ".</p>";
          setFloor(fitPanel, 0.55, 0.8);
        } else if (l.fits.indexOf(k) > -1) {
          verdict.innerHTML = "<strong>Fits your " + c.name + " " + c.code + ".</strong><p>" + esc((l.fitNote && l.fitNote[k]) || "The seller confirmed fitment on this chassis.") + "</p>";
          setFloor(fitPanel, 1.05, 1.15);
        } else {
          verdict.innerHTML = "<strong>Won’t fit the " + c.short + " as listed.</strong><p>Built for " + l.fits.map(function (f) { return CAR[f].name + " " + CAR[f].code; }).join(", ") + ".</p>";
          setFloor(fitPanel, 0, 0.4);
        }
      };
      fitSel.addEventListener("change", judge);
      var mine = myCar();
      if (mine) fitSel.value = mine;
      bind(fitPanel);
      judge();
    }

    // buy
    var buyBtn = document.querySelector("[data-buy]"), addBtn = document.querySelector("[data-add]");
    if (buyBtn) buyBtn.addEventListener("click", function () { openDrawer("checkout", l.id, buyBtn); });
    if (addBtn) {
      var syncAdd = function () {
        var inCart = cart.indexOf(l.id) > -1;
        addBtn.querySelector("span").textContent = inCart ? "In cart" : "Add to cart";
        addBtn.setAttribute("aria-pressed", String(inCart));
      };
      addBtn.addEventListener("click", function () { if (cart.indexOf(l.id) > -1) openDrawer("cart", null, addBtn); else { addToCart(l.id); syncAdd(); } });
      syncAdd();
    }

    // more from this seller
    var more = document.querySelector("[data-more]");
    if (more) {
      var others = LISTINGS.filter(function (o) { return o.seller === l.seller && o.id !== l.id; });
      if (others.length < 4) others = others.concat(LISTINGS.filter(function (o) { return o.seller !== l.seller && o.id !== l.id && o.fits.some(function (f) { return l.fits.indexOf(f) > -1; }); }));
      more.innerHTML = others.slice(0, 4).map(function (o) { return card(o); }).join("");
      scan(more);
      var mt = document.querySelector("[data-f='moretitle']");
      if (mt && l.seller !== "ada") mt.textContent = "More like this";
    }
  }

  function pageGarage() {
    var store = document.querySelector("[data-store]");
    if (store) {
      var mine = LISTINGS.filter(function (l) { return l.seller === "ada"; });
      var sold = { id: "ihi-pair", title: "Stock IHI twin turbos, pair", price: 780, cat: "boost", cond: "used-good", fits: ["r35"], seller: "ada", from: "Ink, 2017 GT-R", spec: "31,000 miles. Sold to a buyer in Tulsa.", watching: 0, days: 300, sold: true, heat: 0 };
      store.innerHTML = mine.map(function (l) { return card(l, { hideFrom: false }); }).join("") + card(sold);
      store.querySelectorAll(".is-sold a").forEach(function (a) { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); });
      scan(store);
    }
    // tabs
    var tabs = Array.prototype.slice.call(document.querySelectorAll("[role=tab]"));
    function select(t, focus) {
      tabs.forEach(function (o) {
        var on = o === t;
        o.setAttribute("aria-selected", String(on));
        o.tabIndex = on ? 0 : -1;
        document.getElementById(o.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) t.focus();
      try { history.replaceState(null, "", "#" + t.getAttribute("data-hash")); } catch (e) { /* sandboxed */ }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t); });
      t.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
        if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
        if (e.key === "Home") n = 0;
        if (e.key === "End") n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); select(tabs[n], true); }
      });
    });
    var hash = (window.location.hash || "").slice(1);
    var initial = tabs.filter(function (t) { return t.getAttribute("data-hash") === hash; })[0];
    if (initial) select(initial);

    // follow
    var fb = document.querySelector("[data-follow]"), fc = document.querySelector("[data-followers]");
    if (fb) {
      var base = 2318, on = !!load("follow.ada", false);
      var sync = function () {
        fb.setAttribute("aria-pressed", String(on));
        fb.querySelector("span").textContent = on ? "Following" : "Follow Ada";
        fc.textContent = (base + (on ? 1 : 0)).toLocaleString("en-US") + " followers";
      };
      fb.addEventListener("click", function () { on = !on; save("follow.ada", on); sync(); if (on) pulse(fb, 1.15); });
      sync();
    }
  }

  function pageSell() {
    var form = document.querySelector("[data-sell]");
    if (!form) return;
    var fitsBox = form.querySelector("[data-fits]");
    fitsBox.innerHTML = CARS.map(function (c) {
      return '<label class="check" data-heat><input type="checkbox" name="fits" value="' + c.key + '"><span class="check__box" aria-hidden="true"></span>' + c.name + ' <span class="label">' + c.code + "</span></label>";
    }).join("") + '<label class="check" data-heat><input type="checkbox" name="universal" value="1"><span class="check__box" aria-hidden="true"></span>Universal</label>';
    var preview = document.querySelector("[data-preview]"), pay = document.querySelector("[data-payout]"), note = document.querySelector("[data-note]");
    var photoUrl = null;
    var file = form.querySelector("[name=photos]"), thumbs = form.querySelector("[data-previews]");
    file.addEventListener("change", function () {
      thumbs.innerHTML = "";
      photoUrl = null;
      Array.prototype.slice.call(file.files || [], 0, 8).forEach(function (f, i) {
        if (!/^image\//.test(f.type)) return;
        var url = URL.createObjectURL(f);
        if (i === 0) photoUrl = url;
        var img = document.createElement("img");
        img.src = url; img.alt = "Selected photo " + (i + 1);
        thumbs.appendChild(img);
      });
      update();
    });
    function update() {
      var title = form.querySelector("[name=title]").value.trim() || "Your part";
      var price = parseFloat(form.querySelector("[name=price]").value) || 0;
      var cat = form.querySelector("[name=cat]").value;
      var from = form.querySelector("[name=from]");
      var fee = Math.round(price * 0.06 * 100) / 100;
      var fits = Array.prototype.map.call(form.querySelectorAll("[name=fits]:checked"), function (i) { return i.value; });
      var l = { id: "draft", title: title, price: price, cat: cat, cond: form.querySelector("[name=cond]").value, fits: fits, universal: form.querySelector("[name=universal]").checked, seller: "ada", from: from.options[from.selectedIndex].text, spec: form.querySelector("[name=desc]").value.trim().slice(0, 80), watching: 0, heat: 0 };
      var html = card(l);
      if (photoUrl) {
        html = html.replace(/<div class="tcard">[\s\S]*?<\/span><\/div>/, '<div class="ph ph--45"><img class="ph__base" src="' + photoUrl + '" alt="' + esc(title) + '"></div>');
      }
      preview.innerHTML = html.replace('href="part.html?id=draft"', 'href="#" aria-disabled="true" tabindex="-1"').replace("0 watching", "Draft").replace(">$0<", ">Set a price<");
      scan(preview);
      var fmt = function (n) { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
      pay.querySelector("[data-p=sale]").textContent = fmt(price);
      pay.querySelector("[data-p=fee]").textContent = "−" + fmt(fee);
      pay.querySelector("[data-p=net]").textContent = fmt(Math.max(0, price - fee));
    }
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    preview.addEventListener("click", function (e) { if (e.target.closest("a")) e.preventDefault(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      save("draft", { title: form.querySelector("[name=title]").value, price: form.querySelector("[name=price]").value, at: Date.now() });
      note.hidden = false;
      note.querySelector("[data-note-title]").textContent = "“" + (form.querySelector("[name=title]").value.trim()) + "” is saved as a draft.";
      setFloor(note, 1.05, 1.15);
      note.focus();
    });
    update();
  }

  /* ------------------------------------------------------------------
     boot
     ------------------------------------------------------------------ */
  function boot() {
    var page = document.body.getAttribute("data-page");
    if (page === "index") pageIndex();
    if (page === "market") pageMarket();
    if (page === "part") pagePart();
    if (page === "garage") pageGarage();
    if (page === "sell") pageSell();
    initNav(); initCart(); initSearch(); initReveal(); initVideoFades();
    scan(document);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
