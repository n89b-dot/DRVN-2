/* SUNDAY — shared interactions
   Count-ups, segmented filter, expanding rows, accept sheet + toast,
   live countdown, toggles, list-a-part modal, nav scroll state. */

(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- toast ---------- */
  var toastEl = null;
  var toastTimer = null;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      toastEl.innerHTML =
        '<span class="check"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2 4 7.7 8.5 2.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="toast-msg"></span>';
      document.body.appendChild(toastEl);
    }
    toastEl.querySelector(".toast-msg").textContent = message;
    requestAnimationFrame(function () { toastEl.classList.add("is-visible"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, 3200);
  }
  window.sundayToast = toast;

  /* ---------- gentle count-ups ---------- */
  function countUp(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    var duration = 900;
    if (prefersReduced) { el.textContent = prefix + target.toLocaleString("en-GB"); return; }
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = prefix + Math.round(target * eased).toLocaleString("en-GB");
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll("[data-count]");
  if (counters.length) {
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { countUp(e.target); seen.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { seen.observe(el); });
  }

  /* ---------- segmented filter (listings) ---------- */
  var segment = document.querySelector("[data-segment]");
  if (segment) {
    var rows = document.querySelectorAll("[data-status]");
    segment.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-filter]");
      if (!btn) return;
      segment.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      var f = btn.getAttribute("data-filter");
      rows.forEach(function (row) {
        var show = f === "all" || row.getAttribute("data-status") === f;
        row.style.display = show ? "" : "none";
      });
    });
  }

  /* ---------- expanding listing rows ---------- */
  document.querySelectorAll(".listing-main").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var row = btn.closest(".listing-row");
      var detail = row.querySelector(".listing-detail");
      var open = row.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      detail.style.maxHeight = open ? detail.scrollHeight + "px" : "0px";
    });
  });
  /* keep open rows honest when the viewport reflows (Pass 1 fix) */
  window.addEventListener("resize", function () {
    document.querySelectorAll(".listing-row.is-open .listing-detail").forEach(function (d) {
      d.style.maxHeight = d.scrollHeight + "px";
    });
  });

  /* ---------- accept-offer sheet ---------- */
  var sheet = document.getElementById("accept-sheet");
  if (sheet) {
    var sTitle = sheet.querySelector("[data-sheet-item]");
    var sOffer = sheet.querySelector("[data-sheet-offer]");
    var sFee = sheet.querySelector("[data-sheet-fee]");
    var sTotal = sheet.querySelector("[data-sheet-total]");
    var sBuyer = sheet.querySelector("[data-sheet-buyer]");
    var activeCard = null;

    function openSheet(trigger) {
      activeCard = trigger.closest("[data-offer-card]");
      var item = trigger.getAttribute("data-item");
      var offer = parseFloat(trigger.getAttribute("data-offer"));
      var buyer = trigger.getAttribute("data-buyer");
      var fee = Math.round(offer * 0.05);
      sTitle.textContent = item;
      sBuyer.textContent = buyer;
      sOffer.textContent = "£" + offer.toLocaleString("en-GB");
      sFee.textContent = "−£" + fee.toLocaleString("en-GB");
      sTotal.textContent = "£" + (offer - fee).toLocaleString("en-GB");
      sheet.classList.add("is-open");
      sheet.querySelector("[data-sheet-confirm]").focus();
    }
    function closeSheet() { sheet.classList.remove("is-open"); }

    document.querySelectorAll("[data-accept]").forEach(function (b) {
      b.addEventListener("click", function () { openSheet(b); });
    });
    sheet.addEventListener("click", function (ev) { if (ev.target === sheet) closeSheet(); });
    sheet.querySelectorAll("[data-sheet-cancel]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && sheet.classList.contains("is-open")) closeSheet();
    });
    var confirmBtn = sheet.querySelector("[data-sheet-confirm]");
    confirmBtn.addEventListener("click", function () {
      closeSheet();
      toast("Offer accepted — we've let " + sBuyer.textContent + " know.");
      if (activeCard) {
        activeCard.style.transition = "opacity 240ms ease, transform 240ms ease";
        activeCard.style.opacity = "0.45";
        var actions = activeCard.querySelector(".offer-actions");
        if (actions) actions.innerHTML = '<span class="pill pill-success"><span class="dot dot-success"></span>Accepted</span>';
      }
    });
  }

  /* Counter / Decline light feedback */
  document.querySelectorAll("[data-counter]").forEach(function (b) {
    b.addEventListener("click", function () { toast("Counter sent — we'll nudge you when they reply."); });
  });
  document.querySelectorAll("[data-decline]").forEach(function (b) {
    b.addEventListener("click", function () {
      var card = b.closest("[data-offer-card]");
      if (card) { card.style.opacity = "0.45"; }
      toast("Offer declined, politely.");
    });
  });

  /* ---------- list-a-part modal (garage) ---------- */
  var partModal = document.getElementById("list-part-modal");
  if (partModal) {
    function openPart() { partModal.classList.add("is-open"); partModal.querySelector("input, select").focus(); }
    function closePart() { partModal.classList.remove("is-open"); }
    document.querySelectorAll("[data-open-list-part]").forEach(function (b) {
      b.addEventListener("click", openPart);
    });
    partModal.addEventListener("click", function (ev) { if (ev.target === partModal) closePart(); });
    partModal.querySelectorAll("[data-sheet-cancel]").forEach(function (b) { b.addEventListener("click", closePart); });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && partModal.classList.contains("is-open")) closePart();
    });
    partModal.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var name = partModal.querySelector("#part-name").value || "Your part";
      closePart();
      toast('"' + name + '" is live — provenance linked to the E30.');
      ev.target.reset();
    });
  }

  /* ---------- live countdown pill ---------- */
  document.querySelectorAll("[data-countdown]").forEach(function (el) {
    var remaining = parseInt(el.getAttribute("data-countdown"), 10); // seconds
    function render() {
      if (remaining <= 0) { el.textContent = "Offer expired"; return; }
      var h = Math.floor(remaining / 3600);
      var m = Math.floor((remaining % 3600) / 60);
      var s = remaining % 60;
      el.textContent = "Offer expires in " + h + "h " + String(m).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
      remaining -= 1;
      setTimeout(render, 1000);
    }
    render();
  });

  /* ---------- toggles ---------- */
  document.querySelectorAll(".toggle").forEach(function (t) {
    t.addEventListener("click", function () {
      var on = t.classList.toggle("is-on");
      t.setAttribute("aria-checked", on ? "true" : "false");
      var label = t.getAttribute("data-toggle-label");
      if (label) toast(label + (on ? " on" : " off"));
    });
  });

  /* ---------- home nav scroll hairline ---------- */
  var homeNav = document.querySelector(".home-nav");
  if (homeNav) {
    var onScroll = function () { homeNav.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- image fallback: keep #E9EDF2 if asset missing ---------- */
  document.querySelectorAll("[data-bg]").forEach(function (el) {
    var src = el.getAttribute("data-bg");
    var img = new Image();
    img.onload = function () { el.style.backgroundImage = "url('" + src + "')"; };
    img.src = src;
  });
})();
