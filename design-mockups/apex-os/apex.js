/* APEX/OS — shared behaviors: clock, count-up, fitment filter, image fallback, ticker clone */
(function () {
  "use strict";

  /* ---------- live UTC-ish clock in command bar ---------- */
  var clock = document.querySelector("[data-clock]");
  function pad(n) { return String(n).padStart(2, "0"); }
  function tickClock() {
    var d = new Date();
    if (clock) {
      clock.textContent =
        pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + " LOC";
    }
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------- count-up numbers (stepped, mechanical) ---------- */
  function countUp(el) {
    var raw = el.getAttribute("data-count");
    var target = parseFloat(raw);
    var decimals = raw.indexOf(".") >= 0 ? raw.split(".")[1].length : 0;
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    var steps = 18, i = 0;
    var timer = setInterval(function () {
      i++;
      var v = target * (i / steps);
      if (i >= steps) { v = target; clearInterval(timer); }
      el.textContent =
        prefix +
        v.toLocaleString("en-GB", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }) +
        suffix;
    }, 46);
  }
  var counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window) {
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !seen.has(e.target)) {
          seen.add(e.target);
          countUp(e.target);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { io.observe(el); });
  } else {
    counters.forEach(countUp);
  }

  /* ---------- fitment toggle: actually filters market grid ---------- */
  var fitToggle = document.querySelector("[data-fit-toggle]");
  if (fitToggle) {
    var stateEl = fitToggle.querySelector(".ft-state");
    var counterEl = document.querySelector("[data-result-count]");
    function applyFit(on) {
      fitToggle.setAttribute("aria-pressed", on ? "true" : "false");
      if (stateEl) stateEl.textContent = on ? "ON" : "OFF";
      var rows = document.querySelectorAll("[data-fits]");
      var visible = 0;
      rows.forEach(function (row) {
        var fits = row.getAttribute("data-fits") === "true";
        var hide = on && !fits;
        row.classList.toggle("is-hidden", hide);
        if (!hide) visible++;
      });
      if (counterEl) counterEl.textContent = pad(visible);
    }
    fitToggle.addEventListener("click", function () {
      applyFit(fitToggle.getAttribute("aria-pressed") !== "true");
    });
    applyFit(false);
  }

  /* ---------- image fallback: hide broken imgs, keep #101214 panel ---------- */
  document.querySelectorAll("img").forEach(function (img) {
    img.addEventListener("error", function () { img.style.display = "none"; });
  });

  /* ---------- ticker: duplicate track content for seamless loop ---------- */
  var track = document.querySelector(".tk-track");
  if (track && !track.dataset.cloned) {
    track.innerHTML += track.innerHTML;
    track.dataset.cloned = "1";
  }

  /* ---------- stepped reveal of panels on load ---------- */
  var reveals = document.querySelectorAll("[data-reveal]");
  reveals.forEach(function (el, i) {
    el.style.visibility = "hidden";
    setTimeout(function () { el.style.visibility = "visible"; }, 60 * i);
  });
})();
