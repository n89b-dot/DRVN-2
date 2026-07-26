/* ============================================================
   MONOGRAPH — interactions
   Reverent, quiet: scroll reveal, top-bar dissolve, collection
   filter, acquire confirm panel, lightbox crossfade.
   No dependencies.
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------
     1 · SCROLL REVEAL — fade up + scale, captions staggered
     --------------------------------------------------------- */
  function initReveal() {
    var items = document.querySelectorAll('.reveal, .reveal-cap');
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------
     2 · TOP BAR — dissolve to near-invisible over a hero image
     --------------------------------------------------------- */
  function initBar() {
    var bar = document.querySelector('.bar');
    var sentinel = document.querySelector('[data-hero-sentinel]');
    if (!bar) return;

    if (!sentinel || !('IntersectionObserver' in window)) {
      bar.setAttribute('data-over-image', 'false');
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        // while the hero region is on screen, dissolve the bar
        bar.setAttribute('data-over-image', entry.isIntersecting ? 'true' : 'false');
      });
    }, { threshold: 0, rootMargin: '-' + (bar.offsetHeight + 20) + 'px 0px 0px 0px' });

    io.observe(sentinel);
  }

  /* ---------------------------------------------------------
     3 · COLLECTION FILTER — filters car plates by category
     --------------------------------------------------------- */
  function initFilter() {
    var group = document.querySelector('[data-filter-group]');
    if (!group) return;
    var buttons = group.querySelectorAll('.filter');
    var items = document.querySelectorAll('[data-cat]');

    function apply(cat) {
      items.forEach(function (item) {
        var match = cat === 'all' || item.getAttribute('data-cat').split(' ').indexOf(cat) !== -1;
        if (match) {
          item.style.display = '';
          // re-run the reveal on newly shown items
          item.classList.remove('is-in');
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { item.classList.add('is-in'); });
          });
        } else {
          item.style.display = 'none';
        }
      });
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        apply(btn.getAttribute('data-filter'));
      });
    });
  }

  /* ---------------------------------------------------------
     4 · ACQUIRE — calm in-page confirm panel
     --------------------------------------------------------- */
  function initAcquire() {
    var overlay = document.querySelector('[data-confirm]');
    if (!overlay) return;
    var openers = document.querySelectorAll('[data-acquire-open]');
    var body = overlay.querySelector('[data-confirm-body]');
    var doneTpl = overlay.querySelector('[data-confirm-done]');
    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      overlay.setAttribute('data-open', 'true');
      document.body.style.overflow = 'hidden';
      var first = overlay.querySelector('button, a');
      if (first) first.focus();
    }
    function close() {
      overlay.setAttribute('data-open', 'false');
      document.body.style.overflow = '';
      if (body) body.hidden = false;
      if (doneTpl) doneTpl.hidden = true;
      if (lastFocus) lastFocus.focus();
    }
    function confirmPurchase() {
      if (body) body.hidden = true;
      if (doneTpl) doneTpl.hidden = false;
      var ok = overlay.querySelector('[data-confirm-close-done]');
      if (ok) ok.focus();
    }

    openers.forEach(function (o) { o.addEventListener('click', open); });
    overlay.querySelectorAll('[data-confirm-close]').forEach(function (c) {
      c.addEventListener('click', close);
    });
    var confirmBtn = overlay.querySelector('[data-confirm-yes]');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmPurchase);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.getAttribute('data-open') === 'true') close();
    });
  }

  /* ---------------------------------------------------------
     5 · LIGHTBOX — crossfade a plate to full view
     --------------------------------------------------------- */
  function initLightbox() {
    var triggers = document.querySelectorAll('[data-lightbox]');
    if (!triggers.length) return;

    var box = document.createElement('div');
    box.className = 'overlay';
    box.setAttribute('data-lightbox-overlay', '');
    box.innerHTML =
      '<figure class="plate frame-32" style="width:min(1100px,100%);background:var(--grey)">' +
      '<img class="plate__img" alt="" style="filter:saturate(1)"></figure>';
    document.body.appendChild(box);
    var img = box.querySelector('img');

    function open(src, alt) {
      img.src = src;
      img.alt = alt || '';
      box.setAttribute('data-open', 'true');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      box.setAttribute('data-open', 'false');
      document.body.style.overflow = '';
    }

    triggers.forEach(function (t) {
      t.style.cursor = 'zoom-in';
      t.addEventListener('click', function () {
        var im = t.querySelector('img');
        if (im) open(im.currentSrc || im.src, im.alt);
      });
    });
    box.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  function boot() {
    initReveal();
    initBar();
    initFilter();
    initAcquire();
    initLightbox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
