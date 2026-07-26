/* ============================================================
   ATLAS — DRVN Concept 10 · shared behaviour
   Calm, grounded motion. Contours draw, routes trace, cards rise.
   ============================================================ */
(function () {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------------------------------------
     1 · Background contour field (procedural topographic lines)
     Injected into every [data-contour] container so the survey
     sheet feel is consistent across pages.
     -------------------------------------------------------- */
  function buildContours(host) {
    const W = 1440, H = 900;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("aria-hidden", "true");

    // Two "peaks" — nested perturbed rings, like elevation contours.
    const peaks = [
      { cx: 1120, cy: 250, base: 60, rings: 9, step: 46, seed: 3 },
      { cx: 250,  cy: 720, base: 48, rings: 8, step: 52, seed: 7 }
    ];

    peaks.forEach((pk) => {
      for (let r = 0; r < pk.rings; r++) {
        const radius = pk.base + r * pk.step;
        const pts = [];
        const N = 46;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          // organic perturbation, deterministic per ring
          const wob =
            Math.sin(a * 3 + pk.seed + r * 0.6) * (7 + r * 1.3) +
            Math.cos(a * 5 + pk.seed) * 4;
          const rr = radius + wob;
          pts.push([
            (pk.cx + Math.cos(a) * rr).toFixed(1),
            (pk.cy + Math.sin(a) * rr * 0.82).toFixed(1)
          ]);
        }
        let d = "M" + pts[0][0] + "," + pts[0][1];
        for (let i = 1; i < pts.length; i++) d += " L" + pts[i][0] + "," + pts[i][1];
        d += " Z";
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
      }
    });
    host.appendChild(svg);
  }
  document.querySelectorAll("[data-contour]").forEach(buildContours);

  /* --------------------------------------------------------
     2 · Reveal on scroll — cards rise + fade, contours settle
     -------------------------------------------------------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if (reduce) {
    revealEls.forEach((el) => el.classList.add("is-in"));
  } else if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* --------------------------------------------------------
     3 · Numbers settle (count-up)
     -------------------------------------------------------- */
  function settle(el) {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const dur = 900;
    const dp = el.dataset.decimals ? parseInt(el.dataset.decimals, 10) : 0;
    const suffix = el.dataset.suffix || "";
    const prefix = el.dataset.prefix || "";
    if (reduce) {
      el.textContent = prefix + target.toFixed(dp) + suffix;
      return;
    }
    const t0 = performance.now();
    function frame(t) {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      el.textContent =
        prefix +
        (dp ? val.toFixed(dp) : Math.round(val).toLocaleString("en-US")) +
        suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduce) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            settle(e.target);
            cio.unobserve(e.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((c) => cio.observe(c));
  } else {
    counters.forEach(settle);
  }

  /* --------------------------------------------------------
     4 · Route lines — dotted paths tracing part -> source car
     Any [data-route-draw] SVG path animates its dash on reveal.
     -------------------------------------------------------- */
  function traceRoutes(scope) {
    scope.querySelectorAll("[data-route-draw] path, path[data-route-draw]").forEach((path) => {
      try {
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = reduce ? 0 : len;
        // keep the dotted look once drawn: swap to dash pattern at end
        if (!reduce) {
          path.getBoundingClientRect();
          path.style.transition = "stroke-dashoffset 720ms cubic-bezier(0.22,1,0.36,1)";
          requestAnimationFrame(() => (path.style.strokeDashoffset = "0"));
          path.addEventListener(
            "transitionend",
            () => {
              path.style.transition = "none";
              path.style.strokeDasharray = "3 6";
              path.style.strokeDashoffset = "0";
            },
            { once: true }
          );
        } else {
          path.style.strokeDasharray = "3 6";
        }
      } catch (err) {
        /* getTotalLength unsupported — leave the static dashed path */
      }
    });
  }

  // Draw route canvases when they enter view
  const routeHosts = document.querySelectorAll(".route-canvas, .prov-route svg");
  if ("IntersectionObserver" in window) {
    const rio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            traceRoutes(e.target);
            rio.unobserve(e.target);
          }
        });
      },
      { threshold: 0.3 }
    );
    routeHosts.forEach((h) => rio.observe(h));
  } else {
    routeHosts.forEach(traceRoutes);
  }

  // On car.html: connect the source banner to each released-part card.
  const released = document.querySelector(".released[data-connect]");
  if (released) {
    const canvas = released.querySelector(".route-canvas");
    const source = released.querySelector(".released-source");
    const cards = released.querySelectorAll(".field-card");
    function drawConnections() {
      if (!canvas || !source || !cards.length) return;
      const box = released.getBoundingClientRect();
      canvas.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
      canvas.innerHTML = "";
      const sRect = source.getBoundingClientRect();
      const sx = sRect.left - box.left + sRect.width / 2;
      const sy = sRect.bottom - box.top;
      cards.forEach((card) => {
        const cRect = card.getBoundingClientRect();
        const cx = cRect.left - box.left + cRect.width / 2;
        const cy = cRect.top - box.top;
        const midY = sy + (cy - sy) * 0.55;
        const d = `M${sx},${sy} C${sx},${midY} ${cx},${sy} ${cx},${cy}`;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("data-route-draw", "");
        canvas.appendChild(p);
      });
      traceRoutes(canvas);
    }
    // draw once visible, and redraw on resize
    let drawn = false;
    const dio = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !drawn) {
            drawn = true;
            drawConnections();
          }
        });
      },
      { threshold: 0.25 }
    );
    dio.observe(released);
    let rt;
    window.addEventListener("resize", () => {
      if (!drawn) return;
      clearTimeout(rt);
      rt = setTimeout(() => {
        // reset trace flag by rebuilding fresh paths
        drawConnections();
      }, 180);
    });
  }

  /* --------------------------------------------------------
     5 · Listing gallery — thumb swaps the main specimen image
     -------------------------------------------------------- */
  const gallery = document.querySelector(".spec-gallery");
  if (gallery) {
    const main = gallery.querySelector(".spec-gallery__main");
    const thumbs = gallery.querySelectorAll(".spec-thumb");
    thumbs.forEach((t) => {
      t.addEventListener("click", () => {
        const img = t.dataset.img;
        if (img && main) main.style.backgroundImage = `url('${img}')`;
        thumbs.forEach((x) => x.setAttribute("aria-pressed", "false"));
        t.setAttribute("aria-pressed", "true");
      });
    });
  }

  /* --------------------------------------------------------
     6 · Atlas map — list <-> pin highlight + terrain filter
     -------------------------------------------------------- */
  const atlas = document.querySelector(".atlas-layout");
  if (atlas) {
    const rows = atlas.querySelectorAll(".reg-row");
    const pins = atlas.querySelectorAll(".map-pin");
    const filters = atlas.querySelectorAll(".filter-btn");

    const pinById = {};
    pins.forEach((p) => (pinById[p.dataset.id] = p));
    const rowById = {};
    rows.forEach((r) => (rowById[r.dataset.id] = r));

    function highlight(id, on) {
      const pin = pinById[id];
      const row = rowById[id];
      if (pin) pin.classList.toggle("is-hot", on);
      if (row) row.classList.toggle("is-hot", on);
    }
    rows.forEach((r) => {
      r.addEventListener("mouseenter", () => highlight(r.dataset.id, true));
      r.addEventListener("mouseleave", () => highlight(r.dataset.id, false));
      r.addEventListener("focus", () => highlight(r.dataset.id, true));
      r.addEventListener("blur", () => highlight(r.dataset.id, false));
    });
    pins.forEach((p) => {
      p.addEventListener("mouseenter", () => highlight(p.dataset.id, true));
      p.addEventListener("mouseleave", () => highlight(p.dataset.id, false));
      p.addEventListener("click", () => {
        const row = rowById[p.dataset.id];
        if (row) {
          row.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
          row.classList.add("is-hot");
          setTimeout(() => row.classList.remove("is-hot"), 1400);
        }
      });
    });

    function applyFilter(terrain) {
      rows.forEach((r) => {
        const match = terrain === "all" || r.dataset.terrain === terrain;
        r.classList.toggle("is-filtered-out", !match);
      });
      pins.forEach((p) => {
        const match = terrain === "all" || p.dataset.terrain === terrain;
        p.classList.toggle("is-dimmed", !match);
      });
    }
    filters.forEach((f) => {
      f.addEventListener("click", () => {
        filters.forEach((x) => x.setAttribute("aria-pressed", "false"));
        f.setAttribute("aria-pressed", "true");
        applyFilter(f.dataset.terrain);
      });
    });
  }

  /* --------------------------------------------------------
     7 · Claim confirm panel (listing.html)
     -------------------------------------------------------- */
  const claimScrim = document.querySelector(".claim-scrim");
  if (claimScrim) {
    const openBtns = document.querySelectorAll("[data-claim-open]");
    const stepClaim = claimScrim.querySelector("[data-step='claim']");
    const stepDone = claimScrim.querySelector("[data-step='done']");
    let lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      if (stepClaim) stepClaim.hidden = false;
      if (stepDone) stepDone.hidden = true;
      claimScrim.classList.add("is-open");
      document.body.style.overflow = "hidden";
      const first = claimScrim.querySelector("button, a");
      if (first) first.focus();
    }
    function close() {
      claimScrim.classList.remove("is-open");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }
    function confirm() {
      if (stepClaim) stepClaim.hidden = true;
      if (stepDone) stepDone.hidden = false;
      const back = stepDone && stepDone.querySelector("button, a");
      if (back) back.focus();
    }

    openBtns.forEach((b) => b.addEventListener("click", open));
    claimScrim.querySelectorAll("[data-claim-close]").forEach((b) =>
      b.addEventListener("click", close)
    );
    claimScrim.querySelectorAll("[data-claim-confirm]").forEach((b) =>
      b.addEventListener("click", confirm)
    );
    claimScrim.addEventListener("click", (e) => {
      if (e.target === claimScrim) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && claimScrim.classList.contains("is-open")) close();
    });
  }

  /* --------------------------------------------------------
     8 · Current-year in colophons
     -------------------------------------------------------- */
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });
})();
