/* MERIDIAN — shared interactions
   Ignition boot, gauge sweeps, segmented tabs, expanding rows,
   countdown, offer accept flow, decommission modal. */
(function () {
  "use strict";

  /* ---------- ignition boot ---------- */
  window.addEventListener("DOMContentLoaded", function () {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.body.classList.add("m-ignited");
      });
    });
  });

  /* ---------- gauges ----------
     <svg class="gauge" data-value="0.7"> with .gauge-arc path.
     270° sweep; arc length precomputed via getTotalLength. */
  var GAUGE_DELAY = 350; // let ignition fade begin first

  function sweepGauge(svg, toValue, dur) {
    var arc = svg.querySelector(".gauge-arc");
    if (!arc) return;
    var len = arc.getTotalLength();
    arc.style.strokeDasharray = len;
    if (arc.dataset.init !== "1") {
      arc.style.strokeDashoffset = len;
      arc.dataset.init = "1";
      // force layout so the transition runs
      arc.getBoundingClientRect();
    }
    if (dur) arc.style.transitionDuration = dur + "ms";
    arc.style.strokeDashoffset = len * (1 - Math.max(0, Math.min(1, toValue)));
  }

  function bootGauges() {
    document.querySelectorAll("svg.gauge").forEach(function (svg, i) {
      var v = parseFloat(svg.dataset.value || "0");
      setTimeout(function () { sweepGauge(svg, v); }, GAUGE_DELAY + i * 160);
    });
  }
  window.addEventListener("DOMContentLoaded", bootGauges);

  /* count-up for gauge numerals: <span data-countup="3410" data-prefix="£"> */
  function countUp(el) {
    var target = parseFloat(el.dataset.countup);
    var prefix = el.dataset.prefix || "";
    var dur = 900, t0 = null;
    function frame(t) {
      if (!t0) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString("en-GB");
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      document.querySelectorAll("[data-countup]").forEach(countUp);
    }, GAUGE_DELAY);
  });

  /* ---------- offer accept / counter / decline (dashboard) ---------- */
  var revenue = 3410;
  var REVENUE_MAX = 6000; // arc scale

  function showToast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.querySelector("span:last-of-type").textContent = msg;
    t.classList.add("is-shown");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("is-shown"); }, 3200);
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-offer-action]");
    if (!btn) return;
    var row = btn.closest(".offer-row");
    var action = btn.dataset.offerAction;
    var part = row.dataset.part;
    var amount = parseInt(row.dataset.amount, 10);

    if (action === "accept") {
      var ov = document.getElementById("confirm-overlay");
      ov.querySelector("[data-confirm-part]").textContent = part;
      ov.querySelector("[data-confirm-amount]").textContent =
        "£" + amount.toLocaleString("en-GB");
      ov.classList.add("is-open");
      ov._row = row;
      ov._amount = amount;
    } else if (action === "counter") {
      showToast("Counter sent — " + part);
    } else if (action === "decline") {
      row.classList.add("is-resolved");
      showToast("Offer declined — " + part);
      bumpOfferGauge(-1);
    }
  });

  function bumpOfferGauge(delta) {
    var svg = document.getElementById("gauge-offers");
    var num = document.getElementById("offers-num");
    if (!svg || !num) return;
    var n = Math.max(0, parseInt(num.textContent, 10) + delta);
    num.textContent = n;
    sweepGauge(svg, n / 5, 700);
  }

  document.addEventListener("click", function (e) {
    var ov = document.getElementById("confirm-overlay");
    if (!ov) return;
    if (e.target.closest("[data-confirm-accept]")) {
      var row = ov._row, amount = ov._amount || 0;
      ov.classList.remove("is-open");
      if (row) row.classList.add("is-resolved");
      bumpOfferGauge(-1);
      // revenue gauge re-sweep
      revenue += amount;
      var rev = document.getElementById("gauge-revenue");
      var revNum = document.getElementById("revenue-num");
      if (rev && revNum) {
        sweepGauge(rev, 0, 400);
        setTimeout(function () {
          sweepGauge(rev, revenue / REVENUE_MAX, 900);
          revNum.dataset.countup = revenue;
          countUp(revNum);
        }, 430);
      }
      showToast("Sale agreed — funds pending");
    }
    if (e.target.closest("[data-overlay-close]") ||
        (e.target.classList && e.target.classList.contains("overlay"))) {
      e.target.closest(".overlay") ?
        e.target.closest(".overlay").classList.remove("is-open") :
        (e.target.classList.contains("overlay") && e.target.classList.remove("is-open"));
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".overlay.is-open").forEach(function (o) {
        o.classList.remove("is-open");
      });
    }
  });

  /* ---------- decommission modal (garage) ---------- */
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-open-decom]")) {
      document.getElementById("decom-overlay").classList.add("is-open");
      var f = document.querySelector("#decom-overlay select, #decom-overlay input");
      if (f) setTimeout(function () { f.focus(); }, 320);
    }
    if (e.target.closest("[data-decom-submit]")) {
      e.preventDefault();
      var part = document.getElementById("decom-part");
      var price = document.getElementById("decom-price");
      if (price && !price.value) { price.focus(); return; }
      document.getElementById("decom-overlay").classList.remove("is-open");
      showToast("Listed — " + (part ? part.value : "part") + " at £" + (price ? price.value : ""));
    }
  });

  /* ---------- segmented tabs (listings) ---------- */
  function initSeg() {
    var seg = document.querySelector(".seg");
    if (!seg) return;
    var trim = seg.querySelector(".seg__trim");
    var btns = seg.querySelectorAll(".seg__btn");

    function place(btn) {
      trim.style.left = (btn.offsetLeft + 14) + "px";
      trim.style.width = (btn.offsetWidth - 28) + "px";
    }
    function select(btn) {
      btns.forEach(function (b) { b.setAttribute("aria-selected", b === btn ? "true" : "false"); });
      place(btn);
      var filter = btn.dataset.filter;
      document.querySelectorAll(".listing").forEach(function (row) {
        var show = filter === "all" || row.dataset.status === filter;
        row.style.display = show ? "" : "none";
      });
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () { select(b); });
    });
    var current = seg.querySelector('[aria-selected="true"]') || btns[0];
    setTimeout(function () { place(current); }, 60);
    window.addEventListener("resize", function () {
      place(seg.querySelector('[aria-selected="true"]') || btns[0]);
    });
  }
  window.addEventListener("DOMContentLoaded", initSeg);

  /* ---------- expanding listing rows ---------- */
  document.addEventListener("click", function (e) {
    var head = e.target.closest(".listing__head");
    if (!head || e.target.closest("a") || e.target.closest(".btn")) return;
    var row = head.closest(".listing");
    var detail = row.querySelector(".listing__detail");
    var open = row.classList.toggle("is-open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
    detail.style.maxHeight = open ? detail.scrollHeight + "px" : "0px";
  });

  /* ---------- countdown ---------- */
  function initCountdown() {
    var el = document.querySelector("[data-countdown]");
    if (!el) return;
    var parts = el.dataset.countdown.split(":").map(Number);
    var secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    function tick() {
      if (secs <= 0) { el.textContent = "CLOSED"; return; }
      secs--;
      var h = String(Math.floor(secs / 3600)).padStart(2, "0");
      var m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
      var s = String(secs % 60).padStart(2, "0");
      el.textContent = h + ":" + m + ":" + s;
      setTimeout(tick, 1000);
    }
    tick();
  }
  window.addEventListener("DOMContentLoaded", initCountdown);

  /* ---------- subtle panel tilt (desktop, fine pointers only) ---------- */
  if (window.matchMedia("(pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.addEventListener("mousemove", function (e) {
      var p = e.target.closest(".glass--tilt");
      document.querySelectorAll(".glass--tilt").forEach(function (el) {
        if (el !== p) el.style.transform = "";
      });
      if (!p) return;
      var r = p.getBoundingClientRect();
      var rx = ((e.clientY - r.top) / r.height - 0.5) * -1.5;
      var ry = ((e.clientX - r.left) / r.width - 0.5) * 1.5;
      p.style.transform = "perspective(900px) rotateX(" + rx + "deg) rotateY(" + ry + "deg)";
    });
    document.addEventListener("mouseleave", function () {
      document.querySelectorAll(".glass--tilt").forEach(function (el) { el.style.transform = ""; });
    }, true);
  }
})();
