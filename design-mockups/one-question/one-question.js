/* DRVN — Concept 19 · One Question
   Shared data, answer state, matcher, nav, cart/checkout sheet and page controllers.
   The particle renderer lives in one-question-particles.js (ES module, three.js). */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ data */

  const ORDER = ['rx7', 'e46', 'ek9', '964'];

  const PLATFORMS = {
    rx7: { key: 'rx7', make: 'Mazda', model: 'RX-7', gen: 'FD3S', years: '1992–2002', short: 'RX-7', a: 'an', plural: 'RX-7s', engine: '13B-REW twin-rotor', bolt: '5×114.3',
      nod: 'Twin rotors, sequential turbos, apex seals and all. Brave. We like it.' },
    e46: { key: 'e46', make: 'BMW', model: 'M3', gen: 'E46', years: '2000–2006', short: 'E46 M3', a: 'an', plural: 'E46 M3s', engine: 'S54 straight-six', bolt: '5×120',
      nod: 'The S54, 8,000 rpm and a straight face. Good answer.' },
    ek9: { key: 'ek9', make: 'Honda', model: 'Civic Type R', gen: 'EK9', years: '1997–2000', short: 'EK9', a: 'an', plural: 'EK9s', engine: 'B16B, 185 hp from 1.6 litres', bolt: '4×100',
      nod: '1.6 litres, 8,400 rpm, zero apologies.' },
    '964': { key: '964', make: 'Porsche', model: '911 Carrera', gen: '964', years: '1989–1994', short: '964', a: 'a', plural: '964s', engine: '3.6 air-cooled flat-six', bolt: '5×130',
      nod: 'Air-cooled. Of course it is.' }
  };

  const SELLERS = {
    's54sasha': { first: 'Sasha', city: 'Austin, TX', car: "'04 E46 M3", key: 'e46', sold: 41, ships: '2 days' },
    'lena.builds': { first: 'Lena', city: 'Chicago, IL', car: "'02 E46 M3", key: 'e46', sold: 17, ships: '1 day' },
    'fd_mika': { first: 'Mika', city: 'Oakland, CA', car: "'93 RX-7", key: 'rx7', sold: 63, ships: '2 days' },
    'nightrotor': { first: 'Theo', city: 'Phoenix, AZ', car: "'95 RX-7", key: 'rx7', sold: 28, ships: '3 days' },
    'ek_ryo': { first: 'Ryo', city: 'San Jose, CA', car: "'98 Civic Type R", key: 'ek9', sold: 52, ships: '1 day' },
    'b16.juno': { first: 'Juno', city: 'Honolulu, HI', car: "'99 Civic Type R", key: 'ek9', sold: 9, ships: '4 days' },
    'aircooled.dev': { first: 'Devon', city: 'Portland, OR', car: "'91 911 Carrera 2", key: '964', sold: 34, ships: '2 days' },
    'guards.red': { first: 'Marguerite', city: 'Santa Fe, NM', car: "'92 911 Carrera 2", key: '964', sold: 12, ships: '3 days' },
    'harness.june': { first: 'June', city: 'Denver, CO', car: "'01 330Ci track car", key: null, sold: 88, ships: '1 day' }
  };

  const no = (why) => ['no', why];
  const LISTINGS = [
    { id: 'bc-br-e46', title: 'BC Racing BR coilovers', for: 'e46', cat: 'Suspension', price: 890, ship: 52, cond: 'Used', img: 'c19-coilover.jpg', alt: 'Black coilover with red adjustment collars', seller: 's54sasha', days: 3,
      cameOff: { text: "Sasha's '04 E46 M3", why: 'Went to KW Clubsports for the track. These did 8,200 miles and were rebuilt by BC in March.' },
      fit: { e46: ['fits', 'Built for the E46 M3: front struts, rear shocks, springs and camber plates, all bolt-in.'], ek9: no('Valved and bracketed for the E46. There’s an EK9 kit listed, though.'), rx7: no('Wrong mounts and valving. An FD kit is listed too.'), '964': no('Different suspension design entirely: the 964 runs torsion bars at the rear.') },
      specs: [['Spring rates', '10k front / 8k rear'], ['Damping', '30-way, monotube'], ['Mileage', '8,200 mi, rebuilt Mar 2026'], ['Includes', 'Camber plates, spanners']] },
    { id: 'bc-br-ek9', title: 'BC Racing BR coilovers', for: 'ek9', cat: 'Suspension', price: 940, ship: 48, cond: 'Like new', img: 'c19-coilover.jpg', alt: 'Black coilover with red adjustment collars', seller: 'ek_ryo', days: 6,
      cameOff: { text: "Ryo's '98 Civic Type R", why: 'Bought for a build that went another way. 400 miles on them.' },
      fit: { ek9: ['fits', 'The EK-chassis kit: eye-type rear mounts, 8k/6k springs. Bolt-in.'], e46: no('Made for the EK chassis. Sasha has the E46 kit.'), rx7: no('Made for the EK chassis.'), '964': no('Made for the EK chassis.') },
      specs: [['Spring rates', '8k front / 6k rear'], ['Damping', '30-way, monotube'], ['Mileage', '400 mi'], ['Includes', 'Top mounts, spanners']] },
    { id: 'bc-br-fd', title: 'BC Racing BR coilovers', for: 'rx7', cat: 'Suspension', price: 980, ship: 55, cond: 'Used', img: 'c19-coilover.jpg', alt: 'Black coilover with red adjustment collars', seller: 'nightrotor', days: 9,
      cameOff: { text: "Theo's '95 RX-7", why: 'Swapped to Öhlins DFV. Freshly serviced, no leaks.' },
      fit: { rx7: ['fits', 'FD3S-specific: pillowball top mounts, 12k/10k springs.'], e46: no('Made for the FD3S. Sasha has the E46 kit.'), ek9: no('Made for the FD3S. Ryo has the EK9 kit.'), '964': no('Made for the FD3S.') },
      specs: [['Spring rates', '12k front / 10k rear'], ['Damping', '30-way, monotube'], ['Mileage', '11,000 mi, serviced'], ['Includes', 'Pillowball mounts']] },
    { id: 'forged-1895', title: 'Forged 18×9.5 +38, bronze, set of four', cat: 'Wheels', price: 2400, ship: 140, cond: 'Used', img: 'c19-wheel.jpg', alt: 'Bronze forged spoke wheel', seller: 'fd_mika', days: 2,
      cameOff: { text: "Mika's '93 RX-7", why: 'Going back to 17s for the street. One faint curb mark, front left, photos on request.' },
      fit: { rx7: ['fits', '5×114.3 at +38 sits flush on the FD with 255s. No spacers.'], ek9: ['adapter', 'Your EK9 is 4×100: you’ll need a 5×114.3 hub conversion, and probably rolled arches.'], e46: ['adapter', 'Your E46 is 5×120: needs 5×120→5×114.3 adapters and 72.6 mm hub rings.'], '964': no('The 964 is 5×130 with a different centre bore. No adapter we’d trust.') },
      specs: [['Size', '18×9.5 +38'], ['Bolt pattern', '5×114.3, 73.1 mm bore'], ['Weight', '8.6 kg each'], ['Condition', 'One faint curb mark']] },
    { id: 'bucket-frp', title: 'Fibreglass bucket seat, grey centre', cat: 'Interior', price: 650, ship: 95, cond: 'Like new', img: 'c19-seat.jpg', alt: 'Black fibreglass bucket seat with grey cloth centre', seller: 'aircooled.dev', days: 4,
      cameOff: { text: "Devon's '91 911 Carrera 2", why: 'Backdating the interior, so the bucket had to go. Never tracked.' },
      fit: { rx7: ['adapter', 'Universal seat: bolts in with FD3S side-mount rails (about $180).'], e46: ['adapter', 'Universal seat: bolts in with E46 side-mount rails (about $190).'], ek9: ['adapter', 'Universal seat: bolts in with EK side-mount rails (about $160).'], '964': ['adapter', 'Universal seat: Devon’s 964 rails are included. Lucky you.'] },
      anyCar: ['adapter', 'Universal seat: you’ll need side-mount rails for your car.'],
      specs: [['Shell', 'Fibreglass, FIA 2026'], ['Width', '520 mm at the hips'], ['Mounting', 'Side-mount'], ['Weight', '7.9 kg']] },
    { id: 'airbox-s54', title: 'Carbon airbox and polished intake, S54', for: 'e46', cat: 'Engine', price: 1150, ship: 60, cond: 'Used', img: 'c19-intake.jpg', alt: 'Carbon fibre airbox with polished intake pipe', seller: 'lena.builds', days: 1,
      cameOff: { text: "Lena's '02 E46 M3", why: 'Went to individual throttle bodies. This came off at 3,000 miles.' },
      fit: { e46: ['fits', 'Direct fit on the S54. Keeps the stock MAF, no tune needed.'], ek9: no('S54 only.'), rx7: no('S54 only.'), '964': no('S54 only.') },
      specs: [['Material', 'Pre-preg carbon'], ['Engine', 'S54 only'], ['Mileage', '3,000 mi'], ['Includes', 'Filter, clamps']] },
    { id: 'deepdish-350', title: '350 mm deep-dish suede wheel + quick release', cat: 'Interior', price: 420, ship: 28, cond: 'New', img: 'c19-steering.jpg', alt: 'Deep-dish suede steering wheel with quick release', seller: 'harness.june', days: 5,
      fit: { rx7: ['adapter', 'Needs an FD3S hub (boss kit, about $90). The quick release is universal.'], e46: ['adapter', 'Needs an E46 hub (about $95) and an airbag-delete resistor.'], ek9: ['adapter', 'Needs an EK hub (about $80). The quick release is universal.'], '964': ['adapter', 'Needs a 964 hub (about $110) and an airbag delete.'] },
      anyCar: ['adapter', 'Universal wheel: you’ll need the hub for your car.'],
      specs: [['Diameter', '350 mm, 90 mm dish'], ['Grip', 'Suede'], ['Quick release', 'Gen 2, 70 mm PCD'], ['Condition', 'New, boxed']] },
    { id: 'tails-fd', title: 'Smoked round tail lights, pair', for: 'rx7', cat: 'Lighting', price: 560, ship: 30, cond: 'Like new', img: 'c19-taillights.jpg', alt: 'Pair of smoked round tail lights', seller: 'nightrotor', days: 7,
      cameOff: { text: "Theo's '95 RX-7", why: 'Went back to OEM for a show. Plug-and-play, no bulb-out warnings.' },
      fit: { rx7: ['fits', 'Plug-and-play on the FD’s stock harness.'], e46: no('FD3S only.'), ek9: no('FD3S only.'), '964': no('FD3S only.') },
      specs: [['Type', 'LED, smoked lens'], ['Harness', 'Plug-and-play'], ['Includes', 'Both sides, gaskets'], ['Condition', 'No cracks or haze']] },
    { id: 'n1-exhaust', title: 'Titanium N1-style exhaust, 60 mm', typeName: 'Titanium exhaust, 60 mm', typeSub: 'Cat-back · B16B', for: 'ek9', cat: 'Engine', price: 1350, ship: 120, cond: 'Used', seller: 'ek_ryo', days: 8,
      cameOff: { text: "Ryo's '98 Civic Type R", why: 'Too loud for the new neighbours. Heat-blued tip, no dents.' },
      fit: { ek9: ['fits', 'Cat-back for the EK9. Uses the stock hangers.'], e46: no('EK chassis only.'), rx7: no('EK chassis only.'), '964': no('EK chassis only.') },
      specs: [['Piping', '60 mm titanium'], ['Type', 'Cat-back'], ['Weight', '5.1 kg'], ['Sound', 'Loud. Honestly.']] },
    { id: 'b16-manifold', title: 'Ported intake manifold, B16B', typeName: 'Ported intake manifold', typeSub: 'B16B · 70 mm plenum', for: 'ek9', cat: 'Engine', price: 520, ship: 45, cond: 'Used', seller: 'b16.juno', days: 12,
      fit: { ek9: ['fits', 'Bolts to the B16B. Reuse your gasket or grab a new one.'], e46: no('B-series only.'), rx7: no('B-series only.'), '964': no('B-series only.') },
      specs: [['Plenum', '70 mm, ported'], ['Engine', 'B16B / B-series'], ['Condition', 'Clean, no cracks']] },
    { id: 'efr-kit', title: 'Single-turbo kit, BorgWarner EFR 7670', typeName: 'Single-turbo kit', typeSub: 'EFR 7670 · 13B-REW', for: 'rx7', cat: 'Engine', price: 3800, ship: 160, cond: 'Used', seller: 'fd_mika', days: 10,
      cameOff: { text: "Mika's '93 RX-7", why: 'Going back to the sequential twins. Yes, really.' },
      fit: { rx7: ['fits', 'Bolts to the 13B-REW with the included manifold. Budget for a tune.'], e46: no('13B-REW only.'), ek9: no('13B-REW only.'), '964': no('13B-REW only.') },
      specs: [['Turbo', 'BorgWarner EFR 7670'], ['Manifold', 'Steam-pipe, included'], ['Last dyno', '410 whp on 18 psi']] },
    { id: 'fd-lip', title: 'FRP front lip, RX-7 FD', typeName: 'FRP front lip', typeSub: 'FD3S · ready to paint', for: 'rx7', cat: 'Exterior', price: 720, ship: 110, cond: 'Used', seller: 'nightrotor', days: 14,
      fit: { rx7: ['fits', 'For the late-model FD bumper. Ready for paint.'], e46: no('FD3S only.'), ek9: no('FD3S only.'), '964': no('FD3S only.') },
      specs: [['Material', 'Fibreglass'], ['Finish', 'Primed, ready to paint'], ['Fits', 'Late-model FD bumper']] },
    { id: 'csl-trunk', title: 'CSL-style carbon trunk lid', typeName: 'CSL-style carbon trunk', typeSub: 'E46 coupe', for: 'e46', cat: 'Exterior', price: 890, ship: 150, cond: 'Like new', seller: 's54sasha', days: 11,
      fit: { e46: ['fits', 'For the E46 coupe. Reuses your lock and third brake light.'], ek9: no('E46 coupe only.'), rx7: no('E46 coupe only.'), '964': no('E46 coupe only.') },
      specs: [['Material', 'Carbon, clear-coated'], ['Fits', 'E46 coupe'], ['Condition', 'Stored indoors']] },
    { id: 'cup1-17', title: 'Cup 1 17-inch wheels, set of four', typeName: 'Cup 1 wheels, 17-inch', typeSub: 'Set of four · 5×130', for: '964', cat: 'Wheels', price: 3200, ship: 140, cond: 'Used', seller: 'aircooled.dev', days: 3,
      cameOff: { text: "Devon's '91 911 Carrera 2", why: 'Going to Fuchs for the backdate. Refinished last year.' },
      fit: { '964': ['fits', 'Period-correct 5×130 with the right offsets for the 964.'], e46: no('5×130 only.'), ek9: no('5×130 only.'), rx7: no('5×130 only.') },
      specs: [['Size', '7J and 8J × 17'], ['Bolt pattern', '5×130'], ['Finish', 'Refinished 2025']] },
    { id: 'g50-shifter', title: 'Short shifter, G50 gearbox', typeName: 'G50 short shifter', typeSub: '964 Carrera 2', for: '964', cat: 'Drivetrain', price: 480, ship: 22, cond: 'New', seller: 'guards.red', days: 6,
      fit: { '964': ['fits', 'For the G50 manual in the Carrera 2. Tiptronic owners, look away.'], e46: no('G50 only.'), ek9: no('G50 only.'), rx7: no('G50 only.') },
      specs: [['Throw', '30% shorter'], ['Gearbox', 'G50 manual'], ['Condition', 'New, boxed']] },
    { id: 'whale-tail', title: 'Turbo-look whale tail, fibreglass', typeName: 'Whale tail, fibreglass', typeSub: '964 · with grille', for: '964', cat: 'Exterior', price: 1400, ship: 180, cond: 'Used', seller: 'guards.red', days: 15,
      fit: { '964': ['fits', 'Bolts to the 964 engine lid. Grille included.'], e46: no('964 only.'), ek9: no('964 only.'), rx7: no('964 only.') },
      specs: [['Material', 'Fibreglass'], ['Finish', 'Guards Red, minor chips'], ['Includes', 'Grille, hardware']] },
    { id: 'harness-6pt', title: '6-point harness, FIA 2026', typeName: '6-point harness', typeSub: 'FIA 2026 · 3-inch', cat: 'Interior', price: 310, ship: 18, cond: 'New', seller: 'harness.june', days: 2,
      universal: 'Universal. Mount it to a harness bar or cage, not the seat belt anchors.',
      specs: [['Belts', '3-inch lap and shoulder'], ['Rating', 'FIA, valid to 2031'], ['Condition', 'New, boxed']] },
    { id: 'lap-timer', title: 'GPS lap timer, 10 Hz', typeName: 'GPS lap timer', typeSub: '10 Hz · suction mount', cat: 'Electronics', price: 420, ship: 15, cond: 'Like new', seller: 'harness.june', days: 9,
      universal: 'Universal. Runs on GPS alone, or plugs into OBD-II where your car has it.',
      specs: [['Rate', '10 Hz GPS'], ['Power', '12 V or internal battery'], ['Includes', 'Mount, cable']] }
  ];

  const MEMBERS = [
    { h: 's54sasha', key: 'e46', car: "'04 E46 M3", paint: 'Interlagos Blue', line: 'KW Clubsports, 1,400 track miles this year, still on the original clutch.' },
    { h: 'lena.builds', key: 'e46', car: "'02 E46 M3", paint: 'Phoenix Yellow', line: 'Individual throttle bodies. Sounds like a superbike and drinks like one.' },
    { h: 'm3.otto', first: 'Otto', city: 'Seattle, WA', key: 'e46', car: "'05 E46 M3", paint: 'Silver Grey', line: 'CSL replica, one carbon panel at a time. Saving for the roof.' },
    { h: 'fd_mika', key: 'rx7', car: "'93 RX-7", paint: 'Vintage Red', line: 'Bridgeported and back on the sequential twins, because she likes a challenge.' },
    { h: 'nightrotor', key: 'rx7', car: "'95 RX-7", paint: 'Brilliant Black', line: 'Single turbo, 410 whp, one rebuild in, zero regrets.' },
    { h: 'rotary.ines', first: 'Inés', city: 'Miami, FL', key: 'rx7', car: "'94 RX-7", paint: 'Competition Yellow', line: 'Twelve years, one owner, two engines.' },
    { h: 'ek_ryo', key: 'ek9', car: "'98 Civic Type R", paint: 'Championship White', line: 'JDM import. Lives above 6,000 rpm on Sundays.' },
    { h: 'b16.juno', key: 'ek9', car: "'99 Civic Type R", paint: 'Milano Red', line: 'Hill climbs, stock block, no air con, no complaints.' },
    { h: 'typer.dex', first: 'Dex', city: 'Atlanta, GA', key: 'ek9', car: "'97 Civic Type R", paint: 'Vogue Silver', line: 'Taking it back to factory, one OEM part at a time.' },
    { h: 'aircooled.dev', key: '964', car: "'91 911 Carrera 2", paint: 'Slate Grey', line: 'Backdate in progress. The bucket seat left; the grin stayed.' },
    { h: 'guards.red', key: '964', car: "'92 911 Carrera 2", paint: 'Guards Red', line: 'Turbo-look rear, 200,000 miles, oil leaks by appointment.' },
    { h: 'rs.kofi', first: 'Kofi', city: 'Brooklyn, NY', key: '964', car: "'93 RS America", paint: 'Grand Prix White', line: 'Daily driven, which upsets people.' }
  ];

  /* ----------------------------------------------------------- utilities */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const byId = (id) => LISTINGS.find((l) => l.id === id);

  /* ---------------------------------------------------------- storage */

  const KEY = 'drvn.oq.v1';
  let memory = null;
  function load() {
    let raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) { try { return JSON.parse(raw); } catch (e) { /* corrupted: fall through */ } }
    return memory ? JSON.parse(JSON.stringify(memory)) : {};
  }
  function save() {
    memory = JSON.parse(JSON.stringify(S));
    try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage blocked: memory only */ }
  }
  const S = Object.assign({ car: null, browsing: false, garage: [], cart: [], saved: {} }, load());
  if (!Array.isArray(S.garage)) S.garage = [];
  if (!Array.isArray(S.cart)) S.cart = [];
  if (!S.saved || typeof S.saved !== 'object') S.saved = {};

  /* ---------------------------------------------------------- matcher */

  const ALIASES = {
    rx7: ['rx7', 'rx-7', 'fd', 'fd3s', 'fd3', 'mazda', 'mazda rx7', 'rotary', '13b', '13brew', 'efini', 'savanna', 'rx7 fd'],
    e46: ['e46', 'm3', 'e46 m3', 'bmw', 'bmw m3', '3 series', 's54', 'bimmer', 'beemer', '330i', '330ci', '325i', 'm3 e46', 'bmw e46'],
    ek9: ['ek9', 'ek', 'civic', 'civic type r', 'type r', 'typer', 'ctr', 'honda', 'honda civic', 'b16b', 'b16', 'ek9 type r'],
    '964': ['964', '911', 'porsche', 'carrera', '911 carrera', 'carrera 2', 'carrera 4', 'c2', 'c4', 'rs america', 'porsche 911', 'porsche 964']
  };
  const EXCLUDE = {
    rx7: ['miata', 'mx5', 'rx8', 'fc', 'fc3s', 'rx3', 'mazda3', 'mazdaspeed3', 'cx5', 'rx2'],
    e46: ['e36', 'e30', 'e90', 'e92', 'e93', 'm2', 'm4', 'm5', 'f80', 'g80', 'z3', 'z4', 'e39', 'x5', 'e21', 'i3', 'i8'],
    ek9: ['eg', 'ef', 'fk8', 'fk2', 'fl5', 'ep3', 'dc2', 'dc5', 'integra', 's2000', 'nsx', 'accord', 'prelude', 'crx', 'fn2', 'si', 'fit', 'jazz'],
    '964': ['993', '996', '997', '991', '992', '930', 'boxster', 'cayman', 'cayenne', '944', '928', '356', '912', 'macan', 'taycan', '924']
  };
  const COMPLETIONS = [
    ['RX-7', 'rx7'], ['Mazda RX-7', 'rx7'], ['FD3S RX-7', 'rx7'],
    ['E46 M3', 'e46'], ['BMW M3', 'e46'], ['BMW E46 M3', 'e46'],
    ['Civic Type R', 'ek9'], ['Honda Civic Type R', 'ek9'], ['EK9 Civic Type R', 'ek9'], ['Type R', 'ek9'],
    ['964 Carrera', '964'], ['911 Carrera', '964'], ['Porsche 911', '964'], ['Porsche 964', '964'], ['Carrera 2', '964']
  ];
  const clean = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]\d{2}\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(my|a|an|the|i|drive|its|it's|is|an?)\b/g, ' ');
  const squash = (s) => s.replace(/[^a-z0-9]+/g, '');
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function match(input) {
    const c = clean(input || '');
    const n = squash(c);
    if (n.length < 2) return null;
    const tokens = c.split(/[\s\-_/.,]+/).map(squash).filter(Boolean);
    let best = null;
    for (const key of ORDER) {
      if (tokens.some((t) => EXCLUDE[key].includes(t))) continue;
      let score = 0;
      for (const raw of ALIASES[key]) {
        const a = squash(raw);
        if (n === a) score = Math.max(score, 100);
        else if (a.startsWith(n) && n.length >= 2) score = Math.max(score, 60 + n.length);
        else if (a.length >= 2 && n.includes(a)) score = Math.max(score, 70 + a.length);
        else {
          const tol = a.length >= 6 ? 2 : a.length >= 4 ? 1 : 0;
          if (tol && lev(n, a) <= tol) score = Math.max(score, 55);
          for (const t of tokens) if (tol && t.length >= 4 && lev(t, a) <= tol) score = Math.max(score, 52);
        }
      }
      if (score >= 50 && (!best || score > best.score)) best = { key, score };
    }
    return best ? { key: best.key, label: PLATFORMS[best.key].short, platform: PLATFORMS[best.key] } : null;
  }
  function completion(value) {
    const v = String(value || '').replace(/\s+/g, ' ').toLowerCase();
    if (!v.trim()) return '';
    const hit = COMPLETIONS.find(([label]) => label.toLowerCase().startsWith(v) && label.length > v.length);
    return hit ? hit[0].slice(v.length) : '';
  }
  function tidyLabel(s) {
    const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return t === t.toLowerCase() ? t.replace(/\b([a-z])/g, (m) => m.toUpperCase()) : t;
  }

  /* -------------------------------------------------------------- fit */

  const RANK = { fits: 0, universal: 1, adapter: 2, unknown: 3, no: 4 };
  function fitFor(l, car) {
    if (l.universal) return { v: 'universal', note: l.universal };
    if (!car) return { v: 'unknown', note: 'Tell us what you drive and we’ll check this against it.' };
    if (!car.key) return l.anyCar ? { v: l.anyCar[0], note: l.anyCar[1] } : { v: 'unknown', note: `Not listed for the ${car.label}. Ask the seller before you buy.` };
    const f = l.fit && l.fit[car.key];
    return f ? { v: f[0], note: f[1] } : { v: 'no', note: 'Not made for your car.' };
  }
  function verdictLabel(v, car) {
    switch (v) {
      case 'fits': return `Fits your ${car ? car.label : 'car'}`;
      case 'universal': return 'Universal fit';
      case 'adapter': return 'Fits with adapter';
      case 'no': return 'Doesn’t fit';
      default: return car ? 'Fit not listed' : 'Add your car to check fit';
    }
  }
  function sortByFit(list, car) {
    return list.slice().sort((a, b) => (RANK[fitFor(a, car).v] - RANK[fitFor(b, car).v]) || (a.days - b.days));
  }
  function tally(car) {
    const t = { fits: 0, universal: 0, adapter: 0, no: 0, unknown: 0 };
    LISTINGS.forEach((l) => { t[fitFor(l, car).v]++; });
    return t;
  }

  /* ------------------------------------------------------- car state */

  function getCar() { return S.car ? { key: S.car.key || null, label: S.car.label } : null; }
  function carParam() { return S.car ? (S.car.key || S.car.label) : (S.browsing ? 'none' : ''); }
  function addToGarage(car) {
    if (!car) return;
    const exists = S.garage.find((g) => (car.key ? g.key === car.key : (!g.key && g.label.toLowerCase() === car.label.toLowerCase())));
    if (!exists) S.garage.push({ key: car.key || null, label: car.label });
  }
  function setCar(car, opts = {}) {
    const prev = carParam();
    if (car) {
      const c = car.key ? { key: car.key, label: PLATFORMS[car.key].short } : { key: null, label: tidyLabel(car.label) };
      S.car = c; S.browsing = false; addToGarage(c);
    } else {
      S.car = null; S.browsing = !!opts.browsing;
    }
    save();
    syncUrl();
    decorateLinks();
    if (prev !== carParam() || opts.force) {
      document.dispatchEvent(new CustomEvent('oq:car', { detail: { car: getCar(), source: opts.source || '' } }));
    }
  }
  function readUrlCar() {
    let v = null;
    try { v = new URLSearchParams(location.search).get('car'); } catch (e) { v = null; }
    if (v == null || v === '') return;
    if (v === 'none') { S.car = null; S.browsing = true; }
    else if (PLATFORMS[v]) { S.car = { key: v, label: PLATFORMS[v].short }; S.browsing = false; addToGarage(S.car); }
    else { const label = tidyLabel(v); if (label) { S.car = { key: null, label }; S.browsing = false; addToGarage(S.car); } }
    save();
  }
  function syncUrl() {
    try {
      const u = new URL(location.href);
      const p = carParam();
      if (p) u.searchParams.set('car', p); else u.searchParams.delete('car');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* sandboxed history: links still carry the car */ }
  }
  function withCar(href) {
    const p = carParam();
    if (!href || /^(https?:|mailto:|tel:|#)/.test(href) || !/\.html/.test(href)) return href;
    const [path, hash] = href.split('#');
    const [base, qs] = path.split('?');
    const sp = new URLSearchParams(qs || '');
    if (p) sp.set('car', p); else sp.delete('car');
    const q = sp.toString();
    return base + (q ? '?' + q : '') + (hash ? '#' + hash : '');
  }
  function decorateLinks(root = document) {
    $$('a[href]:not([data-keep])', root).forEach((a) => {
      const h = a.getAttribute('href');
      const next = withCar(h);
      if (next !== h) a.setAttribute('href', next);
    });
  }

  /* --------------------------------------------------------- cart / saved */

  function inCart(id) { return S.cart.includes(id); }
  function toggleCart(id, force) {
    const has = inCart(id);
    const want = force == null ? !has : force;
    if (want && !has) S.cart.push(id);
    if (!want && has) S.cart = S.cart.filter((x) => x !== id);
    save();
    renderCartCount(want && !has);
    document.dispatchEvent(new CustomEvent('oq:cart'));
    return want;
  }
  const savedKey = (car) => (car ? (car.key || 'u:' + car.label.toLowerCase()) : null);
  function savedFor(car) { const k = savedKey(car); return (k && S.saved[k]) || []; }
  function toggleSaved(id, car) {
    const k = savedKey(car); if (!k) return false;
    const list = S.saved[k] || [];
    const has = list.includes(id);
    S.saved[k] = has ? list.filter((x) => x !== id) : list.concat(id);
    save();
    return !has;
  }

  /* ------------------------------------------------------------ toast */

  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
  }

  /* ----------------------------------------------------------- reveal */

  let io = null;
  function reveal(root = document) {
    const els = $$('.reveal:not(.is-in)', root);
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
    if (!io) io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  }
  function flip(container, render) {
    const old = new Map();
    $$('[data-id]', container).forEach((el) => old.set(el.dataset.id, el.getBoundingClientRect()));
    render();
    const els = $$('[data-id]', container);
    els.forEach((el) => el.classList.add('is-in'));
    if (reduced() || !Element.prototype.animate) return;
    els.forEach((el, i) => {
      const o = old.get(el.dataset.id);
      if (!o) { el.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: i * 30, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }); return; }
      const n = el.getBoundingClientRect();
      const dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 720, easing: 'cubic-bezier(.22,1,.36,1)' });
    });
  }

  /* ------------------------------------------------------ point clouds */

  const clouds = {};
  function cloud(key) {
    if (!clouds[key]) {
      clouds[key] = fetch(`../assets/c19-pts-${key}.bin`)
        .then((r) => { if (!r.ok) throw new Error('cloud ' + key); return r.arrayBuffer(); })
        .then((b) => new Float32Array(b))
        .catch((err) => { delete clouds[key]; throw err; });
    }
    return clouds[key];
  }
  function fogCloud(n) {
    const out = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < n; i++) {
      const u = rnd() || 1e-6, v = rnd(), w = rnd() || 1e-6, q = rnd();
      const g1 = Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831 * v);
      const g2 = Math.sqrt(-2 * Math.log(w)) * Math.cos(6.2831 * q);
      const g3 = Math.sqrt(-2 * Math.log(u)) * Math.sin(6.2831 * v);
      out[i * 3] = g1 * 0.42; out[i * 3 + 1] = g2 * 0.16; out[i * 3 + 2] = g3 * 0.26;
    }
    return out;
  }
  /* Small 2D projection of a cloud: tab thumbnails, member cards, and the no-WebGL fallback still. */
  async function drawSil(canvas, key, opts = {}) {
    let pts;
    try { pts = key ? await cloud(key) : fogCloud(6000); } catch (e) { return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 88, h = canvas.clientHeight || 40;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = opts.color || getComputedStyle(canvas).color;
    const r = opts.rot == null ? 0.42 : opts.rot, cs = Math.cos(r), sn = Math.sin(r);
    const fit = opts.fit || 0.94;
    const scale = Math.min((w * fit) / 2.25, (h * fit) / 0.95);
    const step = Math.max(3, Math.round((opts.stride || 4)) * 3);
    const dot = opts.dot || Math.max(0.7, Math.min(1.4, w / 260));
    ctx.globalAlpha = opts.alpha || 0.22;
    for (let i = 0; i < pts.length; i += step) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      const xr = x * cs + z * sn, zr = -x * sn + z * cs;
      ctx.fillRect(w / 2 + xr * scale, h * 0.52 - y * scale + zr * scale * 0.2, dot, dot);
    }
  }

  /* ------------------------------------------------------- stage bridge */

  const stages = {}; const wants = {};
  function registerStage(id, stage) {
    stages[id] = stage;
    const w = wants[id];
    if (w) applyWant(stage, w, false);
    document.dispatchEvent(new CustomEvent('oq:stage-ready', { detail: { id } }));
  }
  function applyWant(stage, w, instant) {
    if (w.idle) stage.setIdle(true);
    else { stage.setIdle(false); stage.show(w.key, { instant }); }
  }
  function want(id, w) { wants[id] = w; if (stages[id]) applyWant(stages[id], w, false); }
  function stage(id) { return stages[id] || null; }

  /* ----------------------------------------------------- render: cards */

  function cardHTML(l, car, i = 0, opts = {}) {
    const f = fitFor(l, car);
    const vl = verdictLabel(f.v, car);
    const s = SELLERS[l.seller];
    const media = l.img
      ? `<img class="pcard__img" src="../assets/${l.img}" alt="${esc(l.alt)}" loading="lazy" decoding="async" width="896" height="1120">`
      : `<div class="pcard__type" aria-hidden="true"><b>${esc(l.typeName || l.title)}</b><span>${esc(l.typeSub || l.cat)}</span></div>`;
    const forLine = l.for ? `For the ${PLATFORMS[l.for].short}` : l.cat;
    const meta = l.cameOff ? `Came off ${esc(l.cameOff.text)}` : `${esc(s.first)} · ${esc(s.city)}`;
    const added = inCart(l.id);
    return `<article class="pcard is-${f.v}${opts.reveal === false ? '' : ' reveal'}" data-id="${l.id}" style="--d:${Math.min(i, 8) * 70}ms">
  <div class="pcard__media">${media}</div>
  <div class="pcard__body">
    <span class="verdict verdict--${f.v}"><i class="verdict__mark" aria-hidden="true"></i>${esc(vl)}</span>
    <h3 class="pcard__title"><a href="${esc(withCar('part.html?id=' + l.id))}">${esc(l.title)}</a></h3>
    <p class="pcard__meta">${esc(forLine)} · ${esc(l.cond)}<br>${meta}</p>
    <div class="pcard__row">
      <span class="pcard__price">${money(l.price)}</span>
      <button class="pcard__add" type="button" data-add="${l.id}" aria-pressed="${added}" aria-label="${added ? 'Remove' : 'Add'} ${esc(l.title)} ${added ? 'from' : 'to'} cart">${added ? 'In cart' : 'Add to cart'}</button>
    </div>
  </div>
</article>`;
  }
  function bindAdds(root) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      e.preventDefault();
      const l = byId(b.dataset.add);
      const on = toggleCart(l.id);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'In cart' : 'Add to cart';
      b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${l.title} ${on ? 'from' : 'to'} cart`);
      toast(on ? `Added: ${l.title}` : 'Removed from cart');
    });
  }

  /* ------------------------------------------------------------- nav */

  function renderCartCount(bump) {
    $$('[data-cart]').forEach((b) => {
      const n = S.cart.length;
      const c = $('.cartbtn__n', b);
      if (c) c.textContent = String(n);
      b.classList.toggle('has-items', n > 0);
      b.setAttribute('aria-label', `Cart, ${n} item${n === 1 ? '' : 's'}`);
      if (bump && !reduced()) { b.classList.remove('is-bump'); void b.offsetWidth; b.classList.add('is-bump'); }
    });
  }
  function renderChip(animate) {
    const chip = $('[data-carchip]');
    if (!chip) return;
    const car = getCar();
    const label = $('[data-carchip-label]', chip);
    const btn = $('.carchip__btn', chip);
    chip.classList.toggle('is-empty', !car);
    label.textContent = car ? car.label : (S.browsing ? 'Add your car' : 'What do you drive?');
    btn.setAttribute('aria-label', car ? `Your car: ${car.label}. Change car` : 'Tell us what you drive');
    if (animate && !reduced()) { label.classList.remove('is-swap'); void label.offsetWidth; label.classList.add('is-swap'); }
  }
  function initNav() {
    const nav = $('[data-nav]');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // mobile menu
    const mb = $('.menubtn', nav), mn = $('#mnav');
    if (mb && mn) {
      const setMenu = (open) => { mb.setAttribute('aria-expanded', String(open)); mn.classList.toggle('is-open', open); mb.textContent = open ? 'Close' : 'Menu'; };
      mb.addEventListener('click', () => setMenu(mb.getAttribute('aria-expanded') !== 'true'));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mb.getAttribute('aria-expanded') === 'true') { setMenu(false); mb.focus(); } });
      mn.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    }

    // cart
    $$('[data-cart]').forEach((b) => b.addEventListener('click', () => openCart(b)));
    renderCartCount(false);

    // car chip + popover
    const chip = $('[data-carchip]');
    if (!chip) return;
    const btn = $('.carchip__btn', chip);
    const pop = $('.carpop', chip);
    renderChip(false);
    let open = false;
    const close = (focus) => { if (!open) return; open = false; pop.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
    const build = () => {
      const car = getCar();
      const opts = ORDER.map((k) => {
        const p = PLATFORMS[k];
        const inG = S.garage.some((g) => g.key === k);
        return `<li><button type="button" class="carpop__opt" data-pick="${k}" aria-pressed="${car && car.key === k}"><strong>${esc(p.short)}</strong><span>${esc(p.make)} · ${esc(p.gen)}${inG ? ' · in your garage' : ''}</span></button></li>`;
      }).join('');
      const extra = S.garage.filter((g) => !g.key).map((g) => `<li><button type="button" class="carpop__opt" data-pick-label="${esc(g.label)}" aria-pressed="${!!(car && !car.key && car.label === g.label)}"><strong>${esc(g.label)}</strong><span>In your garage</span></button></li>`).join('');
      pop.innerHTML = `<form class="carpop__form" data-popform novalidate>
  <p class="carpop__q" id="carpop-q">What do you drive?</p>
  <div class="field"><label for="carpop-in" class="sr-only">Type your car</label><input id="carpop-in" type="text" autocomplete="off" spellcheck="false" maxlength="34" placeholder="Type it, e.g. Supra" aria-describedby="carpop-match"></div>
  <p class="carpop__match" id="carpop-match" aria-live="polite"></p>
