/* Night Market B — DRVN at about 75% First Light (night) and 25% DRVN.
   First Light supplies the night palette, the scroll-time device, the fog-shader hero, the editorial layouts and the reveals.
   DRVN supplies the content and the facts: Night Market's data is copied below unchanged (same people, listings, prices and posts). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = document.documentElement;
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reducedMQ.matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable: state lives for this page only */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to clear */ } },
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


  const href = (l) => `listing.html?id=${encodeURIComponent(l.id)}`;
  const offLine = (l) => `Off my ${CARS[l.car].name}`;

  /* ───────── shared state ───────── */
  let cart = store.get('nmb-cart', []).filter((id) => byId[id]);
  const saved = new Set(store.get('nmb-saved', []));
  const follows = new Set(store.get('nmb-follows', []));
  const likes = new Set(store.get('nmb-likes', []));
  const getVehicle = () => { const v = store.get('nmb-vehicle', null); return CARS[v] ? v : null; };
  const setVehicle = (v) => store.set('nmb-vehicle', v);

  /* ───────── First Light's device: scroll is the hour before dawn ─────────
     --t runs 0 → 1 down every page; the clock runs 04:20 → 05:10 and the palette moves from night to pre-dawn. */
  const START = 4 * 60 + 20, SPAN = 50;
  const PHASES = [[.36, 'night'], [.74, 'moonlight'], [9, 'first glow']];
  const phaseOf = (t) => PHASES.find((p) => t < p[0])[1];
  const timeOf = (t) => { const m = START + Math.round(clamp(t, 0, 1) * SPAN); return '0' + Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
  let tNow = 0, tTarget = 0, tRaf = 0, lastMin = -1, lastT = -1;
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  function writeT(t) {
    if (Math.abs(t - lastT) < .0025 && t !== tTarget) return;
    lastT = t;
    root.style.setProperty('--t', t.toFixed(4));
    const min = Math.round(t * SPAN);
    if (min !== lastMin) {
      lastMin = min;
      $$('[data-clock]').forEach((el) => { el.textContent = timeOf(t); });
      $$('[data-phase]').forEach((el) => { el.textContent = phaseOf(t); });
    }
  }
  function stepT() {
    tNow += (tTarget - tNow) * .16;
    if (Math.abs(tTarget - tNow) < .0005) { tNow = tTarget; tRaf = 0; } else tRaf = requestAnimationFrame(stepT);
    writeT(tNow);
  }
  function onScrollT() { tTarget = clamp(window.scrollY / maxScroll(), 0, 1); if (!tRaf) tRaf = requestAnimationFrame(stepT); }
  function stampTimes() {
    const max = maxScroll();
    $$('[data-at]').forEach((el) => {
      const y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * .35;
      el.textContent = reduced() ? timeOf(.6) : timeOf(clamp(y / max, 0, 1));
    });
  }
  function initTime() {
    if (reduced()) { writeT(.6); stampTimes(); return; }
    tNow = tTarget = clamp(window.scrollY / maxScroll(), 0, 1);
    writeT(tNow);
    window.addEventListener('scroll', onScrollT, { passive: true });
    window.addEventListener('resize', () => { onScrollT(); stampTimes(); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { stampTimes(); onScrollT(); });
    window.addEventListener('load', () => { stampTimes(); onScrollT(); });
    stampTimes();
  }
  const nowLabel = () => timeOf(reduced() ? .6 : tNow);

  /* ───────── signed in or out (remembered; the inline head script applies it before paint) ───────── */
  const setAuth = (on) => { try { if (on) localStorage.setItem('nmb-auth', 'in'); else localStorage.removeItem('nmb-auth'); } catch (e) { /* storage unavailable */ } root.toggleAttribute('data-auth', false); if (on) root.dataset.auth = 'in'; };
  const isIn = () => root.dataset.auth === 'in';
  function initAuth() {
    if (document.body.dataset.member === 'true') setAuth(true);
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-signin]')) setAuth(true);
      if (e.target.closest('[data-logout]')) { e.preventDefault(); setAuth(false); location.href = 'index.html'; }
    });
  }

  /* ───────── toast ───────── */
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('p'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3600);
  }

  /* ───────── nav: menu sheet, account menu, "not in this mockup" links ───────── */
  function initNav() {
    const nav = $('[data-nav]'); if (!nav) return;
    const btn = $('[data-menu]', nav), sheet = $('#menu');
    if (btn && sheet) {
      const close = () => { btn.setAttribute('aria-expanded', 'false'); sheet.hidden = true; nav.classList.remove('is-open'); };
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open)); sheet.hidden = !open; nav.classList.toggle('is-open', open);
        if (open) $('a', sheet)?.focus();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { close(); btn.focus(); } });
      window.matchMedia('(min-width: 921px)').addEventListener('change', (m) => { if (m.matches) close(); });
    }
    const me = $('[data-me]'), menu = $('#meMenu');
    if (me && menu) {
      const shut = (focus) => { me.setAttribute('aria-expanded', 'false'); menu.hidden = true; if (focus) me.focus(); };
      me.addEventListener('click', () => { const open = me.getAttribute('aria-expanded') !== 'true'; me.setAttribute('aria-expanded', String(open)); menu.hidden = !open; if (open) $('a', menu)?.focus(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) shut(true); });
      document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.me')) shut(false); });
    }
    if (nav.classList.contains('nav--over')) {
      const hero = $('[data-hero]');
      const solid = () => nav.classList.toggle('is-solid', !hero || window.scrollY > hero.offsetHeight - nav.offsetHeight - 40);
      window.addEventListener('scroll', solid, { passive: true }); solid();
    }
    const q = new URLSearchParams(location.search).get('q');
    if (q) $$('input[name="q"]').forEach((i) => { i.value = q; });
    document.addEventListener('click', (e) => { const s = e.target.closest('[data-soon]'); if (s) { e.preventDefault(); toast(s.dataset.soon); } });
  }

  /* ───────── fog-dissolve reveals ───────── */
  let revealIO = null;
  function observeReveals(scope = document) {
    const els = $$('[data-reveal]:not(.is-in)', scope);
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
    if (!revealIO) revealIO = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('is-in'); revealIO.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .06 });
    els.forEach((el) => revealIO.observe(el));
  }
  let settleT = 0;
  window.addEventListener('scroll', () => {
    clearTimeout(settleT);
    settleT = setTimeout(() => { $$('[data-reveal]:not(.is-in)').forEach((el) => { if (el.offsetParent !== null && el.getBoundingClientRect().top < window.innerHeight) { el.classList.add('is-in'); revealIO?.unobserve(el); } }); }, 180);
  }, { passive: true });

  /* ───────── dialogs: modal, focus trap, Esc, return focus ───────── */
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const focusables = (d) => $$(FOCUSABLE, d).filter((el) => el.offsetParent !== null && !el.closest('[hidden]'));
  const Dlg = {
    open(d, opener) {
      if (!d) return;
      d._opener = opener || document.activeElement;
      d.classList.remove('is-closing');
      d.dispatchEvent(new CustomEvent('nmb:open'));
      if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
      document.body.style.overflow = 'hidden';
      const f = $('[autofocus]', d) || focusables(d)[1] || focusables(d)[0]; if (f) f.focus();
    },
    close(d) {
      if (!d || !d.open) return;
      const done = () => { d.classList.remove('is-closing'); if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); if (!$('dialog[open]')) document.body.style.overflow = ''; if (d._opener && d._opener.focus) d._opener.focus(); };
      if (reduced()) { done(); return; }
      d.classList.add('is-closing'); setTimeout(done, 360);
    },
  };
  function wireDialogs() {
    $$('dialog').forEach((d) => {
      d.addEventListener('cancel', (e) => { e.preventDefault(); Dlg.close(d); });
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) Dlg.close(d); });
      d.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const f = focusables(d); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    });
    document.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); Dlg.open(document.getElementById(o.dataset.open), o); } });
  }

  /* ───────── avatars ───────── */
  const avatar = (s, cls = '') => (s.av ? `<img class="av ${cls}" src="${s.av}" alt="" width="40" height="40" loading="lazy">` : `<span class="av av--initials ${cls}" aria-hidden="true">${s.initials}</span>`);

  /* ───────── the listing card: First Light's frame and air, DRVN's facts ───────── */
  const shipLine = (l) => (l.ship > 0 ? `+ ${money(l.ship)} shipping` : 'Shipping included') + (l.pickup ? ' · Pickup available' : '');
  const metaLine = (l) => { const brand = l.brand && !l.title.toLowerCase().includes(l.brand.toLowerCase().split(' ')[0]) ? l.brand : null; return [brand, l.cond, l.loc].filter(Boolean).join(' · '); };
  const fitFor = (l, v) => (!v ? null : l.universal ? 'universal' : l.fits.includes(v) ? 'yes' : 'check');
  const FIT_TEXT = { yes: 'Fits', check: 'Check fit', universal: 'Universal' };
  function cardHTML(l, i = 0, opts = {}) {
    const s = SELLERS[l.seller];
    const fit = fitFor(l, opts.vehicle);
    const frame = l.img
      ? `<img src="${l.img}" alt="${esc(l.title)}" loading="lazy" decoding="async">`
      : `<div class="lcard__type"><i class="label">${esc(catName(l.cat))}</i><b>${esc(l.short || l.title)}</b><span>${esc(l.blurb || '')}</span></div>`;
    return `<article class="lcard" data-id="${l.id}" data-reveal style="--d:${(i % 3) * 80}ms;--k:${l.k ?? (i % 5) / 4}">
      <div class="lcard__frame">${frame}
        ${fit ? `<span class="fitbadge fitbadge--${fit}">${FIT_TEXT[fit]}</span>` : ''}
        <button type="button" class="lcard__save" data-save="${l.id}" aria-pressed="${saved.has(l.id)}" aria-label="Save ${esc(l.title)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3.5h9v13l-4.5-3-4.5 3z"/></svg></button>
        <button type="button" class="lcard__add" data-add="${l.id}" aria-label="Add ${esc(l.title)} to cart">Add to cart</button>
      </div>
      <div class="lcard__body">
        <h3 class="lcard__title"><a href="${href(l)}">${esc(l.title)}</a></h3>
        <p class="lcard__price price">${money(l.price)}</p>
        <p class="lcard__ship">${shipLine(l)}</p>
        <p class="lcard__meta">${esc(metaLine(l))}</p>
        <p class="lcard__by">${avatar(s, 'av--xs')}<span>${esc(s.name)}</span></p>
        <p class="lcard__off">${esc(offLine(l))}</p>
      </div>
    </article>`;
  }
  function syncCards(scope = document) {
    $$('[data-add]', scope).forEach((b) => { const on = cart.includes(b.dataset.add); b.classList.toggle('is-added', on); if (!b.dataset.keep) b.textContent = on ? 'In cart' : 'Add to cart'; });
    $$('[data-save]', scope).forEach((b) => b.setAttribute('aria-pressed', String(saved.has(b.dataset.save))));
  }
  function renderCards(el, list, opts = {}) { el.innerHTML = list.map((l, i) => cardHTML(l, i, opts)).join(''); syncCards(el); observeReveals(el); }

  /* ───────── feed items: builds, updates (with before/after), parts ───────── */
  const svgHeart = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16.5s-6-3.7-6-8.2A3.3 3.3 0 0 1 10 6a3.3 3.3 0 0 1 6 2.3c0 4.5-6 8.2-6 8.2z"/></svg>';
  const svgChat = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12v8H8l-4 3z"/></svg>';
  const likeBtn = (key, base) => { const on = likes.has(key); const n = base + (on ? 1 : 0); return `<button class="react" type="button" data-like="${key}" data-base="${base}" aria-pressed="${on}" aria-label="Like">${svgHeart}<span>${n || ''}</span></button>`; };
  const commentBtn = (n) => `<button class="react" type="button" data-soon="Comments open on the full post, which isn't part of this mockup." aria-label="Comments${n ? ', ' + n : ''}">${svgChat}<span>${n || ''}</span></button>`;
  const saveFeed = (key, label) => `<button class="save" type="button" data-save="${key}" aria-pressed="${saved.has(key)}">Save<span class="sr"> ${esc(label)}</span></button>`;
  const buildHref = (b) => (b.owner === 'marisol' ? `garage.html#${b.id}` : '#');
  const buildSoon = (b) => (b.owner === 'marisol' ? '' : ` data-soon="${esc(`Build pages aren't part of this mockup. This would open ${b.unnamed ? 'the ' + b.nick : b.nick}.`)}"`);
  function whoHead(o, line, when) {
    return `<header class="fpost__head">${avatar(o)}<p><span class="post__name">${esc(o.name)}</span><span class="post__handle">${line}</span></p><time class="fpost__time">${esc(when)}</time></header>`;
  }
  function postHTML(p, i = 0) {
    const o = SELLERS[p.owner]; const b = BUILDS[p.build];
    const media = p.before
      ? `<div class="compare"><img src="${p.before}" alt="Before: ${esc(p.altBefore)}"><img class="compare__after" src="${p.after}" alt="After: ${esc(p.altAfter)}"><span class="compare__line" aria-hidden="true"></span><span class="compare__tag compare__tag--b" aria-hidden="true">Before</span><span class="compare__tag compare__tag--a" aria-hidden="true">After</span><input type="range" min="0" max="100" value="50" aria-label="Before and after, ${esc(p.title)}: slide to compare"></div>`
      : `<img src="${p.img}" alt="${esc(p.alt)}" loading="lazy" decoding="async">`;
    const car = `<a class="link" href="${buildHref(b)}"${buildSoon(b)}>${esc(b.unnamed ? b.nick : b.nick + ' · ' + b.model)}</a>`;
    return `<article class="fpost fpost--wide${p.isNew ? ' is-new' : ''}" data-kind="update" data-owner="${p.owner}" data-reveal style="--d:${(i % 2) * 80}ms">
      ${whoHead(o, car, p.when)}
      <div class="fpost__body"><figure class="fpost__photo photo">${media}</figure>
        <div class="fpost__words"><p class="label">Update</p><h3 class="fpost__title">${esc(p.title)}</h3><p class="fpost__text">${esc(p.text)}</p>
          <div class="fpost__foot">${likeBtn('p:' + p.id, p.likes)}${commentBtn(p.comments)}${saveFeed('p:' + p.id, p.title)}</div></div></div>
    </article>`;
  }
  function buildHTML(b, i = 0) {
    const o = SELLERS[b.owner]; const parts = buildParts(b).length;
    const facts = [b.updates ? `${b.updates} ${b.updates === 1 ? 'update' : 'updates'}` : null, parts ? `${parts} ${parts === 1 ? 'part' : 'parts'} for sale` : null].filter(Boolean).join(' · ') || 'Just added';
    return `<article class="fpost fpost--tall" data-kind="build" data-owner="${b.owner}" data-reveal style="--d:${(i % 2) * 80}ms">
      ${whoHead(o, esc(carsLine(b.owner)), b.age + ' ago')}
      <div class="fpost__body"><figure class="fpost__photo photo"><img src="${b.img}" alt="${esc(b.alt)}" loading="lazy" decoding="async"></figure>
        <div class="fpost__words"><p class="label">Build</p><h3 class="fpost__title"><a href="${buildHref(b)}"${buildSoon(b)}>${esc(b.nick)}</a></h3><p class="fpost__text">${esc(b.unnamed ? 'Unnamed build' : b.model)}</p><p class="fpost__facts">${facts}</p>
          <div class="fpost__foot">${likeBtn('b:' + b.id, b.likes)}${saveFeed('b:' + b.id, b.nick)}</div></div></div>
    </article>`;
  }
  function partFeedHTML(l, i = 0) {
    const s = SELLERS[l.seller];
    const media = l.img ? `<img src="${l.img}" alt="" loading="lazy">` : `<b>${esc(l.short || l.title)}</b>`;
    return `<article class="fpart" data-kind="part" data-id="${l.id}" data-owner="${l.seller}" data-reveal style="--d:${(i % 2) * 80}ms">
      <p class="fpart__line label"><span class="fpart__dot" aria-hidden="true"></span>For sale · ${esc(s.name)}</p>
      <div class="fpart__body"><div class="fpart__img photo">${media}</div>
        <div class="fpart__text"><h3 class="fpart__title"><a href="${href(l)}">${esc(l.title)}</a></h3>
          <p class="lcard__ship">${shipLine(l)}</p><p class="lcard__meta">${esc(metaLine(l))}</p><p class="lcard__off">${esc(offLine(l))}</p></div>
        <p class="fpart__price price">${money(l.price)}</p></div>
      <button type="button" class="lcard__add fpart__add" data-add="${l.id}" aria-label="Add ${esc(l.title)} to cart">Add to cart</button>
    </article>`;
  }
  function builderRow(id) {
    const o = SELLERS[id];
    const btn = id === 'marisol' && isIn() ? '<span class="pill">You</span>' : `<button class="btn btn--quiet btn--sm" type="button" data-follow="${id}" aria-pressed="${follows.has(id)}">${follows.has(id) ? 'Following' : 'Follow'}</button>`;
    return `<li class="person">${avatar(o)}<p><span class="post__name">${esc(o.name)}</span><span class="post__handle">${esc(carsLine(id))}</span></p>${btn}</li>`;
  }
  function wireCompare(scope = document) {
    $$('.compare input', scope).forEach((r) => { if (r._w) return; r._w = 1; r.addEventListener('input', () => r.closest('.compare').style.setProperty('--cut', r.value + '%')); });
  }

  /* ───────── cart drawer, saves, likes, follows (shared everywhere) ───────── */
  const saveCart = () => store.set('nmb-cart', cart);
  function renderCartCount(bump) {
    $$('[data-cart-count]').forEach((b) => { b.textContent = cart.length; b.classList.toggle('has', cart.length > 0); if (bump && !reduced()) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } });
    $$('[data-cart-open]').forEach((b) => b.setAttribute('aria-label', `Cart, ${cart.length} ${cart.length === 1 ? 'item' : 'items'}`));
  }
  function renderCart() {
    renderCartCount();
    const body = $('#cartBody'), foot = $('#cartFoot'); if (!body) return;
    $('#cartN').textContent = cart.length ? ` (${cart.length})` : '';
    if (!cart.length) {
      body.innerHTML = `<div class="bag-empty"><p class="h3">Nothing in the cart <em>yet.</em></p><p>Parts you add show up here, grouped by seller.</p><a class="btn btn--quiet" href="marketplace.html">Browse the marketplace</a></div>`;
      foot.hidden = true; return;
    }
    foot.hidden = false;
    const groups = {};
    cart.forEach((id) => { const l = byId[id]; (groups[l.seller] = groups[l.seller] || []).push(l); });
    body.innerHTML = Object.entries(groups).map(([sid, items]) => {
      const s = SELLERS[sid];
      return `<section class="cgroup" aria-label="From ${esc(s.name)}"><p class="cgroup__head">${avatar(s, 'av--xs')}<span>From ${esc(s.name)}${s.loc ? ' · ' + esc(s.loc) : ''}</span></p>
        <ul>${items.map((l) => `<li class="line"><div class="line__img">${l.img ? `<img src="${l.img}" alt="">` : esc((l.short || l.title).split(' ')[0])}</div>
          <div><p class="line__t"><a href="${href(l)}">${esc(l.title)}</a></p><p class="line__s">${shipLine(l)} · ${esc(l.cond)}</p></div>
          <div class="line__r"><span class="price">${money(l.price)}</span><button class="line__x" type="button" data-remove="${l.id}">Remove<span class="sr"> ${esc(l.title)}</span></button></div></li>`).join('')}</ul></section>`;
    }).join('');
    const sub = cart.reduce((a, id) => a + byId[id].price, 0), ship = cart.reduce((a, id) => a + byId[id].ship, 0);
    $('#cartSub').textContent = money(sub); $('#cartShip').textContent = ship ? money(ship) : 'Included'; $('#cartTotal').textContent = money(sub + ship);
  }
  function addToCart(id, opener, openDrawer = true) {
    if (!cart.includes(id)) { cart.push(id); saveCart(); renderCartCount(true); }
    renderCart(); syncCards();
    document.dispatchEvent(new CustomEvent('nmb:cart'));
    if (openDrawer) Dlg.open($('#cart'), opener);
  }
  function initShared() {
    wireDialogs(); renderCart();
    $('#cartBody')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]'); if (!b) return;
      cart = cart.filter((x) => x !== b.dataset.remove); saveCart(); renderCart(); syncCards(); document.dispatchEvent(new CustomEvent('nmb:cart'));
      ($('#cartBody [data-remove]') || $('#cart [data-close]'))?.focus();
    });
    $('#checkout')?.addEventListener('click', () => toast("Checkout isn't part of this mockup. Payment would be held until each part arrives."));
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-cart-open]'); if (open) { Dlg.open($('#cart'), open); return; }
      const add = e.target.closest('[data-add]'); if (add) { e.preventDefault(); addToCart(add.dataset.add, add); return; }
      const sv = e.target.closest('[data-save]');
      if (sv) {
        const k = sv.dataset.save; if (saved.has(k)) saved.delete(k); else saved.add(k);
        store.set('nmb-saved', [...saved]); syncCards();
        $$(`[data-save="${k}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(saved.has(k))); if (b.classList.contains('save') && b.firstChild) b.firstChild.nodeValue = saved.has(k) ? 'Saved' : 'Save'; });
        toast(saved.has(k) ? 'Saved. Find it under Saved in your account.' : 'Removed from saved.'); return;
      }
      const lk = e.target.closest('[data-like]');
      if (lk) {
        const k = lk.dataset.like; if (likes.has(k)) likes.delete(k); else likes.add(k);
        store.set('nmb-likes', [...likes]);
        const n = Number(lk.dataset.base) + (likes.has(k) ? 1 : 0);
        lk.setAttribute('aria-pressed', String(likes.has(k))); $('span', lk).textContent = n || ''; return;
      }
      const fb = e.target.closest('[data-follow]');
      if (fb) {
        const k = fb.dataset.follow; if (follows.has(k)) follows.delete(k); else follows.add(k);
        store.set('nmb-follows', [...follows]);
        $$(`[data-follow="${k}"]`).forEach((b) => { b.setAttribute('aria-pressed', String(follows.has(k))); b.textContent = follows.has(k) ? 'Following' : 'Follow'; });
        document.dispatchEvent(new CustomEvent('nmb:follow'));
        toast(follows.has(k) ? `Following ${SELLERS[k].name}. Their updates land in Following on Home.` : `Unfollowed ${SELLERS[k].name}.`);
      }
    });
    $$('.save').forEach((b) => { if (b.firstChild) b.firstChild.nodeValue = saved.has(b.dataset.save) ? 'Saved' : 'Save'; });
    window.addEventListener('storage', (e) => { if (e.key === 'nmb-cart') { cart = store.get('nmb-cart', []).filter((id) => byId[id]); renderCart(); syncCards(); } });
  }

  /* tabs: role=tablist, arrow keys, Home/End; panels named by aria-controls */
  function wireTabs(list, onChange) {
    const tabs = $$('[role="tab"]', list);
    const select = (t, focus) => {
      tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = !on; });
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = false;
      if (panel && !reduced()) { panel.classList.remove('is-in'); void panel.offsetWidth; panel.classList.add('is-in'); }
      if (panel) observeReveals(panel);
      if (focus) t.focus();
      if (onChange) onChange(t.dataset.tab || t.id);
      stampTimes();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        let n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') n = tabs[0];
        if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
    return { select: (key, focus) => { const t = tabs.find((x) => (x.dataset.tab || x.id) === key); if (t) select(t, focus); } };
  }

  /* ═══════════════════════════ pages ═══════════════════════════ */
  const countFor = (k) => LISTINGS.filter((l) => l.fits.includes(k)).length;
  const MAKE = (k) => CARS[k].name.split(' ')[1];
  const MODEL = (k) => `${CARS[k].name.split(' ').slice(2).join(' ')} (${CARS[k].gen.split(' · ')[0]})`;
  const CAR_PHOTO = { golfr: 'img/cars/unknown-a.jpg', m4: 'img/cars/gruene-g80-m4.jpg', z06: 'img/cars/frost-c8-z06.jpg', rs4: 'img/cars/anjali-rs4-avant.jpg', gt3: 'img/cars/signal-992-gt3.jpg', m3: 'img/cars/lucille-e46-m3.jpg' };
  const CAR_ALT = { golfr: 'A Golf R Mk8 parked on a street', m4: 'A green M4 Competition outside a café', z06: 'A white Corvette Z06 in an event paddock', rs4: 'A blue RS4 Avant in a wet car park', gt3: 'A yellow 992 GT3 in front of a grey shutter', m3: 'Lucille, a silver E46 M3 with a red stripe, at a circuit' };

  /* ───────── landing ───────── */
  function initLanding() {
    const fresh = $('[data-list="fresh"]');
    if (fresh) renderCards(fresh, ['big-brake-kit', 'akrapovic', 'wing', 'capristo'].map((id) => byId[id]), { vehicle: getVehicle() });
    // What do you drive? make → model, carried into the marketplace
    const make = $('#pMake'), model = $('#pModel'), go = $('#pGo');
    if (make && model) {
      [...new Set(CAR_ORDER.map(MAKE))].sort().forEach((m) => make.add(new Option(m, m)));
      const fillModels = () => {
        model.innerHTML = '';
        model.add(new Option(make.value ? 'Any model' : 'Pick a make first', ''));
        CAR_ORDER.filter((k) => MAKE(k) === make.value).forEach((k) => model.add(new Option(MODEL(k), k)));
        model.disabled = !make.value;
        label();
      };
      const label = () => {
        const k = model.value;
        go.textContent = k ? `Show ${countFor(k) || 'fit-checked'} ${countFor(k) === 1 ? 'part' : 'parts'} for the ${CARS[k].short}` : make.value ? `Show ${make.value} parts` : 'Show parts';
      };
      make.addEventListener('change', fillModels); model.addEventListener('change', label);
      const v = getVehicle(); if (v) { make.value = MAKE(v); fillModels(); model.value = v; label(); } else fillModels();
      $('#picker').addEventListener('submit', (e) => {
        e.preventDefault();
        const k = model.value; if (k) setVehicle(k);
        const q = new URLSearchParams(); if (k) q.set('fits', k); else if (make.value) q.set('q', make.value);
        location.href = 'marketplace.html' + (q.toString() ? '?' + q : '');
      });
    }
    const tiles = $('[data-tiles]');
    if (tiles) {
      tiles.innerHTML = ['m3', 'gt3', 'm4', 'golfr', 'rs4', 'z06'].map((k, i) => {
        const n = countFor(k);
        return `<a class="cartile" href="marketplace.html?fits=${k}" data-vehicle="${k}" data-reveal style="--d:${(i % 3) * 80}ms">
          <span class="cartile__img photo"><img src="${CAR_PHOTO[k]}" alt="${esc(CAR_ALT[k])}" loading="lazy"></span>
          <span class="cartile__name">${esc(CARS[k].name.replace(/^\d{4} /, ''))}</span>
          <span class="cartile__n">${n ? `${n} listed for it` : 'Fit check'}</span></a>`;
      }).join('');
      tiles.addEventListener('click', (e) => { const a = e.target.closest('[data-vehicle]'); if (a) setVehicle(a.dataset.vehicle); });
    }
    const withCar = $('[data-withcar]');
    if (withCar) {
      const pairs = [['rs4-manifold', 'img/cars/anjali-rs4-avant.jpg'], ['gt3-wheels', 'img/cars/signal-992-gt3.jpg'], ['gt3-seats', 'img/cars/signal-992-gt3.jpg']];
      withCar.innerHTML = pairs.map(([id, carImg], i) => { const l = byId[id]; return cardHTML(l, i).replace('<div class="lcard__frame">', `<div class="lcard__frame"><span class="lcard__car photo"><img src="${carImg}" alt="The ${esc(CARS[l.car].name)} it came off" loading="lazy"></span>`); }).join('');
      syncCards(withCar); observeReveals(withCar);
    }
    const sellers = $('[data-sellers]');
    if (sellers) {
      sellers.innerHTML = ['lucille', 'signal', 'shirayuki', 'frost'].map((id, i) => { const b = BUILDS[id]; const n = buildParts(b).length; const o = SELLERS[b.owner];
        return `<a class="sellercar" href="${buildHref(b)}"${buildSoon(b)} data-reveal style="--d:${i * 80}ms"><span class="photo ratio-45"><img src="${b.img}" alt="${esc(b.alt)}" loading="lazy"></span>
          <span class="sellercar__nick">${esc(b.nick)}</span><span class="sellercar__model">${esc(b.model)} · ${esc(o.name)}</span><span class="sellercar__n">${n ? `${n} ${n === 1 ? 'part' : 'parts'} for sale` : 'Nothing listed yet'}</span></a>`; }).join('');
      observeReveals(sellers);
    }
    const shelf = $('[data-shelf]');
    if (shelf) shelf.innerHTML = LISTINGS.filter((l) => l.seller === 'marisol').map((l) => `<li><a class="shelfrow" href="${href(l)}"><span><b>${esc(l.title)}</b><span>${esc(offLine(l))} · ${esc(l.cond)}</span></span><span class="price">${money(l.price)}</span></a></li>`).join('');
  }

  /* ───────── explore ───────── */
  const EXPLORE_FEED = [['b', 'rs4'], ['p', 'jade-pass'], ['l', 'akrapovic'], ['b', 'nimbus'], ['p', 'felix-cup'], ['l', 'rs4-manifold'], ['b', 'hagane'], ['p', 'lena-stage1'], ['band', 'car'], ['l', 'gt3-wheels'], ['b', 'frost'], ['p', 'kaito-coilovers'], ['l', 'gt3-seats'], ['band', 'builders'], ['b', 'gruene'], ['p', 'marcus-wheels'], ['l', 'wing'], ['b', 'scarlet'], ['p', 'lucille-dyno'], ['l', 'capristo'], ['p', 'ryo-teardown'], ['b', 'signal'], ['b', 'shirayuki'], ['p', 'lucille-seat'], ['b', 'lucille'], ['p', 'nimbus-delivery'], ['p', 'lucille-brakes'], ['l', 'big-brake-kit']];
  function initExplore() {
    const feed = $('#xfeed'); if (!feed) return;
    const params = new URLSearchParams(location.search);
    const TYPES = ['all', 'builds', 'updates', 'parts', 'builders'];
    const state = { type: TYPES.includes(params.get('type')) ? params.get('type') : 'all', q: '', make: '', sort: 'newest', limit: 12 };
    const BUILDERS = ['marisol', 'kaito', 'felix', 'tommy', 'dario', 'jade', 'ryo', 'lena', 'marcus', 'anjali'];
    const items = EXPLORE_FEED.filter(([t]) => t !== 'band');
    const modelOf = ([t, id]) => (t === 'b' ? BUILDS[id].model : t === 'p' ? BUILDS[postById[id].build].model : CARS[byId[id].car].name);
    const textOf = ([t, id]) => (t === 'b' ? [BUILDS[id].nick, BUILDS[id].model, SELLERS[BUILDS[id].owner].name] : t === 'p' ? [postById[id].title, postById[id].text, SELLERS[postById[id].owner].name, BUILDS[postById[id].build].nick] : [byId[id].title, byId[id].brand, SELLERS[byId[id].seller].name, CARS[byId[id].car].name]).join(' ').toLowerCase();
    const likesOf = ([t, id]) => (t === 'b' ? BUILDS[id].likes : t === 'p' ? postById[id].likes : 0) + (likes.has(t + ':' + id) ? 1 : 0);
    [...new Set(items.map((x) => modelOf(x).split(' ')[1]))].sort().forEach((m) => $('#xMake').add(new Option(m, m)));
    const want = { builds: 'b', updates: 'p', parts: 'l' };
    const count = $('#xcount');
    function render() {
      const q = state.q.trim().toLowerCase();
      if (state.type === 'builders') {
        const list = BUILDERS.filter((id) => !q || SELLERS[id].name.toLowerCase().includes(q));
        feed.innerHTML = list.length ? `<section class="interject" aria-label="Builders"><ul class="people">${list.map(builderRow).join('')}</ul></section>` : '<div class="empty"><p class="h3">No builders by that <em>name.</em></p><p>Try a first name, like Kaito or Felix.</p></div>';
        $('#xMore').hidden = true; count.textContent = `${list.length} builders`; return;
      }
      let list = items.filter((x) => (state.type === 'all' || x[0] === want[state.type]) && (!q || textOf(x).includes(q)) && (!state.make || modelOf(x).split(' ')[1] === state.make));
      if (state.sort === 'liked') list = [...list].sort((a, b) => likesOf(b) - likesOf(a));
      const total = list.length, shown = list.slice(0, state.limit), out = [];
      const plain = state.type === 'all' && !q && !state.make && state.sort === 'newest';
      shown.forEach((x, i) => { if (plain && i === 5) out.push(['band', 'builders']); if (plain && i === 10) out.push(['band', 'car']); out.push(x); });
      feed.innerHTML = total ? out.map(([t, id], i) => {
        if (t === 'b') return buildHTML(BUILDS[id], i);
        if (t === 'p') return postHTML(postById[id], i);
        if (t === 'l') return partFeedHTML(byId[id], i);
        if (id === 'builders') return `<section class="interject" aria-label="Builders to follow" data-reveal><p class="label">Builders to follow</p><ul class="people">${['kaito', 'felix', 'tommy', 'dario'].map(builderRow).join('')}</ul></section>`;
        return `<section class="interject interject--car" aria-label="Put your car on DRVN" data-reveal><p class="label">Put your car on DRVN</p><p class="interject__line">Every build here started with someone adding their car. <em>Yours gets a page like these.</em></p><a class="btn btn--quiet btn--sm" href="garage.html" data-signin>Add your car</a></section>`;
      }).join('') : '<div class="empty"><p class="h3">Nothing matches <em>yet.</em></p><p>Try another make, or clear the search.</p><button class="btn btn--quiet" type="button" id="xClear">Clear search and filters</button></div>';
      $('#xMore').hidden = total <= state.limit;
      count.textContent = `${total} ${total === 1 ? 'result' : 'results'}`;
      wireCompare(feed); syncCards(feed); observeReveals(feed); stampTimes();
    }
    const tabs = wireTabs($('#xtabs'), (k) => { state.type = k; state.limit = 12; render(); });
    tabs.select(state.type);
    let qt; $('#xq').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { state.q = $('#xq').value; render(); }, 140); });
    $('#xSearch').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('#xq').value; render(); });
    $('#xMake').addEventListener('change', () => { state.make = $('#xMake').value; render(); });
    $('#xSort').addEventListener('change', () => { state.sort = $('#xSort').value; render(); });
    $('#xMore').addEventListener('click', () => { const first = feed.children.length; state.limit += 12; render(); $('a, button', feed.children[first] || feed)?.focus(); });
    document.addEventListener('click', (e) => { if (e.target.closest('#xClear')) { Object.assign(state, { q: '', make: '', sort: 'newest' }); $('#xq').value = ''; $('#xMake').value = ''; $('#xSort').value = 'newest'; render(); } });
    $('#xRail').innerHTML = ['kaito', 'felix', 'jade', 'marcus'].map(builderRow).join('');
  }

  /* ───────── marketplace ───────── */
  function initMarket() {
    const grid = $('[data-market]'); if (!grid) return;
    const form = $('#filters'), count = $('#mcount'), sortEl = $('#mSort'), fitSel = $('#mFits');
    const params = new URLSearchParams(location.search);
    let q = (params.get('q') || '').trim().toLowerCase();
    CAR_ORDER.forEach((k) => fitSel.add(new Option(`${CARS[k].name} (${CARS[k].gen.split(' · ')[0]})`, k)));
    const pv = params.get('fits'); if (CARS[pv]) setVehicle(pv);
    fitSel.value = getVehicle() || '';
    $('#mCats').innerHTML = CATS.map((c) => `<label class="check check--radio"><input type="radio" name="cat" value="${c.id}"${c.id === (params.get('cat') || 'all') ? ' checked' : ''}> ${esc(c.name)}<span class="n">${c.id === 'all' ? LISTINGS.length : LISTINGS.filter((l) => l.cat === c.id).length}</span></label>`).join('');
    const toggle = $('[data-filters-toggle]');
    if (toggle) {
      const mq = window.matchMedia('(max-width: 920px)');
      const setMode = () => { form.hidden = mq.matches ? toggle.getAttribute('aria-expanded') !== 'true' : false; };
      toggle.addEventListener('click', () => { toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true')); setMode(); });
      mq.addEventListener('change', setMode); setMode();
    }
    function apply() {
      const v = fitSel.value || null; setVehicle(v);
      const cat = ($('input[name="cat"]:checked', form) || {}).value || 'all';
      const conds = $$('input[name="cond"]:checked', form).map((c) => c.value);
      const pickup = $('#mPickup').checked, onlyFits = $('#mOnlyFits').checked && v;
      const min = parseFloat($('#mMin').value), max = parseFloat($('#mMax').value);
      let res = LISTINGS.filter((l) => (cat === 'all' || l.cat === cat) && (!conds.length || conds.includes(l.cond)) && (!pickup || l.pickup)
        && (isNaN(min) || l.price >= min) && (isNaN(max) || l.price <= max) && (!onlyFits || fitFor(l, v) !== 'check')
        && (!q || [l.title, l.brand, CARS[l.car].name, SELLERS[l.seller].name].join(' ').toLowerCase().includes(q)));
      const s = sortEl.value;
      res = [...res].sort((a, b) => (s === 'low' ? a.price - b.price : s === 'high' ? b.price - a.price : a.age - b.age));
      $('#mOnlyFitsWrap').hidden = !v;
      $('#mVehicleNote').textContent = v ? `Fit badges show against your ${CARS[v].name}.` : 'Choose your car to see what fits.';
      const active = (v ? 1 : 0) + (cat !== 'all' ? 1 : 0) + conds.length + (pickup ? 1 : 0) + (isNaN(min) ? 0 : 1) + (isNaN(max) ? 0 : 1);
      if (toggle) $('[data-active]', toggle).textContent = active ? ` · ${active}` : '';
      count.innerHTML = `${res.length} ${res.length === 1 ? 'part' : 'parts'}${cat !== 'all' ? ` in <em>${esc(catName(cat))}</em>` : ''}${q ? ` for “${esc(q)}”` : ''}`;
      if (res.length) renderCards(grid, res, { vehicle: v });
      else grid.innerHTML = '<div class="empty"><p class="h3">Nothing yet, <em>but it’s early.</em></p><p>Loosen a filter, or check back after the drive.</p><button type="button" class="btn btn--quiet" data-reset>Clear filters</button></div>';
      const u = new URLSearchParams(); if (cat !== 'all') u.set('cat', cat); if (v) u.set('fits', v); if (q) u.set('q', q);
      history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : ''));
    }
    form.addEventListener('change', apply);
    form.addEventListener('input', (e) => { if (e.target.type === 'number') apply(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
    sortEl.addEventListener('change', apply);
    document.addEventListener('click', (e) => { if (e.target.closest('[data-reset]')) { form.reset(); fitSel.value = ''; q = ''; $$('input[name="q"]').forEach((i) => { i.value = ''; }); $('input[name="cat"][value="all"]').checked = true; apply(); } });
    document.addEventListener('nmb:cart', () => syncCards(grid));
    apply();
  }

  /* ───────── listing ───────── */
  function initListing() {
    const mount = $('#listing'); if (!mount) return;
    const l = byId[new URLSearchParams(location.search).get('id')] || byId['big-brake-kit'];
    const s = SELLERS[l.seller], c = CARS[l.car], first = s.name.split(' ')[0];
    const total = l.price + l.ship, offer = store.get(`nmb-offer-${l.id}`, null);
    document.title = `${l.title} · DRVN`;
    const specs = [...l.specs, ['Ships from', l.loc || 'Ask the seller']];
    const gallery = l.img
      ? `<button class="gframe photo" type="button" data-open="lightbox" aria-label="View the photo full size"><img src="${l.img}" alt="${esc(l.title)}, from the seller"><span class="gframe__zoom">View full size</span></button>
         <p class="gallery__cap"><span>1 photo, from the seller.</span> <a class="link" href="#ask" data-askphoto>Ask ${esc(first)} for more photos</a></p>`
      : `<div class="gframe gframe--type"><div class="lcard__type" style="--k:${l.k ?? .5}"><i class="label">${esc(catName(l.cat))} · No photo yet</i><b>${esc(l.short || l.title)}</b><span>${esc(l.blurb || '')}</span></div></div>
         <p class="gallery__cap"><span>The seller hasn’t added a photo.</span> <a class="link" href="#ask" data-askphoto>Ask ${esc(first)} for a photo</a></p>`;
    const similar = LISTINGS.filter((x) => x.cat === l.cat && x.id !== l.id).slice(0, 3);
    const more = LISTINGS.filter((x) => x.seller === l.seller && x.id !== l.id).slice(0, 3);
    $('#crumbs').innerHTML = `<li><a href="marketplace.html">Marketplace</a></li><li><a href="marketplace.html?cat=${l.cat}">${esc(catName(l.cat))}</a></li>`;
    mount.innerHTML = `
      <div class="part">
        <section class="gallery" aria-label="Photos">${gallery}</section>
        <aside class="buybox" aria-labelledby="partTitle">
          <div><p class="label">${esc(catName(l.cat))} · Grade ${l.grade === 'N' ? 'New' : l.grade}</p><h1 id="partTitle" class="buybox__title">${esc(l.title)}</h1></div>
          <div class="pricing">
            <p class="pricing__amt price">${money(l.price)}</p>
            <p class="pricing__ship">${l.ship > 0 ? `+ ${money(l.ship)} shipping` : 'Shipping included'}${l.pickup ? ' · Pickup available' : ''}</p>
            <details class="pricing__more"><summary>${money(total)} item + shipping</summary>
              <dl class="sum"><div><dt>Item</dt><dd>${money(l.price)}</dd></div><div><dt>Shipping</dt><dd>${l.ship ? money(l.ship) : 'Included'}</dd></div><div><dt>Buyer protection</dt><dd>Included</dd></div><div class="total"><dt>Before tax</dt><dd>${money(total)}</dd></div></dl>
              <p class="hint">Any applicable tax and your selected delivery are confirmed at checkout.</p></details>
          </div>
          <div class="buybox__actions" id="acts">
            <button class="btn btn--sun" type="button" data-buy>Buy now</button>
            <button class="btn btn--quiet" type="button" data-add="${l.id}">Add to cart</button>
            <button class="btn btn--quiet${offer ? ' is-pending' : ''}" type="button" id="offerBtn" data-open="offer">${offer ? `Offer sent · ${money(offer)}` : 'Make an offer'}</button>
            <button class="btn btn--quiet btn--icon" type="button" data-save="${l.id}" aria-pressed="${saved.has(l.id)}" aria-label="Save this part"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3.5h9v13l-4.5-3-4.5 3z"/></svg></button>
          </div>
          <p class="assure">No account needed to buy · Payment held until it arrives</p>
          <section class="fitcheck" aria-labelledby="fitH">
            <h2 id="fitH">Will it fit <em>your car?</em></h2>
            <div class="field"><label for="fitSel">Your vehicle</label><select id="fitSel"><option value="">Choose a vehicle</option>${CAR_ORDER.map((k) => `<option value="${k}">${esc(CARS[k].name)} (${esc(CARS[k].gen.split(' · ')[0])})</option>`).join('')}</select></div>
            <div class="verdict" id="verdict" data-state="" aria-live="polite"><i class="verdict__mark" aria-hidden="true"></i><div></div></div>
          </section>
          <div class="seller">${avatar(s, 'av--lg')}<div><p class="seller__name">${esc(s.name)}</p><p class="seller__meta">${s.loc ? esc(s.loc) + ' · ' : ''}${s.sold} sold on DRVN</p></div><a class="link" href="#ask" data-askfocus>Ask a question</a></div>
          <a class="offcar" href="${l.seller === 'marisol' ? 'garage.html#lucille' : '#'}"${l.seller === 'marisol' ? '' : ` data-soon="${esc(`Garage pages for other members aren't part of this mockup. This would open the ${c.name}.`)}"`}>
            <span class="photo">${c.img ? `<img src="${l.seller === 'marisol' ? 'img/cars/lucille-e46-m3.jpg' : c.img}" alt="">` : `<span class="offcar__none">${esc(c.short)}</span>`}</span>
            <span><span class="label">Came off this car</span><b>${esc(c.nick ? c.nick + ' · ' + c.name : c.name)}</b><span>${esc(l.note)}</span></span></a>
        </aside>
      </div>
      <div class="partmore">
        <div>
          <section aria-labelledby="descH" data-reveal>
            <h2 id="descH" class="h3">In ${esc(first)}’s <em>words</em></h2>
            <div class="prose"><p>${esc(l.desc)}</p></div>
            <div class="grade"><span class="grade__pill">Grade ${l.grade === 'N' ? 'New' : l.grade}</span><div><p class="grade__h">Condition, seller-declared</p><p>${esc(GRADES[l.grade])}</p><p class="hint">Declared by the seller at listing time and recorded on the order if you buy.</p></div></div>
            <dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          </section>
          <section class="qa" aria-labelledby="qaH" data-reveal>
            <h2 id="qaH" class="h3">Questions for <em>the seller</em></h2>
            <p class="hint">Public. Anyone viewing this listing can read these questions and answers. Private, order-specific messaging opens once you buy.</p>
            <ol class="qa__list" id="qaList"></ol>
            <form class="ask" id="ask" novalidate>
              <div class="field"><label for="askText">Ask ${esc(first)} a question</label><textarea id="askText" rows="3" maxlength="500" placeholder="Part numbers, measurements, what’s in the box…" aria-describedby="askHint askErr"></textarea></div>
              <p class="ferr" id="askErr" hidden></p>
              <div class="ask__row"><p class="hint" id="askHint">Everyone can read your question and ${esc(first)}’s answer.</p><button class="btn btn--quiet btn--sm" type="submit">Post question</button></div>
            </form>
          </section>
        </div>
        <aside class="protect" aria-labelledby="protH" data-reveal>
          <h2 id="protH">Buyer protection, <em>plainly</em></h2>
          <ol>
            <li><span><b>Covered:</b> the item never arrives, arrives damaged, is significantly not as described, or is the wrong item.</span></li>
            <li><span><b>Report within 30 days</b> of delivery.</span></li>
            <li><span><b>The seller has 3 days</b> to respond before DRVN can step in.</span></li>
            <li><span><b>Dispatch within 3 working days</b> of a sale is expected of every seller.</span></li>
          </ol>
          <p class="protect__links"><button class="link linkbtn" type="button" data-open="protection">How protection &amp; disputes work</button><button class="link linkbtn" type="button" data-open="report">Report this listing</button></p>
        </aside>
      </div>
      ${similar.length ? `<section class="section--tight" aria-labelledby="simH"><div class="section__head"><div><p class="label">Same category</p><h2 id="simH" class="h2">Similar in <em>${esc(catName(l.cat))}</em></h2></div><a class="arrow" href="marketplace.html?cat=${l.cat}"><span>All ${esc(catName(l.cat))}</span></a></div><div class="grid grid--3" id="simGrid"></div></section>` : ''}
      ${more.length ? `<section class="section--tight" aria-labelledby="moreH"><div class="section__head"><div><p class="label">Same garage</p><h2 id="moreH" class="h2">More from <em>${esc(first)}</em></h2></div>${l.seller === 'marisol' ? '<a class="arrow" href="profile.html?tab=parts"><span>Marisol’s parts</span></a>' : ''}</div><div class="grid grid--3" id="moreGrid"></div></section>` : ''}
      <div class="buybar" id="buybar" aria-hidden="true"><div><span class="buybar__price price">${money(l.price)}</span><span class="buybar__ship">${l.ship > 0 ? '+ ' + money(l.ship) + ' shipping' : 'Shipping included'}</span></div><button class="btn btn--sun btn--sm" type="button" data-buy tabindex="-1">Buy now</button></div>`;
    if ($('#simGrid')) renderCards($('#simGrid'), similar, { vehicle: getVehicle() });
    if ($('#moreGrid')) renderCards($('#moreGrid'), more, { vehicle: getVehicle() });
    syncCards(mount); observeReveals(mount);
    if (l.img) { $('#lbImg').src = l.img; $('#lbImg').alt = l.title; $('#lbCap').textContent = l.title; }
    $$('[data-buy]', mount).forEach((b) => b.addEventListener('click', () => { addToCart(l.id, b); setTimeout(() => $('#checkout')?.focus(), 60); }));
    // fit check
    const fitSel = $('#fitSel'), verdict = $('#verdict');
    const renderFit = (animate) => {
      const v = fitSel.value; let st = '', t, b;
      if (!v) { t = 'Compatibility not confirmed'; b = 'Choose your vehicle, or check the part number, measurements and seller’s notes before buying.'; }
      else if (l.universal) { st = 'maybe'; t = 'Universal fit'; b = `${first} listed this as universal. ${l.desc.split('. ').slice(-1)[0]}`; }
      else if (l.fits.includes(v)) { st = 'yes'; t = 'Listed for this car'; b = `${first} listed it for the ${CARS[v].name}, and it came off ${c.nick ? c.nick + ', ' : ''}${s.pr} own ${CARS[l.car].short}.`; }
      else { st = 'no'; t = 'Not confirmed. Check the part number'; b = `${first} listed this for the ${CARS[l.car].name}, not the ${CARS[v].name}. Check the part number, measurements and ${first}’s notes, or ask below.`; }
      verdict.dataset.state = st; $('div', verdict).innerHTML = `<strong>${esc(t)}</strong><span>${esc(b)}</span>`;
      if (animate && !reduced()) { verdict.classList.remove('is-changed'); void verdict.offsetWidth; verdict.classList.add('is-changed'); }
    };
    fitSel.value = getVehicle() || ''; renderFit(false);
    fitSel.addEventListener('change', () => { setVehicle(fitSel.value || null); renderFit(true); });
    // Q&A
    const qaKey = `nmb-qa-${l.id}`, mine = store.get(qaKey, []), qaList = $('#qaList');
    const qHTML = (x, isNew) => `<li class="qitem${isNew ? ' is-new' : ''}"><p class="label">${esc(x.who)} · ${esc(x.when)}</p><p class="qitem__q">${esc(x.q)}</p>${x.a ? `<div class="qitem__a"><span class="label">${esc(s.name)} · Seller</span><p>${esc(x.a)}</p></div>` : `<div class="qitem__a is-waiting"><span class="label">Awaiting answer</span><p>${esc(first)} usually answers within a day. Everyone viewing will see the answer.</p></div>`}</li>`;
    const all = [...l.qa, ...mine];
    qaList.innerHTML = all.length ? all.map((x) => qHTML(x)).join('') : `<li class="qa__empty">No questions yet. Ask ${esc(first)} anything; answers appear here for everyone.</li>`;
    $('#ask').addEventListener('submit', (e) => {
      e.preventDefault();
      const ta = $('#askText'), err = $('#askErr'), v = ta.value.trim();
      if (v.length < 10) { err.textContent = v ? 'Add a little more detail (at least 10 characters).' : 'Write your question first.'; err.hidden = false; ta.setAttribute('aria-invalid', 'true'); ta.focus(); return; }
      err.hidden = true; ta.removeAttribute('aria-invalid');
      const item = { who: 'You', when: 'just now', q: v, a: null }; mine.push(item); store.set(qaKey, mine);
      if ($('.qa__empty', qaList)) qaList.innerHTML = '';
      qaList.insertAdjacentHTML('beforeend', qHTML(item, true)); ta.value = '';
      toast(`Question posted. We’ll let you know when ${first} answers.`);
    });
    const toAsk = (txt) => { const ta = $('#askText'); if (txt && !ta.value) ta.value = txt; $('#ask').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); ta.focus({ preventScroll: true }); };
    $$('[data-askfocus]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); toAsk(); }));
    $$('[data-askphoto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); toAsk(l.img ? 'Could you add more photos, including any part numbers?' : 'Could you add a photo of the part?'); }));
    // offer sheet
    const oform = $('#offerForm'), amt = $('#offerAmt'), oerr = $('#offerErr'), olive = $('#offerLive');
    $('#oTitle').textContent = l.title;
    $('#oAsk').textContent = `Asking ${money(l.price)} · ${l.ship > 0 ? '+ ' + money(l.ship) + ' shipping' : 'Shipping included'}`;
    $('#oImg').innerHTML = l.img ? `<img src="${l.img}" alt="">` : esc((l.short || l.title).split(' ')[0]);
    $$('[data-oseller]').forEach((x) => { x.textContent = first; });
    $('#quick').innerHTML = [0.9, 0.93, 0.97].map((p) => { const v = Math.round((l.price * p) / 10) * 10; return `<button type="button" class="btn btn--quiet btn--sm" data-amt="${v}">${money(v)}</button>`; }).join('');
    const parse = (v) => v.replace(/[$,\s]/g, '');
    const validate = (v) => { const s2 = parse(v); if (!s2) return 'Enter an amount for your offer.'; if (!/^\d+(\.\d{1,2})?$/.test(s2)) return 'Use numbers only, like 1300.'; const n = Number(s2); if (n < 1) return 'Your offer must be at least $1.'; if (n >= l.price) return `Your offer must be under the asking price of ${money(l.price)}. To pay the asking price, use Buy now.`; return ''; };
    const live = () => { const s2 = parse(amt.value), n = Number(s2); olive.innerHTML = s2 && n > 0 && n < l.price ? `If ${esc(first)} accepts, you pay <strong>${money(n)}</strong>${l.ship ? ` + ${money(l.ship)} shipping = <strong>${money(n + l.ship)}</strong>` : ', shipping included'}.${n < l.price * .5 ? ' Offers under half the asking price are rarely accepted.' : ''}` : `Offers must be under the asking price of ${money(l.price)}.`; };
    $('#offer').addEventListener('nmb:open', () => { $('#offerDone').hidden = true; oform.hidden = false; oerr.hidden = true; amt.removeAttribute('aria-invalid'); amt.value = ''; live(); });
    amt.addEventListener('input', () => { if (!oerr.hidden) { const m = validate(amt.value); oerr.textContent = m; oerr.hidden = !m; amt.toggleAttribute('aria-invalid', !!m); } live(); });
    $('#quick').addEventListener('click', (e) => { const b = e.target.closest('[data-amt]'); if (!b) return; amt.value = b.dataset.amt; oerr.hidden = true; amt.removeAttribute('aria-invalid'); live(); amt.focus(); });
    oform.addEventListener('submit', (e) => {
      e.preventDefault();
      const m = validate(amt.value); if (m) { oerr.textContent = m; oerr.hidden = false; amt.setAttribute('aria-invalid', 'true'); amt.focus(); return; }
      const n = Number(parse(amt.value)); store.set(`nmb-offer-${l.id}`, n);
      oform.hidden = true; $('#offerDone').hidden = false;
      $('#offerDoneText').textContent = `${money(n)} for the ${l.title.split(' — ')[0].toLowerCase()}. ${first} can accept, counter or decline, and you’ll hear back in Messages. Nothing is charged unless the offer is accepted.`;
      const ob = $('#offerBtn'); ob.textContent = `Offer sent · ${money(n)}`; ob.classList.add('is-pending');
      $('#offerDoneBtn').focus();
    });
    // report sheet
    const rform = $('#reportForm');
    $('#report').addEventListener('nmb:open', () => { rform.hidden = false; $('#reportDone').hidden = true; $('#reportErr').hidden = true; rform.reset(); });
    rform.addEventListener('submit', (e) => { e.preventDefault(); if (!$('input[name="reason"]:checked', rform)) { $('#reportErr').hidden = false; $('input[name="reason"]', rform).focus(); return; } rform.hidden = true; $('#reportDone').hidden = false; $('#reportDoneBtn').focus(); });
    // mobile buy bar
    const bar = $('#buybar'), acts = $('#acts');
    if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { const on = !en.isIntersecting && en.boundingClientRect.top < 0; bar.classList.toggle('is-on', on); bar.setAttribute('aria-hidden', String(!on)); $('button', bar).tabIndex = on ? 0 : -1; }).observe(acts);
    document.addEventListener('nmb:cart', () => syncCards(mount));
  }

  /* ───────── home (Marisol, signed in) ───────── */
  const FORYOU = [['b', 'rs4'], ['p', 'jade-pass'], ['l', 'akrapovic'], ['b', 'hagane'], ['p', 'felix-cup'], ['p', 'kaito-coilovers'], ['b', 'frost'], ['p', 'lena-stage1'], ['p', 'marcus-wheels'], ['l', 'kw'], ['p', 'ryo-teardown'], ['b', 'signal']];
  function initHome() {
    const feed = $('#hfeed'); if (!feed) return;
    const mine = []; let tab = 'foryou';
    const item = ([t, id], i) => (t === 'b' ? buildHTML(BUILDS[id], i) : t === 'p' ? postHTML(postById[id], i) : partFeedHTML(byId[id], i));
    function render() {
      let list;
      if (tab === 'following') {
        list = [...mine.map((m) => ['p', m.id]), ...POSTS.filter((p) => follows.has(p.owner)).map((p) => ['p', p.id])];
        if (!list.length) { feed.innerHTML = '<div class="empty empty--left"><p class="h3">Nothing here <em>yet.</em></p><p>Follow a few builders and their updates land here first. Try Kaito or Felix on the right, or browse Explore.</p><a class="btn btn--quiet" href="explore.html">Browse Explore</a></div>'; return; }
      } else list = [...mine.map((m) => ['p', m.id]), ...FORYOU];
      feed.innerHTML = list.map(item).join(''); wireCompare(feed); syncCards(feed); observeReveals(feed); stampTimes();
    }
    const tabs = wireTabs($('#htabs'), (k) => { tab = k; render(); });
    document.addEventListener('nmb:follow', () => { if (tab === 'following') render(); $('#hRailBuilders').innerHTML = ['kaito', 'felix', 'tommy', 'dario'].map(builderRow).join(''); });
    $('#hRailGarage').innerHTML = ['nimbus', 'lucille'].map((id) => { const b = BUILDS[id]; return `<li><a class="rowlink" href="garage.html#${id}"><span class="photo"><img src="${b.img}" alt=""></span><span><strong>${esc(b.nick)}</strong><span>${esc(b.model)} · ${b.updates} ${b.updates === 1 ? 'update' : 'updates'} · ${b.followers} followers</span></span></a></li>`; }).join('');
    $('#hRailWatch').innerHTML = ['gt3-wheels', 'kw', 'akrapovic'].map((id) => { const l = byId[id]; return `<li><a class="rowlink" href="${href(l)}"><span class="photo"><img src="${l.img}" alt=""></span><span><strong>${esc(l.title)}</strong><span>${esc(SELLERS[l.seller].name)}</span></span><span class="price">${money(l.price)}</span></a></li>`; }).join('');
    $('#hRailBuilders').innerHTML = ['kaito', 'felix', 'tommy', 'dario'].map(builderRow).join('');
    // composer: every post needs a photo and a car; tagging a part is optional
    const form = $('#composer'), ta = $('#cText'), car = $('#cCar'), files = $('#cPhotos'), err = $('#cErr'), tagSel = $('#cTag'), tagWrap = $('#cTagWrap'), tagBtn = $('#cTagBtn');
    LISTINGS.filter((l) => l.seller === 'marisol').forEach((l) => tagSel.add(new Option(`${l.title} · ${money(l.price)}`, l.id)));
    const pc = new URLSearchParams(location.search).get('car'); if (BUILDS[pc]?.owner === 'marisol') car.value = pc;
    if (location.hash === '#compose') setTimeout(() => ta.focus(), 60);
    let upload = null;
    files.addEventListener('change', () => { const f = files.files[0]; if (f && /^image\//.test(f.type)) { upload = { url: URL.createObjectURL(f), name: f.name }; $$('input[name="cPick"]', form).forEach((r) => { r.checked = false; }); $('#cUploadLabel').textContent = f.name; err.hidden = true; } });
    $$('input[name="cPick"]', form).forEach((r) => r.addEventListener('change', () => { upload = null; files.value = ''; $('#cUploadLabel').textContent = 'Upload'; err.hidden = true; }));
    tagBtn.addEventListener('click', () => { const open = tagWrap.hidden; tagWrap.hidden = !open; tagBtn.setAttribute('aria-expanded', String(open)); if (open) tagSel.focus(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ta.value.trim(), pick = $('input[name="cPick"]:checked', form), src = upload ? upload.url : pick ? pick.value : null;
      const msg = !v ? 'Say what’s new with the build first.' : v.length < 8 ? 'Add a little more (at least 8 characters).' : !src ? 'Add a photo. Every post on DRVN needs one.' : '';
      if (msg) { err.textContent = msg; err.hidden = false; (!v || v.length < 8 ? ta : ($('input[name="cPick"]', form) || files)).focus(); return; }
      err.hidden = true;
      const [firstLine, ...rest] = v.split(/\n+/);
      const p = { id: 'mine-' + Date.now(), owner: 'marisol', build: car.value, title: firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine, text: rest.join(' ') || (tagSel.value ? `Tagged: ${byId[tagSel.value].title}` : `New on ${BUILDS[car.value].nick}.`), img: src, alt: pick ? pick.dataset.alt : `Photo uploaded by Marisol: ${upload.name}`, likes: 0, comments: 0, when: `Today, ${nowLabel()}`, isNew: true };
      mine.unshift(p); postById[p.id] = p;
      form.reset(); upload = null; $('#cUploadLabel').textContent = 'Upload'; tagWrap.hidden = true; tagBtn.setAttribute('aria-expanded', 'false');
      if (tab !== 'foryou' && tab !== 'following') tab = 'foryou';
      render(); toast(`Posted to ${BUILDS[p.build].nick} at ${nowLabel()}. Your followers see it first.`);
      $('.fpost', feed)?.querySelector('a, button')?.focus();
    });
    tabs.select('foryou');
  }

  /* ───────── garage (Marisol's own) ───────── */
  function initGarage() {
    const view = $('#gview'); if (!view) return;
    const MINE = ['nimbus', 'lucille'];
    const valid = (k) => (k === 'all' || MINE.includes(k) ? k : null);
    let cur = valid(location.hash.slice(1)) || 'nimbus', curTab = 'overview';
    const live = LISTINGS.filter((l) => l.seller === 'marisol').length;
    $('#gstats').textContent = `2 cars · 4 updates · ${live} parts live · $950 in sales off them`;
    const sw = $('#gswitch');
    sw.innerHTML = `<button type="button" data-car="all" aria-pressed="false">All cars</button>` + MINE.map((k) => `<button type="button" data-car="${k}" aria-pressed="false"><img src="${BUILDS[k].img}" alt="">${esc(BUILDS[k].nick)}</button>`).join('');
    sw.addEventListener('click', (e) => { const b = e.target.closest('[data-car]'); if (!b) return; cur = b.dataset.car; curTab = 'overview'; history.replaceState(null, '', '#' + cur); render(); });
    window.addEventListener('hashchange', () => { const k = valid(location.hash.slice(1)); if (k && k !== cur) { cur = k; curTab = 'overview'; render(); } });
    const updatesOf = (k) => POSTS.filter((p) => p.build === k);
    const partsOf = (k) => buildParts(BUILDS[k]);
    const stats = (k) => { const b = BUILDS[k], n = partsOf(k).length; return `${b.updates} ${b.updates === 1 ? 'update' : 'updates'} · ${b.followers} followers · ${n ? `${n} ${n === 1 ? 'part' : 'parts'} for sale` : 'nothing for sale'}`; };
    const acts = (k) => `<div class="carhero__acts"><a class="btn btn--sun" href="home.html?car=${k}#compose">Post an update</a><button class="btn btn--quiet" type="button" data-editcar="${k}">Edit the car</button><a class="arrow" href="profile.html?tab=garage"><span>See the public page</span></a></div>`;
    function render() {
      $$('[data-car]', sw).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.car === cur)));
      if (cur === 'all') {
        view.innerHTML = `<div class="cars">${MINE.map((k, i) => { const b = BUILDS[k]; return `<article class="carcard ${i ? 'carcard--b' : 'carcard--a'}" data-reveal><figure class="photo ratio-32"><img src="${b.img}" alt="${esc(b.alt)}"></figure><div class="carcard__text"><p class="label">${esc(b.model)}</p><h2 class="h3">${esc(b.nick)}</h2><p class="carcard__meta">${stats(k)}</p><div class="carcard__actions"><button class="btn btn--quiet btn--sm" type="button" data-open-car="${k}">Open ${esc(b.nick)}</button></div></div></article>`; }).join('')}</div>`;
        observeReveals(view); return;
      }
      const b = BUILDS[cur], ups = updatesOf(cur), parts = partsOf(cur), mods = MODS[cur], media = MEDIA[cur];
      view.innerHTML = `
        <article class="carhero">
          <div class="carhero__img photo"><img src="${b.img}" alt="${esc(b.alt)}"></div>
          <div class="carhero__text" data-reveal><p class="label">${esc(b.model)}</p><h2 class="carhero__name" id="carName">${esc(b.nick)}</h2><p class="carhero__stats">${stats(cur)}</p>${acts(cur)}</div>
        </article>
        <div class="tabs" role="tablist" aria-label="${esc(b.nick)}" id="gtabs">
          <button class="tab" role="tab" id="t-overview" data-tab="overview" aria-controls="p-overview" type="button">Overview</button>
          <button class="tab" role="tab" id="t-mods" data-tab="mods" aria-controls="p-mods" type="button">Mods<sup>${mods.length}</sup></button>
          <button class="tab" role="tab" id="t-parts" data-tab="parts" aria-controls="p-parts" type="button">Parts<sup>${parts.length}</sup></button>
          <button class="tab" role="tab" id="t-media" data-tab="media" aria-controls="p-media" type="button">Media<sup>${media.length}</sup></button>
        </div>
        <section class="panel" role="tabpanel" id="p-overview" aria-labelledby="t-overview">
          <div class="gover">
            <div>
              <h3 class="label gover__h">Recent updates <button class="linkbtn link" type="button" data-soon="All updates live on the public profile’s Updates tab."> </button></h3>
              <ul class="rows">${ups.map((p) => `<li><a class="rowlink" href="home.html"><span class="photo"><img src="${p.img}" alt=""></span><span><strong>${esc(p.title)}</strong><span>${esc(p.when)}</span></span></a></li>`).join('')}</ul>
              <h3 class="label gover__h">Parts for sale ${parts.length ? '<button class="linkbtn link" type="button" data-gotab="parts">View all</button>' : ''}</h3>
              ${parts.length ? `<ul class="rows">${parts.map((l) => `<li><a class="rowlink" href="${href(l)}"><span class="photo">${l.img ? `<img src="${l.img}" alt="">` : `<b>${esc((l.short || l.title).split(' ')[0])}</b>`}</span><span><strong>${esc(l.title)}</strong><span>${esc(l.cond)} · ${shipLine(l)}</span></span><span class="price">${money(l.price)}</span></a></li>`).join('')}</ul>` : `<p class="gover__empty">Nothing listed off ${esc(b.nick)}. <a class="link" href="#" data-soon="Listing a part isn't part of this mockup.">List a part</a></p>`}
            </div>
            <div>
              <h3 class="label gover__h">Current mods · ${mods.length} <button class="linkbtn link" type="button" data-gotab="mods">View all</button></h3>
              <ul class="modlist">${mods.map(([m, c2]) => `<li><b>${esc(m)}</b><span>${esc(c2)}</span></li>`).join('')}</ul>
              <h3 class="label gover__h">Photos <button class="linkbtn link" type="button" data-gotab="media">View all</button></h3>
              <div class="gphotos">${media.slice(0, 2).map(([src, cap], i) => `<button class="gphoto photo" type="button" data-photo="${i}"><img src="${src}" alt="${esc(cap)}"><span>${esc(cap)}</span></button>`).join('')}</div>
              <p class="gover__public">This is what buyers see when a part says “Off my ${esc(b.model)}”. <a class="link" href="profile.html">View your public profile</a></p>
            </div>
          </div>
        </section>
        <section class="panel" role="tabpanel" id="p-mods" aria-labelledby="t-mods" hidden>
          <div class="modgroups">${[...new Set(mods.map((m) => m[1]))].map((c2) => `<div><h3 class="label">${esc(c2)}</h3><ul class="modlist">${mods.filter((m) => m[1] === c2).map(([m]) => `<li><b>${esc(m)}</b></li>`).join('')}</ul></div>`).join('')}</div>
        </section>
        <section class="panel" role="tabpanel" id="p-parts" aria-labelledby="t-parts" hidden>
          ${parts.length ? `<div class="grid grid--3" id="gParts"></div>` : `<div class="empty empty--left"><p class="h3">Nothing listed off <em>${esc(b.nick)}.</em></p><p>When a part comes off, list it here and it carries the car with it.</p><a class="btn btn--quiet" href="#" data-soon="Listing a part isn't part of this mockup.">List a part</a></div>`}
        </section>
        <section class="panel" role="tabpanel" id="p-media" aria-labelledby="t-media" hidden>
          <div class="gphotos gphotos--3">${media.map(([src, cap], i) => `<button class="gphoto photo" type="button" data-photo="${i}"><img src="${src}" alt="${esc(cap)}"><span>${esc(cap)}</span></button>`).join('')}</div>
        </section>`;
      $$('.gover__h button:empty', view).forEach((x) => x.remove());
      if ($('#gParts')) renderCards($('#gParts'), parts);
      const t = wireTabs($('#gtabs'), (k) => { curTab = k; });
      t.select(curTab);
      observeReveals(view);
      view.onclick = (e) => {
        const g = e.target.closest('[data-gotab]'); if (g) { t.select(g.dataset.gotab, true); }
        const ph = e.target.closest('[data-photo]'); if (ph) { const [src, cap] = media[Number(ph.dataset.photo)]; $('#lbImg').src = src; $('#lbImg').alt = cap; $('#lbCap').textContent = `${b.nick} · ${cap}`; Dlg.open($('#lightbox'), ph); }
      };
    }
    view.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open-car]'); if (o) { cur = o.dataset.openCar; history.replaceState(null, '', '#' + cur); render(); $(`[data-car="${cur}"]`, sw).focus(); }
      const ed = e.target.closest('[data-editcar]'); if (ed) { const b = BUILDS[ed.dataset.editcar]; $('#ecNick').value = b.nick; $('#ecModel').value = b.model; $('#editCar').dataset.car = ed.dataset.editcar; Dlg.open($('#editCar'), ed); }
    });
    $('#editCarForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const k = $('#editCar').dataset.car, nick = $('#ecNick').value.trim();
      if (!nick) { $('#ecErr').hidden = false; $('#ecNick').setAttribute('aria-invalid', 'true'); $('#ecNick').focus(); return; }
      $('#ecErr').hidden = true; $('#ecNick').removeAttribute('aria-invalid');
      BUILDS[k].nick = nick; Dlg.close($('#editCar'));
      const btn = $(`[data-car="${k}"]`, sw); btn.lastChild.textContent = nick;
      render(); toast(`${nick} saved.`);
    });
    render();
  }

  /* ───────── public profile ───────── */
  function initProfile() {
    const tl = $('#ptabs'); if (!tl) return;
    const mine = LISTINGS.filter((l) => l.seller === 'marisol'), ups = POSTS.filter((p) => p.owner === 'marisol');
    $('#pOverGarage').innerHTML = ['nimbus', 'lucille'].map((id) => { const b = BUILDS[id]; return `<li><a class="rowlink" href="garage.html#${id}"><span class="photo"><img src="${b.img}" alt=""></span><span><strong>${esc(b.nick)}</strong><span>${esc(b.model)} · ${b.updates} ${b.updates === 1 ? 'update' : 'updates'}</span></span></a></li>`; }).join('');
    $('#pOverParts').innerHTML = mine.map((l) => `<li><a class="rowlink" href="${href(l)}"><span class="photo">${l.img ? `<img src="${l.img}" alt="">` : `<b>${esc((l.short || l.title).split(' ')[0])}</b>`}</span><span><strong>${esc(l.title)}</strong><span>${esc(l.cond)} · ${shipLine(l)}</span></span><span class="price">${money(l.price)}</span></a></li>`).join('');
    $('#pLatest').innerHTML = ups.slice(0, 2).map((p, i) => postHTML(p, i)).join('');
    $('#pGarage').innerHTML = ['nimbus', 'lucille'].map((id, i) => buildHTML(BUILDS[id], i)).join('');
    $('#pUpdates').innerHTML = ups.map((p, i) => postHTML(p, i)).join('');
    renderCards($('#pParts'), mine, { vehicle: getVehicle() });
    wireCompare(); syncCards();
    const t = wireTabs(tl);
    const start = new URLSearchParams(location.search).get('tab');
    t.select(['overview', 'garage', 'updates', 'parts', 'reviews'].includes(start) ? start : 'overview');
    $('#pStore').addEventListener('click', () => { t.select('parts', true); tl.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); });
    $('#pShare').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href.split('?')[0]); toast('Profile link copied.'); } catch (e) { toast('Copy this link: drvn.app/u/apexmarisol'); } });
    const fb = $('#pFollow'), fn = $('#pFollowers');
    const syncF = () => { const on = follows.has('marisol'); fb.setAttribute('aria-pressed', String(on)); fb.textContent = on ? 'Following' : 'Follow'; fn.textContent = `${1 + (on ? 1 : 0)} ${on ? 'followers' : 'follower'}`; };
    syncF(); document.addEventListener('nmb:follow', syncF);
    if (isIn()) { fb.hidden = true; $('#pEdit').hidden = false; }
  }

  /* ───────── settings: eight sections, nothing sticks until Save ───────── */
  function initSettings() {
    const form = $('#settingsForm'); if (!form) return;
    const bar = $('#savebar');
    const snapshot = () => JSON.stringify($$('input, select, textarea', form).filter((x) => x.name).map((x) => [x.name, x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value]));
    let base = snapshot();
    const dirty = () => { const d = snapshot() !== base; bar.hidden = !d; bar.classList.toggle('is-on', d); };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    $('#sDiscard').addEventListener('click', () => { form.reset(); syncDeps(); dirty(); toast('Changes discarded.'); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pct = $('#sLowest');
      if (pct.value && (Number(pct.value) < 10 || Number(pct.value) > 100)) { $('#sLowestErr').hidden = false; pct.setAttribute('aria-invalid', 'true'); pct.focus(); return; }
      $('#sLowestErr').hidden = true; pct.removeAttribute('aria-invalid');
      $$('input, select, textarea', form).forEach((x) => { if (x.type === 'checkbox' || x.type === 'radio') x.defaultChecked = x.checked; else if (x.tagName === 'SELECT') [...x.options].forEach((o) => { o.defaultSelected = o.selected; }); else x.defaultValue = x.value; });
      base = snapshot(); dirty(); toast(`Settings saved at ${nowLabel()}.`);
    });
    // section nav: highlight the section in view
    const links = $$('.snav a');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((en) => en.forEach((x) => { if (x.isIntersecting) links.forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + x.target.id)); }), { rootMargin: '-30% 0px -60% 0px' });
      $$('.sset').forEach((s) => io.observe(s));
    }
    // password show / hide and change-password checks
    $$('[data-reveal-pw]').forEach((b) => b.addEventListener('click', () => { const i = document.getElementById(b.dataset.revealPw); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show)); b.textContent = show ? 'Hide' : 'Show'; }));
    $('#pwBtn').addEventListener('click', () => {
      const cur = $('#pwCur'), nw = $('#pwNew'), cf = $('#pwConf'), out = $('#pwMsg');
      const m = !cur.value ? [cur, 'Enter your current password.'] : nw.value.length < 10 ? [nw, 'Use at least 10 characters.'] : nw.value !== cf.value ? [cf, 'The new passwords don’t match.'] : null;
      [cur, nw, cf].forEach((x) => x.removeAttribute('aria-invalid'));
      if (m) { m[0].setAttribute('aria-invalid', 'true'); out.textContent = m[1]; out.dataset.state = 'error'; m[0].focus(); return; }
      out.dataset.state = 'ok'; out.textContent = 'Password changed. Other devices have been signed out.'; [cur, nw, cf].forEach((x) => { x.value = ''; x.defaultValue = ''; }); base = snapshot(); dirty();
    });
    $('#emailBtn').addEventListener('click', () => {
      const em = $('#sEmail'), out = $('#emailMsg');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em.value)) { em.setAttribute('aria-invalid', 'true'); out.dataset.state = 'error'; out.textContent = 'Enter an email address like name@example.com.'; em.focus(); return; }
      em.removeAttribute('aria-invalid'); out.dataset.state = 'ok'; out.textContent = `We’ve sent a confirmation to ${em.value}. Nothing changes until you click the link.`;
    });
    // profile photo
    $('#sPhoto').addEventListener('change', (e) => { const f = e.target.files[0]; if (f && /^image\//.test(f.type)) { $('#sPhotoPrev').src = URL.createObjectURL(f); toast('New photo ready. Save to keep it.'); } });
    // dependent controls
    const syncDeps = () => {
      $('#sStoreName').closest('.field').hidden = !$('#sBusiness').checked;
      $('#sBackOnWrap').hidden = !$('#sVacation').checked;
    };
    ['#sBusiness', '#sVacation'].forEach((s) => $(s).addEventListener('change', syncDeps)); syncDeps();
    // payment card remove/add
    $('#cardRemove').addEventListener('click', () => { $('#cardRow').hidden = true; $('#cardNone').hidden = false; toast('Card removed.'); });
    $('#cardAdd').addEventListener('click', () => toast('Adding a card opens Stripe’s secure form, which isn’t part of this mockup.'));
    $('#ledger').addEventListener('click', () => toast('The payouts ledger isn’t part of this mockup.'));
    // danger zone
    $('#exportBtn').addEventListener('click', () => { $('#exportMsg').hidden = false; $('#exportBtn').disabled = true; toast('Export ready. The link works for 7 days.'); });
    $('#delOpen').addEventListener('click', () => { $('#delFlow').hidden = false; $('#delOpen').hidden = true; $('#delName').focus(); });
    $('#delCancel').addEventListener('click', () => { $('#delFlow').hidden = true; $('#delOpen').hidden = false; $('#delName').value = ''; $('#delAck').checked = false; syncDel(); $('#delOpen').focus(); });
    const syncDel = () => { $('#delGo').disabled = !($('#delName').value.trim() === 'apexmarisol' && $('#delAck').checked); };
    ['input', 'change'].forEach((ev) => { $('#delName').addEventListener(ev, syncDel); $('#delAck').addEventListener(ev, syncDel); });
    $('#delGo').addEventListener('click', () => { $('#delFlow').hidden = true; $('#delDone').hidden = false; $('#delUndo').focus(); });
    $('#delUndo').addEventListener('click', () => { $('#delDone').hidden = true; $('#delOpen').hidden = false; $('#delName').value = ''; $('#delAck').checked = false; syncDel(); toast('Deletion cancelled. Your account stays.'); $('#delOpen').focus(); });
    syncDel();
    // the inputs inside the danger zone aren't part of "unsaved changes"
    base = snapshot();
  }

  /* ═══════════ hero: the night film under First Light's fog shader (from First Light, fixed at night) ═══════════ */
  const reducedB = reduced();
  const isDark = () => true;
  const themeHooks = [];
  function hexToRgb(h) {
    h = (h || '').trim().replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  var easeOutQuint = function (x) { return 1 - Math.pow(1 - x, 5); };

  function loopFilm(videos) {
    var FADE = 1.4, a = videos[0], b = videos[1], cur = a, nxt = b, swapping = false;
    var start = function (v) { var p = v.play(); if (p && p.catch) p.catch(function () { /* autoplay refused: poster remains */ }); };
    var check = function () {
      if (swapping || !cur.duration || cur.currentTime < cur.duration - FADE) return;
      swapping = true;
      nxt.currentTime = 0; start(nxt);
      nxt.classList.add('is-on'); cur.classList.remove('is-on');
      var old = cur; cur = nxt; nxt = old;
      setTimeout(function () { old.pause(); swapping = false; }, FADE * 1000 + 80);
    };
    videos.forEach(function (v) { v.addEventListener('timeupdate', check); v.addEventListener('ended', check); v.muted = true; });
    a.addEventListener('playing', function () { a.classList.add('is-on'); }, { once: true });
    return {
      pause: function () { cur.pause(); },
      play: function () { start(cur); }
    };
  }

  function initHero() {
    var hero = $('[data-hero]');
    if (!hero) return;
    var words = $$('[data-emerge]', hero);
    var setEmerge = function (p) {
      words.forEach(function (w, i) {
        var e = clamp((p * 1.35 - i * .1) / .55, 0, 1);
        e = 1 - Math.pow(1 - e, 3);
        if (e >= 1) w.style.removeProperty('--e'); else w.style.setProperty('--e', e.toFixed(3));
      });
    };
    var burn = 0;
    var readBurn = function () { burn = clamp(window.scrollY / (hero.offsetHeight * .9), 0, 1); hero.style.setProperty('--burn', burn.toFixed(3)); };
    readBurn();
    window.addEventListener('scroll', readBurn, { passive: true });

    var visible = true;
    // Two films: dawn and night (Pass 3). Only the one for the current theme plays; the sets crossfade in CSS.
    var films = { dawn: null, night: null }, film = null;
    var dawnVids = $$('[data-video]', hero), nightVids = $$('[data-video-night]', hero);
    if (!reducedB && dawnVids.length === 2) films.dawn = loopFilm(dawnVids);
    if (!reducedB && nightVids.length === 2) films.night = loopFilm(nightVids);
    var pickFilm = function (dark) {
      var next = dark ? films.night : films.dawn;
      if (film && film !== next) film.pause();
      film = next;
      if (film && visible && !document.hidden) film.play();
    };
    pickFilm(isDark());
    var night = isDark() ? 1 : 0, nightTarget = night;
    var canvas = $('[data-fog]', hero);
    var fog = null;
    var gl = null;
    try { gl = canvas && canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
    if (gl) fog = createFog(gl, canvas, hero);
    if (!fog) root.classList.add('no-gl');

    // The headline condenses out of the fog as the density falls.
    var t0 = performance.now(), introDone = reducedB;
    if (reducedB) setEmerge(1); else setEmerge(0);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        if (film) { if (visible && !document.hidden) film.play(); else film.pause(); }
        if (visible) kick();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener('visibilitychange', function () {
      if (film) { if (document.hidden) film.pause(); else if (visible) film.play(); }
      if (!document.hidden) kick();
    });

    var raf = 0;
    function frame(now) {
      raf = 0;
      var time = (now - t0) / 1000;
      var ip = clamp(time / 3.8, 0, 1), intro = easeOutQuint(ip);
      if (!introDone) { setEmerge(intro); if (ip >= 1) introDone = true; }
      night += (nightTarget - night) * .045;
      if (Math.abs(nightTarget - night) < .002) night = nightTarget;
      if (fog) {
        var density = (1.38 - .38 * intro) * (1 - .8 * burn) * (1 - .12 * night);
        fog.render(time, density, burn, night);
      }
      if ((fog || !introDone) && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !reducedB) raf = requestAnimationFrame(frame); }
    themeHooks.push(function (dark) {
      nightTarget = dark ? 1 : 0;
      pickFilm(dark);
      if (reducedB) { night = nightTarget; if (fog) fog.render(14, 1, 0, night); } else kick();
    });
    if (reducedB) { if (fog) fog.render(14, 1, 0, night); window.addEventListener('resize', function () { if (fog) { fog.resize(); fog.render(14, 1, 0, night); } }); }
    else kick();
  }

  /* The fog: three passes on raw WebGL.
     1. density  — domain-warped fbm drifting right→left, at quarter resolution
     2. breath   — a ping-pong trail where the pointer has been; decays like a cleared patch on cold glass
     3. light    — composites over the film: silver-lined edges, forward scattering and shafts toward the sun on the ridge */
  function createFog(gl, canvas, hero) {
    var VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
    var HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 v;\n' +
      'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}' +
      'float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1.,0.)),u.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),u.x),u.y);}' +
      'float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vn(p);p=m*p;a*=.5;}return s;}\n';
    var DENS = HEAD +
      'uniform float uT,uD,uAsp;' +
      'void main(){' +
      ' vec2 p=vec2(v.x*uAsp*.62,v.y*1.75)*1.7;' +
      ' float t=uT*.032;' +
      ' vec2 dr=vec2(t,0.);' +
      ' vec2 q=vec2(fbm(p+dr+vec2(0.,t*.2)),fbm(p+dr*.8+vec2(5.2,1.3)));' +
      ' vec2 r=vec2(fbm(p+vec2(1.9,.7)*q+vec2(1.7,9.2)+dr*1.2),fbm(p+vec2(1.9,.7)*q+vec2(8.3,2.8)+dr));' +
      ' float far=fbm(p*1.3+vec2(1.6,.5)*r+dr*.7);' +
      ' float near=fbm(vec2(p.x*.38,p.y*.55)+vec2(t*1.5,0.)+q*.35);' +
      ' float d=mix(far,near,.48);' +
      ' float band=exp(-pow((v.y-.3)/.24,2.));' +
      ' float prof=.5+.66*band+.2*smoothstep(.72,1.,v.y);' +
      ' float lo=.68-.3*uD, hi=.94-.24*uD;' +
      ' float c=smoothstep(lo,hi,d*prof+.04*r.y);' +
      ' gl_FragColor=vec4(c,d,0.,1.);' +
      '}';
    var TRAIL = HEAD +
      'uniform sampler2D uPrev;uniform vec2 uPt,uTx;uniform float uS,uAsp;' +
      'void main(){' +
      ' vec2 a=v+vec2(uTx.x*.6,0.);' +
      ' float c=texture2D(uPrev,a).r*.6+(texture2D(uPrev,a+vec2(uTx.x,0.)).r+texture2D(uPrev,a-vec2(uTx.x,0.)).r+texture2D(uPrev,a+vec2(0.,uTx.y)).r+texture2D(uPrev,a-vec2(0.,uTx.y)).r)*.1;' +
      ' c=max(c*.986-.0026,0.);' +
      ' vec2 d=v-uPt;d.x*=uAsp;' +
      ' c=min(c+exp(-dot(d,d)/.0042)*uS,1.);' +
      ' gl_FragColor=vec4(c,0.,0.,1.);' +
      '}';
    var COMP = HEAD +
      'uniform sampler2D uDen,uTr;uniform vec2 uSun,uMoon,uL1,uL2,uRidge,uRes;uniform float uAsp,uD,uT,uB,uN,uStars;uniform vec3 uDeep,uPale,uLit,uCore,uBeam,uStar,uGlow;' +
      // night: a headlamp beam pushed through the fog, along the road to the right
      'float beam(vec2 l){vec2 q=v-l;q.x*=uAsp;vec2 bd=normalize(vec2(1.,-.1));float al=dot(q,bd);float pr=length(q-bd*max(al,0.));float w=.014+max(al,0.)*.21;' +
      ' return exp(-pr*pr/(w*w))*smoothstep(-.01,.02,al)*exp(-max(al,0.)*2.4)+exp(-length(q)*55.)*.7;}' +
      'void main(){' +
      ' vec2 e=vec2(1./160.,1./100.);' +
      ' float tr=texture2D(uTr,v).r;' +
      ' vec2 g=vec2(texture2D(uTr,v+vec2(e.x,0.)).r-texture2D(uTr,v-vec2(e.x,0.)).r,texture2D(uTr,v+vec2(0.,e.y)).r-texture2D(uTr,v-vec2(0.,e.y)).r);' +
      ' vec2 su=v-g*.05;' +
      ' float wisp=vn(vec2(su.x*uAsp,su.y)*22.+vec2(uT*.35,0.))-.5;' +
      ' float den=clamp(texture2D(uDen,su).r+wisp*.08,0.,1.);' +
      ' float k=abs(uN*2.-1.);vec2 lp=uN<.5?uSun:uMoon;' +
      ' vec2 ts=lp-v;vec2 tsa=ts;tsa.x*=uAsp;float dist=length(tsa);' +
      ' vec2 dir=ts/max(length(ts),1e-4);' +
      ' float toward=texture2D(uDen,su+dir*.035).r;' +
      ' float lit=clamp(.5+(den-toward)*2.6,0.,1.);' +
      ' float occ=0.;float j=h21(gl_FragCoord.xy+fract(uT));' +
      ' for(int i=0;i<12;i++){float s=(float(i)+j)/12.;occ+=texture2D(uDen,v+ts*s*.92).r;}' +
      ' occ/=12.;' +
      ' float glow=exp(-dist*mix(2.9,4.2,uN))*k;float halo=exp(-dist*mix(11.,30.,uN))*k;' +
      ' float shafts=pow(1.-occ,1.6)*exp(-dist*1.5)*(1.-.55*uN)*k;' +
      ' vec3 col=mix(uDeep,uPale,lit*.75+glow*.35);' +
      ' col=mix(col,uLit,clamp(glow*1.15+shafts*.35,0.,1.)*(.55+.45*den)*(1.-.35*uN));' +
      ' float clear=1.-smoothstep(.04,.55,tr)*.94;' +
      ' float a=den*min(uD,1.)*.86*clear;' +
      ' float rays=shafts*(.24+.2*uB)*clear;' +
      ' vec3 pm=col*a+uLit*rays*.55+uCore*halo*(.5+.3*uB)*(1.-.4*uN);' +
      ' float oa=clamp(a+rays*.32+halo*.18,0.,1.);' +
      ' float bm=(beam(uL1)+beam(uL2))*uN;' +
      ' pm+=uBeam*bm*(.12+.7*den)*clear;oa=clamp(oa+bm*.08*den,0.,1.);' +
      ' vec2 sg=vec2(v.x*uAsp,v.y)*130.;vec2 cl=floor(sg);float hs=h21(cl);vec2 of=vec2(h21(cl+7.1),h21(cl+3.3))-.5;float sd=length(fract(sg)-.5-of*.6);' +
      ' float st=step(.992,hs)*smoothstep(.16,0.,sd)*(.55+.45*sin(uT*1.3+hs*60.))*smoothstep(.45,.9,v.y)*(1.-den)*uStars;' +
      ' pm+=uStar*st;oa=clamp(oa+st*.5,0.,1.);' +
      ' vec2 rq=v-uRidge;rq.x*=uAsp*.55;float rg=exp(-length(rq)*5.)*uN*(.18+.82*uB);' +
      ' pm+=uGlow*rg*(.1+.18*den);oa=clamp(oa+rg*.04,0.,1.);' +
      ' pm+=(h21(gl_FragCoord.xy+uT)-.5)/255.*2.;' +
      ' gl_FragColor=vec4(max(pm,0.),oa);' +
      '}';

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn('fog shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    function prog(fs) {
      var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, fs);
      if (!v || !f) return null;
      var p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p: p, u: u };
    }
    var P = { dens: prog(DENS), trail: prog(TRAIL), comp: prog(COMP) };
    if (!P.dens || !P.trail || !P.comp) return null;

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);

    function target(w, h) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex: tex, fb: fb, w: w, h: h };
    }
    function drop(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

    var cs = getComputedStyle(document.documentElement);
    var tok = function (n) { return hexToRgb(cs.getPropertyValue(n)); };
    var C = { deep: tok('--fog-deep'), pale: tok('--fog-pale'), lit: tok('--fog-lit'), core: tok('--fog-core'), deepW: tok('--fog-deep-warm'), paleW: tok('--fog-pale-warm'),
      nDeep: tok('--fog-night-deep'), nPale: tok('--fog-night-pale'), nPre: tok('--fog-night-predawn'), moon: tok('--moon'), moonCore: tok('--moon-core'), beam: tok('--beam'), star: tok('--star'), glow: tok('--apricot') };

    var W = 0, H = 0, asp = 1, dens = null, trA = null, trB = null, sun = [.7, .87], moon = [.23, .92], l1 = [.32, .24], l2 = [.39, .24], ridge = [.85, .81];
    var TW = 160, TH = 100;
    function resize() {
      var r = hero.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var scale = dpr * (r.width > 1600 ? .6 : .75);
      var cap = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
      W = clamp(Math.round(r.width * scale), 2, cap); H = clamp(Math.round(r.height * scale), 2, cap);
      canvas.width = W; canvas.height = H; asp = r.width / Math.max(1, r.height);
      drop(dens); drop(trA); drop(trB);
      dens = target(Math.max(2, Math.round(W / 4)), Math.max(2, Math.round(H / 4)));
      TH = Math.max(40, Math.round(TW / asp));
      trA = target(TW, TH); trB = target(TW, TH);
      // map the sun on the ridge (film coords .70, .13) through object-fit: cover
      var vid = hero.querySelector('.hero__poster');
      var posX = .5;
      if (vid) { var op = getComputedStyle(vid).objectPosition.split(' ')[0]; if (op && op.indexOf('%') > -1) posX = parseFloat(op) / 100; }
      var vw = 1912, vh = 1080, s = Math.max(r.width / vw, r.height / vh);
      var dw = vw * s, dh = vh * s, ox = (r.width - dw) * posX, oy = (r.height - dh) * .5;
      var at = function (fx, fy) { return [(ox + fx * dw) / r.width, 1 - (oy + fy * dh) / r.height]; };
      // film coordinates: sun on the ridge (dawn); moon, headlamps and the pre-dawn glow (night still)
      sun = at(.70, .13); moon = at(.23, .075); l1 = at(.324, .762); l2 = at(.3925, .759); ridge = at(.85, .19);
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(function () { resize(); }).observe(hero);
    else window.addEventListener('resize', resize);

    // pointer → breath trail
    var pt = [-1, -1], last = null, speed = 0, inside = false;
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = 1 - (e.clientY - r.top) / r.height;
      if (last) speed = Math.min(1, speed + Math.hypot((x - last[0]) * asp, y - last[1]) * 9);
      last = [x, y]; pt = [x, y]; inside = true;
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { inside = false; last = null; });

    var lost = false;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; root.classList.add('no-gl'); });

    function render(time, density, burn, night) {
      night = night || 0;
      if (lost) return;
      // pass 1: density
      gl.bindFramebuffer(gl.FRAMEBUFFER, dens.fb); gl.viewport(0, 0, dens.w, dens.h);
      gl.useProgram(P.dens.p);
      gl.uniform1f(P.dens.u.uT, time); gl.uniform1f(P.dens.u.uD, density); gl.uniform1f(P.dens.u.uAsp, asp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // pass 2: breath trail
      var strength = inside ? .035 + speed * .5 : 0;
      speed *= .82;
      gl.bindFramebuffer(gl.FRAMEBUFFER, trB.fb); gl.viewport(0, 0, TW, TH);
      gl.useProgram(P.trail.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trA.tex);
      gl.uniform1i(P.trail.u.uPrev, 0);
      gl.uniform2f(P.trail.u.uPt, pt[0], pt[1]); gl.uniform2f(P.trail.u.uTx, 1 / TW, 1 / TH);
      gl.uniform1f(P.trail.u.uS, strength); gl.uniform1f(P.trail.u.uAsp, asp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var tmp = trA; trA = trB; trB = tmp;
      // pass 3: light + composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(P.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dens.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, trA.tex);
      var u = P.comp.u;
      gl.uniform1i(u.uDen, 0); gl.uniform1i(u.uTr, 1);
      gl.uniform2f(u.uSun, sun[0], sun[1]); gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uD, density); gl.uniform1f(u.uT, time); gl.uniform1f(u.uB, burn);
      var w = clamp(burn * 1.2, 0, 1);
      var nDeep = mixRgb(C.nDeep, C.nPale, burn * .25), nPale = mixRgb(C.nPale, C.nPre, burn);
      gl.uniform3fv(u.uDeep, mixRgb(mixRgb(C.deep, C.deepW, w), nDeep, night));
      gl.uniform3fv(u.uPale, mixRgb(mixRgb(C.pale, C.paleW, w), nPale, night));
      gl.uniform3fv(u.uLit, mixRgb(C.lit, C.moon, night)); gl.uniform3fv(u.uCore, mixRgb(C.core, C.moonCore, night));
      gl.uniform3fv(u.uBeam, C.beam); gl.uniform3fv(u.uStar, C.star); gl.uniform3fv(u.uGlow, C.glow);
      gl.uniform2f(u.uMoon, moon[0], moon[1]); gl.uniform2f(u.uL1, l1[0], l1[1]); gl.uniform2f(u.uL2, l2[0], l2[1]); gl.uniform2f(u.uRidge, ridge[0], ridge[1]);
      gl.uniform1f(u.uN, night); gl.uniform1f(u.uStars, night * (1 - burn));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return { render: render, resize: resize };
  }


  /* ───────── boot ───────── */
  function boot() {
    initAuth(); initTime(); initNav(); initShared();
    initLanding(); initExplore(); initMarket(); initListing(); initHome(); initGarage(); initProfile(); initSettings();
    initHero(); observeReveals(); syncCards(); stampTimes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
