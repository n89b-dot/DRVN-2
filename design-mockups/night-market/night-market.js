/* Night Market — DRVN marketplace mockup. No dependencies.
   Data is DRVN's seeded listings (plus three image-less ones to show the typographic card). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable: state lives for this page only */ } },
  };

  /* ───────── data ───────── */
  const CATS = [
    { id: 'all', name: 'All parts', icon: 'i-all' },
    { id: 'performance', name: 'Performance', icon: 'i-perf' },
    { id: 'engine', name: 'Engine', icon: 'i-engine' },
    { id: 'exterior', name: 'Exterior & Body', icon: 'i-body' },
    { id: 'interior', name: 'Interior & Lighting', icon: 'i-seat' },
    { id: 'brakes', name: 'Brakes & Suspension', icon: 'i-brake' },
    { id: 'wheels', name: 'Wheels & Tires', icon: 'i-wheel' },
  ];
  const catName = (id) => (CATS.find((c) => c.id === id) || CATS[0]).name;

  const CARS = {
    m3: { name: '2003 BMW M3', short: 'M3', gen: 'E46 · S54 3.2 straight-six', nick: 'Lucille', img: 'img/car-lucille.webp' },
    rs4: { name: '2007 Audi RS4 Avant', short: 'RS4', gen: 'B7 · 4.2 FSI V8' },
    gt3: { name: '2022 Porsche 911 GT3', short: '911 GT3', gen: '992 · 4.0 flat-six' },
    huracan: { name: '2018 Lamborghini Huracán Performante', short: 'Huracán', gen: 'LP640-4 · 5.2 V10' },
    f458: { name: '2015 Ferrari 458 Speciale', short: '458', gen: 'F142 · 4.5 V8' },
    golfr: { name: '2024 Volkswagen Golf R', short: 'Golf R', gen: 'Mk8 · 2.0 TSI' },
    delta: { name: '1992 Lancia Delta HF Integrale', short: 'Delta', gen: 'Evo I · 2.0 turbo' },
  };
  const CAR_ORDER = ['m3', 'rs4', 'gt3', 'golfr', 'delta', 'f458', 'huracan'];

  const SELLERS = {
    anjali: { name: 'Anjali Kumari', av: 'img/av-anjali.jpg', loc: 'Leeds, UK', sold: 4, pr: 'her' },
    felix: { name: 'Felix Brandt', av: 'img/av-felix.jpg', loc: 'Cologne, DE', sold: 7, pr: 'his' },
    imani: { name: 'Imani Okafor', av: 'img/av-imani.jpg', loc: 'Miami, FL', sold: 2, pr: 'her' },
    dario: { name: 'Dario Conti', av: 'img/av-dario.jpg', loc: 'London, UK', sold: 5, pr: 'his' },
    marisol: { name: 'Marisol Vega', av: 'img/av-marisol.jpg', loc: 'Austin, TX', sold: 1, pr: 'her' },
    viz: { name: 'Viz Check', initials: 'VC', loc: null, sold: 3, pr: 'their' },
    dana: { name: 'Dana Rossi', initials: 'DR', loc: 'Bristol, UK', sold: 9, pr: 'her' },
  };

  const GRADES = {
    A: 'Fully functional, light cosmetic wear at most. Ready to fit.',
    B: 'Fully functional, visible cosmetic wear. Check the photo and notes.',
    N: 'New and unused, in original packaging.',
  };

  const L = (o) => Object.assign({ pickup: false, fits: [], universal: false, grade: 'A', qa: [] }, o);
  const LISTINGS = [
    L({ id: 'rs4-manifold', title: 'Audi 4.2 FSI V8 intake manifold (B7 RS4)', price: 120, ship: 10, cond: 'Used', loc: 'Leeds, UK', seller: 'anjali', car: 'rs4', cat: 'engine', img: 'img/rs4-manifold.jpg', brand: 'Audi', fits: ['rs4'], grade: 'B', age: 2,
      note: 'Original intake manifold, removed during a carbon clean',
      desc: 'Original manifold off the BNS V8, removed at 61,000 miles during a carbon clean when I fitted a refurbished spare. Runner flaps move freely and the flap motor works. Gaskets not included.',
      specs: [['Brand', 'Audi'], ['Engine', '4.2 FSI V8 (BNS)'], ['Mileage at removal', '61,000 mi'], ['In the box', 'Manifold with flap motor']] }),
    L({ id: 'gt3-wheels', title: '992 GT3 centre-lock wheels with Michelin Pilot Sport Cup 2', price: 5200, ship: 280, pickup: true, cond: 'Used', loc: 'Cologne, DE', seller: 'felix', car: 'gt3', cat: 'wheels', img: 'img/wheels-gt3.jpg', brand: 'Porsche', fits: ['gt3'], age: 5,
      note: 'Factory centre-lock wheels, swapped for a track set',
      desc: 'Factory forged centre-lock wheels with Cup 2 tyres at around 5mm. No kerb rash; swapped for a dedicated track set. Centre-lock nuts included.',
      specs: [['Brand', 'Porsche'], ['Front', '9.5J × 20, 255/35 ZR20'], ['Rear', '12J × 21, 315/30 ZR21'], ['Tyres', 'Michelin Pilot Sport Cup 2, ~5mm'], ['In the box', '4 wheels, tyres, centre-lock nuts']] }),
    L({ id: 's54-baffle', title: 'BMW S54 oil pan baffle — track spec', short: 'S54 oil pan baffle', blurb: 'Stops oil surge in long corners. Came out at the last engine-out service.', price: 180, ship: 12, cond: 'Used', loc: 'Austin, TX', seller: 'marisol', car: 'm3', cat: 'engine', img: null, brand: 'Beisan Systems', fits: ['m3'], age: 7, k: .25,
      note: 'Beisan baffle, removed at the last engine-out service',
      desc: 'Beisan Systems baffle with trap doors. Stops oil surge in long, fast corners. Came out at the last engine-out service; no cracks and every door swings freely.',
      specs: [['Brand', 'Beisan Systems'], ['Fits', 'S54 engine (E46 M3)'], ['In the box', 'Baffle, bolts']] }),
    L({ id: 'gt3-seats', title: 'Porsche 992 GT3 full bucket seats, carbon (pair)', price: 11500, ship: 350, pickup: true, cond: 'Used', loc: 'Cologne, DE', seller: 'felix', car: 'gt3', cat: 'interior', img: 'img/seats-gt3.jpg', brand: 'Porsche', fits: ['gt3'], age: 9,
      note: 'Factory full buckets, swapped for comfort seats',
      desc: 'Pair of carbon full bucket seats with Race-Tex centres and 8,000 miles of road use. Bolster wear is minimal; airbag and belt-sensor connectors are intact.',
      specs: [['Brand', 'Porsche'], ['Shell', 'Carbon-fibre reinforced plastic'], ['Upholstery', 'Race-Tex centres, leather bolsters'], ['In the box', 'Pair of seats with rails']] }),
    L({ id: 'akrapovic', title: 'Akrapovič Evolution titanium exhaust, Huracán Performante', price: 6400, ship: 220, pickup: true, cond: 'Used', loc: 'Miami, FL', seller: 'imani', car: 'huracan', cat: 'performance', img: 'img/akrapovic.jpg', brand: 'Akrapovič', fits: ['huracan'], age: 12,
      note: 'Full titanium system, back to stock for resale',
      desc: 'Full titanium Evolution system with the valve controller. About 4,000 miles on it; heat colouring on the tips as you would expect, no dents or cracks.',
      specs: [['Brand', 'Akrapovič'], ['Material', 'Titanium, carbon tips'], ['Valves', 'Yes, with controller'], ['In the box', 'Mufflers, link pipes, tips, clamps']] }),
    L({ id: 'wing', title: 'Huracán Performante forged carbon rear wing', price: 8900, ship: 300, pickup: true, cond: 'Used', loc: 'Miami, FL', seller: 'imani', car: 'huracan', cat: 'exterior', img: 'img/wing.jpg', brand: 'Lamborghini', fits: ['huracan'], age: 13,
      note: 'Factory forged composite wing',
      desc: 'Factory forged composite rear wing with its ALA flaps. One stone chip on the leading edge; flaps tested before removal.',
      specs: [['Brand', 'Lamborghini'], ['Material', 'Forged composite'], ['Marks', 'One stone chip, leading edge'], ['In the box', 'Wing, uprights, fixings']] }),
    L({ id: 'capristo', title: 'Capristo valved exhaust, 458 Italia/Speciale', price: 4200, ship: 180, pickup: true, cond: 'Used', loc: 'London, UK', seller: 'dario', car: 'f458', cat: 'performance', img: 'img/capristo.jpg', brand: 'Capristo', fits: ['f458'], age: 16,
      note: 'Valved rear section; the car is going back to standard',
      desc: 'Capristo valved system with remote. Fitted for two summers. Sold because the car is going back to standard.',
      specs: [['Brand', 'Capristo'], ['Fits', '458 Italia, 458 Speciale'], ['Valves', 'Yes, remote included'], ['In the box', 'Rear section, valves, remote']] }),
    L({ id: 'f458-wheels', title: 'Ferrari 458 Speciale forged 20in wheels, set of 4', price: 6800, ship: 240, pickup: true, cond: 'Used', loc: 'London, UK', seller: 'dario', car: 'f458', cat: 'wheels', img: 'img/wheels-458.jpg', brand: 'Ferrari', fits: ['f458'], age: 17,
      note: 'Factory forged wheels, refurbished once',
      desc: 'Speciale forged wheels, set of four. Refurbished once by a Ferrari specialist. Tyres not included.',
      specs: [['Brand', 'Ferrari'], ['Size', '20in, forged'], ['Tyres', 'Not included'], ['In the box', '4 wheels, centre caps']] }),
    L({ id: 'big-brake-kit', title: 'Big brake kit — 355mm rotors, 4-pot calipers, lines', price: 1450, ship: 95, pickup: true, cond: 'Used', loc: 'Austin, TX', seller: 'marisol', car: 'm3', cat: 'brakes', img: 'img/brakes.jpg', brand: 'StopTech', fits: ['m3'], age: 20,
      note: 'StopTech ST-40 big brake kit, 355mm rotors, 4-pot calipers',
      desc: 'Complete front kit, one season of track use. Rotors have life left, calipers rebuilt with new seals before removal. Pads included are down to half.',
      specs: [['Brand', 'StopTech'], ['Model', 'ST-40'], ['Rotors', '355mm two-piece'], ['Calipers', '4-piston'], ['In the box', 'Calipers, rotors, brackets, braided lines, pads at 50%']],
      qa: [
        { who: 'Kaito N.', when: '2 weeks ago', q: 'Are the rotors two-piece? And what minimum thickness is stamped on them?', a: 'Yes, two-piece with aluminium hats. Minimum is stamped at 30mm and they measure 31.4mm today.' },
        { who: 'Tommy E.', when: '5 days ago', q: 'Will these clear 18-inch wheels? I am on the stock Style 67s.', a: 'They cleared my 18in Apex ARC-8s with no spacers. Stock 18s are tight on the caliper, so measure your spoke clearance before you buy.' },
      ] }),
    L({ id: 'golf-grille', title: 'Golf R Mk8 front grille, gloss black', short: 'Mk8 front grille', blurb: 'Still boxed. It never went on the car.', price: 140, ship: 25, cond: 'New', loc: null, seller: 'viz', car: 'golfr', cat: 'exterior', img: null, brand: 'Volkswagen', fits: ['golfr'], grade: 'N', age: 21, k: .8,
      note: 'Spare grille, never fitted',
      desc: 'Still in its box. I bought it the same week the facelift grille arrived, so it never went on.',
      specs: [['Brand', 'Volkswagen'], ['Fits', 'Golf R Mk8'], ['In the box', 'Grille with clips']] }),
    L({ id: 'ohlins', title: 'Öhlins Road & Track coilovers, 12k miles', price: 1450, ship: 45, cond: 'Used', loc: null, seller: 'viz', car: 'golfr', cat: 'brakes', img: 'img/ohlins.jpg', brand: 'Öhlins', fits: ['golfr'], age: 24,
      note: 'Road & Track kit, 12,000 miles',
      desc: 'Öhlins Road & Track coilovers with 12,000 miles. Dual-flow-valve dampers, set 10 clicks from full soft. No leaks; top mounts included.',
      specs: [['Brand', 'Öhlins'], ['Model', 'Road & Track'], ['Mileage', '12,000 mi'], ['In the box', '4 dampers, springs, top mounts']] }),
    L({ id: 'kw', title: 'KW Variant 2 coilovers — Delta HF fitment', price: 680, ship: 0, cond: 'Used', loc: 'Bristol, UK', seller: 'dana', car: 'delta', cat: 'brakes', img: 'img/kw.jpg', brand: 'KW', fits: ['delta'], grade: 'B', age: 30,
      note: 'Variant 2 kit, set for fast road',
      desc: 'KW Variant 2 kit made for the Delta HF Integrale. Rebound adjustable, height set for fast road.',
      specs: [['Brand', 'KW'], ['Model', 'Variant 2'], ['Adjustment', 'Height, rebound'], ['In the box', '4 dampers, springs, tools']] }),
    L({ id: 'sabelt', title: 'Sabelt bucket seat — driver side', price: 290, ship: 0, cond: 'Used', loc: 'Bristol, UK', seller: 'dana', car: 'delta', cat: 'interior', img: 'img/sabelt.jpg', brand: 'Sabelt', universal: true, age: 31,
      note: 'Fixed-back bucket from the driver side',
      desc: 'Sabelt fixed-back bucket, driver side. Side-mount, so you will need a subframe for your car.',
      specs: [['Brand', 'Sabelt'], ['Mounting', 'Side-mount (universal)'], ['In the box', 'Seat, side brackets']] }),
    L({ id: 'mishimoto', title: 'Mishimoto aluminium radiator — E46 M3', short: 'Aluminium radiator', blurb: 'Two seasons on the car. Flushed and pressure-tested before removal.', price: 260, ship: 40, cond: 'Like new', loc: 'Austin, TX', seller: 'marisol', car: 'm3', cat: 'engine', img: null, brand: 'Mishimoto', fits: ['m3'], age: 33, k: .55,
      note: 'Aluminium radiator, two seasons of use',
      desc: 'Two seasons on the car. Flushed and pressure-tested before removal; no bent fins worth mentioning.',
      specs: [['Brand', 'Mishimoto'], ['Core', '2-row aluminium'], ['In the box', 'Radiator, drain plug']] }),
  ];
  const byId = Object.fromEntries(LISTINGS.map((l) => [l.id, l]));
  const href = (l) => `listing.html?id=${encodeURIComponent(l.id)}`;
  const shipLine = (l) => (l.ship > 0 ? `+ ${money(l.ship)} shipping` : 'Shipping included') + (l.pickup ? ' · Pickup available' : '');
  const metaLine = (l) => {
    // brand only when the title does not already say it
    const brand = l.brand && !l.title.toLowerCase().includes(l.brand.toLowerCase().split(' ')[0]) ? l.brand : null;
    return [brand, l.cond, l.loc].filter(Boolean).join(' · ');
  };
  const avatar = (s, cls = '') => (s.av
    ? `<img class="av ${cls}" src="${s.av}" alt="" width="28" height="28" loading="lazy">`
    : `<span class="av av--initials ${cls}" aria-hidden="true">${s.initials}</span>`);
  const fitFor = (l, carId) => (!carId ? null : l.universal ? 'universal' : l.fits.includes(carId) ? 'yes' : 'check');
  const FIT_TEXT = { yes: 'Fits', check: 'Check fit', universal: 'Universal' };
  const svg = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const SOON_CAR = (c) => `Garage pages aren't part of this mockup. This would open ${c.nick ? c.nick + ', ' : ''}the ${c.name}.`;

  /* ───────── shared state ───────── */
  let cart = store.get('nm-cart', []).filter((id) => byId[id]);
  const saved = new Set(store.get('nm-saved', []).filter((id) => byId[id] || /^(p|b):/.test(id)));
  const getVehicle = () => { const v = store.get('nm-vehicle', null); return CARS[v] ? v : null; };
  const setVehicle = (v) => store.set('nm-vehicle', v);

  /* ───────── card ───────── */
  function cardHTML(l, i = 0, carId = null, opts = {}) {
    const s = SELLERS[l.seller];
    const c = CARS[l.car];
    const fit = fitFor(l, carId);
    const inCart = cart.includes(l.id);
    const isSaved = saved.has(l.id);
    const media = l.img
      ? `<img src="${l.img}" alt="${esc(l.title)}" width="1400" height="1050">`
      : `<div class="card__type" style="--k:${l.k ?? .5}"><span class="label">${esc(catName(l.cat))}</span><b>${esc(l.short || l.title)}</b><span>${esc(l.blurb || '')}</span></div>`;
    return `<article class="card${opts.large ? ' lpost' : ''}${opts.inset ? ' card--paired' : ''}" data-id="${l.id}" style="--i:${Math.min(i, 12)}">
      <div class="card__media">
        ${media}
        ${opts.label ? `<span class="card__label card__label--sale">${svg('i-tag')}For sale</span>` : ''}
        ${opts.inset ? `<span class="card__inset"><img src="${opts.inset.img}" alt="Came off ${esc(opts.inset.nick)}, ${esc(opts.inset.model)}" loading="lazy"></span>` : ''}
        ${fit ? `<span class="fitbadge" data-fit="${fit}">${FIT_TEXT[fit]}<span class="sr"> for your ${esc(CARS[carId].name)}</span></span>` : ''}
        <button class="card__save" type="button" aria-pressed="${isSaved}" aria-label="Save ${esc(l.title)}">${svg('i-bookmark')}</button>
        <button class="card__add${inCart ? ' is-in' : ''}" type="button" aria-label="${inCart ? 'In cart' : 'Add to cart'}: ${esc(l.title)}">${svg(inCart ? 'i-check' : 'i-cart')}<span aria-hidden="true">${inCart ? 'In cart' : 'Add to cart'}</span></button>
      </div>
      <div class="card__body">
        <h3 class="card__title"><a href="${href(l)}">${esc(l.title)}</a></h3>
        <p class="card__price">${money(l.price)}</p>
        <p class="card__ship">${shipLine(l)}</p>
        <p class="card__meta">${esc(metaLine(l))}</p>
        <div class="byline">
          ${avatar(s)}
          <p class="byline__text"><span class="byline__name">${esc(s.name)}</span><a class="byline__car" href="#" data-soon="${esc(SOON_CAR(c))}">Off my ${esc(c.name)}</a></p>
        </div>
      </div>
    </article>`;
  }
  function syncCardButtons(root = document) {
    $$('.card[data-id]', root).forEach((card) => {
      const id = card.dataset.id; const l = byId[id];
      const add = $('.card__add', card); const inCart = cart.includes(id);
      add.classList.toggle('is-in', inCart);
      add.setAttribute('aria-label', `${inCart ? 'In cart' : 'Add to cart'}: ${l.title}`);
      add.innerHTML = `${svg(inCart ? 'i-check' : 'i-cart')}<span aria-hidden="true">${inCart ? 'In cart' : 'Add to cart'}</span>`;
      $('.card__save', card).setAttribute('aria-pressed', saved.has(id));
    });
  }

  /* ───────── toast (top layer popover) ───────── */
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg;
    try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (e) { t.hidden = false; }
    clearTimeout(t._h);
    t._h = setTimeout(() => { try { t.hidePopover(); } catch (e) { t.hidden = true; } }, 3600);
  }

  /* ───────── dialogs: modal, focus trap, Esc, return focus ───────── */
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const stack = [];
  const Dlg = {
    open(d, opener) {
      if (!d || d.open) return;
      d._opener = opener || document.activeElement;
      d.dispatchEvent(new CustomEvent('nm:open'));
      d.showModal();
      stack.push(d);
      document.documentElement.classList.add('has-dlg');
      const f = $('[data-autofocus]', d) || $$(FOCUSABLE, d).find((el) => el.offsetParent !== null);
      if (f) f.focus();
    },
    close(d) {
      if (!d || !d.open || d.classList.contains('is-closing')) return;
      const finish = () => {
        d.classList.remove('is-closing'); d.close();
        const i = stack.indexOf(d); if (i > -1) stack.splice(i, 1);
        if (!stack.length) document.documentElement.classList.remove('has-dlg');
        d.dispatchEvent(new CustomEvent('nm:closed'));
        const o = d._opener; if (o && o.isConnected && typeof o.focus === 'function') o.focus();
      };
      if (reduced()) return finish();
      d.classList.add('is-closing'); setTimeout(finish, 170);
    },
  };
  function wireDialogs() {
    $$('dialog.dlg').forEach((d) => {
      d.addEventListener('cancel', (e) => { e.preventDefault(); Dlg.close(d); });
      d.addEventListener('click', (e) => { if (e.target === d) Dlg.close(d); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !stack.length) return;
      const d = stack[stack.length - 1];
      const f = $$(FOCUSABLE, d).filter((el) => el.offsetParent !== null && !(el.type === 'radio' && !el.checked && $$(`input[name="${el.name}"]:checked`, d).length));
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !d.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('click', (e) => {
      const op = e.target.closest('[data-open]');
      if (op) { e.preventDefault(); Dlg.open(document.getElementById(op.dataset.open), op); return; }
      const cl = e.target.closest('[data-close]');
      if (cl) { e.preventDefault(); Dlg.close(cl.closest('dialog')); return; }
      const soon = e.target.closest('[data-soon]');
      if (soon) { e.preventDefault(); toast(soon.dataset.soon); }
    });
  }

  /* ───────── cart ───────── */
  const saveCart = () => store.set('nm-cart', cart);
  function bumpBadge() {
    $$('[data-cart-count]').forEach((b) => { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); });
  }
  function renderCartCount() {
    $$('[data-cart-count]').forEach((b) => { b.textContent = cart.length; b.hidden = cart.length === 0; });
    $$('[data-cart-label]').forEach((b) => b.setAttribute('aria-label', `Cart, ${cart.length} ${cart.length === 1 ? 'item' : 'items'}`));
  }
  function renderCart() {
    renderCartCount();
    const body = $('#cartBody'); const foot = $('#cartFoot'); if (!body) return;
    $('#cartTitleN').textContent = cart.length ? `(${cart.length})` : '';
    if (!cart.length) {
      body.innerHTML = `<div class="cempty">${svg('i-cart')}<h3>Your cart is empty</h3><p>Parts you add show up here, grouped by seller.</p><a class="btn btn--quiet btn--sm" href="marketplace.html">Browse the marketplace</a></div>`;
      foot.hidden = true; return;
    }
    foot.hidden = false;
    const groups = {};
    cart.forEach((id) => { const l = byId[id]; (groups[l.seller] = groups[l.seller] || []).push(l); });
    body.innerHTML = Object.entries(groups).map(([sid, items]) => {
      const s = SELLERS[sid];
      return `<section class="cgroup" aria-label="From ${esc(s.name)}">
        <p class="cgroup__head">${avatar(s)}<span>From ${esc(s.name)}${s.loc ? ' · ' + esc(s.loc) : ''}</span></p>
        <ul>${items.map((l) => `<li class="line">
          <div class="line__img">${l.img ? `<img src="${l.img}" alt="" loading="lazy">` : `<b>${esc(l.short || l.title)}</b>`}</div>
          <div>
            <p class="line__title"><a href="${href(l)}">${esc(l.title)}</a></p>
            <div class="line__row"><span class="line__price">${money(l.price)}</span><span class="line__ship">${l.ship > 0 ? '+ ' + money(l.ship) + ' shipping' : 'Shipping included'}</span></div>
            <div class="line__row"><span class="line__ship">${esc(l.cond)}${l.pickup ? ' · Pickup available' : ''}</span><button class="textbtn" type="button" data-remove="${l.id}" aria-label="Remove ${esc(l.title)}">Remove</button></div>
          </div></li>`).join('')}</ul></section>`;
    }).join('');
    const sub = cart.reduce((a, id) => a + byId[id].price, 0);
    const ship = cart.reduce((a, id) => a + byId[id].ship, 0);
    $('#cartSub').textContent = money(sub);
    $('#cartShip').textContent = ship ? money(ship) : 'Included';
    $('#cartTotal').textContent = money(sub + ship);
  }
  function addToCart(id, opener) {
    if (!cart.includes(id)) { cart.push(id); saveCart(); bumpBadge(); }
    renderCart(); syncCardButtons();
    document.dispatchEvent(new CustomEvent('nm:cart'));
    Dlg.open($('#cart'), opener);
  }
  function removeFromCart(id) {
    cart = cart.filter((x) => x !== id); saveCart(); renderCart(); syncCardButtons();
    document.dispatchEvent(new CustomEvent('nm:cart'));
    const next = $('#cartBody [data-remove]') || $('#cartBody a') || $('#cart [data-close]');
    if (next) next.focus();
  }
  function toggleSave(id) {
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    store.set('nm-saved', [...saved]);
    return saved.has(id);
  }

  /* ───────── shared shell ───────── */
  function initShell() {
    wireDialogs();
    renderCart();
    $('#cartBody')?.addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) removeFromCart(b.dataset.remove); });
    $('#checkout')?.addEventListener('click', () => toast("Checkout isn't part of this mockup. Payment would be held until each part arrives."));
    const hdr = $('.hdr');
    const onScroll = () => hdr && hdr.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    // card actions, anywhere a card appears
    document.addEventListener('click', (e) => {
      const save = e.target.closest('.card__save');
      if (save) {
        const id = save.closest('.card').dataset.id || save.dataset.savekey; const on = toggleSave(id);
        $$(`[data-savekey="${id}"]`).forEach((b) => b.setAttribute('aria-pressed', on));
        save.setAttribute('aria-pressed', on); toast(on ? 'Saved. Find it under Saved in the top bar.' : 'Removed from saved.');
        return;
      }
      const add = e.target.closest('.card__add');
      if (add) addToCart(add.closest('.card').dataset.id, add);
    });
    window.addEventListener('storage', (e) => { if (e.key === 'nm-cart') { cart = store.get('nm-cart', []).filter((id) => byId[id]); renderCart(); syncCardButtons(); } });
  }

  /* ───────── marketplace ───────── */
  function initMarket() {
    const params = new URLSearchParams(location.search);
    const state = { cat: CATS.some((c) => c.id === params.get('cat')) ? params.get('cat') : 'all', q: params.get('q') || '', sort: 'newest', cond: '', brand: '', from: '', min: null, max: null, vehicle: CARS[params.get('vehicle')] ? params.get('vehicle') : getVehicle() };
    if (state.vehicle) setVehicle(state.vehicle);
    const grid = $('#grid'); const form = $('#rail');
    const f = { cond: $('#fCond'), brand: $('#fBrand'), from: $('#fFrom'), min: $('#fMin'), max: $('#fMax'), q: $('#findin'), sort: $('#sort') };
    f.q.value = state.q;
    $$('.hsearch input[name="q"]').forEach((i) => { i.value = state.q; });

    // categories with counts
    $('#cats').innerHTML = CATS.map((c) => {
      const n = c.id === 'all' ? LISTINGS.length : LISTINGS.filter((l) => l.cat === c.id).length;
      return `<li><button class="cat" type="button" data-cat="${c.id}" aria-pressed="${state.cat === c.id}">${svg(c.icon)}<span>${c.name}</span><span class="cat__n">${n}</span></button></li>`;
    }).join('');
    // brands from the data
    [...new Set(LISTINGS.map((l) => l.brand))].sort((a, b) => a.localeCompare(b)).forEach((b) => f.brand.add(new Option(b, b)));

    const hay = (l) => [l.title, l.brand, SELLERS[l.seller].name, CARS[l.car].name, catName(l.cat), l.loc || ''].join(' ').toLowerCase();
    function results() {
      const q = state.q.trim().toLowerCase();
      let list = LISTINGS.filter((l) => (state.cat === 'all' || l.cat === state.cat)
        && (!state.cond || l.cond === state.cond)
        && (!state.brand || l.brand === state.brand)
        && (!state.from || (l.loc || '').toLowerCase().includes(state.from.toLowerCase()))
        && (state.min == null || l.price >= state.min)
        && (state.max == null || l.price <= state.max)
        && (!q || q.split(/\s+/).every((w) => hay(l).includes(w))));
      if (state.sort === 'low') list = list.sort((a, b) => a.price - b.price);
      else if (state.sort === 'high') list = list.sort((a, b) => b.price - a.price);
      else list = list.sort((a, b) => a.age - b.age);
      return list;
    }
    function chips() {
      const out = [];
      if (state.vehicle) out.push({ k: 'vehicle', label: `<span class="chip__k">Fit:</span> ${esc(CARS[state.vehicle].name)}`, cls: 'chip--fit', aria: `vehicle ${CARS[state.vehicle].name}` });
      if (state.cat !== 'all') out.push({ k: 'cat', label: esc(catName(state.cat)), aria: catName(state.cat) });
      if (state.q) out.push({ k: 'q', label: `<span class="chip__k">Search:</span> “${esc(state.q)}”`, aria: `search ${state.q}` });
      if (state.cond) out.push({ k: 'cond', label: `<span class="chip__k">Condition:</span> ${esc(state.cond)}`, aria: `condition ${state.cond}` });
      if (state.brand) out.push({ k: 'brand', label: `<span class="chip__k">Brand:</span> ${esc(state.brand)}`, aria: `brand ${state.brand}` });
      if (state.from) out.push({ k: 'from', label: `<span class="chip__k">Ships from:</span> ${esc(state.from)}`, aria: `ships from ${state.from}` });
      if (state.min != null || state.max != null) {
        const t = state.min != null && state.max != null ? `${money(state.min)}–${money(state.max)}` : state.min != null ? `${money(state.min)} and up` : `Up to ${money(state.max)}`;
        out.push({ k: 'price', label: `<span class="chip__k">Price:</span> ${t}`, aria: `price ${t}` });
      }
      const el = $('#chips');
      el.hidden = !out.length;
      el.innerHTML = out.map((c) => `<span class="chip ${c.cls || ''}">${c.label}<button type="button" data-chip="${c.k}" aria-label="Remove filter: ${esc(c.aria)}">${svg('i-close')}</button></span>`).join('')
        + (out.length > 1 ? '<button class="textbtn" type="button" data-chip="all">Clear all</button>' : '');
      const nFilters = [state.cond, state.brand, state.from, state.min != null || state.max != null, state.cat !== 'all'].filter(Boolean).length;
      const fb = $('#filterN'); fb.textContent = nFilters; fb.hidden = !nFilters;
    }
    function render(first = false) {
      const list = results();
      $$('.cat').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cat === state.cat));
      const n = list.length;
      $('#countN').textContent = `${n} ${n === 1 ? 'part' : 'parts'}`;
      let fitText = '';
      if (state.vehicle) {
        const yes = list.filter((l) => fitFor(l, state.vehicle) === 'yes').length;
        const uni = list.filter((l) => fitFor(l, state.vehicle) === 'universal').length;
        fitText = `${yes} fit your ${CARS[state.vehicle].short}${uni ? ` · ${uni} universal` : ''}`;
      }
      $('#countFit').textContent = fitText; $('#countFit').hidden = !fitText;
      // vehicle button
      const vb = $('#vbtn');
      if (state.vehicle) {
        vb.innerHTML = `<span class="vbtn__dot" aria-hidden="true"></span>${esc(CARS[state.vehicle].name)} <span class="vbtn__change">· Change</span>`;
        vb.setAttribute('aria-label', `Vehicle: ${CARS[state.vehicle].name}. Change vehicle`);
        $('#vlead').textContent = 'Showing fit for';
      } else {
        vb.innerHTML = `${svg('i-car')}Choose vehicle`; vb.removeAttribute('aria-label');
        $('#vlead').textContent = 'Shopping for a vehicle?';
      }
      grid.classList.toggle('is-first', first && !reduced());
      grid.innerHTML = n ? list.map((l, i) => cardHTML(l, i, state.vehicle)).join('')
        : `<div class="empty"><h3>No parts match those filters</h3><p>Try a wider price range or another category. New parts are listed every day.</p><button class="btn btn--quiet btn--sm" type="button" data-chip="all">Clear filters</button></div>`;
      chips();
      $('#live').textContent = `${n} ${n === 1 ? 'part' : 'parts'}${fitText ? ', ' + fitText : ''}`;
    }
    function syncForm() {
      f.cond.value = state.cond; f.brand.value = state.brand; f.from.value = state.from;
      f.min.value = state.min ?? ''; f.max.value = state.max ?? ''; f.q.value = state.q;
      $('#priceErr').hidden = true; f.min.removeAttribute('aria-invalid'); f.max.removeAttribute('aria-invalid');
    }
    function applyForm() {
      const num = (v) => (v.trim() === '' ? null : Math.max(0, Number(v.replace(/[$,]/g, ''))));
      const min = num(f.min.value); const max = num(f.max.value);
      const err = $('#priceErr');
      if ((min != null && isNaN(min)) || (max != null && isNaN(max))) { err.textContent = 'Use numbers only, like 500.'; err.hidden = false; (isNaN(min) ? f.min : f.max).setAttribute('aria-invalid', 'true'); return false; }
      if (min != null && max != null && min > max) { err.textContent = 'Min is above max.'; err.hidden = false; f.min.setAttribute('aria-invalid', 'true'); f.min.focus(); return false; }
      err.hidden = true; f.min.removeAttribute('aria-invalid'); f.max.removeAttribute('aria-invalid');
      Object.assign(state, { cond: f.cond.value, brand: f.brand.value, from: f.from.value.trim(), min, max });
      render(); return true;
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); if (applyForm()) { const d = form.closest('dialog'); if (d) Dlg.close(d); } });
    $('#fReset').addEventListener('click', () => { Object.assign(state, { cat: 'all', cond: '', brand: '', from: '', min: null, max: null }); syncForm(); render(); });
    $('#cats').addEventListener('click', (e) => { const b = e.target.closest('.cat'); if (!b) return; state.cat = b.dataset.cat; render(); });
    let qt;
    f.q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { state.q = f.q.value; render(); }, 140); });
    $('#findForm').addEventListener('submit', (e) => { e.preventDefault(); state.q = f.q.value; render(); });
    f.sort.addEventListener('change', () => { state.sort = f.sort.value; render(); });
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-chip]'); if (!c) return;
      const k = c.dataset.chip;
      if (k === 'all') { Object.assign(state, { cat: 'all', q: '', cond: '', brand: '', from: '', min: null, max: null, vehicle: null }); setVehicle(null); }
      else if (k === 'vehicle') { state.vehicle = null; setVehicle(null); }
      else if (k === 'cat') state.cat = 'all';
      else if (k === 'price') { state.min = null; state.max = null; }
      else state[k] = '';
      syncForm(); render();
      ($('#chips button') || $('#findin')).focus();
    });
    document.addEventListener('nm:cart', () => syncCardButtons(grid));

    // vehicle chooser
    const vdlg = $('#vehicle');
    $('#vlist').innerHTML = CAR_ORDER.map((id) => {
      const c = CARS[id];
      const n = LISTINGS.filter((l) => l.fits.includes(id)).length;
      return `<label class="vopt"><input class="radio" type="radio" name="vehicle" value="${id}"><span><span class="vopt__name">${esc(c.name)}</span><span class="vopt__sub">${esc(c.gen)}</span></span><span class="vopt__n">${n} listed</span></label>`;
    }).join('');
    vdlg.addEventListener('nm:open', () => {
      $$('input[name="vehicle"]', vdlg).forEach((r) => { r.checked = r.value === state.vehicle; });
      const chk = $('input[name="vehicle"]:checked', vdlg) || $('input[name="vehicle"]', vdlg);
      $$('[data-autofocus]', vdlg).forEach((x) => x.removeAttribute('data-autofocus')); chk.setAttribute('data-autofocus', '');
    });
    $('#vehicleForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('input[name="vehicle"]:checked', vdlg);
      if (!v) { $('#vErr').hidden = false; return; }
      $('#vErr').hidden = true;
      state.vehicle = v.value; setVehicle(v.value); render(); Dlg.close(vdlg);
      toast(`Showing fit for your ${CARS[v.value].name}.`);
    });
    $('#vClear').addEventListener('click', () => { state.vehicle = null; setVehicle(null); render(); Dlg.close(vdlg); });

    // the rail becomes a sheet below 1024px
    const fdlg = $('#filtersDlg'); const home = $('#railHome');
    fdlg.addEventListener('nm:open', () => { $('#filtersBody').append(form); });
    fdlg.addEventListener('nm:closed', () => { home.append(form); });

    render(true);
  }

  /* ───────── listing ───────── */
  function initListing() {
    const id = new URLSearchParams(location.search).get('id');
    const l = byId[id] || byId['big-brake-kit'];
    const s = SELLERS[l.seller]; const c = CARS[l.car];
    const first = s.name.split(' ')[0];
    const total = l.price + l.ship;
    const fromCar = LISTINGS.filter((x) => x.car === l.car).length;
    document.title = `${l.title} · DRVN Marketplace`;
    const ships = l.loc || 'Ask the seller';
    const specs = [...l.specs, ['Ships from', ships]];
    const offer = store.get(`nm-offer-${l.id}`, null);

    const gallery = l.img
      ? `<button class="gframe" type="button" data-open="lightbox" aria-label="View the photo full size">
           <img src="${l.img}" alt="${esc(l.title)}, laid out on the bench" width="1400" height="932">
           <span class="gframe__zoom" aria-hidden="true">${svg('i-zoom')}View full size</span>
         </button>
         <p class="gcap"><span><span class="label">1 photo</span>From the seller.</span><a class="qlink" href="#ask" data-askphoto>Ask ${esc(first)} for more photos</a></p>`
      : `<div class="gframe gframe--type card__type" style="--k:${l.k ?? .5}"><span class="label">${esc(catName(l.cat))} · No photo yet</span><b>${esc(l.short || l.title)}</b><span>${esc(l.blurb || '')}</span></div>
         <p class="gcap"><span><span class="label">No photo yet</span>The seller hasn't added a photo.</span><a class="qlink" href="#ask" data-askphoto>Ask ${esc(first)} for a photo</a></p>`;

    const similar = LISTINGS.filter((x) => x.cat === l.cat && x.id !== l.id).slice(0, 4);
    const more = LISTINGS.filter((x) => x.seller === l.seller && x.id !== l.id).slice(0, 4);
    const moreSec = (title, list, link) => (list.length ? `<section aria-labelledby="h-${link.id}">
        <div class="more__head"><h2 id="h-${link.id}">${title}</h2><a class="qlink" href="${link.href}" ${link.soon ? `data-soon="${esc(link.soon)}"` : ''}>${link.text}</a></div>
        <div class="grid grid--2">${list.map((x, i) => cardHTML(x, i + 8, getVehicle())).join('')}</div></section>` : '');
    const moreCount = [similar.length, more.length].filter(Boolean).length;

    $('#crumbs').innerHTML = `<li><a href="marketplace.html">Marketplace</a></li><li><a href="marketplace.html?cat=${l.cat}">${esc(catName(l.cat))}</a></li>`;
    $('#listing').innerHTML = `
      <div class="lst">
        <div class="lst__gallery">${gallery}</div>

        <div class="lst__buy">
          <div class="buy">
            <div>
              <p class="label">${esc(catName(l.cat))} · ${esc(l.cond)}</p>
              <h1 class="buy__title">${esc(l.title)}</h1>
            </div>

            <div class="pricebox">
              <div class="pricebox__top">
                <div><p class="label">Asking</p><p class="pricebox__amt">${money(l.price)}</p></div>
                <button class="savebtn" type="button" id="saveBtn" aria-pressed="${saved.has(l.id)}">${svg('i-bookmark')}<span>${saved.has(l.id) ? 'Saved' : 'Save'}</span></button>
              </div>
              <p class="pricebox__ship">${l.ship > 0 ? `+ ${money(l.ship)} shipping` : 'Shipping included'}${l.pickup ? ' · Pickup available' : ''} · <strong>${money(total)} item + shipping</strong></p>
              <p class="pricebox__tax">Any applicable tax and your selected delivery are confirmed at checkout.</p>
              <p class="pricebox__cond"><span class="label">Condition</span><span>${esc(l.cond)}</span></p>
            </div>

            <div>
              <div class="acts" id="acts">
                <button class="btn btn--sun" type="button" data-buy>Buy now</button>
                <button class="btn btn--quiet" type="button" id="addBtn"></button>
                <button class="btn btn--quiet${offer ? ' is-pending' : ''}" type="button" id="offerBtn" data-open="offer">${offer ? `Offer sent · ${money(offer)}` : 'Make an offer'}</button>
              </div>
              <ul class="assure">
                <li>${svg('i-user')}No account needed to buy</li>
                <li>${svg('i-lock')}Payment held until it arrives</li>
              </ul>
            </div>

            <section class="fitpanel" aria-labelledby="fitH">
              <h2 id="fitH">Will it fit your car?</h2>
              <div class="field">
                <label class="field__label" for="fitSel">Your vehicle</label>
                <select class="ctl" id="fitSel">
                  <option value="">Choose a vehicle</option>
                  ${CAR_ORDER.map((k) => `<option value="${k}">${esc(CARS[k].name)} (${esc(CARS[k].gen.split(' · ')[0])})</option>`).join('')}
                </select>
              </div>
              <div class="verdict" id="verdict" aria-live="polite"><span class="verdict__mark" aria-hidden="true"></span><div></div></div>
            </section>

            <div class="prov">
              <div class="seller">
                ${avatar(s)}
                <div><p class="seller__name">${esc(s.name)}</p><p class="seller__meta">${s.loc ? esc(s.loc) + ' · ' : ''}${s.sold} sold on DRVN</p></div>
                <a class="qlink" href="#ask" data-askfocus>Ask a question</a>
              </div>
              <section class="cameoff" aria-labelledby="offH">
                <h2 class="label" id="offH">Came off this car</h2>
                <p class="cameoff__note">${esc(l.note)}</p>
                <a class="carcard" href="#" data-soon="${esc(SOON_CAR(c))}">
                  <span class="carcard__img">${c.img ? `<img src="${c.img}" alt="${esc(c.name)}" width="997" height="502">` : svg('i-car')}</span>
                  <span>${c.nick ? `<span class="carcard__name">${esc(c.nick)}</span><span class="carcard__model">${esc(c.name)}</span>` : `<span class="carcard__name">${esc(c.name)}</span><span class="carcard__model">${esc(c.gen)}</span>`}<span class="carcard__more">${esc(first)}'s build · ${fromCar} ${fromCar === 1 ? 'part' : 'parts'} listed from it</span></span>
                  ${svg('i-arrow')}
                </a>
              </section>
            </div>

            <section class="protect" aria-labelledby="protH">
              ${svg('i-shield')}
              <div>
                <h2 id="protH">Buyer protection</h2>
                <p>Covered: the item never arrives, arrives damaged, is significantly not as described, or is the wrong item.</p>
                <p>Report a problem within 30 days of delivery and the seller has 3 days to respond before DRVN can step in.</p>
                <a class="tlink" href="#" data-open="protection">How protection &amp; disputes work</a>
              </div>
            </section>

            <div class="dispatch">
              <p>Sellers are expected to dispatch within 3 working days of a sale.</p>
              <button class="reportbtn" type="button" data-open="report">${svg('i-flag')}Report this listing</button>
            </div>
          </div>
        </div>

        <div class="lst__details">
          <section aria-labelledby="descH">
            <h2 class="sect__h" id="descH">Description</h2>
            <p class="desc">${esc(l.desc)}</p>
            <div class="cond">
              <h3 class="label">Condition — seller-declared</h3>
              <div class="grade"><span class="grade__pill">Grade ${l.grade === 'N' ? 'New' : l.grade}</span><p>${esc(GRADES[l.grade])}</p></div>
              <p class="foot">Declared by the seller at listing time and recorded on the order if you buy.</p>
            </div>
          </section>

          <section aria-labelledby="specH">
            <h2 class="sect__h" id="specH">Details</h2>
            <dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          </section>



          <section class="qa" aria-labelledby="qaH">
            <h2 class="sect__h" id="qaH" style="margin-bottom:0">Questions for the seller</h2>
            <p class="qa__note">${svg('i-eye')}<span>Public — anyone viewing this listing can read these questions and answers. Private, order-specific messaging opens once you buy.</span></p>
            <ol class="qa__list" id="qaList"></ol>
            <form class="ask" id="ask" novalidate>
              <label class="field__label" for="askText">Ask ${esc(first)} a question</label>
              <textarea class="ctl" id="askText" name="q" rows="3" maxlength="500" placeholder="Part numbers, measurements, what's in the box…" aria-describedby="askHint askErr"></textarea>
              <p class="ferr" id="askErr" hidden></p>
              <div class="ask__row"><p class="hint" id="askHint">Everyone can read your question and ${esc(first)}'s answer.</p><button class="btn btn--quiet btn--sm" type="submit">Post question</button></div>
            </form>
          </section>
        </div>
      </div>

      ${moreCount ? `<div class="more${moreCount === 1 ? ' more--one' : ''}">
        ${moreSec('Similar in this category', similar, { id: 'sim', href: `marketplace.html?cat=${l.cat}`, text: `All ${esc(catName(l.cat))}` })}
        ${moreSec(`More from ${esc(first)}`, more, { id: 'more', href: '#', text: `${esc(first)}'s parts`, soon: "Member stores (the Parts tab on a profile) aren't part of this mockup." })}
      </div>` : ''}

      <div class="buybar" id="buybar" aria-hidden="true">
        <div><span class="buybar__price">${money(l.price)}</span><span class="buybar__ship">${l.ship > 0 ? '+ ' + money(l.ship) + ' shipping' : 'Shipping included'}</span></div>
        <button class="btn btn--sun btn--sm" type="button" data-buy tabindex="-1">Buy now</button>
      </div>`;

    if (location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) requestAnimationFrame(() => t.scrollIntoView()); }

    // lightbox image
    if (l.img) { $('#lbImg').src = l.img; $('#lbImg').alt = l.title; $('#lbCap').textContent = l.title; }

    // add to cart / buy
    const addBtn = $('#addBtn');
    const syncAdd = () => { const inC = cart.includes(l.id); addBtn.innerHTML = inC ? `${svg('i-check')}In cart` : 'Add to cart'; };
    syncAdd();
    document.addEventListener('nm:cart', () => { syncAdd(); syncCardButtons($('#listing')); });
    addBtn.addEventListener('click', () => addToCart(l.id, addBtn));
    $$('[data-buy]').forEach((b) => b.addEventListener('click', () => { addToCart(l.id, b); setTimeout(() => $('#checkout')?.focus(), 60); }));

    // save
    const saveBtn = $('#saveBtn');
    saveBtn.addEventListener('click', () => {
      const on = toggleSave(l.id); saveBtn.setAttribute('aria-pressed', on); $('span', saveBtn).textContent = on ? 'Saved' : 'Save';
      toast(on ? 'Saved. Find it later under Saved parts.' : 'Removed from saved parts.');
    });

    // fit check
    const fitSel = $('#fitSel'); const verdict = $('#verdict');
    function renderFit(animate) {
      const v = fitSel.value;
      let state = ''; let title; let body;
      if (!v) { title = 'Compatibility not confirmed'; body = "Check the part number, measurements and seller's notes before buying."; }
      else if (l.universal) { state = 'universal'; title = 'Universal fit'; body = `${first} listed this as universal. ${l.desc.split('. ').slice(-1)[0]}`; }
      else if (l.fits.includes(v)) { state = 'yes'; title = 'Listed for this car'; body = `${first} listed it for the ${CARS[v].name}, and it came off ${c.nick ? c.nick + ', ' : ''}${s.pr} own ${CARS[l.car].short}.`; }
      else { state = 'no'; title = 'Not confirmed — check the part number'; body = `${first} listed this for the ${CARS[l.car].name}, not the ${CARS[v].name}. Check the part number, measurements and ${first}'s notes, or ask below.`; }
      verdict.dataset.state = state;
      $('div', verdict).innerHTML = `<strong>${esc(title)}</strong><p>${esc(body)}</p>`;
      if (animate && !reduced()) { verdict.classList.remove('is-changed'); void verdict.offsetWidth; verdict.classList.add('is-changed'); }
    }
    fitSel.value = getVehicle() || '';
    renderFit(false);
    fitSel.addEventListener('change', () => { setVehicle(fitSel.value || null); renderFit(true); });

    // Q&A
    const qaKey = `nm-qa-${l.id}`;
    const mine = store.get(qaKey, []);
    const qaList = $('#qaList');
    const qHTML = (x, isNew) => `<li class="qitem${isNew ? ' is-new' : ''}">
        <p class="label">${esc(x.who)} · ${esc(x.when)}</p>
        <p class="qitem__q">${esc(x.q)}</p>
        ${x.a ? `<div class="qitem__a"><span class="label">${esc(s.name)} · Seller</span>${esc(x.a)}</div>` : `<div class="qitem__a is-waiting"><span class="label">Awaiting answer</span>${esc(first)} usually answers within a day. Everyone viewing will see the reply.</div>`}
      </li>`;
    const renderQA = () => {
      const all = [...l.qa, ...mine];
      qaList.innerHTML = all.length ? all.map((x) => qHTML(x)).join('') : `<li class="qa__empty">No questions yet. Ask ${esc(first)} anything — answers appear here for everyone.</li>`;
    };
    renderQA();
    $('#ask').addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = $('#askText'); const err = $('#askErr'); const v = ta.value.trim();
      if (v.length < 10) { err.textContent = v ? 'Add a little more detail (at least 10 characters).' : 'Write your question first.'; err.hidden = false; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
      err.hidden = true; ta.removeAttribute('aria-invalid');
      const item = { who: 'You', when: 'just now', q: v, a: null };
      mine.push(item); store.set(qaKey, mine);
      if (!l.qa.length && mine.length === 1) qaList.innerHTML = '';
      qaList.insertAdjacentHTML('beforeend', qHTML(item, true));
      ta.value = '';
      toast(`Question posted. We'll let you know when ${first} answers.`);
    });
    $$('[data-askfocus]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $('#ask').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); $('#askText').focus({ preventScroll: true }); }));
    $$('[data-askphoto]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); const ta = $('#askText');
      if (!ta.value) ta.value = l.img ? 'Could you add photos of the rotor faces and the caliper part numbers?' : 'Could you add a photo of the part?';
      $('#ask').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); ta.focus({ preventScroll: true });
    }));

    // offer sheet
    const odlg = $('#offer'); const oform = $('#offerForm'); const amt = $('#offerAmt'); const oerr = $('#offerErr'); const olive = $('#offerLive');
    $('#oImg').src = l.img || ''; $('#oImg').hidden = !l.img;
    $('#oTitle').textContent = l.title;
    $('#oAsk').textContent = `Asking ${money(l.price)} · ${l.ship > 0 ? '+ ' + money(l.ship) + ' shipping' : 'Shipping included'}`;
    $('#oSeller').textContent = first;
    $('#quick').innerHTML = [0.9, 0.93, 0.97].map((p) => { const v = Math.round((l.price * p) / 10) * 10; return `<button type="button" data-amt="${v}">${money(v)}</button>`; }).join('');
    const parse = (v) => v.replace(/[$,\s]/g, '');
    function validate(v) {
      const s2 = parse(v);
      if (!s2) return 'Enter an amount for your offer.';
      if (!/^\d+(\.\d{1,2})?$/.test(s2)) return 'Use numbers only, like 1300.';
      const n = Number(s2);
      if (n < 1) return 'Your offer must be at least $1.';
      if (n >= l.price) return `Your offer must be under the asking price of ${money(l.price)}. To pay the asking price, use Buy now.`;
      return '';
    }
    function live() {
      const s2 = parse(amt.value); const n = Number(s2);
      if (s2 && !isNaN(n) && n > 0 && n < l.price) {
        olive.innerHTML = `If ${esc(first)} accepts, you pay <strong>${money(n)}</strong>${l.ship ? ` + ${money(l.ship)} shipping = <strong>${money(n + l.ship)}</strong>` : ', shipping included'}.${n < l.price * 0.5 ? ' Offers under half the asking price are rarely accepted.' : ''}`;
      } else olive.textContent = s2 ? '' : `Offers must be under the asking price of ${money(l.price)}.`;
    }
    odlg.addEventListener('nm:open', () => {
      $('#offerDone').hidden = true; oform.hidden = false; oerr.hidden = true; amt.removeAttribute('aria-invalid'); amt.value = ''; live();
    });
    amt.addEventListener('input', () => { if (!oerr.hidden) { const m = validate(amt.value); oerr.textContent = m; oerr.hidden = !m; amt.toggleAttribute('aria-invalid', !!m); } live(); });
    $('#quick').addEventListener('click', (e) => { const b = e.target.closest('[data-amt]'); if (!b) return; amt.value = b.dataset.amt; oerr.hidden = true; amt.removeAttribute('aria-invalid'); live(); amt.focus(); });
    oform.addEventListener('submit', (e) => {
      e.preventDefault();
      const m = validate(amt.value);
      if (m) { oerr.textContent = m; oerr.hidden = false; amt.setAttribute('aria-invalid', 'true'); amt.focus(); return; }
      const n = Number(parse(amt.value));
      store.set(`nm-offer-${l.id}`, n);
      oform.hidden = true; $('#offerDone').hidden = false;
      $('#offerDoneText').textContent = `${money(n)} for the ${l.title.split(' — ')[0].toLowerCase()}. ${first} can accept, counter or decline, and you'll hear back in Messages. Nothing is charged unless the offer is accepted.`;
      const ob = $('#offerBtn'); ob.textContent = `Offer sent · ${money(n)}`; ob.classList.add('is-pending');
      $('#offerDoneBtn').focus();
    });

    // report sheet
    const rform = $('#reportForm');
    $('#report').addEventListener('nm:open', () => { rform.hidden = false; $('#reportDone').hidden = true; $('#reportErr').hidden = true; rform.reset(); });
    rform.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!$('input[name="reason"]:checked', rform)) { $('#reportErr').hidden = false; $('input[name="reason"]', rform).focus(); return; }
      rform.hidden = true; $('#reportDone').hidden = false; $('#reportDoneBtn').focus();
    });

    // mobile buy bar, once the main actions scroll out of view
    const bar = $('#buybar'); const acts = $('#acts');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => {
        const on = !en.isIntersecting && en.boundingClientRect.top < 0;
        bar.classList.toggle('is-on', on); bar.setAttribute('aria-hidden', String(!on));
        $('button', bar).tabIndex = on ? 0 : -1;
      }).observe(acts);
    }
  }


  /* ═══════════════════════════════════════════════════════════════
     ROUND TWO — members, builds, posts, and the six new pages.
     ═══════════════════════════════════════════════════════════════ */

  /* ───────── more members (DRVN's seeded community) and public counts ───────── */
  Object.assign(SELLERS, {
    kaito: { name: 'Kaito Nakamura', av: 'img/av-kaito.jpg', loc: null, sold: 0, pr: 'his' },
    ryo: { name: 'Ryo Tanaka', av: 'img/av-ryo.jpg', loc: null, sold: 0, pr: 'his' },
    lena: { name: 'Lena Park', av: 'img/av-lena.jpg', loc: null, sold: 0, pr: 'her' },
    jade: { name: 'Jade Whitfield', av: 'img/av-jade.jpg', loc: null, sold: 0, pr: 'her' },
    marcus: { name: 'Marcus Reid', av: 'img/av-marcus.jpg', loc: null, sold: 0, pr: 'his' },
    tommy: { name: 'Tommy Eriksen', initials: 'TE', loc: null, sold: 0, pr: 'his' },
  });
  const COUNTS = { marisol: [2, 4], kaito: [1, 3], felix: [1, 3], tommy: [1, 2], dario: [1, 2], jade: [1, 1], ryo: [1, 1], lena: [1, 1], marcus: [1, 1], anjali: [1, 0], imani: [1, 0], viz: [1, 0], dana: [1, 0] };
  const carsLine = (id) => { const [c, u] = COUNTS[id] || [0, 0]; return `${c} ${c === 1 ? 'car' : 'cars'} · ${u} ${u === 1 ? 'update' : 'updates'}`; };
  SELLERS.marisol.handle = '@apexmarisol';

  Object.assign(CARS, {
    m4: { name: '2022 BMW M4 Competition', short: 'M4', gen: 'G82 · S58 3.0 straight-six' },
    z06: { name: '2023 Chevrolet Corvette Z06', short: 'Z06', gen: 'C8 · 5.5 flat-plane V8' },
  });
  CAR_ORDER.splice(3, 0, 'm4', 'z06');

  /* member cars ("builds"). fit links a build to the model key listings use */
  const BUILDS = {
    nimbus: { owner: 'marisol', nick: 'Nimbus', model: '2022 BMW M4 Competition', fit: 'm4', img: 'img/cars/nimbus-g80-m4.jpg', alt: 'Grey BMW M4 Competition on the floor of a BMW showroom', updates: 1, followers: 0, likes: 0, age: '2mo' },
    lucille: { owner: 'marisol', nick: 'Lucille', model: '2003 BMW M3', fit: 'm3', img: 'img/cars/lucille-e46-m3.jpg', alt: 'Silver E46 M3 with a red stripe and race number 05, parked by a tyre stack at a circuit', updates: 3, followers: 0, likes: 0, age: '2mo' },
    signal: { owner: 'felix', nick: 'Signal', model: '2022 Porsche 911 GT3', fit: 'gt3', img: 'img/cars/signal-992-gt3.jpg', alt: 'Yellow 992 GT3 parked in front of a grey shutter door', updates: 3, followers: 0, likes: 0, age: '1mo' },
    shirayuki: { owner: 'kaito', nick: 'Shirayuki', model: '1999 Nissan Silvia', fit: null, img: 'img/cars/shirayuki-s15.jpg', alt: 'White S15 Silvia on bronze wheels outside a Japanese tuning shop at dusk', updates: 3, followers: 0, likes: 0, age: '1mo' },
    hagane: { owner: 'ryo', nick: 'Hagane', model: '2002 Nissan Skyline GT-R', fit: null, img: 'img/cars/hagane-r34.jpg', alt: 'Gunmetal R34 GT-R with a rear wing in a concrete car park', updates: 1, followers: 0, likes: 1, age: '2mo' },
    scarlet: { owner: 'lena', nick: 'Scarlet', model: '2022 Audi TTS', fit: null, img: 'img/cars/scarlet-tts.jpg', alt: 'Red Audi TTS on a paved driveway in front of a modern house', updates: 1, followers: 0, likes: 0, age: '1mo' },
    frost: { owner: 'jade', nick: 'Frost', model: '2023 Chevrolet Corvette Z06', fit: 'z06', img: 'img/cars/frost-c8-z06.jpg', alt: 'White C8 Corvette Z06 in a busy event paddock', updates: 1, followers: 0, likes: 0, age: '1mo' },
    gruene: { owner: 'marcus', nick: 'Gruene', model: '2021 BMW M4 Competition', fit: 'm4', img: 'img/cars/gruene-g80-m4.jpg', alt: 'Green BMW M4 Competition parked outside a café on a high street', updates: 1, followers: 0, likes: 0, age: '2mo' },
    rs4: { owner: 'anjali', nick: '2007 Audi RS4 Avant', model: 'B7 RS4 Avant', fit: 'rs4', img: 'img/cars/anjali-rs4-avant.jpg', alt: 'Blue B7 RS4 Avant in a wet car park', updates: 0, followers: 0, likes: 0, age: '1mo', unnamed: true },
  };
  Object.entries(BUILDS).forEach(([id, b]) => { b.id = id; });
  const buildParts = (b) => LISTINGS.filter((l) => l.seller === b.owner && l.car === b.fit);

  const POSTS = [
    { id: 'jade-pass', owner: 'jade', build: 'frost', title: 'First real pass in the quarter', text: 'Stopped babying it. The flat-plane scream past the tree is worth the tire bill.', img: 'img/posts/jade-z06-launch.jpg', alt: 'White Z06 doing a burnout at the start line of a drag strip, crowd behind the barrier', likes: 1, comments: 1, when: '1mo ago', h: 700 },
    { id: 'felix-cup', owner: 'felix', build: 'signal', title: 'Chasing the Cup car — lap day notes', text: "Signal's third track day: new PB and a masterclass from a 992 Cup up ahead.", img: 'img/posts/felix-gt3-pit.jpg', alt: 'Rear three-quarter view of the yellow GT3 in the pit lane', likes: 0, comments: 0, when: '1mo ago', h: 720 },
    { id: 'lena-stage1', owner: 'lena', build: 'scarlet', title: 'Stage 1 weekend: intake + tune', text: 'Two mods, one Saturday, and the small coupe finally breathes.', img: 'img/posts/lena-tts-intake.jpg', alt: 'Engine bay of the red TTS with a red cone air filter fitted', likes: 0, comments: 0, when: '1mo ago', h: 740 },
    { id: 'kaito-coilovers', owner: 'kaito', build: 'shirayuki', title: 'Coilovers in — Shirayuki finally sits right', text: 'HKS Hipermax in, alignment done, wheel gap gone.', before: 'img/posts/kaito-s15-before.jpg', after: 'img/posts/kaito-s15-after.jpg', altBefore: 'the white S15 on stock wheels at stock height', altAfter: 'the same car lowered on bronze wheels', likes: 0, comments: 0, when: '1mo ago', h: 760 },
    { id: 'marcus-wheels', owner: 'marcus', build: 'gruene', title: 'Wheels and a drop — Gruene sits right', text: 'Bronze on green, the combo that was always going to happen.', before: 'img/posts/marcus-m4-wheels-before.jpg', after: 'img/posts/marcus-m4-wheels-after.jpg', altBefore: 'the green M4 on silver factory wheels', altAfter: 'the same car on bronze wheels, sitting lower', likes: 0, comments: 0, when: '2mo ago', h: 1300 },
    { id: 'lucille-dyno', owner: 'marisol', build: 'lucille', title: 'Lucille on the rollers — baseline before headers', text: 'Numbers first, mods second. Baseline dyno day for the E46.', img: 'img/posts/lucille-e46-dyno.jpg', alt: 'The silver E46 M3 strapped to a dyno in a workshop, a technician at the laptop', likes: 0, comments: 0, when: 'Aug 2026', h: 1350 },
    { id: 'ryo-teardown', owner: 'ryo', build: 'hagane', title: 'Winter teardown starts — wheels off, turbos out', text: 'The RB26 refresh begins. Everything that comes off goes up for sale.', img: 'img/posts/ryo-r34-lift.jpg', alt: 'The gunmetal R34 up on a two-post lift with its wheels off', likes: 0, comments: 0, when: '2mo ago', h: 1380 },
    { id: 'nimbus-delivery', owner: 'marisol', build: 'nimbus', title: 'Delivery day — meet Nimbus', text: 'Twenty years of M3 ownership finally led to this one. Brooklyn Grey, picked up on a Saturday morning.', img: 'img/posts/nimbus-delivery.jpg', alt: 'The grey M4 Competition in the dealership showroom on delivery day', likes: 0, comments: 0, when: 'Aug 22, 2026', h: 1500 },
    { id: 'lucille-brakes', owner: 'marisol', build: 'lucille', title: 'Brakes done before the enduro', text: 'New rotors and pads all around, fresh fluid, and the big kit is listed for whoever needs it.', img: 'img/posts/lucille-marisol-post-brakes.jpg', alt: 'A new brake rotor and caliper on the hub with the wheel off, gloves and brake cleaner on the floor', likes: 0, comments: 0, when: 'Aug 2026', h: 1420 },
    { id: 'lucille-seat', owner: 'marisol', build: 'lucille', title: 'A proper seat, finally', text: 'Fixed-back bucket in on the driver side. Lower, tighter, and the old seat is off to a good home.', img: 'img/posts/lucille-marisol-post-seat.jpg', alt: 'A blue fixed-back bucket seat fitted on the driver side, seen through the open door', likes: 0, comments: 0, when: 'Sep 2026', h: 900 },
  ];
  const postById = Object.fromEntries(POSTS.map((p) => [p.id, p]));

  const MODS = {
    nimbus: [['XPEL Ultimate Plus PPF — full front', 'Exterior'], ['BMW iDrive coding — exhaust flap, folding mirrors', 'Interior'], ['BMW M OEM 826M forged, double-spoke', 'Wheels & Tires']],
    lucille: [['Apex ARC-8 18in wheels', 'Wheels & Tires'], ['New rotors and pads, all round', 'Brakes & Suspension'], ['Fixed-back bucket seat, driver side', 'Interior'], ['Race number and red stripe livery', 'Exterior']],
  };
  const MEDIA = {
    nimbus: [['img/cars/nimbus-g80-m4.jpg', 'Nimbus on the showroom floor'], ['img/posts/nimbus-delivery.jpg', 'Delivery day']],
    lucille: [['img/cars/lucille-e46-m3.jpg', 'Lucille in the paddock, number 05'], ['img/posts/lucille-e46-dyno.jpg', 'Baseline dyno run'], ['img/posts/lucille-marisol-post-brakes.jpg', 'New rotors before the enduro'], ['img/posts/lucille-marisol-post-seat.jpg', 'The new driver-side bucket']],
  };

  /* follow, like and saved-post state (localStorage, wrapped) */
  const follows = new Set(store.get('nm-follows', []));
  const likes = new Set(store.get('nm-likes', []));
  const isMe = (id) => id === 'marisol' && document.documentElement.dataset.auth === 'in';
  const buildHref = (b) => (b.owner === 'marisol' ? `garage.html#${b.id}` : '#');
  const buildSoon = (b) => (b.owner === 'marisol' ? '' : ` data-soon="${esc(`Build pages aren't part of this mockup. This would open ${b.unnamed ? 'the ' + b.nick : b.nick}.`)}"`);

  function likeBtn(key, base) {
    const on = likes.has(key); const n = base + (on ? 1 : 0);
    return `<button class="react" type="button" data-like="${key}" data-base="${base}" aria-pressed="${on}" aria-label="Like">${svg('i-heart')}<span>${n || ''}</span></button>`;
  }
  const commentBtn = (n) => `<button class="react" type="button" data-soon="Comments open on the full post, which isn't part of this mockup." aria-label="Comments${n ? ', ' + n : ''}">${svg('i-comment')}<span>${n || ''}</span></button>`;
  const saveBtn = (key, label) => `<button class="card__save" type="button" data-savekey="${key}" aria-pressed="${saved.has(key)}" aria-label="Save ${esc(label)}">${svg('i-bookmark')}</button>`;

  function buildHTML(b, i = 0, large = false) {
    const o = SELLERS[b.owner]; const parts = buildParts(b).length;
    const facts = [b.updates ? `${b.updates} ${b.updates === 1 ? 'update' : 'updates'}` : null, parts ? `${parts} ${parts === 1 ? 'part' : 'parts'} for sale` : null].filter(Boolean).join(' · ') || 'Just added';
    return `<article class="card card--post${large ? ' lpost' : ''}" data-build="${b.id}" style="--i:${Math.min(i, 12)}">
      <div class="card__media">
        <img src="${b.img}" alt="${esc(b.alt)}" width="1400" height="1050">
        <span class="card__label">${svg('i-garage')}Build</span>
        ${saveBtn('b:' + b.id, b.nick)}
      </div>
      <div class="card__body">
        <h3 class="card__title"><a href="${buildHref(b)}"${buildSoon(b)}>${esc(b.nick)}</a></h3>
        <p class="card__ship">${esc(b.unnamed ? 'Unnamed build' : b.model)}</p>
        <p class="card__meta">${facts}</p>
        <div class="byline">${avatar(o)}<p class="byline__text"><span class="byline__name">${esc(o.name)}</span><span class="byline__name">${carsLine(b.owner)}</span></p></div>
        <div class="card__foot">${likeBtn('b:' + b.id, b.likes)}<time>${b.age} ago</time></div>
      </div>
    </article>`;
  }
  function postHTML(p, i = 0, large = false) {
    const o = SELLERS[p.owner]; const b = BUILDS[p.build];
    const media = p.before
      ? `<div class="compare"><img src="${p.before}" alt="Before: ${esc(p.altBefore)}" width="1400" height="1044"><img class="compare__after" src="${p.after}" alt="After: ${esc(p.altAfter)}" width="1400" height="1044"><span class="compare__line" aria-hidden="true"></span><span class="compare__tag compare__tag--b" aria-hidden="true">Before</span><span class="compare__tag compare__tag--a" aria-hidden="true">After</span><input type="range" min="0" max="100" value="50" aria-label="Before and after, ${esc(p.title)}: slide to compare"></div>`
      : `<img src="${p.img}" alt="${esc(p.alt)}" width="1400" height="1044"${p.portrait ? ' style="object-position:50% 40%"' : ''}>`;
    const href = p.owner === 'marisol' ? `garage.html#${p.build}` : '#';
    const soon = p.owner === 'marisol' ? '' : ` data-soon="${esc("Full posts aren't part of this mockup.")}"`;
    return `<article class="card card--post${large ? ' lpost' : ''}${p.isNew ? ' is-new' : ''}" data-post="${p.id}" style="--i:${Math.min(i, 12)}">
      <div class="card__media">
        ${media}
        <span class="card__label">${svg('i-image')}Update</span>
        ${saveBtn('p:' + p.id, p.title)}
      </div>
      <div class="card__body">
        <h3 class="card__title"><a href="${href}"${soon}>${esc(p.title)}</a></h3>
        <p class="card__excerpt">${esc(p.text)}</p>
        <div class="byline">${avatar(o)}<p class="byline__text"><span class="byline__name">${esc(o.name)}</span><a class="byline__car" href="${buildHref(b)}"${buildSoon(b)}>${esc(b.unnamed ? b.nick : b.nick + ' · ' + b.model)}</a></p></div>
        <div class="card__foot">${likeBtn('p:' + p.id, p.likes)}${commentBtn(p.comments)}<time>${esc(p.when)}</time></div>
      </div>
    </article>`;
  }
  function builderRow(id) {
    const o = SELLERS[id];
    const btn = isMe(id) ? '<span class="pill">You</span>' : `<button class="btn btn--quiet btn--sm followbtn" type="button" data-follow="${id}" aria-pressed="${follows.has(id)}">${follows.has(id) ? 'Following' : 'Follow'}</button>`;
    return `<div class="row">${avatar(o)}<span><span class="row__title">${esc(o.name)}</span><span class="row__sub">${carsLine(id)}</span></span>${btn}</div>`;
  }
  function wireCompare(root = document) {
    $$('.compare input', root).forEach((r) => { if (r._w) return; r._w = 1; r.addEventListener('input', () => r.closest('.compare').style.setProperty('--cut', r.value + '%')); });
  }

  /* tabs: role=tablist with arrow keys; panels named by aria-controls */
  function wireTabs(list, onChange) {
    const tabs = $$('[role="tab"]', list);
    const select = (t, focus) => {
      tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute('aria-controls')); if (p && p !== document.getElementById(t.getAttribute('aria-controls'))) p.hidden = true; });
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) { panel.hidden = false; if (!reduced()) { panel.classList.remove('is-in'); void panel.offsetWidth; panel.classList.add('is-in'); } }
      if (focus) t.focus();
      if (onChange) onChange(t.dataset.tab || t.id);
    };
    tabs.forEach((t) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const i = tabs.indexOf(t); let n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') n = tabs[0];
        if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
    return { select: (key) => { const t = tabs.find((x) => (x.dataset.tab || x.id) === key); if (t) select(t); } };
  }

  /* ───────── shell, round two: auth, sidebar state, saved + notifications drawers ───────── */
  function initShell2() {
    const html = document.documentElement;
    if (document.body.dataset.auth === 'in') { html.dataset.auth = 'in'; store.set('nm-auth', 'in'); }
    const nav = document.body.dataset.nav;
    $$(`[data-navkey]`).forEach((a) => { if (a.dataset.navkey === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('[data-logout]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); store.set('nm-auth', null); location.href = 'index.html'; }));
    const tb = $('.topbar');
    if (tb) { const on = () => tb.classList.toggle('is-scrolled', window.scrollY > 8); window.addEventListener('scroll', on, { passive: true }); on(); }
    // likes
    document.addEventListener('click', (e) => {
      const lb = e.target.closest('[data-like]'); if (!lb) return;
      const k = lb.dataset.like; if (likes.has(k)) likes.delete(k); else likes.add(k);
      store.set('nm-likes', [...likes]);
      const on = likes.has(k); const n = Number(lb.dataset.base) + (on ? 1 : 0);
      $$(`[data-like="${k}"]`).forEach((b) => { b.setAttribute('aria-pressed', on); $('span', b).textContent = n || ''; if (on && !reduced()) { b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop'); } });
    });
    // follows
    document.addEventListener('click', (e) => {
      const fb = e.target.closest('[data-follow]'); if (!fb) return;
      const id = fb.dataset.follow; if (follows.has(id)) follows.delete(id); else follows.add(id);
      store.set('nm-follows', [...follows]);
      const on = follows.has(id);
      $$(`[data-follow="${id}"]`).forEach((b) => { b.setAttribute('aria-pressed', on); b.textContent = on ? 'Following' : 'Follow'; });
      toast(on ? `Following ${SELLERS[id].name}. Their updates show in your Following feed.` : `Unfollowed ${SELLERS[id].name}.`);
      document.dispatchEvent(new CustomEvent('nm:follow', { detail: id }));
    });
    // saved drawer
    const sd = $('#savedDlg');
    if (sd) sd.addEventListener('nm:open', renderSaved);
    $('#savedBody')?.addEventListener('click', (e) => {
      const r = e.target.closest('[data-unsave]'); if (!r) return;
      saved.delete(r.dataset.unsave); store.set('nm-saved', [...saved]); renderSaved(); syncCardButtons();
      $$(`[data-savekey="${r.dataset.unsave}"]`).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      ($('#savedBody [data-unsave]') || $('#savedDlg [data-close]')).focus();
    });
    wireCompare();
  }
  function renderSaved() {
    const body = $('#savedBody'); if (!body) return;
    const items = [...saved];
    if (!items.length) { body.innerHTML = `<div class="cempty">${svg('i-bookmark')}<h3>Nothing saved yet</h3><p>Save parts, builds and updates and they wait for you here.</p><a class="btn btn--quiet btn--sm" href="explore.html">Explore builds</a></div>`; return; }
    body.innerHTML = '<div class="rows">' + items.map((k) => {
      let img = ''; let title = ''; let sub = ''; let link = '#';
      if (byId[k]) { const l = byId[k]; img = l.img; title = l.title; sub = `${money(l.price)} · ${shipLine(l)}`; link = href(l); }
      else if (k.startsWith('p:') && postById[k.slice(2)]) { const p = postById[k.slice(2)]; img = p.img || p.after; title = p.title; sub = `Update · ${SELLERS[p.owner].name}`; link = p.owner === 'marisol' ? `garage.html#${p.build}` : '#'; }
      else if (k.startsWith('b:') && BUILDS[k.slice(2)]) { const b = BUILDS[k.slice(2)]; img = b.img; title = b.nick; sub = `Build · ${b.model}`; link = buildHref(b); }
      else return '';
      return `<div class="row"><span class="row__thumb">${img ? `<img src="${img}" alt="">` : svg('i-tag')}</span><span><a class="row__title qlink" href="${link}">${esc(title)}</a><span class="row__sub">${esc(sub)}</span></span><button class="textbtn" type="button" data-unsave="${k}" aria-label="Remove ${esc(title)} from saved">Remove</button></div>`;
    }).join('') + '</div>';
  }

  /* ───────── landing, round two: First Light's story with DRVN's facts ───────── */
  const MODEL = (k) => { const c = CARS[k]; const words = c.name.split(' '); return `${words.slice(2).join(' ')} (${c.gen.split(' · ')[0]})`; };
  const MAKE = (k) => CARS[k].name.split(' ')[1];
  const PICK_PHOTO = {
    m3: ['img/cars/lucille-e46-m3.jpg', 'Silver E46 M3 with a red stripe and race number 05 in a circuit paddock', 'Lucille, Marisol’s 2003 M3, in the paddock. Three parts off it are listed.'],
    gt3: ['img/cars/signal-992-gt3.jpg', 'Yellow 992 GT3 parked in front of a shutter door', 'Signal, Felix’s 992 GT3. Its seats and wheels are both for sale.'],
    golfr: ['img/cars/unknown-a.jpg', 'Blue Mk8 Golf R seen from the rear, quad exhausts', 'A Mk8 Golf R. Two parts on DRVN were listed for the platform.'],
    m4: ['img/cars/nimbus-g80-m4.jpg', 'Grey BMW M4 Competition in a showroom', 'Nimbus, Marisol’s M4 Competition, on delivery day. Nothing off it yet.'],
    z06: ['img/cars/frost-c8-z06.jpg', 'White C8 Corvette Z06 in an event paddock', 'Frost, Jade’s Z06, in the paddock. Nothing listed for it yet.'],
    rs4: ['img/cars/anjali-rs4-avant.jpg', 'Blue B7 RS4 Avant in a wet car park', 'Anjali’s 2007 RS4 Avant. Its intake manifold is listed.'],
    huracan: ['img/wing.jpg', 'A forged carbon rear wing on a dark table', 'Off Imani’s Huracán Performante: the forged carbon wing, listed.'],
    f458: ['img/wheels-458.jpg', 'Four forged Ferrari wheels stacked on a garage floor', 'Off Dario’s 458 Speciale: its forged 20in wheels, listed.'],
    delta: ['img/kw.jpg', 'KW coilovers laid out on a workbench', 'Off Dana’s Delta Integrale: the KW Variant 2 coilovers, listed.'],
  };

  function initLanding() {
    // hero strip: what's for sale right now, each with the car it came off
    const STRIP = ['big-brake-kit', 'akrapovic', 'wing', 'capristo'];
    $('#strip').innerHTML = STRIP.map((id) => { const l = byId[id]; return `<li><a href="${href(l)}"><img src="${l.img}" alt=""><span><b>${money(l.price)}</b><span>${esc(l.title)}</span><span>Off a ${esc(CARS[l.car].name)}</span></span></a></li>`; }).join('');

    // what do you drive: a sentence picker over the real platforms
    const sel = $('#pickCar'); const go = $('#pickGo'); const note = $('#pickNote'); const img = $('#pickImg'); const cap = $('#pickCap');
    const count = (k) => LISTINGS.filter((l) => l.fits.includes(k)).length;
    const makes = [...new Set(CAR_ORDER.map(MAKE))].sort();
    sel.innerHTML = makes.map((m) => `<optgroup label="${esc(m)}">${CAR_ORDER.filter((k) => MAKE(k) === m).map((k) => `<option value="${k}">${esc(MODEL(k))}</option>`).join('')}</optgroup>`).join('');
    sel.value = CARS[getVehicle()] ? getVehicle() : 'm3';
    let swapT;
    const sync = (animate) => {
      const k = sel.value; const n = count(k); const name = MODEL(k).replace(/ \(.+\)$/, '');
      go.textContent = n ? `Show ${n} ${n === 1 ? 'part' : 'parts'} for the ${MODEL(k)}` : `Shop with fit checks for the ${name}`;
      note.textContent = n ? 'Plus anything universal. Every other part says whether it was listed for your car.' : `Nothing is listed for the ${name} yet. Every part will say whether it was listed for it.`;
      const [src, alt, caption] = PICK_PHOTO[k];
      const apply = () => { img.src = src; img.alt = alt; cap.textContent = caption; img.classList.remove('is-out'); };
      if (!animate || reduced() || img.getAttribute('src') === src) { apply(); return; }
      img.classList.add('is-out'); clearTimeout(swapT); swapT = setTimeout(apply, 320);
    };
    sel.addEventListener('change', () => sync(true));
    $('#pickForm').addEventListener('submit', (e) => { e.preventDefault(); setVehicle(sel.value); location.href = `marketplace.html?vehicle=${sel.value}`; });
    sync(false);
    const top = CAR_ORDER.map((k) => [k, count(k)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('#carlinks').innerHTML = top.map(([k, n]) => `<li><a href="marketplace.html?vehicle=${k}" data-vehicle="${k}">${esc(MODEL(k).replace(/ Performante| Speciale| HF Integrale| Avant/, ''))}<small>${n}</small></a></li>`).join('');
    $('#carlinks').addEventListener('click', (e) => { const a = e.target.closest('[data-vehicle]'); if (a) setVehicle(a.dataset.vehicle); });

    // listed tonight: the four newest, as marketplace cards
    $('#fresh').innerHTML = [...LISTINGS].sort((a, b) => a.age - b.age).slice(0, 4).map((l, i) => cardHTML(l, i, getVehicle())).join('');
    document.addEventListener('nm:cart', () => syncCardButtons($('#fresh')));

    initHeroFilm();
  }

  /* hero film + fog, ported from First Light (night only).
     Two copies of the film crossfade at the loop point; the fog is three WebGL passes:
     density (domain-warped fbm), breath (where the pointer has been), light (moon rim, headlamp beams, stars). */
  function loopFilm(videos) {
    const FADE = 1.4; let cur = videos[0]; let nxt = videos[1]; let swapping = false;
    const start = (v) => { const p = v.play(); if (p && p.catch) p.catch(() => { /* autoplay refused: the poster stays */ }); };
    const check = () => {
      if (swapping || !cur.duration || cur.currentTime < cur.duration - FADE) return;
      swapping = true; nxt.currentTime = 0; start(nxt);
      nxt.classList.add('is-on'); cur.classList.remove('is-on');
      const old = cur; cur = nxt; nxt = old;
      setTimeout(() => { old.pause(); swapping = false; }, FADE * 1000 + 80);
    };
    videos.forEach((v) => { v.muted = true; v.addEventListener('timeupdate', check); v.addEventListener('ended', check); });
    videos[0].addEventListener('playing', () => videos[0].classList.add('is-on'), { once: true });
    return { pause: () => cur.pause(), play: () => start(cur) };
  }
  const hexRgb = (h) => { h = (h || '').trim().replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); const n = parseInt(h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function initHeroFilm() {
    const hero = $('[data-hero]'); if (!hero) return;
    const root = document.documentElement; const still = reduced();
    const words = $$('[data-emerge]', hero);
    const setEmerge = (p) => words.forEach((w, i) => { let e = clamp((p * 1.35 - i * .08) / .55, 0, 1); e = 1 - Math.pow(1 - e, 3); if (e >= 1) w.style.removeProperty('--e'); else w.style.setProperty('--e', e.toFixed(3)); });
    let burn = 0;
    const readBurn = () => { burn = clamp(window.scrollY / (hero.offsetHeight * .9), 0, 1); hero.style.setProperty('--burn', burn.toFixed(3)); };
    readBurn(); window.addEventListener('scroll', () => { readBurn(); kick(); }, { passive: true });

    let visible = true;
    const vids = $$('[data-film]', hero);
    const film = !still && vids.length === 2 ? loopFilm(vids) : null;
    if (film) { vids.forEach((v) => { v.preload = 'auto'; v.load(); }); film.play(); }

    const canvas = $('[data-fog]', hero); let gl = null; let fog = null;
    try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false }); } catch (e) { gl = null; }
    if (gl) fog = createFog(gl, canvas, hero);
    if (!fog) root.classList.add('no-gl');

    const t0 = performance.now(); let introDone = still;
    if (!still) { root.classList.add('is-emerging'); setEmerge(0); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => {
        visible = en.isIntersecting;
        if (film) { if (visible && !document.hidden) film.play(); else film.pause(); }
        if (visible) kick();
      }).observe(hero);
    }
    document.addEventListener('visibilitychange', () => { if (film) { if (document.hidden) film.pause(); else if (visible) film.play(); } if (!document.hidden) kick(); });
    let raf = 0;
    function frame(now) {
      raf = 0;
      const time = (now - t0) / 1000;
      const ip = clamp(time / 2.6, 0, 1); const intro = 1 - Math.pow(1 - ip, 5);
      if (!introDone) { setEmerge(intro); if (ip >= 1) { introDone = true; root.classList.remove('is-emerging'); } }
      if (fog) fog.render(time, (1.3 - .38 * intro) * (1 - .8 * burn) * .88, burn);
      if ((fog || !introDone) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !still) raf = requestAnimationFrame(frame); }
    if (still) { if (fog) { fog.render(14, .9, 0); window.addEventListener('resize', () => { fog.resize(); fog.render(14, .9, 0); }); } }
    else kick();
  }

  function createFog(gl, canvas, hero) {
    const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 v;\n'
      + 'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}'
      + 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y);}'
      + 'float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vn(p);p=m*p;a*=.5;}return s;}\n';
    const DENS = HEAD + 'uniform float uT,uD,uAsp;void main(){'
      + ' vec2 p=vec2(v.x*uAsp*.62,v.y*1.75)*1.7;float t=uT*.032;vec2 dr=vec2(t,0.);'
      + ' vec2 q=vec2(fbm(p+dr+vec2(0.,t*.2)),fbm(p+dr*.8+vec2(5.2,1.3)));'
      + ' vec2 r=vec2(fbm(p+vec2(1.9,.7)*q+vec2(1.7,9.2)+dr*1.2),fbm(p+vec2(1.9,.7)*q+vec2(8.3,2.8)+dr));'
      + ' float far=fbm(p*1.3+vec2(1.6,.5)*r+dr*.7);float near=fbm(vec2(p.x*.38,p.y*.55)+vec2(t*1.5,0.)+q*.35);'
      + ' float d=mix(far,near,.48);float band=exp(-pow((v.y-.3)/.24,2.));float prof=.5+.66*band+.2*smoothstep(.72,1.,v.y);'
      + ' float lo=.68-.3*uD,hi=.94-.24*uD;float c=smoothstep(lo,hi,d*prof+.04*r.y);gl_FragColor=vec4(c,d,0.,1.);}';
    const TRAIL = HEAD + 'uniform sampler2D uPrev;uniform vec2 uPt,uTx;uniform float uS,uAsp;void main(){'
      + ' vec2 a=v+vec2(uTx.x*.6,0.);'
      + ' float c=texture2D(uPrev,a).r*.6+(texture2D(uPrev,a+vec2(uTx.x,0.)).r+texture2D(uPrev,a-vec2(uTx.x,0.)).r+texture2D(uPrev,a+vec2(0.,uTx.y)).r+texture2D(uPrev,a-vec2(0.,uTx.y)).r)*.1;'
      + ' c=max(c*.986-.0026,0.);vec2 d=v-uPt;d.x*=uAsp;c=min(c+exp(-dot(d,d)/.0042)*uS,1.);gl_FragColor=vec4(c,0.,0.,1.);}';
    // night composite: moonlit rims, headlamp beams pushed through the fog, sparse stars, a faint glow on the ridge
    const COMP = HEAD + 'uniform sampler2D uDen,uTr;uniform vec2 uMoon,uL1,uL2,uRidge;uniform float uAsp,uD,uT,uB,uStars;uniform vec3 uDeep,uPale,uLit,uCore,uBeam,uStar,uGlow;'
      + 'float beam(vec2 l){vec2 q=v-l;q.x*=uAsp;vec2 bd=normalize(vec2(1.,-.1));float al=dot(q,bd);float pr=length(q-bd*max(al,0.));float w=.014+max(al,0.)*.21;'
      + ' return exp(-pr*pr/(w*w))*smoothstep(-.01,.02,al)*exp(-max(al,0.)*2.4)+exp(-length(q)*55.)*.7;}'
      + 'void main(){vec2 e=vec2(1./160.,1./100.);float tr=texture2D(uTr,v).r;'
      + ' vec2 g=vec2(texture2D(uTr,v+vec2(e.x,0.)).r-texture2D(uTr,v-vec2(e.x,0.)).r,texture2D(uTr,v+vec2(0.,e.y)).r-texture2D(uTr,v-vec2(0.,e.y)).r);'
      + ' vec2 su=v-g*.05;float wisp=vn(vec2(su.x*uAsp,su.y)*22.+vec2(uT*.35,0.))-.5;float den=clamp(texture2D(uDen,su).r+wisp*.08,0.,1.);'
      + ' vec2 ts=uMoon-v;vec2 tsa=ts;tsa.x*=uAsp;float dist=length(tsa);vec2 dir=ts/max(length(ts),1e-4);'
      + ' float toward=texture2D(uDen,su+dir*.035).r;float lit=clamp(.5+(den-toward)*2.6,0.,1.);'
      + ' float occ=0.;float j=h21(gl_FragCoord.xy+fract(uT));for(int i=0;i<12;i++){float s=(float(i)+j)/12.;occ+=texture2D(uDen,v+ts*s*.92).r;}occ/=12.;'
      + ' float glow=exp(-dist*4.2);float halo=exp(-dist*30.);float shafts=pow(1.-occ,1.6)*exp(-dist*1.5)*.45;'
      + ' vec3 col=mix(uDeep,uPale,lit*.75+glow*.35);col=mix(col,uLit,clamp(glow*1.15+shafts*.35,0.,1.)*(.55+.45*den)*.65);'
      + ' float clear=1.-smoothstep(.04,.55,tr)*.94;float a=den*min(uD,1.)*.86*clear;float rays=shafts*(.24+.2*uB)*clear;'
      + ' vec3 pm=col*a+uLit*rays*.55+uCore*halo*(.5+.3*uB)*.6;float oa=clamp(a+rays*.32+halo*.18,0.,1.);'
      + ' float bm=beam(uL1)+beam(uL2);pm+=uBeam*bm*(.12+.7*den)*clear;oa=clamp(oa+bm*.08*den,0.,1.);'
      + ' vec2 sg=vec2(v.x*uAsp,v.y)*130.;vec2 cl=floor(sg);float hs=h21(cl);vec2 of=vec2(h21(cl+7.1),h21(cl+3.3))-.5;float sd=length(fract(sg)-.5-of*.6);'
      + ' float st=step(.992,hs)*smoothstep(.16,0.,sd)*(.55+.45*sin(uT*1.3+hs*60.))*smoothstep(.45,.9,v.y)*(1.-den)*uStars;pm+=uStar*st;oa=clamp(oa+st*.5,0.,1.);'
      + ' vec2 rq=v-uRidge;rq.x*=uAsp*.55;float rg=exp(-length(rq)*5.)*(.18+.82*uB);pm+=uGlow*rg*(.1+.18*den);oa=clamp(oa+rg*.04,0.,1.);'
      + ' pm+=(h21(gl_FragCoord.xy+uT)-.5)/255.*2.;gl_FragColor=vec4(max(pm,0.),oa);}';

    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('fog shader:', gl.getShaderInfoLog(s)); return null; } return s; };
    const prog = (fs) => {
      const vs = sh(gl.VERTEX_SHADER, VS); const f = sh(gl.FRAGMENT_SHADER, fs); if (!vs || !f) return null;
      const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    };
    const P = { dens: prog(DENS), trail: prog(TRAIL), comp: prog(COMP) };
    if (!P.dens || !P.trail || !P.comp) return null;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const target = (w, h) => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((k) => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fb, w, h };
    };
    const drop = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
    // colours come from the CSS tokens
    const cs = getComputedStyle(document.documentElement); const tok = (n) => hexRgb(cs.getPropertyValue(n));
    const C = { deep: tok('--fog-night-deep'), pale: tok('--fog-night-pale'), pre: tok('--fog-night-predawn'), moon: tok('--moon'), core: tok('--moon-core'), beam: tok('--beam'), star: tok('--star'), glow: tok('--apricot') };

    let W = 0; let H = 0; let asp = 1; let dens = null; let trA = null; let trB = null; let TH = 100; const TW = 160;
    let moon = [.23, .92]; let l1 = [.32, .24]; let l2 = [.39, .24]; let ridge = [.85, .81];
    function resize() {
      const r = hero.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 1.5) * (r.width > 1600 ? .6 : .75);
      const cap = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
      W = clamp(Math.round(r.width * scale), 2, cap); H = clamp(Math.round(r.height * scale), 2, cap);
      canvas.width = W; canvas.height = H; asp = r.width / Math.max(1, r.height);
      drop(dens); drop(trA); drop(trB);
      dens = target(Math.max(2, Math.round(W / 4)), Math.max(2, Math.round(H / 4)));
      TH = Math.max(40, Math.round(TW / asp)); trA = target(TW, TH); trB = target(TW, TH);
      // map film coordinates (moon, headlamps, ridge glow) through object-fit: cover
      const poster = hero.querySelector('.hero__poster'); let posX = .5;
      if (poster) { const op = getComputedStyle(poster).objectPosition.split(' ')[0]; if (op && op.indexOf('%') > -1) posX = parseFloat(op) / 100; }
      const vw = 1888; const vh = 1072; const s = Math.max(r.width / vw, r.height / vh);
      const dw = vw * s; const dh = vh * s; const ox = (r.width - dw) * posX; const oy = (r.height - dh) * .5;
      const at = (fx, fy) => [(ox + fx * dw) / r.width, 1 - (oy + fy * dh) / r.height];
      moon = at(.232, .078); l1 = at(.324, .762); l2 = at(.3925, .759); ridge = at(.85, .19);
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero); else window.addEventListener('resize', resize);
    // the pointer clears the fog like breath on cold glass
    let pt = [-1, -1]; let last = null; let speed = 0; let inside = false;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const y = 1 - (e.clientY - r.top) / r.height;
      if (last) speed = Math.min(1, speed + Math.hypot((x - last[0]) * asp, y - last[1]) * 9);
      last = [x, y]; pt = [x, y]; inside = true;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { inside = false; last = null; });
    let lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; document.documentElement.classList.add('no-gl'); });

    function render(time, density, burn) {
      if (lost) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dens.fb); gl.viewport(0, 0, dens.w, dens.h);
      gl.useProgram(P.dens.p); gl.uniform1f(P.dens.u.uT, time); gl.uniform1f(P.dens.u.uD, density); gl.uniform1f(P.dens.u.uAsp, asp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const strength = inside ? .035 + speed * .5 : 0; speed *= .82;
      gl.bindFramebuffer(gl.FRAMEBUFFER, trB.fb); gl.viewport(0, 0, TW, TH);
      gl.useProgram(P.trail.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trA.tex);
      gl.uniform1i(P.trail.u.uPrev, 0); gl.uniform2f(P.trail.u.uPt, pt[0], pt[1]); gl.uniform2f(P.trail.u.uTx, 1 / TW, 1 / TH);
      gl.uniform1f(P.trail.u.uS, strength); gl.uniform1f(P.trail.u.uAsp, asp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const tmp = trA; trA = trB; trB = tmp;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(P.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dens.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, trA.tex);
      const u = P.comp.u;
      gl.uniform1i(u.uDen, 0); gl.uniform1i(u.uTr, 1);
      gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uD, density); gl.uniform1f(u.uT, time); gl.uniform1f(u.uB, burn);
      gl.uniform3fv(u.uDeep, mixRgb(C.deep, C.pale, burn * .25)); gl.uniform3fv(u.uPale, mixRgb(C.pale, C.pre, burn));
      gl.uniform3fv(u.uLit, C.moon); gl.uniform3fv(u.uCore, C.core); gl.uniform3fv(u.uBeam, C.beam); gl.uniform3fv(u.uStar, C.star); gl.uniform3fv(u.uGlow, C.glow);
      gl.uniform2f(u.uMoon, moon[0], moon[1]); gl.uniform2f(u.uL1, l1[0], l1[1]); gl.uniform2f(u.uL2, l2[0], l2[1]); gl.uniform2f(u.uRidge, ridge[0], ridge[1]);
      gl.uniform1f(u.uStars, 1 - burn);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return { render, resize };
  }

  /* ───────── explore ───────── */
  function initExplore() {
    const FEED = [['b', 'rs4'], ['p', 'jade-pass'], ['l', 'akrapovic'], ['b', 'nimbus'], ['p', 'felix-cup'], ['l', 'rs4-manifold'], ['b', 'hagane'], ['p', 'lena-stage1'], ['band', 'car'], ['l', 'gt3-wheels'], ['b', 'frost'], ['p', 'kaito-coilovers'], ['l', 'gt3-seats'], ['band', 'builders'], ['b', 'gruene'], ['p', 'marcus-wheels'], ['l', 'wing'], ['b', 'scarlet'], ['p', 'lucille-dyno'], ['l', 'capristo'], ['p', 'ryo-teardown'], ['b', 'signal'], ['b', 'shirayuki'], ['p', 'lucille-seat'], ['b', 'lucille'], ['p', 'nimbus-delivery'], ['p', 'lucille-brakes'], ['l', 'big-brake-kit']];
    const params = new URLSearchParams(location.search);
    const state = { type: ['all', 'builds', 'updates', 'parts', 'builders'].includes(params.get('type')) ? params.get('type') : 'all', q: '', make: '', sort: 'newest', limit: 16 };
    const grid = $('#xgrid');
    const BUILDERS = ['marisol', 'kaito', 'felix', 'tommy', 'dario', 'jade', 'ryo', 'lena', 'marcus', 'anjali'];
    const modelOf = ([t, id]) => (t === 'b' ? BUILDS[id].model : t === 'p' ? BUILDS[postById[id].build].model : CARS[byId[id].car].name);
    const textOf = ([t, id]) => {
      if (t === 'b') { const b = BUILDS[id]; return [b.nick, b.model, SELLERS[b.owner].name].join(' '); }
      if (t === 'p') { const p = postById[id]; return [p.title, p.text, SELLERS[p.owner].name, BUILDS[p.build].nick, BUILDS[p.build].model].join(' '); }
      const l = byId[id]; return [l.title, l.brand, SELLERS[l.seller].name, CARS[l.car].name].join(' ');
    };
    const likesOf = ([t, id]) => (t === 'b' ? BUILDS[id].likes : t === 'p' ? postById[id].likes : 0) + (likes.has((t === 'l' ? '' : t + ':') + id) ? 1 : 0);
    const makes = [...new Set(FEED.filter(([t]) => t !== 'band').map((x) => modelOf(x).split(' ')[1]))].sort();
    makes.forEach((m) => $('#xMake').add(new Option(m, m)));
    const want = { builds: 'b', updates: 'p', parts: 'l' };
    function render() {
      const q = state.q.trim().toLowerCase();
      $$('#xtabs [role="tab"]').forEach((t) => { const on = t.dataset.tab === state.type; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
      if (state.type === 'builders') {
        const list = BUILDERS.filter((id) => !q || SELLERS[id].name.toLowerCase().includes(q));
        grid.className = 'xgrid';
        grid.innerHTML = list.length ? `<section class="band band--list" aria-label="Builders"><div class="rows">${list.map(builderRow).join('')}</div></section>` : '<div class="empty"><h3>No builders by that name</h3><p>Try a first name, like Kaito.</p></div>';
        $('#xMore').hidden = true; $('#xlive').textContent = `${list.length} builders`; return;
      }
      let items = FEED.filter((x) => x[0] !== 'band'
        && (state.type === 'all' || x[0] === want[state.type])
        && (!q || textOf(x).toLowerCase().includes(q))
        && (!state.make || modelOf(x).split(' ')[1] === state.make));
      if (state.sort === 'liked') items = [...items].sort((a, b) => likesOf(b) - likesOf(a));
      const total = items.length;
      const shown = items.slice(0, state.limit);
      // interjections only in the unfiltered "All" view
      const out = [];
      shown.forEach((x, i) => {
        if (state.type === 'all' && !q && !state.make && state.sort === 'newest') {
          if (i === 8) out.push(['band', 'car']);
          if (i === 12) out.push(['band', 'builders']);
        }
        out.push(x);
      });
      grid.className = 'grid xgrid';
      grid.innerHTML = total ? out.map(([t, id], i) => {
        if (t === 'b') return buildHTML(BUILDS[id], i);
        if (t === 'p') return postHTML(postById[id], i);
        if (t === 'l') return cardHTML(byId[id], i, getVehicle(), { label: true });
        if (id === 'car') return `<section class="band" aria-labelledby="bandCarH"><div><h2 class="label" id="bandCarH">Put your car on DRVN</h2><p>Every build on this wall started with someone adding their car. Yours gets a page like these — the mods, the updates, and the car behind any part you sell off it.</p></div><div class="band__acts"><a class="btn btn--sun" href="garage.html">Add your car</a><a class="btn btn--quiet only-out" href="home.html">Sign in</a></div></section>`;
        return `<section class="band band--list" aria-labelledby="bandBuildH"><h2 class="label" id="bandBuildH">Builders to follow</h2><div class="rows">${['marisol', 'kaito', 'felix', 'tommy'].map(builderRow).join('')}</div></section>`;
      }).join('') : '<div class="empty"><h3>Nothing matches yet</h3><p>Try another make, or clear the search.</p><button class="btn btn--quiet btn--sm" type="button" id="xClear">Clear search and filters</button></div>';
      $('#xMore').hidden = total <= state.limit;
      $('#xlive').textContent = `${total} ${total === 1 ? 'result' : 'results'}`;
      $('#xFilterN').textContent = [state.make, state.sort !== 'newest'].filter(Boolean).length; $('#xFilterN').hidden = $('#xFilterN').textContent === '0';
      wireCompare(grid); syncCardButtons(grid);
    }
    wireTabs($('#xtabs'), (k) => { state.type = k; state.limit = 16; render(); });
    let qt; $('#xq').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { state.q = $('#xq').value; render(); }, 140); });
    $('#xSearch').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('#xq').value; render(); });
    $('#xMore').addEventListener('click', () => { const first = grid.children.length; state.limit += 16; render(); const next = grid.children[first]; if (next) $('a, button', next)?.focus(); });
    $('#xFilterForm').addEventListener('submit', (e) => { e.preventDefault(); state.make = $('#xMake').value; state.sort = $('#xSort').value; render(); Dlg.close($('#xFilters')); });
    $('#xFilterReset').addEventListener('click', () => { $('#xMake').value = ''; $('#xSort').value = 'newest'; });
    document.addEventListener('click', (e) => { if (e.target.closest('#xClear')) { state.q = ''; state.make = ''; state.sort = 'newest'; $('#xq').value = ''; $('#xMake').value = ''; $('#xSort').value = 'newest'; render(); } });
    document.addEventListener('nm:cart', () => syncCardButtons(grid));
    render();
  }

  /* ───────── home (signed in as Marisol) ───────── */
  function initHome() {
    const h = new Date().getHours();
    $('#greet').textContent = `${h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'}, Marisol.`;
    const FORYOU = [['b', 'rs4'], ['p', 'jade-pass'], ['l', 'akrapovic'], ['b', 'hagane'], ['p', 'felix-cup'], ['p', 'kaito-coilovers'], ['b', 'frost'], ['p', 'lena-stage1'], ['p', 'marcus-wheels'], ['l', 'kw'], ['p', 'ryo-teardown'], ['b', 'signal']];
    const mine = [];
    const feed = $('#hfeed'); let tab = 'foryou';
    const item = ([t, id], i) => (t === 'b' ? buildHTML(BUILDS[id], i, true) : t === 'p' ? postHTML(postById[id] || mine.find((m) => m.id === id), i, true) : cardHTML(byId[id], i, null, { label: true, large: true }));
    function render() {
      let list;
      if (tab === 'following') {
        list = [...mine.map((m) => ['p', m.id]), ...POSTS.filter((p) => follows.has(p.owner)).map((p) => ['p', p.id])];
        if (!list.length) { feed.innerHTML = `<div class="feed-empty"><h2>Nothing here yet</h2><p>Follow a few builders and their updates land here first. Try Kaito or Felix in the rail, or browse Explore.</p><p style="margin-top:20px"><a class="btn btn--quiet btn--sm" href="explore.html?type=builders">Find builders</a></p></div>`; return; }
      } else list = [...mine.map((m) => ['p', m.id]), ...FORYOU];
      feed.innerHTML = list.map(item).join('');
      wireCompare(feed); syncCardButtons(feed);
    }
    wireTabs($('#htabs'), (k) => { tab = k; render(); });
    document.addEventListener('nm:follow', () => { if (tab === 'following') render(); });
    document.addEventListener('nm:cart', () => syncCardButtons(feed));
    // rail
    $('#railGarage').innerHTML = ['nimbus', 'lucille'].map((id) => { const b = BUILDS[id]; return `<a class="row row--link" href="garage.html#${id}"><span class="row__thumb"><img src="${b.img}" alt=""></span><span><span class="row__title">${b.nick}</span><span class="row__sub">${b.model}</span><span class="row__meta">${b.updates} ${b.updates === 1 ? 'update' : 'updates'} · ${b.followers} followers</span></span>${svg('i-arrow')}</a>`; }).join('');
    $('#railWatch').innerHTML = ['gt3-wheels', 'kw', 'akrapovic'].map((id) => { const l = byId[id]; return `<a class="row row--link" href="${href(l)}"><span class="row__thumb row__thumb--sq"><img src="${l.img}" alt=""></span><span><span class="row__title">${esc(l.title)}</span><span class="row__sub">${SELLERS[l.seller].name}</span></span><span class="row__price">${money(l.price)}</span></a>`; }).join('');
    $('#railBuilders').innerHTML = ['kaito', 'felix', 'tommy', 'dario'].map(builderRow).join('');
    // composer
    const form = $('#composer'); const ta = $('#cText'); const car = $('#cCar'); const files = $('#cPhotos'); const prev = $('#cPreview'); const err = $('#cErr');
    const tagBtn = $('#cTagBtn'); const tagWrap = $('#cTagWrap'); const tagSel = $('#cTag');
    LISTINGS.filter((l) => l.seller === 'marisol').forEach((l) => tagSel.add(new Option(`${l.title} · ${money(l.price)}`, l.id)));
    const params = new URLSearchParams(location.search);
    if (BUILDS[params.get('car')]?.owner === 'marisol') car.value = params.get('car');
    if (location.hash === '#compose') setTimeout(() => { ta.focus(); }, 50);
    let photos = [];
    const showPrev = () => {
      prev.innerHTML = photos.map((p, i) => `<figure><img src="${p.url}" alt="Photo ${i + 1} for your post: ${esc(p.name)}"><button type="button" data-rmphoto="${i}" aria-label="Remove photo ${i + 1}">${svg('i-close')}</button></figure>`).join('');
      $('#cPhotoN').textContent = photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Add photos';
    };
    files.addEventListener('change', () => { [...files.files].slice(0, 6 - photos.length).forEach((f) => photos.push({ url: URL.createObjectURL(f), name: f.name })); files.value = ''; showPrev(); if (photos.length) err.hidden = true; });
    prev.addEventListener('click', (e) => { const b = e.target.closest('[data-rmphoto]'); if (!b) return; photos.splice(Number(b.dataset.rmphoto), 1); showPrev(); files.focus(); });
    tagBtn.addEventListener('click', () => { const open = tagWrap.hidden; tagWrap.hidden = !open; tagBtn.setAttribute('aria-expanded', open); if (open) tagSel.focus(); });
    tagSel.addEventListener('change', () => { tagBtn.innerHTML = tagSel.value ? `${svg('i-tag')}Tagged: ${esc(byId[tagSel.value].title.split(' — ')[0])}` : `${svg('i-tag')}Tag a part`; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ta.value.trim();
      const msg = !v ? "Say what's new with the build first." : v.length < 8 ? 'Add a little more (at least 8 characters).' : !photos.length ? 'Add a photo. Every post needs one.' : '';
      if (msg) { err.textContent = msg; err.hidden = false; (!v || v.length < 8 ? ta : files).focus(); return; }
      err.hidden = true;
      const [first, ...rest] = v.split(/\n+/);
      const p = { id: 'mine-' + Date.now(), owner: 'marisol', build: car.value, title: first.length > 80 ? first.slice(0, 77) + '…' : first, text: rest.join(' ') || (tagSel.value ? `Tagged: ${byId[tagSel.value].title}` : `New on ${BUILDS[car.value].nick}.`), img: photos[0].url, alt: `Your photo: ${photos[0].name}`, likes: 0, comments: 0, when: 'Just now', isNew: true };
      mine.unshift(p); postById[p.id] = p;
      ta.value = ''; photos = []; showPrev(); tagSel.value = ''; tagSel.dispatchEvent(new Event('change')); tagWrap.hidden = true; tagBtn.setAttribute('aria-expanded', 'false');
      render();
      toast(`Posted to ${BUILDS[p.build].nick}. Your followers see it first.`);
      $('.card', feed)?.querySelector('.card__title a')?.focus();
    });
    render();
  }

  /* ───────── garage (Marisol's own) ───────── */
  function initGarage() {
    const MINE = ['nimbus', 'lucille'];
    const valid = (k) => (k === 'all' || MINE.includes(k) ? k : null);
    let cur = valid(location.hash.slice(1)) || 'nimbus'; let curTab = 'overview';
    const live = LISTINGS.filter((l) => l.seller === 'marisol').length;
    $('#gstats').textContent = `Garage — 2 cars · 4 updates · ${live} live · $950 in sales off them`;
    const sw = $('#gswitch');
    sw.innerHTML = `<button type="button" data-car="all" aria-pressed="false">${svg('i-garage')}All cars</button>` + MINE.map((k) => `<button type="button" data-car="${k}" aria-pressed="false"><img src="${BUILDS[k].img}" alt="">${BUILDS[k].nick}</button>`).join('');
    sw.addEventListener('click', (e) => { const b = e.target.closest('[data-car]'); if (!b) return; cur = b.dataset.car; curTab = 'overview'; history.replaceState(null, '', '#' + cur); render(); });
    window.addEventListener('hashchange', () => { const k = valid(location.hash.slice(1)); if (k && k !== cur) { cur = k; curTab = 'overview'; render(); } });
    const updatesOf = (k) => POSTS.filter((p) => p.build === k);
    const partsOf = (k) => buildParts(BUILDS[k]);
    const heroActs = (k) => `<div class="carhero__acts"><a class="btn btn--sun btn--sm" href="home.html?car=${k}#compose">${svg('i-plus')}Post update</a><button class="btn btn--quiet btn--sm" type="button" data-editcar="${k}">Edit the car</button><a class="qlink" href="profile.html?tab=garage">View the build page</a></div>`;
    const heroStats = (k) => { const b = BUILDS[k]; const n = partsOf(k).length; return `${b.updates} ${b.updates === 1 ? 'update' : 'updates'} · ${b.followers} followers · ${n ? `${n} ${n === 1 ? 'part' : 'parts'} for sale` : 'nothing for sale'}`; };
    function render() {
      $$('[data-car]', sw).forEach((b) => b.setAttribute('aria-pressed', b.dataset.car === cur));
      const root = $('#gview');
      if (cur === 'all') {
        root.innerHTML = `<div class="cars2">${MINE.map((k) => { const b = BUILDS[k]; return `<article class="carhero"><img src="${b.img}" alt="${esc(b.alt)}"><div class="carhero__text"><p class="label">${esc(b.model)}</p><h2>${esc(b.nick)}</h2><p class="carhero__stats">${heroStats(k)}</p><div class="carhero__acts"><button class="btn btn--quiet btn--sm" type="button" data-open-car="${k}">Open ${esc(b.nick)}</button><a class="btn btn--ghost btn--sm" href="home.html?car=${k}#compose">Post update</a></div></div></article>`; }).join('')}</div>`;
        return;
      }
      const b = BUILDS[cur]; const ups = updatesOf(cur); const parts = partsOf(cur); const mods = MODS[cur]; const media = MEDIA[cur];
      root.innerHTML = `
        <article class="carhero"><img src="${b.img}" alt="${esc(b.alt)}"><div class="carhero__text"><p class="label">${esc(b.model)}</p><h2 id="carName">${esc(b.nick)}</h2><p class="carhero__stats">${heroStats(cur)}</p>${heroActs(cur)}</div></article>
        <div class="tabs" role="tablist" aria-label="${esc(b.nick)}" id="gtabs" style="margin-top:32px">
          <button class="tab" role="tab" id="t-overview" data-tab="overview" aria-controls="p-overview">Overview</button>
          <button class="tab" role="tab" id="t-mods" data-tab="mods" aria-controls="p-mods">Mods <span class="tab__n">${mods.length}</span></button>
          <button class="tab" role="tab" id="t-parts" data-tab="parts" aria-controls="p-parts">Parts <span class="tab__n">${parts.length}</span></button>
          <button class="tab" role="tab" id="t-media" data-tab="media" aria-controls="p-media">Media <span class="tab__n">${media.length}</span></button>
        </div>
        <div class="tabpanel" role="tabpanel" id="p-overview" aria-labelledby="t-overview">
          <div class="gpanels">
            <div>
              <section class="panel" aria-labelledby="gUpH"><div class="panel__head"><h3 id="gUpH">Recent updates</h3><a class="qlink" href="profile.html?tab=updates">All updates</a></div>
                <div class="rows">${ups.map((p) => `<a class="row row--link" href="home.html"><span class="row__thumb"><img src="${p.img}" alt=""></span><span><span class="row__title">${esc(p.title)}</span><span class="row__meta">${esc(p.when)}</span></span>${svg('i-arrow')}</a>`).join('')}</div></section>
              <section class="panel" aria-labelledby="gPartsH"><div class="panel__head"><h3 id="gPartsH">Parts for sale</h3>${parts.length ? '<button class="qlink textbtn" type="button" data-gotab="parts">View all</button>' : ''}</div>
                ${parts.length ? `<div class="rows">${parts.map((l) => `<a class="row row--link" href="${href(l)}"><span class="row__thumb row__thumb--sq">${l.img ? `<img src="${l.img}" alt="">` : svg('i-tag')}</span><span><span class="row__title">${esc(l.title)}</span><span class="row__sub">${esc(l.cond)} · ${shipLine(l)}</span></span><span class="row__price">${money(l.price)}</span></a>`).join('')}</div>` : `<div class="empty-inline"><span>Nothing listed off this car.</span><a class="qlink" href="#" data-soon="The sell flow isn't part of this mockup.">List a part</a></div>`}</section>
              <section class="panel" aria-labelledby="gPhH"><div class="panel__head"><h3 id="gPhH">Photos</h3><button class="qlink textbtn" type="button" data-gotab="media">View all</button></div>
                <div class="photos">${media.slice(0, 2).map(([src, cap], i) => `<button class="photo" type="button" data-photo="${i}"><img src="${src}" alt="${esc(cap)}"><span>${esc(cap)}</span></button>`).join('')}</div></section>
            </div>
            <div>
              <section class="panel" aria-labelledby="gModH"><div class="panel__head"><h3 id="gModH">Current mods · ${mods.length}</h3><button class="qlink textbtn" type="button" data-gotab="mods">View all</button></div>
                <div class="rows">${mods.map(([m, c]) => `<div class="row" style="grid-template-columns:1fr"><span><span class="row__title">${esc(m)}</span><span class="row__sub">${esc(c)}</span></span></div>`).join('')}</div></section>
              <section class="panel panel--glow" aria-labelledby="gPubH"><div class="panel__head"><h3 id="gPubH">Your public page</h3></div>
                <p style="font-size:14px;color:inherit">This is what buyers see when a part says “Off my ${esc(b.model)}”.</p><p style="margin-top:12px"><a class="qlink" href="profile.html">View public profile</a></p></section>
            </div>
          </div>
        </div>
        <div class="tabpanel" role="tabpanel" id="p-mods" aria-labelledby="t-mods" hidden>
          <section class="panel"><div class="mods">${[...new Set(mods.map((m) => m[1]))].map((c) => `<div><h3 class="label">${esc(c)}</h3><div class="rows">${mods.filter((m) => m[1] === c).map(([m]) => `<div class="row" style="grid-template-columns:1fr"><span class="row__title">${esc(m)}</span></div>`).join('')}</div></div>`).join('')}</div></section>
        </div>
        <div class="tabpanel" role="tabpanel" id="p-parts" aria-labelledby="t-parts" hidden>
          ${parts.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));margin-top:0">${parts.map((l, i) => cardHTML(l, i)).join('')}</div>` : `<div class="empty"><h3>Nothing listed off ${esc(b.nick)}</h3><p>When something comes off, list it here and it carries the car with it.</p><a class="btn btn--quiet btn--sm" href="#" data-soon="The sell flow isn't part of this mockup.">List a part</a></div>`}
        </div>
        <div class="tabpanel" role="tabpanel" id="p-media" aria-labelledby="t-media" hidden>
          <div class="photos photos--3">${media.map(([src, cap], i) => `<button class="photo" type="button" data-photo="${i}"><img src="${src}" alt="${esc(cap)}"><span>${esc(cap)}</span></button>`).join('')}</div>
        </div>`;
      const t = wireTabs($('#gtabs'), (k) => { curTab = k; });
      t.select(curTab);
      $('#t-' + curTab).tabIndex = 0;
      root.onclick = (e) => {
        const g = e.target.closest('[data-gotab]'); if (g) { t.select(g.dataset.gotab); $('#t-' + g.dataset.gotab).focus(); }
        const ph = e.target.closest('[data-photo]'); if (ph) { const [src, cap] = media[Number(ph.dataset.photo)]; $('#lbImg').src = src; $('#lbImg').alt = cap; $('#lbCap').textContent = `${b.nick} · ${cap}`; Dlg.open($('#lightbox'), ph); }
      };
    }
    $('#gview').addEventListener('click', (e) => {
      const o = e.target.closest('[data-open-car]'); if (o) { cur = o.dataset.openCar; history.replaceState(null, '', '#' + cur); render(); $(`[data-car="${cur}"]`, sw).focus(); }
      const ed = e.target.closest('[data-editcar]'); if (ed) { const b = BUILDS[ed.dataset.editcar]; $('#ecNick').value = b.nick; $('#ecModel').value = b.model; $('#editCar').dataset.car = ed.dataset.editcar; Dlg.open($('#editCar'), ed); }
    });
    $('#editCarForm').addEventListener('submit', (e) => {
      e.preventDefault(); const k = $('#editCar').dataset.car; const nick = $('#ecNick').value.trim();
      if (!nick) { $('#ecErr').hidden = false; $('#ecNick').setAttribute('aria-invalid', 'true'); $('#ecNick').focus(); return; }
      $('#ecErr').hidden = true; $('#ecNick').removeAttribute('aria-invalid');
      BUILDS[k].nick = nick; Dlg.close($('#editCar'));
      $(`[data-car="${k}"]`, sw).lastChild.textContent = nick; render(); toast(`${nick} saved.`);
    });
    render();
  }

  /* ───────── public profile ───────── */
  function initProfile() {
    const params = new URLSearchParams(location.search);
    const mine = LISTINGS.filter((l) => l.seller === 'marisol');
    const ups = POSTS.filter((p) => p.owner === 'marisol');
    $('#pGarageList').innerHTML = ['nimbus', 'lucille'].map((id) => { const b = BUILDS[id]; return `<a class="row row--link" href="garage.html#${id}"><span class="row__thumb"><img src="${b.img}" alt=""></span><span><span class="row__title">${b.nick}</span><span class="row__sub">${b.model}</span></span>${svg('i-arrow')}</a>`; }).join('');
    $('#pPartsList').innerHTML = mine.map((l) => `<a class="row row--link" href="${href(l)}"><span class="row__thumb row__thumb--sq">${l.img ? `<img src="${l.img}" alt="">` : svg('i-tag')}</span><span><span class="row__title">${esc(l.title)}</span><span class="row__sub">${esc(l.cond)}</span></span><span class="row__price">${money(l.price)}</span></a>`).join('');
    $('#pLatest').innerHTML = ups.slice(0, 3).map((p, i) => postHTML(p, i)).join('');
    $('#pGarage').innerHTML = ['nimbus', 'lucille'].map((b, i) => buildHTML(BUILDS[b], i)).join('');
    $('#pUpdates').innerHTML = ups.map((p, i) => postHTML(p, i)).join('');
    $('#pParts').innerHTML = mine.map((l, i) => cardHTML(l, i, getVehicle())).join('');
    const t = wireTabs($('#ptabs'));
    const start = params.get('tab'); if (['overview', 'garage', 'updates', 'parts', 'reviews'].includes(start)) t.select(start); else t.select('overview');
    $('#pStore').addEventListener('click', () => { t.select('parts'); $('#t-parts').focus(); $('#ptabs').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); });
    $('#pShare').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0]); toast('Profile link copied.'); } catch (e) { toast('Copy this link: drvn.app/u/apexmarisol'); } });
    const fb = $('#pFollow'); const fn = $('#pFollowers');
    const syncF = () => { const on = follows.has('marisol'); fb.setAttribute('aria-pressed', on); fb.textContent = on ? 'Following' : 'Follow'; fn.textContent = 1 + (on ? 1 : 0); };
    fb.dataset.follow = 'marisol'; syncF();
    document.addEventListener('nm:follow', syncF);
    if (document.documentElement.dataset.auth === 'in') { fb.hidden = true; $('#pEdit').hidden = false; }
    document.addEventListener('nm:cart', () => syncCardButtons($('#pParts')));
    wireCompare();
  }

  /* ───────── settings ───────── */
  function initSettings() {
    const form = $('#settingsForm'); const bar = $('#dirtybar');
    const sections = $$('.sset', form); const links = $$('.setnav a');
    const show = (id, focus) => {
      if (!sections.some((s) => s.id === id)) id = 'account';
      sections.forEach((s) => { const on = s.id === id; s.hidden = !on; if (on && !reduced()) { s.classList.remove('is-in'); void s.offsetWidth; s.classList.add('is-in'); } });
      links.forEach((a) => { if (a.hash === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      if (focus) $('#' + id + ' h2')?.focus();
    };
    links.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', a.hash); show(a.hash.slice(1), true); }));
    show(location.hash.slice(1) || 'account');
    // persisted values
    const KEY = 'nm-settings';
    const fields = () => $$('[name]', form).filter((el) => !el.closest('[data-nodirty]'));
    const read = () => Object.fromEntries(fields().map((el) => [el.name + (el.type === 'radio' ? '' : ''), el.type === 'checkbox' ? el.checked : el.type === 'radio' ? (form.querySelector(`[name="${el.name}"]:checked`)?.value ?? '') : el.value]));
    const write = (v) => fields().forEach((el) => { if (!(el.name in v)) return; if (el.type === 'checkbox') el.checked = !!v[el.name]; else if (el.type === 'radio') el.checked = el.value === v[el.name]; else el.value = v[el.name]; });
    const savedV = store.get(KEY, null); if (savedV) write(savedV);
    let base = JSON.stringify(read());
    const sync = () => {
      const dirty = JSON.stringify(read()) !== base; bar.hidden = !dirty;
      $('#vacNote').hidden = !$('#vacation').checked;
      $('#bioN').textContent = `${$('#bio').value.length}/160`;
    };
    form.addEventListener('input', sync); form.addEventListener('change', sync); sync();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ht = $('#handling'); const offer = $('#offerFloor');
      if (offer.value && (offer.value < 10 || offer.value > 100)) { show('profile'); offer.setAttribute('aria-invalid', 'true'); $('#offerErr').hidden = false; offer.focus(); return; }
      offer.removeAttribute('aria-invalid'); $('#offerErr').hidden = true;
      const v = read(); store.set(KEY, v); base = JSON.stringify(v); sync();
      toast('Settings saved.'); void ht;
    });
    $('#discard').addEventListener('click', () => { write(JSON.parse(base)); sync(); toast('Changes discarded.'); });
    window.addEventListener('beforeunload', (e) => { if (!bar.hidden) { e.preventDefault(); e.returnValue = ''; } });
    // avatar preview
    $('#avFile').addEventListener('change', () => { const f = $('#avFile').files[0]; if (f) { $('#avImg').src = URL.createObjectURL(f); toast('New photo ready. Save to keep it.'); bar.hidden = false; } });
    // email
    $('#emailBtn').addEventListener('click', () => {
      const el = $('#email'); const v = el.value.trim(); const err = $('#emailErr');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = 'Enter a full email address, like name@example.com.'; err.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); return; }
      err.hidden = true; el.removeAttribute('aria-invalid');
      $('#emailOk').textContent = v === 'marisol@drvn.test' ? 'That is already your sign-in email.' : `We've emailed ${v}. Your email changes once you confirm.`; $('#emailOk').hidden = false;
    });
    // password
    $$('[data-reveal]').forEach((b) => b.addEventListener('click', () => { const i = document.getElementById(b.dataset.reveal); const on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', (on ? 'Hide ' : 'Show ') + b.dataset.what); }));
    $('#pwBtn').addEventListener('click', () => {
      const cur = $('#pwCur'); const nw = $('#pwNew'); const cf = $('#pwConf'); const err = $('#pwErr');
      [cur, nw, cf].forEach((x) => x.removeAttribute('aria-invalid'));
      const fail = (el, m) => { err.textContent = m; err.hidden = false; el.setAttribute('aria-invalid', 'true'); el.focus(); };
      if (!cur.value) return fail(cur, 'Enter your current password.');
      if (nw.value.length < 10) return fail(nw, 'Use at least 10 characters for the new password.');
      if (nw.value === cur.value) return fail(nw, 'The new password has to be different.');
      if (cf.value !== nw.value) return fail(cf, "The two new passwords don't match.");
      err.hidden = true; [cur, nw, cf].forEach((x) => { x.value = ''; });
      toast('Password changed. Other devices stay signed in until they next refresh.');
    });
    // danger zone
    $('#exportBtn').addEventListener('click', () => {
      const b = $('#exportBtn'); b.disabled = true; b.textContent = 'Preparing your export…';
      setTimeout(() => { b.hidden = true; $('#exportReady').hidden = false; $('#exportLink').focus(); }, reduced() ? 0 : 900);
    });
    const del = $('#delStart'); const conf = $('#delConfirm'); const typed = $('#delType'); const ack = $('#delAck'); const go = $('#delGo');
    const check = () => { go.disabled = !(typed.value.trim().replace(/^@/, '') === 'apexmarisol' && ack.checked); };
    del.addEventListener('click', () => { conf.hidden = false; del.hidden = true; typed.focus(); });
    typed.addEventListener('input', check); ack.addEventListener('change', check);
    $('#delCancel').addEventListener('click', () => { conf.hidden = true; del.hidden = false; typed.value = ''; ack.checked = false; check(); del.focus(); });
    go.addEventListener('click', () => { conf.hidden = true; $('#delDone').hidden = false; $('#delUndo').focus(); });
    $('#delUndo').addEventListener('click', () => { $('#delDone').hidden = true; del.hidden = false; typed.value = ''; ack.checked = false; check(); del.focus(); toast('Deletion cancelled. Nothing was removed.'); });
  }

  /* ───────── boot ───────── */
  function boot() {
    initShell();
    initShell2();
    const page = document.body.dataset.page;
    const run = { market: initMarket, listing: initListing, landing: initLanding, explore: initExplore, home: initHome, garage: initGarage, profile: initProfile, settings: initSettings }[page];
    if (run) run();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
