/* GLANCE — shared behaviors */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- entrance stagger (widgets scale from .96) ---------- */
  var enters = document.querySelectorAll(".enter");
  if (reduced) {
    enters.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { io.unobserve(e.target); e.target.classList.add("in"); }
      });
    }, { threshold: 0.1 });
    enters.forEach(function (el, i) {
      el.style.transitionDelay = (i % 8) * 55 + "ms";
      io.observe(el);
    });
  }

  /* ---------- live countdowns: data-countdown="seconds" ---------- */
  var timers = [];
  document.querySelectorAll("[data-countdown]").forEach(function (el) {
    timers.push({ el: el, s: parseInt(el.getAttribute("data-countdown"), 10) || 0 });
  });
  function fmt(s) {
    if (s <= 0) return "00:00";
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return h > 0 ? h + ":" + p(m) + ":" + p(sec) : p(m) + ":" + p(sec);
  }
  function tick() {
    timers.forEach(function (t) {
      if (t.s > 0) t.s--;
      t.el.textContent = fmt(t.s);
    });
  }
  if (timers.length) { tick(); setInterval(tick, 1000); }

  /* ---------- dynamic island: open on scroll-up pause, tap on touch ---------- */
  var island = document.querySelector(".island");
  if (island) {
    island.addEventListener("click", function (e) {
      if (e.target === island || e.target.classList.contains("island__brand")) {
        island.classList.toggle("is-open");
      }
    });
    var lastY = window.scrollY;
    window.addEventListener("scroll", function () {
      if (window.scrollY < lastY - 30) island.classList.add("is-open");
      else if (window.scrollY > lastY + 30) island.classList.remove("is-open");
      lastY = window.scrollY;
    }, { passive: true });
  }

  /* ---------- reduced motion: pause hero video to poster ---------- */
  var vid = document.querySelector(".backdrop video");
  if (vid) {
    if (reduced) { vid.pause(); vid.removeAttribute("autoplay"); }
    vid.addEventListener("error", function () { vid.remove(); }, true);
  }

  /* ---------- market: search filter over listing widgets + app grid ---------- */
  var search = document.getElementById("market-search");
  if (search) {
    var rows = document.querySelectorAll("[data-filter-text]");
    var apps = document.querySelectorAll(".app[data-filter-text]");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      rows.forEach(function (r) {
        var hit = r.getAttribute("data-filter-text").toLowerCase().indexOf(q) !== -1;
        if (r.classList.contains("app")) r.classList.toggle("is-dim", q !== "" && !hit);
        else r.style.display = hit ? "" : "none";
      });
    });
  }

  /* ---------- listing: 2-step confirm sheet ---------- */
  var sheet = document.getElementById("confirm-sheet");
  if (sheet) {
    var veil = document.getElementById("sheet-veil");
    var steps = sheet.querySelectorAll(".sheet__step");
    var mode = "buy";
    function openSheet(m) {
      mode = m;
      sheet.querySelectorAll("[data-mode-label]").forEach(function (el) {
        el.textContent = m === "buy" ? "Buy now" : "Make offer";
      });
      var offerRow = sheet.querySelector("#offer-row");
      if (offerRow) offerRow.style.display = m === "offer" ? "flex" : "none";
      goStep(0);
      document.body.classList.add("sheet-open");
    }
    function closeSheet() { document.body.classList.remove("sheet-open"); }
    function goStep(i) {
      steps.forEach(function (s, n) { s.classList.toggle("is-active", n === i); });
    }
    document.querySelectorAll("[data-open-sheet]").forEach(function (b) {
      b.addEventListener("click", function () { openSheet(b.getAttribute("data-open-sheet")); });
    });
    sheet.addEventListener("click", function (e) {
      var t = e.target.closest("[data-sheet]");
      if (!t) return;
      var a = t.getAttribute("data-sheet");
      if (a === "next") goStep(1);
      if (a === "done") {
        goStep(2);
        var conf = document.getElementById("sheet-confirm-line");
        if (conf) conf.textContent = mode === "buy"
          ? "Order placed. Jordan has 48h to ship."
          : "Offer sent. Jordan usually replies within 2h.";
        var live = document.getElementById("listing-live-state");
        if (live && mode === "offer") live.textContent = "YOUR OFFER PENDING";
      }
      if (a === "close") closeSheet();
    });
    if (veil) veil.addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  /* ---------- car: follow toggle ---------- */
  var follow = document.getElementById("follow-btn");
  if (follow) {
    follow.addEventListener("click", function () {
      var on = follow.getAttribute("aria-pressed") === "true";
      follow.setAttribute("aria-pressed", String(!on));
      follow.textContent = on ? "[ FOLLOW ]" : "[ FOLLOWING ✓ ]";
      follow.classList.toggle("btn--primary", on);
    });
  }

  /* ---------- alerts: accept / counter / dismiss ---------- */
  document.querySelectorAll(".notif").forEach(function (n) {
    n.addEventListener("click", function (e) {
      var act = e.target.closest("[data-notif]");
      if (!act) return;
      var a = act.getAttribute("data-notif");
      var title = n.querySelector(".notif__title");
      var body = n.querySelector(".notif__body");
      var actions = n.querySelector(".notif__actions");
      if (a === "dismiss") { n.classList.add("is-dismissed"); return; }
      if (a === "accept") {
        if (title) title.innerHTML = 'Offer accepted <span class="chip chip--green">DONE</span>';
        if (body) body.textContent = "Sale confirmed at the offered price. Ship by Thursday — label is in your email.";
        if (actions) actions.innerHTML = '<span class="mono">Payment clearing · funds in 1–2 days</span>';
      }
      if (a === "counter") {
        if (title) title.innerHTML = 'Counter sent <span class="chip chip--red-soft">WAITING</span>';
        if (body) body.textContent = "You countered at £960. The buyer has 24h to respond.";
        if (actions) actions.innerHTML = '<span class="mono">Sent just now · expires in 24:00:00</span>';
      }
    });
  });
})();
