/* AFTER HOURS — shared cinematics */
(function () {
  "use strict";

  /* ---------- Letterbox intro ---------- */
  window.addEventListener("load", function () {
    requestAnimationFrame(function () {
      document.body.classList.add("loaded");
    });
  });
  // Fallback in case load already fired or hangs on missing images
  setTimeout(function () { document.body.classList.add("loaded"); }, 1800);

  /* ---------- Nav: appear after first scroll, solidify ---------- */
  var nav = document.querySelector(".nav");
  var lastShown = false;
  function onScrollNav() {
    var y = window.scrollY;
    var show = y > 40;
    if (show !== lastShown && nav) {
      nav.classList.toggle("visible", show);
      lastShown = show;
    }
    if (nav) nav.classList.toggle("solid", y > window.innerHeight * 0.6);
  }
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();
  // On subpages, show nav immediately
  if (document.body.dataset.navAlways === "true" && nav) {
    nav.classList.add("visible");
    lastShown = true;
  }

  /* ---------- Live-ish clock (locked to the night) ---------- */
  var clock = document.querySelector("[data-clock]");
  if (clock) {
    var base = new Date();
    base.setHours(1, 47, 0, 0);
    var start = Date.now();
    setInterval(function () {
      var t = new Date(base.getTime() + (Date.now() - start));
      var h = String(t.getHours()).padStart(2, "0");
      var m = String(t.getMinutes()).padStart(2, "0");
      var s = String(t.getSeconds()).padStart(2, "0");
      clock.textContent = h + ":" + m + ":" + s + " AM";
    }, 1000);
  }

  /* ---------- Reveal on scroll ---------- */
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal, .manifesto-line").forEach(function (el) {
    io.observe(el);
  });

  /* ---------- Scroll cinematography (rAF) ----------
     .scene__bg  : scales down + brightens as scene enters, darkens as it leaves
     .parallax-word / [data-parallax] : translate at custom speed          */
  var bgs = Array.prototype.slice.call(document.querySelectorAll(".scene__bg"));
  var plx = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
  var ticking = false;

  function frame() {
    ticking = false;
    var vh = window.innerHeight;

    bgs.forEach(function (bg) {
      var r = bg.parentElement.getBoundingClientRect();
      if (r.bottom < -vh * 0.2 || r.top > vh * 1.2) return;
      // progress: 0 when scene top hits viewport bottom, 1 when scene bottom hits top
      var p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      var scale = 1.14 - p * 0.14;
      var bright = 0.72 + Math.sin(p * Math.PI) * 0.32; // brightest mid-scene
      bg.style.transform = "scale(" + scale.toFixed(4) + ") translateY(" + ((p - 0.5) * -30).toFixed(1) + "px)";
      bg.style.filter = "brightness(" + bright.toFixed(3) + ") saturate(" + (0.85 + Math.sin(p * Math.PI) * 0.2).toFixed(3) + ")";
    });

    plx.forEach(function (el) {
      var speed = parseFloat(el.dataset.parallax) || 0.3;
      var r = (el.closest(".scene") || el.parentElement).getBoundingClientRect();
      var offset = (r.top + r.height / 2 - vh / 2) * speed;
      el.style.transform = "translateY(" + (-offset).toFixed(1) + "px)";
    });
  }
  function requestFrame() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }
  window.addEventListener("scroll", requestFrame, { passive: true });
  window.addEventListener("resize", requestFrame);
  requestFrame();

  /* ---------- Like / save toggles ---------- */
  document.querySelectorAll("[data-toggle-count]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var n = btn.querySelector("[data-n]");
      var count = parseInt(n.textContent.replace(/,/g, ""), 10);
      var active = btn.classList.toggle("active");
      n.textContent = (count + (active ? 1 : -1)).toLocaleString();
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  });

  /* ---------- Buy overlay ---------- */
  var overlay = document.getElementById("buy-overlay");
  if (overlay) {
    var openers = document.querySelectorAll("[data-buy]");
    var lastFocus = null;
    function openOverlay() {
      lastFocus = document.activeElement;
      overlay.classList.add("open");
      overlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      var c = overlay.querySelector(".overlay__close");
      if (c) c.focus();
    }
    function closeOverlay() {
      overlay.classList.remove("open", "confirmed");
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }
    openers.forEach(function (b) { b.addEventListener("click", openOverlay); });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeOverlay();
    });
    var closeBtn = overlay.querySelector(".overlay__close");
    if (closeBtn) closeBtn.addEventListener("click", closeOverlay);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
    });
    var confirmBtn = overlay.querySelector("[data-confirm]");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        overlay.classList.add("confirmed");
      });
    }
  }
})();