</form>
<ul class="carpop__list" aria-label="Pick a car">${opts}${extra}</ul>
<div class="carpop__foot"><button type="button" class="tlink tlink--quiet" data-pick-none>Just browsing</button><a class="tlink" href="${esc(withCar('garage.html'))}">Your garage <span class="btn__arrow">→</span></a></div>`;
      const input = $('#carpop-in', pop), m = $('#carpop-match', pop);
      input.addEventListener('input', () => {
        const v = input.value.trim(); const r = match(v);
        m.textContent = !v ? '' : r ? `${r.platform.make} ${r.platform.model} · ${r.platform.gen}. Press Enter.` : (v.length >= 3 ? 'Not in our garage yet. We’ll still show you universal parts.' : '');
      });
      $('[data-popform]', pop).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim(); if (!v) { input.focus(); return; }
        const r = match(v);
        setCar(r ? { key: r.key } : { label: v }, { source: 'chip' });
        close(true);
      });
    };
    btn.addEventListener('click', () => {
      if (open) { close(true); return; }
      build();
      open = true;
      pop.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(() => { const i = $('#carpop-in', pop); if (i) i.focus(); }, 40);
    });
    pop.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pick]');
      const pl = e.target.closest('[data-pick-label]');
      const pn = e.target.closest('[data-pick-none]');
      if (p) { setCar({ key: p.dataset.pick }, { source: 'chip' }); close(true); }
      else if (pl) { setCar({ label: pl.dataset.pickLabel }, { source: 'chip' }); close(true); }
      else if (pn) { setCar(null, { browsing: true, source: 'chip' }); close(true); }
    });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') {
        const f = $$('button, a[href], input', pop).filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    document.addEventListener('click', (e) => { if (open && !chip.contains(e.target)) close(false); });
    document.addEventListener('oq:car', () => renderChip(true));
    OQ.openChip = () => { if (!open) btn.click(); };
  }

  /* ------------------------------------------------------- sheet (dialog) */

  const Sheet = (() => {
    let scrim, el, last, isOpen = false, closeT;
    function build() {
      scrim = document.createElement('div'); scrim.className = 'sheet-scrim'; scrim.hidden = true;
      el = document.createElement('aside'); el.className = 'sheet'; el.hidden = true;
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'sheet-title');
      el.innerHTML = '<div class="sheet__head"><h2 class="sheet__title" id="sheet-title"></h2><button class="sheet__close" type="button" aria-label="Close">×</button></div><div class="sheet__body"></div><div class="sheet__foot"></div>';
      document.body.append(scrim, el);
      scrim.addEventListener('click', close);
      $('.sheet__close', el).addEventListener('click', close);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      });
    }
    const focusables = () => $$('button:not([disabled]), a[href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', el).filter((x) => x.offsetParent !== null || x === document.activeElement);
    function set(view) {
      $('.sheet__title', el).textContent = view.title;
      $('.sheet__body', el).innerHTML = view.body;
      const foot = $('.sheet__foot', el);
      foot.innerHTML = view.foot || ''; foot.hidden = !view.foot;
      decorateLinks(el);
      if (view.bind) view.bind(el);
    }
    function open(view, opener) {
      if (!el) build();
      clearTimeout(closeT);
      if (!isOpen) last = opener || document.activeElement;
      set(view);
      scrim.hidden = false; el.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('is-open'); el.classList.add('is-open'); }));
      isOpen = true;
      setTimeout(() => { const t = $('[data-autofocus]', el) || $('.sheet__close', el); t.focus(); }, 80);
    }
    function swap(view) { if (!isOpen) return open(view); set(view); setTimeout(() => { const t = $('[data-autofocus]', el) || $('.sheet__close', el); t.focus(); }, 30); }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      scrim.classList.remove('is-open'); el.classList.remove('is-open');
      document.documentElement.style.overflow = '';
      closeT = setTimeout(() => { scrim.hidden = true; el.hidden = true; }, reduced() ? 0 : 520);
      if (last && document.contains(last)) last.focus();
    }
    return { open, swap, close };
  })();

  function lineHTML(l, removable) {
    const s = SELLERS[l.seller];
    const img = l.img ? `<img src="../assets/${l.img}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc((l.typeName || l.title).charAt(0))}</span>`;
    return `<div class="line"><div class="line__img">${img}</div><div><div class="line__t">${esc(l.title)}</div><div class="line__m">From ${esc(s.first)} · ${esc(s.city)} · ${esc(l.cond)}</div></div><div><div class="line__p">${money(l.price)}</div>${removable ? `<button class="line__rm" type="button" data-rm="${l.id}">Remove</button>` : ''}</div></div>`;
  }
  function cartView() {
    const items = S.cart.map(byId).filter(Boolean);
    if (!items.length) {
      return { title: 'Your cart', body: `<div class="empty" style="padding:0"><p class="h3">Nothing in here yet.</p><p>Everything you add is checked against your car first.</p><a class="btn btn--primary" href="market.html" data-autofocus>Browse parts <span class="btn__arrow">→</span></a></div>` };
    }
    const sub = items.reduce((a, l) => a + l.price, 0), ship = items.reduce((a, l) => a + l.ship, 0);
    return {
      title: `Your cart · ${items.length}`,
      body: `${items.map((l) => lineHTML(l, true)).join('')}
<div class="totals"><div><span>Parts</span><span>${money(sub)}</span></div><div><span>Shipping</span><span>${money(ship)}</span></div><div><span>Buyer protection</span><span>Included</span></div><div class="totals__sum"><span>Total</span><span>${money(sub + ship)}</span></div></div>`,
      foot: `<button class="btn btn--primary btn--block" type="button" data-checkout data-autofocus>Check out <span class="btn__arrow">→</span></button><p class="sheet__fine">No account needed. Your payment is held until delivery.</p>`,
      bind: (el) => {
        $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => { toggleCart(b.dataset.rm, false); Sheet.swap(cartView()); syncAddButtons(); }));
        const c = $('[data-checkout]', el); if (c) c.addEventListener('click', () => Sheet.swap(checkoutView(items, true)));
      }
    };
  }
  function syncAddButtons() {
    $$('[data-add]').forEach((b) => { const on = inCart(b.dataset.add); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'In cart' : 'Add to cart'; });
    $$('[data-cart-toggle]').forEach((b) => { const on = inCart(b.dataset.cartToggle); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'In your cart' : 'Add to cart'; });
  }
  function checkoutView(items, fromCart) {
    const sub = items.reduce((a, l) => a + l.price, 0), ship = items.reduce((a, l) => a + l.ship, 0), total = sub + ship;
    const sellers = Array.from(new Set(items.map((l) => SELLERS[l.seller].first)));
    const who = sellers.length === 1 ? sellers[0] : 'the sellers';
    return {
      title: 'Checkout',
      body: `${items.map((l) => lineHTML(l, false)).join('')}
<div class="totals"><div><span>Parts</span><span>${money(sub)}</span></div><div><span>Shipping</span><span>${money(ship)}</span></div><div><span>Buyer protection</span><span>Included</span></div><div class="totals__sum"><span>Total</span><span>${money(total)}</span></div></div>
<div class="held"><strong>Your money waits with us.</strong><span>We hold ${money(total)} until it’s delivered. ${esc(who)} gets paid 2 days after it arrives, once you’ve had a look.</span></div>
<form class="form" id="checkout-form" novalidate>
  <div class="field"><label for="co-email">Email for updates</label><input id="co-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" data-autofocus><span class="field__err" id="co-email-err"></span></div>
  <div class="field"><label for="co-name">Full name</label><input id="co-name" name="name" type="text" autocomplete="name"><span class="field__err" id="co-name-err"></span></div>
  <div class="field"><label for="co-addr">Street address</label><input id="co-addr" name="addr" type="text" autocomplete="street-address"><span class="field__err" id="co-addr-err"></span></div>
  <div class="form__row"><div class="field"><label for="co-city">City</label><input id="co-city" name="city" type="text" autocomplete="address-level2"></div><div class="field"><label for="co-zip">ZIP</label><input id="co-zip" name="zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="10"><span class="field__err" id="co-zip-err"></span></div></div>
</form>`,
      foot: `<button class="btn btn--primary btn--block" type="submit" form="checkout-form">Pay ${money(total)}, held until delivery</button>${fromCart ? '<button class="tlink tlink--quiet" type="button" data-back style="justify-self:center">Back to cart</button>' : '<p class="sheet__fine">Card details on the next step. No account needed.</p>'}`,
      bind: (el) => {
        const back = $('[data-back]', el); if (back) back.addEventListener('click', () => Sheet.swap(cartView()));
        const form = $('#checkout-form', el);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const rules = [['email', (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Add an email so we can send tracking.'], ['name', (v) => v.length > 1, 'Who’s it going to?'], ['addr', (v) => v.length > 3, 'Where should it go?'], ['zip', (v) => /^\d{5}(-\d{4})?$/.test(v), 'A 5-digit ZIP, please.']];
          let firstBad = null;
          rules.forEach(([n, ok, msg]) => {
            const i = form.elements[n]; const err = $('#co-' + n + '-err', el); const good = ok(i.value.trim());
            i.setAttribute('aria-invalid', String(!good)); if (err) err.textContent = good ? '' : msg;
            if (good) i.removeAttribute('aria-describedby'); else i.setAttribute('aria-describedby', 'co-' + n + '-err');
            if (!good && !firstBad) firstBad = i;
          });
          if (firstBad) { firstBad.focus(); return; }
          if (fromCart) { S.cart = []; save(); renderCartCount(false); syncAddButtons(); }
          Sheet.swap(doneView(items, total, who));
        });
      }
    };
  }
  function doneView(items, total, who) {
    const car = getCar();
    return {
      title: 'Order placed',
      body: `<div class="done"><div class="done__mark" aria-hidden="true">✓</div><h3 class="h2">Paid, and held.</h3><p>${money(total)} is with us, not with ${esc(who)} yet. When ${items.length === 1 ? 'it arrives' : 'they arrive'}, you’ve got 2 days to check ${items.length === 1 ? 'it' : 'them'} over. Then ${esc(who)} gets paid.</p><p>${car ? `Enjoy fitting ${items.length === 1 ? 'it' : 'them'} to the ${esc(car.label)}.` : 'Enjoy the build.'}</p></div>`,
      foot: `<button class="btn btn--primary btn--block" type="button" data-done data-autofocus>Done</button>`,
      bind: (el) => { $('[data-done]', el).addEventListener('click', () => Sheet.close()); }
    };
  }
  function openCart(opener) { Sheet.open(cartView(), opener); }
  function openCheckout(items, opener) { Sheet.open(checkoutView(items, false), opener); }

  /* ======================================================== PAGE: index */

  function pageIndex() {
    const hero = $('[data-hero]');
    const form = $('[data-ask]');
    const input = $('#answer');
    const ans = $('[data-ans]');
    const pre = $('.ans__pre', ans), post = $('.ans__post', ans), sfx = $('.ans__sfx', ans), idle = $('.ans__idle', ans);
    const matchEl = $('[data-match]');
    const live = $('[data-live]');
    const submit = $('[data-submit]');
    const chip = $('[data-carchip]');
    let current = null;        // last matched platform key
    let unknownT = null, idleT = null, typeT = null, liveT = null;
    let idleLabel = '';

    const fineInput = window.matchMedia('(pointer: fine)').matches;

    function setLive(msg) { clearTimeout(liveT); liveT = setTimeout(() => { if (live) live.textContent = msg; }, 450); }
    function chipVisible(v) { if (chip) chip.classList.toggle('is-hidden', !v); }

    function fit() {
      const avail = input.clientWidth * 0.97;
      ans.style.setProperty('--ans-scale', '1');
      const w = pre.offsetWidth + post.offsetWidth + sfx.offsetWidth + (input.value ? 0 : idle.offsetWidth);
      const s = w > avail && w > 0 ? Math.max(0.4, avail / w) : 1;
      ans.style.setProperty('--ans-scale', s.toFixed(3));
    }
    function paintGhost() {
      const v = input.value;
      const a = input.selectionStart == null ? v.length : input.selectionStart;
      const b = input.selectionEnd == null ? v.length : input.selectionEnd;
      pre.textContent = v.slice(0, a);
      post.textContent = v.slice(a);
      const atEnd = a === v.length && b === v.length;
      sfx.textContent = atEnd ? completion(v) : '';
      idle.textContent = v ? '' : idleLabel;
      ans.classList.toggle('has-sel', a !== b);
      fit();
    }
    function kick() {
      if (reduced()) return;
      ans.classList.remove('is-kick'); void ans.offsetWidth; ans.classList.add('is-kick');
      clearTimeout(kick.k); kick.k = setTimeout(() => ans.classList.remove('is-kick'), 650);
      const s = stage('hero'); if (s) s.kick();
      document.body.classList.add('is-typing');
      clearTimeout(kick.t); kick.t = setTimeout(() => document.body.classList.remove('is-typing'), 900);
    }

    function showMatch(r, v) {
      if (r) {
        const p = r.platform;
        matchEl.innerHTML = `<span class="match__name">${esc(p.make)} ${esc(p.model)} · ${esc(p.gen)} · ${esc(p.years)}</span><span class="match__line">${esc(p.nod)}</span>`;
        setLive(`Recognised: ${p.make} ${p.model}, ${p.gen}. Press Enter to see parts that fit.`);
      } else if (v) {
        matchEl.innerHTML = `<span class="match__name">Not in our garage yet</span><span class="match__line">We’ll still show you universal parts, and everything that fits with an adapter.</span>`;
        setLive('Not in our garage yet. We’ll still show you universal parts.');
      } else {
        matchEl.innerHTML = `<span class="match__try">Try <button type="button" data-try="RX-7">RX-7</button><button type="button" data-try="E46 M3">E46 M3</button><button type="button" data-try="Civic Type R">Civic Type R</button><button type="button" data-try="Porsche 964">Porsche 964</button></span>`;
      }
    }

    function onInput(fromTyper) {
      paintGhost();
      if (!fromTyper) kick(); else kick();
      const v = input.value.trim();
      submit.disabled = !v;
      hero.classList.toggle('is-answering', !!v);
      clearTimeout(unknownT); clearTimeout(idleT);
      if (!v) {
        current = null;
        showMatch(null, '');
        idleT = setTimeout(() => want('hero', { idle: true }), 1200);
        return;
      }
      const r = match(v);
      if (r) {
        if (r.key !== current) { current = r.key; want('hero', { key: r.key }); }
        const s = stage('hero'); if (s) s.setLoose(0);
        showMatch(r, v);
      } else {
        // thinking: stay on the last car but loosen; settle into the cloud if it never resolves
        const s = stage('hero');
        if (current) { if (s) s.setLoose(0.35); } else want('hero', { key: 'cloud' });
        unknownT = setTimeout(() => {
          if (input.value.trim().length >= 3 && !match(input.value)) { current = 'cloud'; want('hero', { key: 'cloud' }); showMatch(null, v); }
        }, v.length >= 3 ? 380 : 900);
        if (v.length < 3) matchEl.innerHTML = '';
      }
    }

    function typeInto(text) {
      clearTimeout(typeT);
      input.value = '';
      input.focus();
      let i = 0;
      const step = () => {
        input.value = text.slice(0, ++i);
        input.setSelectionRange(input.value.length, input.value.length);
        onInput(true);
        if (i < text.length) typeT = setTimeout(step, reduced() ? 0 : 70 + Math.random() * 50);
      };
      step();
    }

    // idle placeholder: the site types the car it is drawing
    let idleTyper = null;
    document.addEventListener('oq:stage-cycle', (e) => {
      if (e.detail.id !== 'hero' || input.value) return;
      const p = PLATFORMS[e.detail.key];
      if (!p) return;
      const label = p.short === '964' ? 'Porsche 964' : p.short === 'EK9' ? 'Civic Type R' : p.short;
      clearInterval(idleTyper);
      if (reduced()) { idleLabel = label; paintGhost(); return; }
      let i = 0; idleLabel = '';
      idleTyper = setInterval(() => { idleLabel = label.slice(0, ++i); if (!input.value) { idle.textContent = idleLabel; } if (i >= label.length) clearInterval(idleTyper); }, 55);
    });

    input.addEventListener('input', () => onInput(false));
    ['keyup', 'click', 'select'].forEach((ev) => input.addEventListener(ev, paintGhost));
    document.addEventListener('selectionchange', () => { if (document.activeElement === input) paintGhost(); });
    input.addEventListener('focus', () => { ans.classList.add('is-focused'); paintGhost(); });
    input.addEventListener('blur', () => ans.classList.remove('is-focused'));
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowRight') {
        const c = sfx.textContent;
        if (c && input.selectionStart === input.value.length) { e.preventDefault(); input.value += c; onInput(false); }
      }
      if (e.key === 'Escape' && input.value) { input.value = ''; onInput(false); }
    });
    matchEl.addEventListener('click', (e) => { const t = e.target.closest('[data-try]'); if (t) typeInto(t.dataset.try); });
    window.addEventListener('resize', () => fit());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    function flyToChip(text) {
      const label = chip && $('[data-carchip-label]', chip);
      if (!label || reduced()) return;
      const from = pre.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(input).fontSize);
      const fly = document.createElement('p');
      fly.className = 'fly'; fly.textContent = text; fly.setAttribute('aria-hidden', 'true');
      fly.style.fontSize = fs + 'px';
      fly.style.left = from.left + 'px'; fly.style.top = (from.top + fs * 0.05) + 'px';
      document.body.appendChild(fly);
      chipVisible(true);
      chip.style.opacity = '0';
      requestAnimationFrame(() => {
        const to = label.getBoundingClientRect();
        const s = 17 / fs;
        fly.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { offset: 0.8, opacity: 1 },
          { transform: `translate(${to.left - from.left}px, ${to.top - from.top - fs * 0.05 + 1}px) scale(${s})`, opacity: 0.0 }
        ], { duration: 820, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' }).onfinish = () => {
          fly.remove(); chip.style.opacity = ''; chip.classList.remove('is-pop'); void chip.offsetWidth; chip.classList.add('is-pop');
        };
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      const r = match(v);
      const label = r ? r.platform.short : tidyLabel(v);
      const s = stage('hero');
      if (s) { if (r) s.show(r.key); s.flare(); }
      flyToChip(label);
      setCar(r ? { key: r.key } : { label: v }, { source: 'ask', force: true });
      chipVisible(true);
      const t = tally(getCar());
      const n = t.fits + t.universal;
      matchEl.innerHTML = r
        ? `<span class="match__name">Good answer. ${n} parts fit your ${esc(label)} right now.</span><span class="match__line">${t.adapter} more fit with an adapter. Scroll on, or change your answer any time.</span>`
        : `<span class="match__name">Noted: ${esc(label)}.</span><span class="match__line">${t.universal} universal parts and ${t.adapter} that fit with an adapter. We’ll learn your car as members list for it.</span>`;
      setLive(`Showing parts for your ${label}.`);
      const target = $('#answer');
      setTimeout(() => {
        target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        setTimeout(() => { const h = $('#answer-h'); if (h) h.focus({ preventScroll: true }); }, reduced() ? 0 : 700);
      }, reduced() ? 0 : 950);
    });
    $('[data-browse]').addEventListener('click', () => {
      setCar(null, { browsing: true, source: 'ask', force: true });
      chipVisible(true);
      $('#answer').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    });

    // render the answer sections
    const grid = $('[data-a-grid]');
    bindAdds(grid);
    function renderAnswer(animate) {
      const car = getCar();
      const p = car && car.key ? PLATFORMS[car.key] : null;
      const t = tally(car);
      const title = $('[data-a-title]'), lead = $('[data-a-lead]'), count = $('[data-a-count]'), eyebrow = $('[data-a-eyebrow]'), all = $('[data-a-all]');
      if (car) {
        eyebrow.textContent = 'Your answer, answered';
        title.innerHTML = p ? `Parts that fit your <span class="car-word">${esc(car.label)}</span>` : `Parts for your <span class="car-word">${esc(car.label)}</span>`;
        lead.textContent = p
          ? `Checked against the ${p.make} ${p.model} ${p.gen}: ${p.bolt} hubs, the ${p.engine}, the lot. What fits comes first; what doesn’t fades back.`
          : `We don’t know the ${car.label} yet, so here’s everything universal first, then parts that fit with an adapter.`;
        count.innerHTML = p ? `<strong>${t.fits + t.universal}</strong> fit · <strong>${t.adapter}</strong> with an adapter · ${t.no} don’t` : `<strong>${t.universal}</strong> universal · <strong>${t.adapter}</strong> with an adapter`;
        all.innerHTML = `Everything for your ${esc(car.label)} <span class="btn__arrow">→</span>`;
      } else {
        eyebrow.textContent = S.browsing ? 'Just browsing' : 'On DRVN this week';
        title.textContent = 'Parts on DRVN this week';
        lead.textContent = 'Fresh off members’ cars. Tell us what you drive and every one of these tells you whether it fits.';
        count.innerHTML = `<strong>${LISTINGS.length}</strong> parts from <strong>${Object.keys(SELLERS).length}</strong> members`;
        all.innerHTML = 'See the whole marketplace <span class="btn__arrow">→</span>';
      }
      all.setAttribute('href', withCar('market.html'));
      const list = car ? sortByFit(LISTINGS, car).slice(0, 6) : LISTINGS.filter((l) => l.img).slice(0, 6);
      grid.innerHTML = list.map((l, i) => cardHTML(l, car, i)).join('');
      if (animate) $$('.car-word', title).forEach((w) => w.classList.add('is-swap'));
      reveal(grid);

      // how it works
      $$('[data-carword]').forEach((el) => { el.textContent = car ? car.label : el.dataset.carword; });
      // people
      const ppl = $('[data-people]');
      const pt = $('[data-people-title]'), pl = $('[data-people-lead]');
      let members;
      if (p) {
        members = MEMBERS.filter((m) => m.key === p.key);
        pt.textContent = `Other people who drive ${p.a} ${p.short}`;
        pl.textContent = `${members.length} members with ${p.plural} keep their builds here, and sell what comes off them. Buy from someone who knows the car.`;
      } else {
        members = ORDER.map((k) => MEMBERS.find((m) => m.key === k));
        pt.textContent = 'Everyone here has an answer';
        pl.textContent = 'Members keep a garage of their cars, post what they’re building and sell the parts that come off. Tell us yours to meet your people.';
      }
      ppl.innerHTML = members.map((m, i) => {
        const s = SELLERS[m.h] || {};
        const first = m.first || s.first, city = m.city || s.city;
        const listed = LISTINGS.filter((l) => l.seller === m.h).length;
        return `<article class="person reveal" style="--d:${i * 80}ms"><canvas class="person__sil" data-sil="${m.key}" aria-hidden="true"></canvas><h3 class="person__car">${esc(m.car)}</h3><p class="person__who"><b>${esc(first)}</b> · @${esc(m.h)} · ${esc(city)}</p><p class="person__quote">${esc(m.line)}</p><div class="person__foot"><span>${esc(m.paint)}</span><span>${listed ? `${listed} part${listed > 1 ? 's' : ''} for sale` : 'Not selling, just building'}</span></div></article>`;
      }).join('');
      $$('canvas[data-sil]', ppl).forEach((c) => drawSil(c, c.dataset.sil, { alpha: 0.32, stride: 7, rot: 0.42, dot: 1 }));
      reveal(ppl);
      // sell
      const st = $('[data-sell-title]'), sl = $('[data-sell-lead]');
      st.textContent = car ? `Took something off your ${car.label}?` : 'Took something off your car?';
      sl.textContent = p
        ? `Someone with ${p.a} ${p.short} is hunting for it right now. List it in two minutes; buyers will see exactly which car it came off.`
        : 'Someone with the same car is hunting for it right now. List it in two minutes; buyers see exactly which car it came off.';
      decorateLinks();
    }

    // initial state
    const car = getCar();
    if (car) {
      input.value = car.label;
      current = car.key || 'cloud';
      want('hero', { key: car.key || 'cloud' });
      hero.classList.add('is-answering');
      submit.disabled = false;
      const r = car.key ? { platform: PLATFORMS[car.key] } : null;
      showMatch(r, car.key ? car.label : car.label);
      chipVisible(true);
    } else {
      want('hero', { idle: true });
      submit.disabled = true;
      showMatch(null, '');
      chipVisible(S.browsing);
    }
    paintGhost();
    renderAnswer(false);
    if (fineInput && !car) setTimeout(() => input.focus({ preventScroll: true }), 300);

    document.addEventListener('oq:car', (e) => {
      renderAnswer(true);
      if (e.detail.source === 'chip') {
        const c = getCar();
        input.value = c ? c.label : '';
        current = c ? (c.key || 'cloud') : null;
        if (c) want('hero', { key: c.key || 'cloud' }); else want('hero', { idle: true });
        submit.disabled = !c;
        showMatch(c && c.key ? { platform: PLATFORMS[c.key] } : null, c ? c.label : '');
        paintGhost();
      }
    });
  }

  /* ======================================================= PAGE: market */

  function pageMarket() {
    const grid = $('[data-m-grid]');
    const count = $('[data-m-count]');
    const live = $('[data-live]');
    const title = $('[data-m-title]'), lead = $('[data-m-lead]'), tallyEl = $('[data-m-tally]');
    const st = { fit: 'all', cat: 'All', max: 4000, cond: new Set(), sort: 'fit' };
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('cat')) st.cat = qs.get('cat');
      if (['fits', 'adapter', 'all'].includes(qs.get('fit'))) st.fit = qs.get('fit');
    } catch (e) { /* defaults */ }
    const cats = ['All'].concat(Array.from(new Set(LISTINGS.map((l) => l.cat))));
    const maxPrice = Math.ceil(Math.max(...LISTINGS.map((l) => l.price)) / 100) * 100;
    st.max = maxPrice;
    bindAdds(grid);
    const det = $('[data-filters]');
    const mq = window.matchMedia('(max-width: 960px)');
    const syncDet = () => { det.open = !mq.matches; };
    syncDet();
    if (mq.addEventListener) mq.addEventListener('change', syncDet);

    function passFit(l, car, mode) {
      if (mode === 'all' || !car) return true;
      const v = fitFor(l, car).v;
      if (mode === 'fits') return v === 'fits' || v === 'universal';
      return v === 'fits' || v === 'universal' || v === 'adapter';
    }
    function passOthers(l, ignore) {
      if (ignore !== 'cat' && st.cat !== 'All' && l.cat !== st.cat) return false;
      if (l.price > st.max) return false;
      if (ignore !== 'cond' && st.cond.size && !st.cond.has(l.cond)) return false;
      return true;
    }
    function filtered(car) {
      let list = LISTINGS.filter((l) => passOthers(l) && passFit(l, car, st.fit));
      if (st.sort === 'fit') list = sortByFit(list, car);
      if (st.sort === 'low') list.sort((a, b) => a.price - b.price);
      if (st.sort === 'high') list.sort((a, b) => b.price - a.price);
      if (st.sort === 'new') list.sort((a, b) => a.days - b.days);
      return list;
    }
    function renderControls() {
      const car = getCar();
      const fitSeg = $('[data-m-fit]');
      const counts = { fits: 0, adapter: 0, all: 0 };
      LISTINGS.filter((l) => passOthers(l)).forEach((l) => { ['fits', 'adapter', 'all'].forEach((m) => { if (passFit(l, car, m)) counts[m]++; }); });
      fitSeg.innerHTML = [['fits', 'Fits'], ['adapter', 'Fits with adapter'], ['all', 'All']].map(([k, lab]) =>
        `<button type="button" class="seg__btn" role="radio" aria-checked="${st.fit === k}" data-fit="${k}" ${!car && k !== 'all' ? 'disabled' : ''} tabindex="${st.fit === k ? 0 : -1}"><span>${lab}</span><span class="seg__n">${car ? counts[k] : (k === 'all' ? counts.all : '')}</span></button>`).join('');
      $('[data-m-fit-hint]').innerHTML = car
        ? (car.key ? `Checked against your ${esc(car.label)}. “Fits with adapter” includes everything that fits.` : `We don’t know the ${esc(car.label)} yet: “Fits” means universal parts.`)
        : `<button type="button" class="tlink" data-open-chip>Tell us your car</button> to filter by fit.`;
      $('[data-m-cats]').innerHTML = cats.map((c) => {
        const n = LISTINGS.filter((l) => (c === 'All' || l.cat === c) && passOthers(l, 'cat') && passFit(l, car, st.fit)).length;
        return `<li><button type="button" aria-pressed="${st.cat === c}" data-cat="${esc(c)}"><span>${c === 'All' ? 'All parts' : esc(c)}</span><span class="seg__n">${n}</span></button></li>`;
      }).join('');
      $$('[data-cond]').forEach((cb) => {
        const n = LISTINGS.filter((l) => l.cond === cb.value && passOthers(l, 'cond') && passFit(l, car, st.fit)).length;
        const nEl = cb.parentElement.querySelector('.seg__n'); if (nEl) nEl.textContent = n;
      });
      const sum = $('[data-m-sumn]');
      if (sum) { const active = (st.fit !== 'all') + (st.cat !== 'All') + (st.max < maxPrice) + (st.cond.size > 0); sum.textContent = active ? ` · ${active} on` : ''; }
    }
    function render(animate) {
      const car = getCar();
      const p = car && car.key ? PLATFORMS[car.key] : null;
      const t = tally(car);
      title.innerHTML = car ? `Parts for your <span class="car-word${animate ? ' is-swap' : ''}">${esc(car.label)}</span>` : 'Every part on DRVN';
      lead.textContent = p
        ? `Every listing checked against the ${p.make} ${p.model} ${p.gen}. Change your car up top and the whole market re-sorts around it.`
        : car ? `The ${car.label} isn’t in our garage yet, so universal parts come first.` : 'Browsing without a car is fine. Tell us yours and every part will say whether it fits.';
      tallyEl.innerHTML = car
        ? `<div><b>${t.fits + t.universal}</b><span>fit</span></div><div><b>${t.adapter}</b><span>with adapter</span></div><div><b>${t.no + t.unknown}</b><span>don’t</span></div>`
        : `<div><b>${LISTINGS.length}</b><span>parts</span></div><div><b>${Object.keys(SELLERS).length}</b><span>sellers</span></div>`;
      renderControls();
      const list = filtered(car);
      const draw = () => {
        grid.innerHTML = list.length ? list.map((l, i) => cardHTML(l, car, i)).join('')
          : `<div class="empty" style="grid-column:1/-1"><p class="h3">Nothing ${car ? `for your ${esc(car.label)} ` : ''}matches that, yet.</p><p>Widen the price, try another category, or include parts that fit with an adapter.</p><button class="btn btn--ghost" type="button" data-reset>Clear filters</button></div>`;
      };
      flip(grid, draw);
      const msg = `${list.length} part${list.length === 1 ? '' : 's'}${car ? ` · sorted for your ${car.label}` : ''}`;
      count.innerHTML = `<strong>${list.length}</strong> part${list.length === 1 ? '' : 's'}${car ? ` · ${st.sort === 'fit' ? 'best fit first' : 'sorted'} for your ${esc(car.label)}` : ''}`;
      if (live) live.textContent = msg;
    }
    const range = $('[data-m-max]'), out = $('[data-m-maxout]');
    range.max = String(maxPrice); range.value = String(st.max);
    const paintRange = () => { const pct = (range.value - range.min) / (range.max - range.min) * 100; range.style.setProperty('--pct', pct + '%'); out.textContent = Number(range.value) >= maxPrice ? 'Any price' : 'Up to ' + money(range.value); };
    paintRange();
    $('[data-m-ends]').innerHTML = `<span>$0</span><span>${money(maxPrice)}</span>`;
    range.addEventListener('input', () => { st.max = Number(range.value); paintRange(); render(true); });
    $('[data-m-fit]').addEventListener('click', (e) => { const b = e.target.closest('[data-fit]'); if (!b || b.disabled) return; st.fit = b.dataset.fit; render(true); $(`[data-fit="${st.fit}"]`).focus(); });
    $('[data-m-fit]').addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const btns = $$('[data-fit]').filter((b) => !b.disabled); const i = btns.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const n = btns[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
      st.fit = n.dataset.fit; render(true); $(`[data-fit="${st.fit}"]`).focus();
    });
    $('[data-m-cats]').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; st.cat = b.dataset.cat; render(true); const nb = $(`[data-cat="${CSS.escape(st.cat)}"]`); if (nb) nb.focus(); });
    $$('[data-cond]').forEach((cb) => cb.addEventListener('change', () => { if (cb.checked) st.cond.add(cb.value); else st.cond.delete(cb.value); render(true); }));
    $('[data-m-sort]').addEventListener('change', (e) => { st.sort = e.target.value; render(true); });
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-chip]') && OQ.openChip) { e.stopPropagation(); OQ.openChip(); }
      if (e.target.closest('[data-reset]')) { st.fit = 'all'; st.cat = 'All'; st.max = maxPrice; st.cond.clear(); range.value = String(maxPrice); paintRange(); $$('[data-cond]').forEach((c) => { c.checked = false; }); render(true); }
    });
    document.addEventListener('oq:car', () => { if (!getCar()) st.fit = 'all'; render(true); });
    document.addEventListener('oq:cart', syncAddButtons);
    render(false);
  }

  /* ========================================================= PAGE: part */

  function pagePart() {
    let id = 'bc-br-e46';
    try { const q = new URLSearchParams(location.search).get('id'); if (q && byId(q)) id = q; } catch (e) { /* default */ }
    const l = byId(id);
    const s = SELLERS[l.seller];
    document.title = `${l.title} · DRVN`;
    const media = $('[data-p-media]');
    if (l.img === 'c19-coilover.jpg') {
      media.innerHTML = `<video src="../assets/c19-motion-coilover.mp4" poster="../assets/c19-coilover.jpg" muted autoplay loop playsinline preload="metadata" aria-label="The coilover turning on a turntable"></video><figcaption>Turn it around. Slowly.</figcaption>`;
      const v = $('video', media);
      if (reduced()) { v.removeAttribute('autoplay'); v.pause(); }
    } else if (l.img) {
      media.innerHTML = `<img src="../assets/${l.img}" alt="${esc(l.alt)}">`;
    } else {
      media.innerHTML = `<div class="pcard__type" style="height:100%"><b style="font-size:clamp(40px,4vw,64px)">${esc(l.typeName || l.title)}</b><span>${esc(l.typeSub || '')}</span></div>`;
    }
    $('[data-p-cat]').textContent = l.cat;
    $('[data-p-cat]').setAttribute('href', withCar('market.html?cat=' + encodeURIComponent(l.cat)));
    $('[data-p-title]').textContent = l.title;
    $('[data-p-sub]').textContent = `${l.for ? 'For the ' + PLATFORMS[l.for].make + ' ' + PLATFORMS[l.for].model + ' ' + PLATFORMS[l.for].gen : 'Universal'} · ${l.cond}`;
    $('[data-p-price]').innerHTML = `${money(l.price)} <small>+ ${money(l.ship)} shipping · buyer protection included</small>`;
    $('[data-p-specs]').innerHTML = (l.specs || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    $('[data-p-seller]').innerHTML = `<div class="avatar" aria-hidden="true">${esc(s.first.charAt(0))}</div>
<div><div class="seller__name">${esc(s.first)} <span class="dim">@${esc(l.seller)}</span></div><div class="seller__meta">${esc(s.city)} · ${s.sold} sold · usually ships in ${esc(s.ships)}</div></div>
${l.cameOff ? `<div class="cameoff"><div class="cameoff__k">Came off</div><p class="cameoff__car">${esc(l.cameOff.text)}</p><p>${esc(l.cameOff.why)}</p></div>` : `<div class="cameoff"><div class="cameoff__k">Drives</div><p class="cameoff__car">${esc(s.car)}</p><p>Sells what ${esc(s.first)} outgrows.</p></div>`}`;
    $$('[data-p-sellername]').forEach((e) => { e.textContent = s.first; });
    $$('[data-p-total]').forEach((e) => { e.textContent = money(l.price); });

    const verdict = $('[data-p-verdict]');
    function renderVerdict(animate) {
      const car = getCar();
      const f = fitFor(l, car);
      let head;
      if (!car) head = 'Does it fit yours?';
      else if (f.v === 'fits') head = `Fits your ${car.label}.`;
      else if (f.v === 'universal') head = `Fits your ${car.label}. It fits most things.`;
      else if (f.v === 'adapter') head = `Fits your ${car.label}, with an adapter.`;
      else if (f.v === 'no') head = `Doesn’t fit your ${car.label}.`;
      else head = `Not listed for the ${car.label}.`;
      let extra = '';
      if (car && car.key && f.v === 'no') {
        const sib = LISTINGS.find((x) => x.id !== l.id && x.title === l.title && x.fit && x.fit[car.key] && x.fit[car.key][0] === 'fits');
        if (sib) extra = ` <a class="tlink" href="${esc(withCar('part.html?id=' + sib.id))}">${esc(SELLERS[sib.seller].first)} has the ${esc(PLATFORMS[car.key].short)} version for ${money(sib.price)} <span class="btn__arrow">→</span></a>`;
        else extra = ` <a class="tlink" href="${esc(withCar('market.html?fit=fits'))}">See what does fit <span class="btn__arrow">→</span></a>`;
      }
      if (!car) extra = ' <button class="tlink" type="button" data-open-chip>Tell us what you drive</button>';
      verdict.className = `verdict-xl is-${f.v}`;
      verdict.innerHTML = `<div class="verdict-xl__head"><i class="verdict-xl__mark" aria-hidden="true"></i><span>${esc(head)}</span></div><p>${esc(f.note)}${extra}</p>`;
      if (animate && !reduced() && verdict.animate) verdict.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)' });
      const saveBtn = $('[data-p-save]');
      const on = car && savedFor(car).includes(l.id);
      saveBtn.setAttribute('aria-pressed', String(!!on));
      saveBtn.textContent = on ? `Saved to your ${car.label}` : (car ? `Save to your ${car.label}` : 'Save to your garage');
      // more for your car
      const more = $('[data-p-more]'), moreT = $('[data-p-more-title]');
      const others = sortByFit(LISTINGS.filter((x) => x.id !== l.id), car).slice(0, 4);
      moreT.textContent = car ? `More for your ${car.label}` : `More on DRVN`;
      flip(more, () => { more.innerHTML = others.map((x, i) => cardHTML(x, car, i)).join(''); });
    }
    const cartBtn = $('[data-cart-toggle]');
    cartBtn.dataset.cartToggle = l.id;
    syncAddButtons();
    cartBtn.addEventListener('click', () => { const on = toggleCart(l.id); syncAddButtons(); toast(on ? 'Added to your cart' : 'Removed from cart'); });
    $('[data-p-buy]').addEventListener('click', (e) => openCheckout([l], e.currentTarget));
    $('[data-p-save]').addEventListener('click', () => {
      const car = getCar();
      if (!car) { if (OQ.openChip) OQ.openChip(); return; }
      const on = toggleSaved(l.id, car);
      renderVerdict(false);
      toast(on ? `Saved to your ${car.label} in your garage` : 'Removed from your garage');
    });
    document.addEventListener('click', (e) => { if (e.target.closest('[data-open-chip]') && OQ.openChip) { e.stopPropagation(); OQ.openChip(); } });
    bindAdds($('[data-p-more]'));
    document.addEventListener('oq:car', () => renderVerdict(true));
    document.addEventListener('oq:cart', syncAddButtons);
    renderVerdict(false);
  }

  /* ======================================================= PAGE: garage */

  function pageGarage() {
    const tabs = $('[data-g-tabs]');
    const panels = $('[data-g-panels]');
    const wrap = $('[data-g-wrap]');
    const empty = $('[data-g-empty]');
    const plate = $('[data-g-plate]');
    let sel = 0;
    const keyOf = (g) => g.key || 'u:' + g.label.toLowerCase();

    function describe(g) {
      const p = g.key ? PLATFORMS[g.key] : null;
      return p ? { name: `${p.make} ${p.model}`, line: `${p.gen} · ${p.years} · ${p.engine}` } : { name: g.label, line: 'Not in our garage yet: universal parts first' };
    }
    function render(focusTab) {
      const car = getCar();
      const has = S.garage.length > 0;
      wrap.hidden = !has; empty.hidden = has;
      if (!has) { want('garage', { idle: true }); renderAdd(); return; }
      if (sel >= S.garage.length) sel = 0;
      tabs.innerHTML = S.garage.map((g, i) => {
        const primary = car && keyOf(car) === keyOf(g);
        return `<button type="button" class="tab" role="tab" id="gtab-${i}" aria-controls="gpanel-${i}" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}"><canvas data-gsil="${g.key || ''}" aria-hidden="true"></canvas><span class="tab__name">${esc(g.label)}</span><span class="tab__sub">${primary ? 'Your car' : (g.key ? PLATFORMS[g.key].make : 'Universal')}</span></button>`;
      }).join('');
      panels.innerHTML = S.garage.map((g, i) => {
        const d = describe(g);
        const primary = car && keyOf(car) === keyOf(g);
        const gcar = { key: g.key, label: g.label };
        const t = tally(gcar);
        const saved = savedFor(gcar).map(byId).filter(Boolean);
        const savedHTML = saved.length
          ? `<ul class="saved">${saved.map((l) => { const f = fitFor(l, gcar); return `<li><div class="line__img">${l.img ? `<img src="../assets/${l.img}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc((l.typeName || l.title).charAt(0))}</span>`}</div><div><a class="line__t" href="${esc(withCar('part.html?id=' + l.id))}">${esc(l.title)}</a><div class="line__m"><span class="verdict verdict--${f.v}"><i class="verdict__mark" aria-hidden="true"></i>${esc(verdictLabel(f.v, gcar))}</span></div></div><div class="line__p">${money(l.price)}</div></li>`; }).join('')}</ul>`
          : `<p class="dim" style="margin:0">Nothing saved for it yet. Hit “Save” on any part and it lands here.</p>`;
        const picks = sortByFit(LISTINGS, gcar).filter((l) => !saved.includes(l)).slice(0, 2);
        return `<div class="gpanel" role="tabpanel" id="gpanel-${i}" aria-labelledby="gtab-${i}" tabindex="0" ${i === sel ? '' : 'hidden'}>
  <div><p class="eyebrow">${esc(d.line)}</p><h2 class="h2">${esc(d.name)}</h2></div>
  <div class="gpanel__status">${primary ? '<span class="pillnote">Your car. Every page is talking to it.</span>' : `<button class="btn btn--primary btn--sm" type="button" data-primary="${i}">Make this my car</button>`}<button class="tlink tlink--quiet" type="button" data-remove="${i}">Remove from garage</button></div>
  <p class="lead">${g.key ? `<strong>${t.fits + t.universal}</strong> parts fit it right now, and <strong>${t.adapter}</strong> more with an adapter.` : `<strong>${t.universal}</strong> universal parts and <strong>${t.adapter}</strong> that fit with an adapter.`} <a class="tlink" data-keep href="market.html?car=${esc(encodeURIComponent(g.key || g.label))}">Shop for it <span class="btn__arrow">→</span></a></p>
  <div><h3 class="blockhead">Saved for this car</h3>${savedHTML}</div>
  ${picks.length ? `<div><h3 class="blockhead">Worth a look</h3><ul class="saved">${picks.map((l) => `<li><div class="line__img">${l.img ? `<img src="../assets/${l.img}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc((l.typeName || l.title).charAt(0))}</span>`}</div><div><a class="line__t" href="${esc(withCar('part.html?id=' + l.id))}">${esc(l.title)}</a><div class="line__m">${esc(verdictLabel(fitFor(l, gcar).v, gcar))}</div></div><div class="line__p">${money(l.price)}</div></li>`).join('')}</ul></div>` : ''}
</div>`;
      }).join('');
      $$('canvas[data-gsil]', tabs).forEach((c) => drawSil(c, c.dataset.gsil || null, { alpha: 0.3, stride: 4, rot: 0.3, fit: 0.98 }));
      select(sel, focusTab, true);
      renderAdd();
    }
    function select(i, focus, skipRender) {
      sel = i;
      $$('[role="tab"]', tabs).forEach((t, j) => { t.setAttribute('aria-selected', String(j === i)); t.tabIndex = j === i ? 0 : -1; });
      $$('[role="tabpanel"]', panels).forEach((p, j) => { p.hidden = j !== i; });
      const g = S.garage[i];
      if (!g) return;
      want('garage', { key: g.key || 'cloud' });
      const d = describe(g);
      plate.innerHTML = `<b>${esc(g.label)}</b><span>${esc(g.key ? PLATFORMS[g.key].make + ' · ' + PLATFORMS[g.key].years : 'Universal parts first')}</span>`;
      if (!skipRender) $$('canvas[data-gsil]', tabs).forEach((c) => drawSil(c, c.dataset.gsil || null, { alpha: 0.3, stride: 4, rot: 0.3, fit: 0.98 }));
      const tabEl = $(`#gtab-${i}`);
      if (tabEl && tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({ left: tabEl.offsetLeft - 16, behavior: reduced() ? 'auto' : 'smooth' });
      if (focus && tabEl) tabEl.focus({ preventScroll: true });
      void d;
    }
    tabs.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (!t) return; select($$('[role="tab"]', tabs).indexOf(t), false); });
    tabs.addEventListener('keydown', (e) => {
      const n = S.garage.length; let i = sel;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (sel + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (sel - 1 + n) % n;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else return;
      e.preventDefault(); select(i, true);
    });
    panels.addEventListener('click', (e) => {
      const p = e.target.closest('[data-primary]'), r = e.target.closest('[data-remove]');
      if (p) { const g = S.garage[Number(p.dataset.primary)]; setCar(g.key ? { key: g.key } : { label: g.label }, { source: 'garage' }); toast(`Every page now talks to your ${g.label}`); }
      if (r) {
        const idx = Number(r.dataset.remove); const g = S.garage[idx];
        S.garage.splice(idx, 1);
        const car = getCar();
        if (car && keyOf(car) === keyOf(g)) {
          const next = S.garage[0];
          save();
          if (next) setCar(next.key ? { key: next.key } : { label: next.label }, { source: 'garage' }); else setCar(null, { source: 'garage' });
        } else save();
        sel = Math.max(0, Math.min(sel, S.garage.length - 1));
        render(true);
        toast(`${g.label} removed from your garage`);
      }
    });

    function renderAdd() {
      $$('[data-g-add]').forEach((box) => {
        const missing = ORDER.filter((k) => !S.garage.some((g) => g.key === k));
        $('[data-g-quick]', box).innerHTML = missing.map((k) => `<button class="btn btn--ghost btn--sm" type="button" data-quick="${k}">+ ${esc(PLATFORMS[k].short)}</button>`).join('');
      });
    }
    function addCar(car) {
      const before = S.garage.length;
      addToGarage(car); save();
      const idx = S.garage.length > before ? S.garage.length - 1 : S.garage.findIndex((g) => (car.key ? g.key === car.key : g.label.toLowerCase() === tidyLabel(car.label).toLowerCase()));
      if (!getCar()) setCar(car, { source: 'garage' });
      sel = Math.max(0, idx);
      render(true);
      toast(`${S.garage[sel].label} is in your garage`);
    }
    $$('[data-g-add]').forEach((box) => {
      const form = $('form', box), input = $('input', box), m = $('[data-g-match]', box);
      input.addEventListener('input', () => { const v = input.value.trim(); const r = match(v); m.textContent = !v ? '' : r ? `${r.platform.make} ${r.platform.model} · ${r.platform.gen}` : (v.length >= 3 ? 'Not in our garage yet. We’ll add it anyway.' : ''); });
      form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) { input.focus(); return; } const r = match(v); addCar(r ? { key: r.key, label: r.platform.short } : { key: null, label: tidyLabel(v) }); input.value = ''; m.textContent = ''; });
      box.addEventListener('click', (e) => { const q = e.target.closest('[data-quick]'); if (q) addCar({ key: q.dataset.quick, label: PLATFORMS[q.dataset.quick].short }); });
    });
    document.addEventListener('oq:car', (e) => { if (e.detail.source !== 'garage') { const car = getCar(); if (car) sel = Math.max(0, S.garage.findIndex((g) => keyOf(g) === keyOf(car))); } render(false); });
    const car = getCar();
    if (car) sel = Math.max(0, S.garage.findIndex((g) => keyOf(g) === keyOf(car)));
    render(false);
  }

  /* ========================================================= PAGE: sell */

  function pageSell() {
    const flow = $('[data-flow]');
    const bar = $('[data-flow-bar]'), stepLabel = $('[data-flow-n]');
    const data = { what: '', price: '' };
    let steps = [], at = 0;
    function plan() { const car = getCar(); steps = (car ? [] : ['car']).concat(['what', 'price', 'review']); }
    function carName() { const c = getCar(); return c ? c.label : 'car'; }
    function show(name, focus = true) {
      at = steps.indexOf(name);
      $$('[data-step]', flow).forEach((s) => { s.hidden = s.dataset.step !== name; });
      const total = steps.length;
      const n = Math.min(at + 1, total);
      stepLabel.textContent = name === 'done' ? 'Listed' : `${n} of ${total}`;
      bar.style.setProperty('--p', (name === 'done' ? 100 : (at / total) * 100 + 8) + '%');
      $$('[data-carname]', flow).forEach((e) => { e.textContent = carName(); });
      if (name === 'price') hintPrice();
      if (name === 'review') review();
      const cur = $(`[data-step="${name}"]`, flow);
      $$('[data-back]', cur).forEach((b) => { b.hidden = at <= 0; });
      if (focus) { const t = $('input', cur) || $('h1, h2', cur); if (t) { if (!t.matches('input')) t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } }
    }
    function hintPrice() {
      const c = getCar();
      const same = LISTINGS.filter((l) => c && c.key && l.fit && l.fit[c.key] && l.fit[c.key][0] === 'fits');
      const h = $('[data-price-hint]');
      if (same.length) { const ps = same.map((l) => l.price).sort((a, b) => a - b); h.textContent = `Parts for ${PLATFORMS[c.key].plural} on DRVN are listed from ${money(ps[0])} to ${money(ps[ps.length - 1])}. Price it like you’d want to buy it.`; }
      else h.textContent = 'Price it like you’d want to buy it. You can change it later.';
    }
    function review() {
      $('[data-r-what]').textContent = data.what;
      $('[data-r-price]').textContent = money(Number(data.price));
      $('[data-r-net]').textContent = `You get ${money(Number(data.price) * 0.95)} after the 5% fee, paid 2 days after delivery.`;
    }
    const next = () => { if (at < steps.length - 1) show(steps[at + 1]); };
    const back = () => { if (at > 0) show(steps[at - 1]); };
    $$('[data-back]', flow).forEach((b) => b.addEventListener('click', back));
    $('[data-f-car]').addEventListener('submit', (e) => {
      e.preventDefault(); const i = $('#sell-car'); const v = i.value.trim(); if (!v) { i.focus(); return; }
      const r = match(v); setCar(r ? { key: r.key } : { label: v }, { source: 'sell' }); next();
    });
    $('#sell-car').addEventListener('input', (e) => { const v = e.target.value.trim(); const r = match(v); $('[data-car-hint]').textContent = !v ? 'It helps buyers trust what they’re getting.' : r ? `${r.platform.make} ${r.platform.model} · ${r.platform.gen}. ${r.platform.nod}` : (v.length >= 3 ? 'Not in our garage yet. That’s fine.' : ''); });
    $('[data-f-what]').addEventListener('submit', (e) => {
      e.preventDefault(); const i = $('#sell-what'); const v = i.value.trim();
      if (v.length < 3) { $('[data-what-hint]').textContent = 'A few words is plenty: “BC coilovers, 8k miles”.'; i.focus(); return; }
      data.what = v; next();
    });
    $('[data-what-opts]').addEventListener('click', (e) => { const b = e.target.closest('[data-opt]'); if (!b) return; const i = $('#sell-what'); i.value = b.dataset.opt; i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
    $('[data-f-price]').addEventListener('submit', (e) => {
      e.preventDefault(); const i = $('#sell-price'); const v = Number(String(i.value).replace(/[^\d.]/g, ''));
      if (!v || v < 5) { $('[data-price-hint]').textContent = 'What would you want for it? Whole dollars is fine.'; i.focus(); return; }
      data.price = String(Math.round(v)); next();
    });
    $('[data-f-review]').addEventListener('submit', (e) => {
      e.preventDefault();
      steps.push('done');
      show('done');
      $('[data-done-line]').textContent = getCar() ? `Buyers with ${getCar().key ? PLATFORMS[getCar().key].a + ' ' + getCar().label : 'the same car'} will see it first, and they’ll see it came off yours.` : 'Buyers will see exactly which car it came off.';
    });
    $('[data-again]').addEventListener('click', () => { data.what = ''; data.price = ''; $('#sell-what').value = ''; $('#sell-price').value = ''; plan(); show(steps[0]); });
    document.addEventListener('oq:car', () => { $$('[data-carname]', flow).forEach((e) => { e.textContent = carName(); }); });
    plan();
    show(steps[0], window.matchMedia('(pointer: fine)').matches);
  }

  /* ------------------------------------------------------------- boot */

  const OQ = {
    ORDER, PLATFORMS, LISTINGS, SELLERS, MEMBERS,
    match, completion, fitFor, verdictLabel, getCar, setCar,
    cloud, fogCloud, drawSil, registerStage, stage, want,
    reduced, money, toast
  };
  window.OQ = OQ;

  readUrlCar();
  initNav();
  decorateLinks();
  syncUrl();
  const page = document.body.dataset.page;
  ({ index: pageIndex, market: pageMarket, part: pagePart, garage: pageGarage, sell: pageSell }[page] || (() => {}))();
  reveal();
})();
