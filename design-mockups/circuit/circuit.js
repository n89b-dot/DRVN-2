/* ============================================================
   CIRCUIT — DRVN Concept 11  ·  circuit.js
   Interactions:
   1. Trace draw-in on scroll (stroke-dashoffset)
   2. Node hover highlight/dim (car + listing connection maps)
   3. Network graph filter + neighbourhood highlight + detail card
   4. Acquire confirm modal
   5. Count-up numbers
   All progressive-enhancement; pages work without JS present.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* measure every SVG trace so dasharray == path length ------------- */
  function primeTraces() {
    $$('.trace-path, .gedge').forEach((p) => {
      try {
        const len = p.getTotalLength();
        p.style.setProperty('--len', len.toFixed(1));
        p.style.strokeDasharray = len.toFixed(1);
        p.style.strokeDashoffset = len.toFixed(1);
      } catch (e) { /* non-path element */ }
    });
  }

  /* ---------- 1. scroll reveal + trace draw ---------- */
  function initReveal() {
    const targets = $$('.reveal, .trace-draw');
    if (prefersReduced) {
      targets.forEach((t) => {
        t.classList.add('is-in');
        $$('.trace-path', t).forEach((p) => p.classList.add('is-drawn'));
      });
      $$('.trace-path.autodraw').forEach((p) => p.classList.add('is-drawn'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        // draw any traces inside, staggered
        $$('.trace-path', en.target).forEach((p, i) => {
          setTimeout(() => p.classList.add('is-drawn'), 120 * i);
        });
        io.unobserve(en.target);
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -8% 0px' });
    targets.forEach((t) => io.observe(t));

    // hero / auto-draw traces fire on load
    setTimeout(() => $$('.trace-path.autodraw').forEach((p, i) => {
      setTimeout(() => p.classList.add('is-drawn'), 140 * i);
    }), 220);
  }

  /* ---------- 2. connection-map node hover (car + listing) ---------- */
  /* Elements opt in with data-node="ID". Traces declare data-link="ID" (one
     or more, space-separated). Hovering/focusing a node lights matching
     traces + matching nodes, dims the rest. Works for HTML rel-nodes and
     SVG node groups sharing the same [data-cmap] container.               */
  function initConnectionMaps() {
    $$('[data-cmap]').forEach((map) => {
      const nodes  = $$('[data-node]', map);
      const traces = $$('.trace-path[data-link]', map);
      const relAll = $$('.rel-node', map);

      const clear = () => {
        traces.forEach((t) => t.classList.remove('is-active', 'is-dim'));
        relAll.forEach((n) => n.classList.remove('is-active', 'is-dim'));
        $$('[data-node]', map).forEach((n) => n.classList.remove('is-active', 'is-dim'));
      };

      const light = (id) => {
        traces.forEach((t) => {
          const links = (t.dataset.link || '').split(/\s+/);
          if (links.includes(id) || links.includes('*')) {
            t.classList.add('is-active'); t.classList.remove('is-dim');
          } else {
            t.classList.add('is-dim'); t.classList.remove('is-active');
          }
        });
        $$('[data-node]', map).forEach((n) => {
          const nid = n.dataset.node;
          // the hovered node + the core node ("*") stay lit; matching partners lit
          const isCore = n.dataset.core === 'true';
          if (nid === id || isCore || traceConnects(id, nid)) {
            n.classList.add('is-active'); n.classList.remove('is-dim');
          } else {
            n.classList.add('is-dim'); n.classList.remove('is-active');
          }
        });
      };

      // does a trace link the hovered id to candidate nid?
      function traceConnects(id, nid) {
        return traces.some((t) => {
          const links = (t.dataset.link || '').split(/\s+/);
          return links.includes(id) && links.includes(nid);
        });
      }

      nodes.forEach((n) => {
        const id = n.dataset.node;
        const on  = () => light(id);
        n.addEventListener('mouseenter', on);
        n.addEventListener('focus', on);
        n.addEventListener('mouseleave', clear);
        n.addEventListener('blur', clear);
      });
      map.addEventListener('mouseleave', clear);
    });
  }

  /* ---------- 3. network graph ---------- */
  function initGraph() {
    const graph = $('#network-graph');
    if (!graph) return;

    const gnodes = $$('.gnode', graph);
    const gedges = $$('.gedge', graph);
    const detail = $('#graph-detail');

    // adjacency from edge data-a / data-b (node ids)
    const neighbours = (id) => {
      const set = new Set([id]);
      gedges.forEach((e) => {
        if (e.dataset.a === id) set.add(e.dataset.b);
        if (e.dataset.b === id) set.add(e.dataset.a);
      });
      return set;
    };

    const clearHot = () => {
      gnodes.forEach((n) => n.classList.remove('is-hot', 'is-dim'));
      gedges.forEach((e) => e.classList.remove('is-active', 'is-dim'));
    };

    const highlight = (id) => {
      const near = neighbours(id);
      gnodes.forEach((n) => {
        if (near.has(n.dataset.id)) { n.classList.add('is-hot'); n.classList.remove('is-dim'); }
        else { n.classList.add('is-dim'); n.classList.remove('is-hot'); }
      });
      gedges.forEach((e) => {
        if (e.dataset.a === id || e.dataset.b === id) {
          e.classList.add('is-active'); e.classList.remove('is-dim');
        } else { e.classList.add('is-dim'); e.classList.remove('is-active'); }
      });
    };

    const showDetail = (n) => {
      if (!detail) return;
      $('#gd-kind').textContent  = n.dataset.kind || 'NODE';
      $('#gd-title').textContent = n.dataset.title || '';
      $('#gd-meta').textContent  = n.dataset.meta || '';
      const media = $('#gd-media');
      if (n.dataset.img) { media.style.backgroundImage = `url('${n.dataset.img}')`; media.style.display = 'block'; }
      else { media.style.display = 'none'; }
      const link = $('#gd-link');
      link.setAttribute('href', n.dataset.href || '#');
      link.textContent = n.dataset.cta || 'Open node';
      detail.classList.add('is-open');
    };

    gnodes.forEach((n) => {
      const id = n.dataset.id;
      n.addEventListener('mouseenter', () => highlight(id));
      n.addEventListener('focus', () => { highlight(id); showDetail(n); });
      n.addEventListener('mouseleave', clearHot);
      n.addEventListener('click', (e) => {
        // first click on touch: pin highlight + detail; nav via the detail link
        highlight(id); showDetail(n);
      });
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && n.dataset.href) window.location.href = n.dataset.href;
      });
    });

    graph.addEventListener('mouseleave', clearHot);

    // filters
    const filters = $$('.filter-btn');
    filters.forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true');
        const f = btn.dataset.filter;
        gnodes.forEach((n) => {
          const types = (n.dataset.types || '').split(/\s+/);
          const show = f === 'all' || types.includes(f);
          n.classList.toggle('is-hidden', !show);
        });
        gedges.forEach((e) => {
          const aVis = !$(`.gnode[data-id="${e.dataset.a}"]`).classList.contains('is-hidden');
          const bVis = !$(`.gnode[data-id="${e.dataset.b}"]`).classList.contains('is-hidden');
          e.classList.toggle('is-hidden', !(aVis && bVis));
        });
        if (detail) detail.classList.remove('is-open');
        clearHot();
      });
    });

    // detail close
    const gdClose = $('#gd-close');
    if (gdClose) gdClose.addEventListener('click', () => { detail.classList.remove('is-open'); clearHot(); });
  }

  /* ---------- 4. acquire confirm modal ---------- */
  function initModal() {
    const scrim = $('#acquire-modal');
    if (!scrim) return;
    const openers = $$('[data-open-acquire]');
    const closers = $$('[data-close-acquire]', scrim);
    let lastFocus = null;

    const open = () => {
      lastFocus = document.activeElement;
      scrim.classList.add('is-open');
      scrim.setAttribute('aria-hidden', 'false');
      const first = $('.modal__close', scrim); if (first) first.focus();
      document.addEventListener('keydown', onKey);
    };
    const close = () => {
      scrim.classList.remove('is-open');
      scrim.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
      if (lastFocus) lastFocus.focus();
      // reset any confirmed state
      const b = $('#acquire-body'); const done = $('#acquire-done');
      if (b && done) { b.style.display = ''; done.style.display = 'none'; }
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    openers.forEach((o) => o.addEventListener('click', open));
    closers.forEach((c) => c.addEventListener('click', close));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });

    // confirm -> success state
    const confirmBtn = $('#acquire-confirm');
    if (confirmBtn) confirmBtn.addEventListener('click', () => {
      const b = $('#acquire-body'); const done = $('#acquire-done');
      if (b && done) { b.style.display = 'none'; done.style.display = 'block'; }
    });
  }

  /* ---------- 5. count-up numbers ---------- */
  function initCountUp() {
    const nums = $$('[data-count]');
    if (!nums.length) return;
    if (prefersReduced) { nums.forEach((n) => n.textContent = format(n)); return; }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        run(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.6 });
    nums.forEach((n) => io.observe(n));

    function format(n) {
      const t = parseFloat(n.dataset.count);
      const dec = n.dataset.decimals ? parseInt(n.dataset.decimals, 10) : 0;
      return t.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    function run(n) {
      const target = parseFloat(n.dataset.count);
      const dec = n.dataset.decimals ? parseInt(n.dataset.decimals, 10) : 0;
      const dur = 1200; const t0 = performance.now();
      const step = (t) => {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        n.textContent = val.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        if (p < 1) requestAnimationFrame(step);
        else n.textContent = target.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      };
      requestAnimationFrame(step);
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    primeTraces();
    initReveal();
    initConnectionMaps();
    initGraph();
    initModal();
    initCountUp();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
