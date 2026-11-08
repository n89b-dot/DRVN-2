/* First Light — DRVN concept 18.
   One idea runs everything here: scroll position is time of day.
   --t (0→1) maps 05:12 → 06:40; the palette, the clock, the mark's sun and the hero fog all read from it. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var money = function (n) { return '$' + n.toLocaleString('en-US'); };

  /* ───────────────────────── data ───────────────────────── */
  var CARS = {
    '964':   { name: 'Porsche 911 (964)', short: '911 (964)', years: '1989–94' },
    'g':     { name: 'Porsche 911 Carrera 3.2', short: 'Carrera 3.2', years: '1984–89' },
    '993':   { name: 'Porsche 911 (993)', short: '911 (993)', years: '1994–98' },
    'dc2':   { name: 'Integra Type R (DC2)', short: 'Integra DC2', years: '1995–01' },
    'e30':   { name: 'BMW 3 Series (E30)', short: 'E30', years: '1982–94' },
    'e46':   { name: 'BMW M3 (E46)', short: 'E46 M3', years: '2000–06' },
    'na':    { name: 'Mazda MX-5 (NA)', short: 'NA Miata', years: '1989–97' },
    'mk7':   { name: 'Volkswagen Golf R (Mk7)', short: 'Golf R Mk7', years: '2015–19' }
  };
  var SELLERS = {
    theo: { name: 'Theo Lindqvist', handle: '@theo.964', city: 'Boulder, CO', car: 'Theo’s 1991 964' },
    jules: { name: 'Jules Ferreira', handle: '@jules.dc2', city: 'Fort Collins, CO', car: 'Jules’s 1998 Integra Type R' },
    sam: { name: 'Sam Whitaker', handle: '@e30.sam', city: 'Denver, CO', car: 'Sam’s 1989 E30 325is' },
    ana: { name: 'Ana Ruiz', handle: '@ana.carrera', city: 'Golden, CO', car: null },
    kenji: { name: 'Kenji Mori', handle: '@na.kenji', city: 'Lyons, CO', car: 'Kenji’s 1994 Miata' },
    mara: { name: 'Mara Okafor', handle: '@mara.s2k', city: 'Longmont, CO', car: null }
  };
  var A = '../assets/';
  // ord: minutes since listed (lower is newer)
  var LISTINGS = [
    { id: 'kw-clubsport', title: 'KW Clubsport 3-way coilovers', cat: 'Suspension', fits: ['964'], cond: 'Used', price: 2150, img: A + 'c18-bench.jpg', crop: 'crop-coil', seller: 'theo', when: 'Listed 05:41', ord: 19, note: '9,000 miles, rebuilt by KW in March', alt: 'Two KW Clubsport coilovers half-wrapped in brown paper on an oak bench' },
    { id: 'g50-shift', title: 'Short-shift kit, G50 gearbox', cat: 'Drivetrain', fits: ['964', 'g'], cond: 'Like new', price: 390, img: A + 'c18-bench.jpg', crop: 'crop-shift', seller: 'theo', when: 'Listed 05:44', ord: 16, note: '1,200 miles. Comes with new bushings', alt: 'A short-shift lever and linkage resting on brown paper' },
    { id: 'cover-964', title: 'Fitted indoor car cover, 964', cat: 'Care & storage', fits: ['964'], cond: 'Like new', price: 240, img: A + 'c18-garage-door.jpg', crop: 'crop-cover', seller: 'theo', when: 'Listed 05:47', ord: 13, note: 'Soft-lined, mirror pockets, storage bag', alt: 'A car under a fitted grey cover in a garage at dawn' },
    { id: 'fuchs-16', title: 'Fuchs 16" 7J & 8J, refinished', cat: 'Wheels & tyres', fits: ['964', 'g'], cond: 'Refurbished', price: 3900, seller: 'theo', when: 'Listed 05:52', ord: 8, type: ['Fuchs 16"', 'Set of four, 7J front and 8J rear. Refinished in the original anodised look. No curb rash.'], note: 'Set of four, no tyres' },
    { id: 'sw388', title: 'Spoon-style SW388 15" wheels, white', cat: 'Wheels & tyres', fits: ['dc2'], cond: 'Used', price: 680, img: A + 'c18-lay-by.jpg', crop: 'crop-dc2', seller: 'jules', when: 'Listed 06:03', ord: 4, note: '15×6.5 +45, Federal 595s at half tread', alt: 'A white five-spoke wheel on a dark green Integra Type R' },
    { id: 'b18c-header', title: 'B18C 4-2-1 header, stainless', cat: 'Exhaust & intake', fits: ['dc2'], cond: 'Used', price: 420, seller: 'jules', when: 'Listed 06:05', ord: 2, type: ['B18C header', '4-2-1, stainless. Came off when the Type R went back to stock manifold for emissions.'], note: 'Gaskets and studs included' },
    { id: 'dc2-strut', title: 'Front strut bar, carbon', cat: 'Suspension', fits: ['dc2'], cond: 'Used', price: 160, seller: 'jules', when: 'Yesterday', ord: 1500, type: ['Strut bar', 'Carbon tube, alloy ends. Clears the factory intake.'] },
    { id: 'sr3', title: 'Recaro SR3, Type R red', cat: 'Interior', fits: ['dc2'], cond: 'Used', price: 750, seller: 'jules', when: 'Oct 14', ord: 5400, type: ['Recaro SR3', 'Driver side, red cloth, one small bolster scuff. Side mounts included.'] },
    { id: 'bbs-rs', title: 'BBS RS 15" 7J, set of four', cat: 'Wheels & tyres', fits: ['e30'], cond: 'Used', price: 2600, img: A + 'c18-lay-by.jpg', crop: 'crop-e30', seller: 'sam', when: 'Listed 05:58', ord: 9, note: 'Rebuilt with new hardware in 2024', alt: 'A cross-spoke BBS wheel on a grey BMW E30' },
    { id: 'mtech2', title: 'M-Tech II front lip, original', cat: 'Body & lighting', fits: ['e30'], cond: 'Used', price: 310, seller: 'sam', when: 'Yesterday', ord: 1460, type: ['M-Tech II lip', 'Genuine BMW, not a reproduction. Two tabs repaired, otherwise clean.'] },
    { id: 'e30-lsd', title: '3.73 limited-slip diff, small case', cat: 'Drivetrain', fits: ['e30'], cond: 'Refurbished', price: 1150, seller: 'sam', when: 'Oct 15', ord: 4100, type: ['3.73 LSD', 'Small case, rebuilt clutch packs, fresh seals. Bolt-in for 325e/i.'] },
    { id: 'e30-bilstein', title: 'Bilstein Sport dampers, set', cat: 'Suspension', fits: ['e30'], cond: 'New', price: 540, seller: 'sam', when: 'Oct 12', ord: 8200, type: ['Bilstein Sport', 'Front inserts and rear shocks, still boxed.'] },
    { id: 'ducktail', title: 'RS-style ducktail decklid', cat: 'Body & lighting', fits: ['964', 'g'], cond: 'New', price: 1480, seller: 'ana', when: 'Listed 05:33', ord: 27, type: ['Ducktail', 'Fibreglass, primed, with grille and seal. Never fitted.'] },
    { id: 'h4-euro', title: 'Euro H4 headlights, pair', cat: 'Body & lighting', fits: ['964', 'g'], cond: 'Refurbished', price: 560, seller: 'ana', when: 'Yesterday', ord: 1390, type: ['Euro H4s', 'Bosch glass, new reflectors and seals. A pair.'] },
    { id: 'b6-rear', title: 'Bilstein B6 dampers, rear pair', cat: 'Suspension', fits: ['964', '993'], cond: 'New', price: 420, seller: 'ana', when: 'Oct 13', ord: 6900, type: ['Bilstein B6', 'Rear pair, boxed. For torsion-bar setups.'] },
    { id: 'p-zero', title: 'P Zero Rosso N-spec, 205/55 & 225/50 R16', cat: 'Wheels & tyres', fits: ['964', 'g'], cond: 'Used', price: 380, seller: 'ana', when: 'Oct 15', ord: 4300, type: ['P Zero Rosso', 'N-spec, 2023 date code, about 60% left. Set of four.'] },
    { id: '993-plenum', title: 'Varioram intake plenum, 993', cat: 'Exhaust & intake', fits: ['993'], cond: 'Used', price: 890, seller: 'ana', when: 'Oct 11', ord: 9600, type: ['Varioram plenum', 'Cleaned, flaps checked, new gaskets.'] },
    { id: 'ceramic', title: 'Ceramic coating kit, unopened', cat: 'Care & storage', fits: ['all'], cond: 'New', price: 95, img: A + 'c18-dew.jpg', crop: 'crop-dew', seller: 'kenji', when: 'Listed 06:01', ord: 6, note: 'Fits any car. Bought two by mistake', alt: 'Dew beading on a silver bonnet at sunrise' },
    { id: 'ctek', title: 'CTEK MXS 5.0 battery tender', cat: 'Care & storage', fits: ['all'], cond: 'Like new', price: 45, seller: 'sam', when: 'Oct 16', ord: 2600, type: ['CTEK MXS 5.0', 'With the ring-terminal lead. For the car that sleeps all week.'] },
    { id: 'na-hardtop', title: 'Factory hardtop, Classic Red', cat: 'Body & lighting', fits: ['na'], cond: 'Used', price: 1350, seller: 'kenji', when: 'Yesterday', ord: 1300, type: ['NA hardtop', 'Classic Red, glass rear window, headliner intact. Local pickup in Lyons.'] },
    { id: 'na-exhaust', title: 'Racing Beat exhaust, NA', cat: 'Exhaust & intake', fits: ['na'], cond: 'Used', price: 290, seller: 'kenji', when: 'Oct 14', ord: 5600, type: ['Racing Beat', 'Power Pulse cat-back. Quiet until it isn’t.'] },
    { id: 'csl-airbox', title: 'CSL-style carbon airbox', cat: 'Exhaust & intake', fits: ['e46'], cond: 'Used', price: 1100, seller: 'sam', when: 'Oct 10', ord: 11000, type: ['CSL airbox', 'Carbon, with the snorkel and MAF adapter. Needs a tune.'] },
    { id: 'is20', title: 'IS20 turbo, Golf R Mk7, 31k miles', cat: 'Exhaust & intake', fits: ['mk7'], cond: 'Used', price: 340, img: A + 'c18-bench-turbo.jpg', crop: '', seller: 'theo', off: 'Theo’s 2015 Golf R', when: 'Listed 06:12', ord: 3, note: 'Came off the daily for an IS38. No shaft play', alt: 'A used turbocharger on a workbench beside centre caps, a torque wrench and a steaming coffee' },
    { id: 'mk7-winter', title: 'Golf R winter wheels on Blizzak WS90', cat: 'Wheels & tyres', fits: ['mk7'], cond: 'Used', price: 720, seller: 'mara', when: 'Yesterday', ord: 1350, type: ['Winter set', '18" Pretoria replicas on Blizzak WS90, one season. Ready before the first snow.'] },
    { id: 'mk7-paddles', title: 'DSG paddle extensions, Mk7', cat: 'Interior', fits: ['mk7'], cond: 'New', price: 85, seller: 'mara', when: 'Oct 15', ord: 4500, type: ['Paddle extensions', 'Machined aluminium, clip-on. Still in the bag.'] },
    { id: 'momo', title: 'Momo Prototipo 350mm, with hub', cat: 'Interior', fits: ['964', 'g'], cond: 'Used', price: 340, seller: 'theo', when: 'Sold Sept 21', ord: 40000, sold: true, type: ['Momo Prototipo', '350mm, leather rim re-stitched. Sold to a 3.2 in Laramie.'] },
    { id: 'lid-struts', title: 'Front lid struts, 964, pair', cat: 'Body & lighting', fits: ['964'], cond: 'New', price: 60, seller: 'theo', when: 'Sold yesterday', ord: 1400, sold: true, type: ['Lid struts', 'Stabilus, a pair. Bought two sets. Sold to Kenji.'] },
    { id: 'tray-964', title: 'Rear parcel shelf delete', cat: 'Interior', fits: ['964'], cond: 'Used', price: 180, seller: 'theo', when: 'Sold Aug 30', ord: 60000, sold: true, type: ['Shelf delete', 'Carpeted panel, black. Sold.'] }
  ];
  var byId = function (id) { for (var i = 0; i < LISTINGS.length; i++) if (LISTINGS[i].id === id) return LISTINGS[i]; return null; };
  var fitsCar = function (l, car) { return !car || l.fits.indexOf('all') > -1 || l.fits.indexOf(car) > -1; };
  var fitsLabel = function (l) {
    if (l.fits.indexOf('all') > -1) return 'Fits any car';
    return 'Fits ' + l.fits.map(function (c) { return CARS[c].short; }).join(', ');
  };
  var SHIP = { 'is20': 22, 'kw-clubsport': 85, 'fuchs-16': 140, 'bbs-rs': 120, 'na-hardtop': 0, 'ducktail': 110 };
  var shipFor = function (l) { return SHIP[l.id] !== undefined ? SHIP[l.id] : (l.price > 600 ? 65 : 18); };

  /* ───────────────────────── safe storage ───────────────────────── */
  var store = {
    get: function (k, d) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable: state stays in memory */ } }
  };

  /* ───────────────────────── time of day ───────────────────────── */
  // Dawn runs 05:12 → 06:40. Night (Pass 3) is the hour before: 04:20 → 05:10.
  var THEMES = {
    dawn: { key: 'dawn', start: 5 * 60 + 12, span: 88, phases: [[.3, 'blue hour'], [.56, 'first light'], [.8, 'sunrise'], [9, 'morning']] },
    night: { key: 'night', start: 4 * 60 + 20, span: 50, phases: [[.36, 'night'], [.74, 'moonlight'], [9, 'first glow']] }
  };
  var TH = THEMES.dawn;
  var phaseOf = function (t) { for (var i = 0; i < TH.phases.length; i++) if (t < TH.phases[i][0]) return TH.phases[i][1]; return ''; };
  var timeOf = function (t) {
    var m = TH.start + Math.round(clamp(t, 0, 1) * TH.span);
    var h = Math.floor(m / 60), mm = m % 60;
    return '0' + h + ':' + (mm < 10 ? '0' : '') + mm;
  };
  var clockEls = [], phaseEls = [];
  var tNow = 0, tTarget = 0, tRaf = 0, lastMin = -1;
  var maxScroll = function () { return Math.max(1, document.documentElement.scrollHeight - window.innerHeight); };

  var lastT = -1;
  function writeT(t) {
    if (Math.abs(t - lastT) < .0025 && t !== tTarget) return;
    lastT = t;
    root.style.setProperty('--t', t.toFixed(4));
    var min = Math.round(t * TH.span) + (TH === THEMES.night ? 1000 : 0);
    if (min !== lastMin) {
      lastMin = min;
      var s = timeOf(t), p = phaseOf(t);
      clockEls.forEach(function (el) { el.textContent = s; });
      phaseEls.forEach(function (el) { el.textContent = p; });
    }
  }
  function stepT() {
    tNow += (tTarget - tNow) * .16;
    if (Math.abs(tTarget - tNow) < .0005) { tNow = tTarget; tRaf = 0; } else { tRaf = requestAnimationFrame(stepT); }
    writeT(tNow);
  }
  function onScrollT() {
    tTarget = clamp(window.scrollY / maxScroll(), 0, 1);
    if (!tRaf) tRaf = requestAnimationFrame(stepT);
  }
  // Section labels print the time at which they reach the reading line
  function stampTimes() {
    var max = maxScroll();
    $$('[data-at]').forEach(function (el) {
      var y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * .35;
      el.textContent = reduced ? timeOf(.65) : timeOf(clamp(y / max, 0, 1));
    });
  }
  function initTime() {
    clockEls = $$('[data-clock]');
    phaseEls = $$('[data-phase]');
    if (reduced) { writeT(.65); stampTimes(); return; }
    tNow = tTarget = clamp(window.scrollY / maxScroll(), 0, 1);
    writeT(tNow);
    window.addEventListener('scroll', onScrollT, { passive: true });
    window.addEventListener('resize', function () { onScrollT(); stampTimes(); });
    stampTimes();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { stampTimes(); onScrollT(); });
    window.addEventListener('load', function () { stampTimes(); onScrollT(); });
  }


  /* ───────────────────────── Pass 3: theme (dawn / night) ───────────────────────── */
  var darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  var themeHooks = [];
  function isDark() {
    var a = root.getAttribute('data-theme');
    if (a === 'dark') return true;
    if (a === 'light') return false;
    return darkMQ.matches;
  }
  function applyTheme() {
    var dark = isDark();
    var next = dark ? THEMES.night : THEMES.dawn;
    $$('[data-theme-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', String(dark)); });
    if (next === TH) return;
    TH = next;
    lastMin = -1; lastT = -1;
    writeT(reduced ? .65 : tNow);
    stampTimes();
    themeHooks.forEach(function (fn) { fn(dark); });
  }
  // Photos with a night version (the 964 at the hairpin) swap with the theme
  function swapNightImages() {
    var dark = isDark();
    $$('img[data-src-night]').forEach(function (im) {
      if (!im.getAttribute('data-src-dawn')) im.setAttribute('data-src-dawn', im.getAttribute('src'));
      var want = dark ? im.getAttribute('data-src-night') : im.getAttribute('data-src-dawn');
      if (im.getAttribute('src') !== want) im.setAttribute('src', want);
    });
  }
  themeHooks.push(swapNightImages);
  function initTheme() {
    TH = isDark() ? THEMES.night : THEMES.dawn;
    swapNightImages();
    $$('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(isDark()));
      b.addEventListener('click', function () {
        var want = isDark() ? 'light' : 'dark';
        if (!reduced) {
          root.classList.add('theme-fade');
          clearTimeout(initTheme.t);
          initTheme.t = setTimeout(function () { root.classList.remove('theme-fade'); }, 1400);
        }
        root.setAttribute('data-theme', want);
        store.set('fl-theme', want);
        announce(want === 'dark' ? 'Night. The hour before dawn.' : 'Dawn.');
      });
    });
    // The artifact viewer (or anyone) may set data-theme on <html>: follow it either way.
    if ('MutationObserver' in window) new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);
  }

  /* ───────────────────────── nav ───────────────────────── */
  function initNav() {
    var nav = $('[data-nav]');
    if (!nav) return;
    var btn = $('[data-menu]', nav), sheet = $('#menu');
    if (btn && sheet) {
      var close = function () { btn.setAttribute('aria-expanded', 'false'); sheet.hidden = true; nav.classList.remove('is-open'); };
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        sheet.hidden = !open;
        nav.classList.toggle('is-open', open);
        if (open) { var f = $('a', sheet); if (f) f.focus(); }
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) { close(); btn.focus(); } });
      window.matchMedia('(min-width: 921px)').addEventListener('change', function (m) { if (m.matches) close(); });
    }
    if (nav.classList.contains('nav--over')) {
      var hero = $('[data-hero]');
      var solid = function () { nav.classList.toggle('is-solid', !hero || window.scrollY > hero.offsetHeight - nav.offsetHeight - 40); };
      window.addEventListener('scroll', solid, { passive: true });
      solid();
    }
    var q = new URLSearchParams(location.search).get('q');
    if (q) $$('input[name="q"]').forEach(function (i) { i.value = q; });
  }

  /* ───────────────────────── reveal (fog dissolve) ───────────────────────── */
  var revealIO = null;
  function observeReveals(scope) {
    var els = $$('[data-reveal]:not(.is-in)', scope);
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); revealIO.unobserve(en.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    }
    els.forEach(function (el) { revealIO.observe(el); });
  }
  // Fast flings can skip a frame where an element intersects; catch anything already passed once scrolling settles.
  var settleTimer = 0;
  function settleReveals() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      var vh = window.innerHeight;
      $$('[data-reveal]:not(.is-in)').forEach(function (el) {
        if (el.offsetParent === null) return;
        if (el.getBoundingClientRect().top < vh) { el.classList.add('is-in'); if (revealIO) revealIO.unobserve(el); }
      });
    }, 180);
  }
  window.addEventListener('scroll', settleReveals, { passive: true });

  /* ───────────────────────── cards ───────────────────────── */
  function cardHTML(l, i) {
    var s = SELLERS[l.seller];
    var frame = l.img
      ? '<img src="' + l.img + '" alt="' + l.alt + '" class="' + (l.crop || '') + '" loading="lazy" decoding="async">'
      : '<div class="lcard__type"><i class="label">' + l.cat + '</i><b>' + l.type[0] + '</b><span>' + l.type[1] + '</span></div>';
    var add = l.sold ? '' : '<button type="button" class="lcard__add" data-add="' + l.id + '" aria-label="Add ' + l.title.replace(/"/g, '&quot;') + ' to bag">Add to bag</button>';
    var off = (l.off || s.car) && l.fits.indexOf('all') < 0 ? '<p class="lcard__off">Off ' + (l.off || s.car) + '</p>' : '<p class="lcard__off">From ' + s.handle + ', ' + s.city.split(',')[0] + '</p>';
    return '<article class="lcard' + (l.sold ? ' is-sold' : '') + '" data-reveal style="--d:' + ((i % 4) * 90) + 'ms">' +
      '<div class="lcard__frame">' + frame + add + '</div>' +
      '<div class="lcard__body">' +
        '<p class="lcard__when label">' + l.when + '</p>' +
        '<h3 class="lcard__title"><a href="part.html">' + l.title + '</a></h3>' +
        '<p class="lcard__price price">' + money(l.price) + '</p>' +
        '<p class="lcard__meta">' + fitsLabel(l) + ' · ' + l.cond + '</p>' + off +
      '</div></article>';
  }
  function renderInto(el, list) {
    var n = Math.max(1, list.length - 1);
    el.innerHTML = list.map(function (l, i) { return cardHTML(l, i).replace('style="--d:', 'style="--k:' + (i / n).toFixed(3) + ';--d:'); }).join('');
    syncAddButtons();
    observeReveals(el);
  }
  function initLists() {
    $$('[data-list]').forEach(function (el) {
      var kind = el.getAttribute('data-list');
      var list;
      if (kind === 'fresh') list = ['kw-clubsport', 'fuchs-16', 'sw388', 'cover-964'].map(byId);
      else if (kind === 'theo') list = LISTINGS.filter(function (l) { return l.seller === 'theo'; });
      else if (kind === 'theo-more') list = ['g50-shift', 'fuchs-16', 'cover-964'].map(byId);
      else return;
      renderInto(el, list);
    });
  }

  /* ───────────────────────── bag + checkout drawer ───────────────────────── */
  var bag = store.get('fl-bag', []).filter(function (id) { return byId(id) && !byId(id).sold; });
  var drawer = null, drawerOpener = null, mode = 'bag', buyNowId = null;

  function syncAddButtons() {
    $$('[data-add]').forEach(function (b) {
      var inBag = bag.indexOf(b.getAttribute('data-add')) > -1;
      b.classList.toggle('is-added', inBag);
      var label = b.getAttribute('data-label-add') || 'Add to bag';
      b.textContent = inBag ? 'In your bag' : label;
    });
  }
  function syncCount(bump) {
    $$('[data-bag-count]').forEach(function (el) {
      el.textContent = bag.length;
      el.classList.toggle('has', bag.length > 0);
      if (bump && !reduced) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    $$('[data-bag-open]').forEach(function (b) { b.setAttribute('aria-label', 'Bag, ' + bag.length + (bag.length === 1 ? ' item' : ' items')); });
  }
  function addToBag(id) {
    if (bag.indexOf(id) > -1) { openDrawer('bag', null); return; }
    bag.push(id); store.set('fl-bag', bag); syncCount(true); syncAddButtons();
    announce(byId(id).title + ' added to your bag.');
  }
  function announce(msg) {
    var live = $('#live');
    if (!live) { live = document.createElement('p'); live.id = 'live'; live.className = 'sr'; live.setAttribute('aria-live', 'polite'); document.body.appendChild(live); }
    live.textContent = ''; setTimeout(function () { live.textContent = msg; }, 30);
  }

  function buildDrawer() {
    drawer = document.createElement('dialog');
    drawer.className = 'drawer';
    drawer.setAttribute('aria-labelledby', 'drawer-title');
    drawer.innerHTML = '<div class="drawer__in"><div class="drawer__head"><h2 id="drawer-title">Your bag</h2>' +
      '<button type="button" class="iconbtn" data-close aria-label="Close"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></div>' +
      '<div class="drawer__body" data-dbody></div><div class="drawer__foot" data-dfoot></div></div>';
    document.body.appendChild(drawer);
    drawer.addEventListener('click', function (e) {
      if (e.target === drawer) closeDrawer();
      var x = e.target.closest('[data-close]'); if (x) closeDrawer();
      var rm = e.target.closest('[data-remove]');
      if (rm) { bag = bag.filter(function (id) { return id !== rm.getAttribute('data-remove'); }); store.set('fl-bag', bag); syncCount(false); syncAddButtons(); paint(); var c = $('[data-close]', drawer); if (c) c.focus(); }
      if (e.target.closest('[data-to-checkout]')) { mode = 'checkout'; paint(); focusFirst(); }
      if (e.target.closest('[data-to-bag]')) { mode = 'bag'; buyNowId = null; paint(); focusFirst(); }
    });
    drawer.addEventListener('cancel', function (e) { e.preventDefault(); closeDrawer(); });
    drawer.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    drawer.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var items = currentItems(), tot = totals(items);
      var who = items.length === 1 ? SELLERS[items[0].seller].name.split(' ')[0] : 'each seller';
      if (!buyNowId) { bag = []; store.set('fl-bag', bag); syncCount(false); syncAddButtons(); }
      mode = 'done';
      paint({ total: tot.total, who: who });
      focusFirst();
    });
  }
  function focusables() {
    return $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', drawer)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }
  function focusFirst() { var f = focusables(); var target = f[1] || f[0]; if (target) target.focus(); }
  function currentItems() { return buyNowId ? [byId(buyNowId)] : bag.map(byId); }
  function totals(items) {
    var sub = 0, ship = 0;
    items.forEach(function (l) { sub += l.price; ship += shipFor(l); });
    var tax = Math.round(sub * .0405);
    return { sub: sub, ship: ship, tax: tax, total: sub + ship + tax };
  }
  function lineHTML(l, removable) {
    var img = l.img ? '<img src="' + l.img + '" alt="" class="' + (l.crop || '') + '">' : l.type[0].split(' ')[0];
    var s = SELLERS[l.seller];
    return '<li class="line"><div class="line__img">' + img + '</div><div><p class="line__t">' + l.title + '</p><p class="line__s">' + s.handle + ' · ships from ' + s.city + '</p></div>' +
      '<div class="line__r"><span class="price">' + money(l.price) + '</span>' + (removable ? '<button type="button" class="line__x" data-remove="' + l.id + '">Remove<span class="sr"> ' + l.title + '</span></button>' : '') + '</div></li>';
  }
  function sumHTML(t) {
    return '<dl class="sum"><div><dt>Parts</dt><dd>' + money(t.sub) + '</dd></div><div><dt>Shipping</dt><dd>' + (t.ship ? money(t.ship) : 'Local pickup') + '</dd></div>' +
      '<div><dt>Buyer protection</dt><dd>Included</dd></div><div><dt>Estimated tax</dt><dd>' + money(t.tax) + '</dd></div>' +
      '<div class="total"><dt>Total</dt><dd class="price">' + money(t.total) + '</dd></div></dl>';
  }
  function paint(extra) {
    var body = $('[data-dbody]', drawer), foot = $('[data-dfoot]', drawer), title = $('#drawer-title', drawer);
    var items = currentItems(), t = totals(items);
    if (mode === 'bag') {
      title.innerHTML = 'Your <em>bag</em>';
      if (!items.length) {
        body.innerHTML = '<div class="bag-empty"><p class="h3">Nothing here yet.</p><p>The best parts tend to go before breakfast.</p><a class="btn btn--sun" href="market.html">Browse the marketplace</a></div>';
        foot.innerHTML = '';
        return;
      }
      body.innerHTML = '<ul>' + items.map(function (l) { return lineHTML(l, true); }).join('') + '</ul>' + sumHTML(t);
      foot.innerHTML = '<button type="button" class="btn btn--sun btn--block" data-to-checkout>Checkout · <span class="price">' + money(t.total) + '</span></button>';
    } else if (mode === 'checkout') {
      var one = items.length === 1 ? SELLERS[items[0].seller].name.split(' ')[0] : 'each seller';
      title.innerHTML = '<em>Checkout</em>';
      body.innerHTML = '<ul>' + items.map(function (l) { return lineHTML(l, false); }).join('') + '</ul>' + sumHTML(t) +
        '<p class="hold"><b>Held until it arrives.</b> Your ' + money(t.total) + ' sits with DRVN, not the seller. When the box lands you have two days to check it; then ' + one + ' is paid. If it isn’t as described, the money comes back to you.</p>' +
        '<form class="addr" id="addr" novalidate><h3>Where should it go?</h3>' +
        '<div class="field"><label for="co-name">Full name</label><input id="co-name" name="name" autocomplete="name" required></div>' +
        '<div class="field"><label for="co-street">Street address</label><input id="co-street" name="street" autocomplete="street-address" required></div>' +
        '<div class="row3"><div class="field"><label for="co-city">City</label><input id="co-city" name="city" autocomplete="address-level2" required></div>' +
        '<div class="field"><label for="co-state">State</label><input id="co-state" name="state" autocomplete="address-level1" maxlength="2" required></div>' +
        '<div class="field"><label for="co-zip">ZIP</label><input id="co-zip" name="zip" autocomplete="postal-code" inputmode="numeric" pattern="[0-9]{5}" required></div></div>' +
        '<div class="field"><label for="co-email">Email for tracking</label><input id="co-email" name="email" type="email" autocomplete="email" required></div></form>';
      foot.innerHTML = '<button type="submit" form="addr" class="btn btn--sun btn--block">Place order · <span class="price">' + money(t.total) + '</span></button>' +
        (buyNowId ? '' : '<p style="margin-top:12px;text-align:center"><button type="button" class="line__x" data-to-bag>Back to bag</button></p>');
    } else {
      title.innerHTML = 'Order <em>placed</em>';
      var tot = extra ? extra.total : t.total, who = extra ? extra.who : 'the seller';
      body.innerHTML = '<div class="ok"><h3>It’s on its way <em>to you.</em></h3><p><span class="price">' + money(tot) + '</span> is held by DRVN until delivery. ' +
        (who === 'each seller' ? 'Each seller has been told.' : who + ' has been told, and usually ships before 7 a.m.') + '</p><p>We’ll email tracking as soon as there is some. Two days after it arrives, ' + (who === 'each seller' ? 'the sellers are' : who + ' is') + ' paid.</p></div>';
      foot.innerHTML = '<button type="button" class="btn btn--quiet btn--block" data-close>Done</button>';
      buyNowId = null;
    }
  }
  function openDrawer(m, opener, id) {
    if (!drawer) buildDrawer();
    mode = m; buyNowId = id || null; drawerOpener = opener || document.activeElement;
    paint();
    drawer.classList.remove('is-closing');
    if (typeof drawer.showModal === 'function') drawer.showModal(); else drawer.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
    focusFirst();
  }
  function closeDrawer() {
    if (!drawer || !drawer.open) return;
    var done = function () {
      drawer.classList.remove('is-closing');
      if (typeof drawer.close === 'function') drawer.close(); else drawer.removeAttribute('open');
      document.body.style.overflow = '';
      if (mode === 'done') mode = 'bag';
      if (drawerOpener && drawerOpener.focus) drawerOpener.focus();
    };
    if (reduced) { done(); return; }
    drawer.classList.add('is-closing');
    setTimeout(done, 400);
  }
  function initBag() {
    syncCount(false);
    document.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add) { e.preventDefault(); addToBag(add.getAttribute('data-add')); return; }
      var open = e.target.closest('[data-bag-open]');
      if (open) { openDrawer('bag', open); return; }
      var buy = e.target.closest('[data-buy]');
      if (buy) openDrawer('checkout', buy, buy.getAttribute('data-buy'));
    });
  }

  /* ───────────────────────── market filters ───────────────────────── */
  function initMarket() {
    var grid = $('[data-market]');
    if (!grid) return;
    var form = $('[data-filters]'), countEl = $('[data-count]'), sortEl = $('[data-sort]');
    var fitsEl = $('[name="fits"]', form);
    var params = new URLSearchParams(location.search);
    var q = (params.get('q') || '').trim().toLowerCase();
    if (params.get('fits') && CARS[params.get('fits')]) fitsEl.value = params.get('fits');
    if (params.get('cat')) $$('[name="cat"]', form).forEach(function (c) { if (c.value === params.get('cat')) c.checked = true; });

    var live = LISTINGS.filter(function (l) { return !l.sold; });
    // category counts
    $$('[name="cat"]', form).forEach(function (c) {
      var n = live.filter(function (l) { return l.cat === c.value; }).length;
      var span = c.parentNode.querySelector('.n'); if (span) span.textContent = n;
    });

    var toggle = $('[data-filters-toggle]');
    if (toggle) {
      var mq = window.matchMedia('(max-width: 920px)');
      var setMode = function () { if (mq.matches) { form.hidden = toggle.getAttribute('aria-expanded') !== 'true'; } else { form.hidden = false; } };
      toggle.addEventListener('click', function () { toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true')); setMode(); });
      mq.addEventListener('change', setMode); setMode();
    }

    function apply() {
      var car = fitsEl.value;
      var cats = $$('[name="cat"]:checked', form).map(function (c) { return c.value; });
      var conds = $$('[name="cond"]:checked', form).map(function (c) { return c.value; });
      var min = parseFloat($('[name="min"]', form).value), max = parseFloat($('[name="max"]', form).value);
      var res = live.filter(function (l) {
        if (!fitsCar(l, car)) return false;
        if (cats.length && cats.indexOf(l.cat) < 0) return false;
        if (conds.length && conds.indexOf(l.cond) < 0) return false;
        if (!isNaN(min) && l.price < min) return false;
        if (!isNaN(max) && l.price > max) return false;
        if (q && (l.title + ' ' + l.cat + ' ' + fitsLabel(l)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      var s = sortEl.value;
      res.sort(function (a, b) {
        if (s === 'low') return a.price - b.price;
        if (s === 'high') return b.price - a.price;
        return a.ord - b.ord;
      });
      var active = (car ? 1 : 0) + cats.length + conds.length + (!isNaN(min) ? 1 : 0) + (!isNaN(max) ? 1 : 0);
      if (toggle) toggle.querySelector('[data-active]').textContent = active ? ' · ' + active : '';
      var what = res.length === 1 ? 'part' : 'parts';
      countEl.innerHTML = res.length + ' ' + what + (car ? (res.length === 1 ? ' that fits <em>' : ' that fit <em>') + (car === 'all' ? 'any car' : CARS[car].short) + '</em>' : '') + (q ? ' for “' + q.replace(/</g, '') + '”' : '');
      if (!res.length) {
        grid.innerHTML = '<div class="empty"><p class="h3">Nothing yet, <em>but it’s early.</em></p><p>New parts land every morning. Loosen a filter, or check back after the drive.</p><button type="button" class="btn btn--quiet" data-reset>Clear filters</button></div>';
      } else {
        renderInto(grid, res);
      }
      var u = new URLSearchParams();
      if (car) u.set('fits', car);
      if (cats.length === 1) u.set('cat', cats[0]);
      if (q) u.set('q', q);
      history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : ''));
    }
    function reset() {
      form.reset(); fitsEl.value = ''; q = '';
      $$('input[name="q"]').forEach(function (i) { i.value = ''; });
      apply();
    }
    form.addEventListener('change', apply);
    form.addEventListener('input', function (e) { if (e.target.type === 'number') apply(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
    sortEl.addEventListener('change', apply);
    document.addEventListener('click', function (e) { if (e.target.closest('[data-reset]')) reset(); });
    apply();
  }

  /* ───────────────────────── car picker (index) ───────────────────────── */
  function initPicker() {
    var sel = $('[data-picker]');
    if (!sel) return;
    var btn = $('[data-picker-go]');
    var set = function () {
      var c = CARS[sel.value];
      var n = LISTINGS.filter(function (l) { return !l.sold && fitsCar(l, sel.value); }).length;
      btn.innerHTML = 'Show ' + n + ' parts for the ' + c.short;
    };
    sel.addEventListener('change', set); set();
    $$('[data-carcount]').forEach(function (el) {
      var k = el.getAttribute('data-carcount');
      el.textContent = LISTINGS.filter(function (l) { return !l.sold && fitsCar(l, k); }).length;
    });
  }

  /* ───────────────────────── part page ───────────────────────── */
  var FIT = {
    '964-c2': ['yes', 'Fits. Direct bolt-in.', 'These came off a 964 Carrera 2. Front struts, rear dampers and top mounts all go straight on.'],
    '964-c4': ['yes', 'Fits. Direct bolt-in.', 'The Carrera 4 uses the same strut and damper pickups as the C2. Same kit, same rates.'],
    '964-turbo': ['maybe', 'Fits, with a note.', 'Bolts on, but the Turbo’s extra weight over the rear wants stiffer rear springs. Theo can point you to the right rates.'],
    '993': ['no', 'Doesn’t fit.', 'The 993’s multi-link rear needs its own kit. Try the 993 filter in the marketplace.'],
    'g': ['no', 'Doesn’t fit.', 'Torsion-bar Carrera 3.2s need a full coilover conversion. This kit isn’t one.'],
    'dc2': ['no', 'Doesn’t fit.', 'Different car entirely. There are DC2 suspension parts from Jules in the marketplace.'],
    'e30': ['no', 'Doesn’t fit.', 'Different strut and damper design. Sam has Bilstein Sports for the E30 listed.']
  };
  function initPart() {
    var sel = $('[data-fit]');
    if (sel) {
      var out = $('[data-verdict]');
      var show = function () {
        var v = FIT[sel.value];
        if (!v) { out.setAttribute('data-state', ''); out.querySelector('strong').textContent = 'Pick your car to check.'; out.querySelector('span').textContent = 'We match the part against the cars it was listed for.'; return; }
        out.setAttribute('data-state', v[0]);
        out.querySelector('strong').textContent = v[1];
        out.querySelector('span').textContent = v[2];
      };
      sel.addEventListener('change', function () { show(); store.set('fl-car', sel.value); });
      var saved = store.get('fl-car', '');
      if (saved && FIT[saved]) sel.value = saved;
      show();
    }
    var main = $('[data-gallery-main]');
    if (main) {
      var img = $('img', main), cap = $('[data-gallery-cap]');
      $$('[data-thumb]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('aria-current') === 'true') return;
          $$('[data-thumb]').forEach(function (o) { o.setAttribute('aria-current', 'false'); });
          b.setAttribute('aria-current', 'true');
          var swap = function () {
            img.src = b.getAttribute('data-src');
            img.alt = b.getAttribute('data-alt');
            img.className = b.getAttribute('data-crop') || '';
            if (cap) cap.textContent = b.getAttribute('data-cap');
            requestAnimationFrame(function () { main.classList.remove('is-misting'); });
          };
          if (reduced) { swap(); return; }
          main.classList.add('is-misting');
          setTimeout(swap, 360);
        });
      });
    }
  }

  /* ───────────────────────── garage tabs + follow ───────────────────────── */
  function initTabs() {
    $$('[role="tablist"]').forEach(function (list) {
      var tabs = $$('[role="tab"]', list);
      var select = function (tab, focus) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var p = document.getElementById(t.getAttribute('aria-controls'));
          if (p) { p.hidden = !on; if (on) { p.classList.remove('is-in'); void p.offsetWidth; p.classList.add('is-in'); observeReveals(p); } }
        });
        if (focus) tab.focus();
        stampTimes();
      };
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { select(t, false); });
        t.addEventListener('keydown', function (e) {
          var k = e.key, n = null;
          if (k === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
          else if (k === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (k === 'Home') n = tabs[0];
          else if (k === 'End') n = tabs[tabs.length - 1];
          if (n) { e.preventDefault(); select(n, true); }
        });
      });
      var hash = location.hash.replace('#', '');
      var start = tabs.filter(function (t) { return t.getAttribute('aria-controls') === hash; })[0];
      if (start) select(start, false);
    });
    initFollows();
  }
  // Follow buttons: one stored state per person, counts optional ([data-follow-n="key"])
  var follows = store.get('fl-follows', {});
  function syncFollows(scope) {
    $$('[data-follow]', scope).forEach(function (b) {
      var key = b.getAttribute('data-follow-key') || 'theo', on = !!follows[key];
      var base = parseInt(b.getAttribute('data-follow'), 10);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Following' : 'Follow';
      var n = $('[data-follow-n="' + key + '"]');
      if (n && !isNaN(base)) n.textContent = (base + (on ? 1 : 0)).toLocaleString('en-US') + ' followers';
    });
  }
  function initFollows() {
    syncFollows(document);
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-follow]');
      if (!b) return;
      var key = b.getAttribute('data-follow-key') || 'theo';
      follows[key] = !follows[key]; store.set('fl-follows', follows); syncFollows(document);
      announce((follows[key] ? 'Following ' : 'Unfollowed ') + (b.getAttribute('data-follow-name') || 'Theo') + '.');
    });
  }

  /* ───────────────────────── sell page ───────────────────────── */
  function initSell() {
    var form = $('[data-sell]');
    if (!form) return;
    var price = $('[name="price"]', form);
    var out = { gross: $('[data-gross]'), fee: $('[data-fee]'), net: $('[data-net]') };
    var calc = function () {
      var p = Math.max(0, Math.round(parseFloat(price.value) || 0));
      var fee = Math.round(p * .06);
      out.gross.textContent = money(p);
      out.fee.textContent = '−' + money(fee);
      out.net.textContent = money(p - fee);
    };
    price.addEventListener('input', calc); calc();
    var file = $('[name="photos"]', form), prev = $('[data-previews]');
    if (file && prev) file.addEventListener('change', function () {
      prev.innerHTML = '';
      Array.prototype.slice.call(file.files, 0, 6).forEach(function (f) {
        if (!/^image\//.test(f.type)) return;
        var im = document.createElement('img'); im.alt = 'Selected photo: ' + f.name; im.src = URL.createObjectURL(f); prev.appendChild(im);
      });
      var lab = $('[data-drop-label]'); if (lab) lab.textContent = file.files.length + (file.files.length === 1 ? ' photo' : ' photos') + ' ready';
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var done = $('[data-sell-done]');
      $('[data-sell-title]', done).textContent = $('[name="title"]', form).value;
      $('[data-sell-time]', done).textContent = timeOf(tNow || .3);
      form.hidden = true; done.hidden = false;
      var h = $('h2', done); h.setAttribute('tabindex', '-1'); h.focus();
      window.scrollTo({ top: done.getBoundingClientRect().top + window.scrollY - 120, behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  /* ───────────────────────── Pass 2: feed (explore + home) ───────────────────────── */
  var MEMBERS = {
    theo: { name: 'Theo Lindqvist', handle: '@theo.964', city: 'Boulder', near: true, i: 'T' },
    jules: { name: 'Jules Ferreira', handle: '@jules.dc2', city: 'Fort Collins', near: false, i: 'J' },
    sam: { name: 'Sam Whitaker', handle: '@e30.sam', city: 'Denver', near: false, i: 'S' },
    ana: { name: 'Ana Ruiz', handle: '@ana.carrera', city: 'Golden', near: true, i: 'A' },
    kenji: { name: 'Kenji Mori', handle: '@na.kenji', city: 'Lyons', near: true, i: 'K' },
    mara: { name: 'Mara Okafor', handle: '@mara.s2k', city: 'Longmont', near: true, i: 'M' }
  };
  // In the order it happened: the feed runs forward through the morning, like the page.
  var FEED = [
    { id: 'f-miata', kind: 'build', who: 'theo', time: '05:14', car: '1991 MX-5, the project', carHref: 'garage.html', img: A + 'c18-miata.jpg', shape: 'tall', alt: 'A red NA MX-5 alone in a misty car park at blue hour', text: 'Bought it Thursday from a guy in Loveland. Classic Red, 118k, rust only where you’d expect. Project-car rules: no budget, no deadline.', links: [['market.html?fits=na', 'Parts for the NA']] },
    { id: 'f-b18c', kind: 'part', listing: 'b18c-header', time: '05:22' },
    { id: 'f-e30', kind: 'build', who: 'sam', time: '05:26', car: '1989 E30 325is', img: A + 'c18-e30-interior.jpg', shape: 'tall', alt: 'An E30 interior at dawn, condensation on the glass and a thin line of apricot light across the windscreen', text: 'Condensation on the inside at 5:20. The heater core is next on the list, apparently. The light coming over the hood made up for it.', links: [['market.html?fits=e30', 'E30 parts']] },
    { id: 'f-people', kind: 'people' },
    { id: 'f-993', kind: 'build', who: 'ana', time: '05:38', car: '1996 911 Carrera (993)', img: A + 'c18-993.jpg', shape: 'tall', alt: 'A silver 993 under a rural fuel-station canopy at blue hour', text: 'Fuel stop in Ward before Peak to Peak. The canopy lights make every car look like a press photo. The plenum I took off last month is still listed.', links: [['part.html', 'Varioram plenum, $890']] },
    { id: 'f-kw', kind: 'part', listing: 'kw-clubsport', time: '05:41' },
    { id: 'f-convoy', kind: 'build', who: 'theo', time: '05:52', car: 'The 5:30 club', carHref: 'garage.html', img: A + 'c18-convoy.jpg', shape: 'wide', alt: 'Four cars climbing a switchback above a sea of fog at sunrise, seen from above', text: 'Four of us up Flagstaff this week. Jules leading, which explains the pace. Fog sat at 6,000 feet the whole way.', links: [['car.html', 'Theo’s 964']] },
    { id: 'f-trending', kind: 'trending' },
    { id: 'f-sw388', kind: 'part', listing: 'sw388', time: '06:03' },
    { id: 'f-golf', kind: 'build', who: 'theo', time: '06:10', car: '2015 Golf R, the daily', carHref: 'garage.html', img: A + 'c18-golf.jpg', shape: 'wide', alt: 'A grey Golf R on a frosted gravel driveway at dawn, a kitchen window lit behind it', text: 'The daily earns its keep: 21°F, frost on the gravel, kitchen light on. The IS38 goes in this weekend and the IS20 is listed.', links: [['market.html?fits=mk7', 'Golf R parts']] },
    { id: 'f-is20', kind: 'part', listing: 'is20', time: '06:12' },
    { id: 'f-layby', kind: 'build', who: 'jules', time: '06:26', car: '1998 Integra Type R (DC2)', img: A + 'c18-lay-by.jpg', shape: 'wide', alt: 'A dark green Integra Type R and a grey E30 at a wet lay-by above a sea of cloud', text: 'Lay-by above Nederland. The cloud sat in the valley the whole way up, and Sam’s E30 found the only dry patch.', links: [['market.html?fits=dc2', 'DC2 parts']] },
    { id: 'f-hardtop', kind: 'part', listing: 'na-hardtop', time: '06:31' },
    { id: 'f-dew', kind: 'build', who: 'kenji', time: '06:38', car: '1994 MX-5 Miata', img: A + 'c18-dew.jpg', shape: 'tall', alt: 'Dew beads on a silver bonnet with the low sun on the horizon', text: 'Left it out overnight on purpose. Dew sits differently on paint you’ve just had corrected. Ceramic kit spare if anyone wants it.', links: [['part.html', 'Ceramic kit, $95']] }
  ];
  var PEOPLE = [
    { k: 'ana', car: '1996 993 Carrera' },
    { k: 'kenji', car: '1994 MX-5 Miata' },
    { k: 'mara', car: '2001 S2000, Golf R daily' }
  ];
  var TRENDING = [
    ['market.html?q=bilstein', 'Bilstein B6 for torsion-bar 911s', '41 saves'],
    ['market.html?fits=na', 'NA hardtops before winter', '28 saves'],
    ['explore.html', 'First frost on Flagstaff', '19 posts'],
    ['market.html?fits=mk7', 'IS38 swaps on the Mk7 R', '16 saves'],
    ['market.html?q=fuchs', 'Refinished Fuchs', '12 saves']
  ];
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  function whoHTML(m, time) {
    return '<header class="fpost__head"><span class="avatar" aria-hidden="true">' + m.i + '</span>' +
      '<p><span class="post__name">' + m.name + '</span><span class="post__handle">' + m.handle + ' · ' + m.city + '</span></p>' +
      '<time class="fpost__time" datetime="2026-10-25T' + time + '">' + time + '</time></header>';
  }
  function feedItemHTML(f, i) {
    var d = ' style="--d:' + ((i % 3) * 80) + 'ms"';
    if (f.kind === 'people') {
      return '<section class="interject" data-kind="people" data-reveal aria-label="People to follow"><p class="label">People to follow</p><ul class="people">' +
        PEOPLE.map(function (p) {
          var m = MEMBERS[p.k];
          return '<li class="person"><span class="avatar" aria-hidden="true">' + m.i + '</span><p><span class="post__name">' + m.name + '</span><span class="post__handle">' + m.handle + ' · ' + m.city + '</span><span class="person__car">' + p.car + '</span></p>' +
            '<button type="button" class="btn btn--quiet btn--sm" data-follow="" data-follow-key="' + p.k + '" data-follow-name="' + m.name + '" aria-pressed="false">Follow</button></li>';
        }).join('') + '</ul></section>';
    }
    if (f.kind === 'trending') {
      return '<section class="interject" data-kind="trending" data-reveal aria-label="Trending this week"><p class="label">Trending this week</p><ol class="trending">' +
        TRENDING.map(function (t) { return '<li><a href="' + t[0] + '"><span>' + t[1] + '</span><small>' + t[2] + '</small></a></li>'; }).join('') + '</ol></section>';
    }
    if (f.kind === 'part') {
      var l = byId(f.listing), s = SELLERS[l.seller], m = MEMBERS[l.seller];
      var media = l.img ? '<img src="' + l.img + '" alt="" class="' + (l.crop || '') + '" loading="lazy">' : '<b>' + l.type[0] + '</b>';
      return '<article class="fpart" data-kind="part" data-near="' + (m && m.near ? 1 : 0) + '" data-reveal' + d + '>' +
        '<p class="fpart__line label"><span class="fpart__dot" aria-hidden="true"></span>Listed by ' + s.handle + ' · <time datetime="2026-10-25T' + f.time + '">' + f.time + '</time></p>' +
        '<div class="fpart__body"><div class="fpart__img photo">' + media + '</div><div class="fpart__text">' +
        '<h3 class="fpart__title"><a href="part.html">' + l.title + '</a></h3><p class="lcard__meta">' + fitsLabel(l) + ' · ' + l.cond + '</p>' +
        ((l.off || s.car) && l.fits.indexOf('all') < 0 ? '<p class="lcard__off">Off ' + (l.off || s.car) + '</p>' : '') + '</div>' +
        '<p class="fpart__price price">' + money(l.price) + '</p></div></article>';
    }
    var mm = MEMBERS[f.who];
    var car = f.carHref ? '<a class="link" href="' + f.carHref + '">' + f.car + '</a>' : f.car;
    var links = (f.links || []).map(function (x) { return '<a class="link" href="' + x[0] + '">' + x[1] + '</a>'; }).join('');
    var src = f.img ? '<img src="' + f.img + '" alt="' + esc(f.alt) + '" loading="lazy" decoding="async">' : '';
    return '<article class="fpost fpost--' + f.shape + (f.isNew ? ' is-new' : '') + '" data-kind="build" data-near="' + (mm.near ? 1 : 0) + '" data-reveal' + d + '>' +
      whoHTML(mm, f.time) +
      '<div class="fpost__body"><figure class="fpost__photo photo">' + src + '</figure><div class="fpost__words">' +
      '<p class="fpost__car">' + car + '</p><p class="fpost__text">' + esc(f.text) + '</p>' +
      '<div class="fpost__foot"><button type="button" class="save" data-save="' + f.id + '" aria-pressed="false">Save<span class="sr"> ' + esc(mm.name) + '’s post</span></button>' + links + '</div>' +
      '</div></div></article>';
  }
  function renderFeed(el, items) {
    el.innerHTML = items.map(feedItemHTML).join('');
    syncFollows(el); syncSaves(el);
    observeReveals(el);
  }
  var saved = store.get('fl-saved', []);
  function syncSaves(scope) {
    $$('[data-save]', scope).forEach(function (b) {
      var on = saved.indexOf(b.getAttribute('data-save')) > -1;
      b.setAttribute('aria-pressed', String(on));
      b.firstChild.nodeValue = on ? 'Saved' : 'Save';
    });
  }
  function initFeeds() {
    $$('[data-feed]').forEach(function (el) {
      var kind = el.getAttribute('data-feed'), items;
      if (kind === 'explore') items = FEED;
      else if (kind === 'following') items = FEED.filter(function (f) { return f.kind === 'build' && f.who !== 'theo' && ['jules', 'sam', 'ana'].indexOf(f.who) > -1 || f.kind === 'people'; });
      else if (kind === 'foryou') items = FEED.filter(function (f) { if (f.kind !== 'part') return f.kind === 'trending'; var l = byId(f.listing); return l.seller !== 'theo' && (fitsCar(l, '964') || fitsCar(l, 'na') || fitsCar(l, 'mk7')); }).concat(['ducktail', 'b6-rear', 'mk7-winter'].map(function (id, i) { return { id: 'fy-' + id, kind: 'part', listing: id, time: ['06:14', '06:20', '06:33'][i] }; }));
      else if (kind === 'local') items = FEED.filter(function (f) { if (f.kind === 'part') { var m = MEMBERS[byId(f.listing).seller]; return m && m.near && byId(f.listing).seller !== 'theo'; } return f.kind === 'build' && MEMBERS[f.who].near && f.who !== 'theo'; });
      else return;
      if (kind === 'foryou') items.sort(function (a, b) { return (a.time || '99') < (b.time || '99') ? -1 : 1; });
      renderFeed(el, items);
    });
    document.addEventListener('click', function (e) {
      var sv = e.target.closest('[data-save]');
      if (sv) {
        var id = sv.getAttribute('data-save'), at = saved.indexOf(id);
        if (at > -1) saved.splice(at, 1); else saved.push(id);
        store.set('fl-saved', saved); syncSaves(document);
        announce(at > -1 ? 'Removed from saved.' : 'Saved.');
      }
    });
    // explore filters: All · Builds · Parts · Near me
    var bar = $('[data-feed-filter]'), feed = $('[data-feed="explore"]'), count = $('[data-feed-count]');
    if (bar && feed) {
      var apply = function (v) {
        $$('button', bar).forEach(function (b) { b.setAttribute('aria-pressed', String(b.value === v)); });
        var n = 0;
        $$('[data-kind]', feed).forEach(function (it) {
          var k = it.getAttribute('data-kind'), near = it.getAttribute('data-near') === '1';
          var show = v === 'all' || (v === 'builds' && k === 'build') || (v === 'parts' && k === 'part') || (v === 'near' && near && (k === 'build' || k === 'part'));
          it.hidden = !show;
          if (show && (k === 'build' || k === 'part')) { n++; it.classList.add('is-in'); }
        });
        var word = { all: 'posts this morning', builds: 'build updates', parts: 'parts listed', near: 'posts near Boulder' }[v];
        if (count) count.textContent = n + ' ' + word;
        stampTimes(); onScrollT();
      };
      bar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) apply(b.value); });
      apply('all');
    }
    $$('[data-rsvp]').forEach(function (b) {
      var n = $('[data-rsvp-n]'), base = parseInt(b.getAttribute('data-rsvp'), 10), on = store.get('fl-rsvp', false);
      var p = function () { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'You’re going' : 'I’m in'; if (n) n.textContent = (base + (on ? 1 : 0)) + ' going'; };
      b.addEventListener('click', function () { on = !on; store.set('fl-rsvp', on); p(); announce(on ? 'See you at 5:30.' : 'Maybe next week.'); });
      p();
    });
  }

  /* ───────────────────────── Pass 2: home ───────────────────────── */
  function initHome() {
    var form = $('[data-composer]');
    if (form) {
      var msg = $('[data-composer-msg]', form);
      var file = $('[name="upload"]', form);
      var uploadedSrc = null;
      if (file) file.addEventListener('change', function () {
        if (file.files[0] && /^image\//.test(file.files[0].type)) {
          uploadedSrc = URL.createObjectURL(file.files[0]);
          $$('[name="photo"]', form).forEach(function (r) { r.checked = false; });
          var lab = $('[data-upload-label]', form); if (lab) lab.textContent = file.files[0].name;
        }
      });
      $$('[name="photo"]', form).forEach(function (r) { r.addEventListener('change', function () { uploadedSrc = null; var lab = $('[data-upload-label]', form); if (lab) lab.textContent = 'Upload'; if (file) file.value = ''; }); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = $('[name="text"]', form), about = $('[name="about"]', form), pick = $('[name="photo"]:checked', form);
        var src = uploadedSrc || (pick ? pick.value : null);
        var problem = !text.value.trim() ? [text, 'Say what you did this morning.'] : !about.value ? [about, 'Pick the car or part this is about.'] : !src ? [$('[name="photo"]', form), 'Every post on DRVN has a photo. Pick one or upload your own.'] : null;
        if (problem) { msg.textContent = problem[1]; msg.setAttribute('data-state', 'error'); problem[0].focus(); return; }
        var opt = about.options[about.selectedIndex];
        var post = { id: 'mine-' + Date.now(), kind: 'build', who: 'theo', time: timeOf(reduced ? .65 : tNow), car: opt.text, carHref: opt.getAttribute('data-href') || 'garage.html', img: src, shape: pick && pick.getAttribute('data-shape') === 'wide' ? 'wide' : 'tall', alt: pick ? pick.getAttribute('data-alt') : 'Photo uploaded by Theo', text: text.value.trim(), links: [], isNew: true };
        var tab = $('#t-following'); if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
        var feed = $('[data-feed="following"]');
        feed.insertAdjacentHTML('afterbegin', feedItemHTML(post, 0));
        var el = feed.firstElementChild; el.classList.add('is-in'); syncSaves(feed);
        form.reset(); uploadedSrc = null;
        var lab = $('[data-upload-label]', form); if (lab) lab.textContent = 'Upload';
        msg.removeAttribute('data-state');
        msg.textContent = 'Posted at ' + post.time + '. It’s at the top of Following.';
        announce('Posted.');
      });
    }
    $$('[data-todo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('[data-todo-row]'), out = $('[data-todo-state]', row);
        $$('[data-todo]', row).forEach(function (x) { x.hidden = true; });
        out.textContent = b.getAttribute('data-todo').replace('{t}', timeOf(reduced ? .65 : tNow));
        row.classList.add('is-done');
        out.setAttribute('tabindex', '-1'); out.focus();
      });
    });
  }

  /* ───────────────────────── hero: film + fog ───────────────────────── */
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
    if (!reduced && dawnVids.length === 2) films.dawn = loopFilm(dawnVids);
    if (!reduced && nightVids.length === 2) films.night = loopFilm(nightVids);
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
    var t0 = performance.now(), introDone = reduced;
    if (reduced) setEmerge(1); else setEmerge(0);

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
    function kick() { if (!raf && !reduced) raf = requestAnimationFrame(frame); }
    themeHooks.push(function (dark) {
      nightTarget = dark ? 1 : 0;
      pickFilm(dark);
      if (reduced) { night = nightTarget; if (fog) fog.render(14, 1, 0, night); } else kick();
    });
    if (reduced) { if (fog) fog.render(14, 1, 0, night); window.addEventListener('resize', function () { if (fog) { fog.resize(); fog.render(14, 1, 0, night); } }); }
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

  /* ───────────────────────── boot ───────────────────────── */
  function boot() {
    initTheme();
    initTime();
    initNav();
    initLists();
    initBag();
    initMarket();
    initPicker();
    initPart();
    initTabs();
    initSell();
    initFeeds();
    initHome();
    initHero();
    observeReveals(document);
    stampTimes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
