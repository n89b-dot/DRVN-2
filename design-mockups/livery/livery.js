/* LIVERY — shared interactions */
(function () {
  "use strict";

  /* ---------- Burger nav ---------- */
  var burger = document.querySelector(".burger");
  var navLinks = document.querySelector(".nav-links");
  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      var open = navLinks.classList.toggle("open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.textContent = open ? "CLOSE" : "MENU";
    });
  }

  /* ---------- Stripe dividers slide in on scroll ---------- */
  var stripes = document.querySelectorAll(".stripe-divider");
  stripes.forEach(function (s) { s.classList.add("pre-anim"); });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("animate");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    stripes.forEach(function (s) { io.observe(s); });
  } else {
    stripes.forEach(function (s) { s.classList.add("animate"); });
  }

  /* ---------- Countdown chips ----------
     Any element with [data-countdown="HH:MM:SS"] ticks down live. */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  var counters = document.querySelectorAll("[data-countdown]");
  if (counters.length) {
    var targets = [];
    counters.forEach(function (el) {
      var parts = el.getAttribute("data-countdown").split(":").map(Number);
      var secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      targets.push({ el: el, deadline: Date.now() + secs * 1000 });
    });
    function tick() {
      var now = Date.now();
      targets.forEach(function (t) {
        var remain = Math.max(0, Math.floor((t.deadline - now) / 1000));
        var h = Math.floor(remain / 3600);
        var m = Math.floor((remain % 3600) / 60);
        var s = remain % 60;
        t.el.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);
        if (remain <= 3600) t.el.classList.add("red");
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- Pit-board flip counter (dashboard greeting) ----------
     Element with [data-flip] cycles through comma-separated values with a flip. */
  document.querySelectorAll("[data-flip]").forEach(function (el) {
    var values = el.getAttribute("data-flip").split(",");
    var i = 0;
    setInterval(function () {
      i = (i + 1) % values.length;
      el.classList.remove("flip-anim");
      void el.offsetWidth; /* restart animation */
      el.textContent = values[i];
      el.classList.add("flip-anim");
    }, 3200);
  });

  /* ---------- Accept-offer confirm overlay ---------- */
  var overlay = document.getElementById("accept-overlay");
  if (overlay) {
    var boardPart = overlay.querySelector("[data-board-part]");
    var boardAmt = overlay.querySelector("[data-board-amt]");
    var boardBuyer = overlay.querySelector("[data-board-buyer]");
    var lastTrigger = null;

    document.querySelectorAll("[data-accept]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        lastTrigger = btn;
        boardPart.textContent = btn.getAttribute("data-part");
        boardAmt.textContent = btn.getAttribute("data-amount");
        boardBuyer.textContent = btn.getAttribute("data-buyer");
        overlay.classList.add("open");
        overlay.querySelector(".btn.green").focus();
      });
    });

    function closeOverlay() {
      overlay.classList.remove("open");
      if (lastTrigger) lastTrigger.focus();
    }
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });
    overlay.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", closeOverlay);
    });
    var confirmBtn = overlay.querySelector("[data-confirm-accept]");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        var card = lastTrigger ? lastTrigger.closest(".offer-card") : null;
        if (card) {
          var chip = card.querySelector(".countdown-chip");
          if (chip) {
            chip.classList.remove("yellow", "red");
            chip.classList.add("green");
            chip.textContent = "ACCEPTED — DEAL DONE";
            chip.removeAttribute("data-countdown");
          }
          card.querySelectorAll(".offer-actions button").forEach(function (b) { b.disabled = true; b.style.opacity = ".35"; });
        }
        closeOverlay();
        toast("OFFER ACCEPTED — BUYER NOTIFIED");
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
    });
  }

  /* ---------- Release-a-part modal (garage) ---------- */
  var releaseOverlay = document.getElementById("release-overlay");
  if (releaseOverlay) {
    var openBtn = document.getElementById("release-open");
    if (openBtn) {
      openBtn.addEventListener("click", function () {
        releaseOverlay.classList.add("open");
        releaseOverlay.querySelector("input").focus();
      });
    }
    releaseOverlay.addEventListener("click", function (e) { if (e.target === releaseOverlay) releaseOverlay.classList.remove("open"); });
    releaseOverlay.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { releaseOverlay.classList.remove("open"); });
    });
    var relForm = releaseOverlay.querySelector("form");
    if (relForm) {
      relForm.addEventListener("submit", function (e) {
        e.preventDefault();
        releaseOverlay.classList.remove("open");
        toast("PART RELEASED TO PIT LANE — LISTING LIVE");
        relForm.reset();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") releaseOverlay.classList.remove("open");
    });
  }

  /* ---------- Timing-tower: tabs + expanding rows ---------- */
  var tower = document.getElementById("tower");
  if (tower) {
    /* expand/collapse */
    tower.querySelectorAll(".tower-row").forEach(function (row) {
      row.addEventListener("click", function () {
        var detail = document.getElementById(row.getAttribute("aria-controls"));
        var isOpen = detail.classList.contains("open");
        /* close all */
        tower.querySelectorAll(".tower-detail.open").forEach(function (d) { d.classList.remove("open"); });
        tower.querySelectorAll(".tower-row.expanded").forEach(function (r) {
          r.classList.remove("expanded");
          r.setAttribute("aria-expanded", "false");
        });
        if (!isOpen) {
          detail.classList.add("open");
          row.classList.add("expanded");
          row.setAttribute("aria-expanded", "true");
        }
      });
    });
    /* tabs filter */
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(function (t) { t.setAttribute("aria-selected", "false"); });
        tab.setAttribute("aria-selected", "true");
        var filter = tab.getAttribute("data-filter");
        tower.querySelectorAll(".tower-row").forEach(function (row) {
          var status = row.getAttribute("data-status");
          var show = filter === "all" || status === filter;
          row.style.display = show ? "" : "none";
          var detail = document.getElementById(row.getAttribute("aria-controls"));
          if (detail && !show) { detail.classList.remove("open"); row.classList.remove("expanded"); }
        });
      });
    });
    /* row action buttons shouldn't toggle the row */
    tower.querySelectorAll(".tower-detail .btn").forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        toast(b.textContent.trim() + " — DONE");
      });
    });
  }

  /* ---------- Race lights (orders) ---------- */
  var lightsRow = document.getElementById("race-lights");
  if (lightsRow) {
    var stages = Array.prototype.slice.call(lightsRow.querySelectorAll(".light-stage"));
    var dispatchForm = document.getElementById("dispatch-form");
    function currentIndex() {
      for (var i = 0; i < stages.length; i++) {
        if (stages[i].classList.contains("current")) return i;
      }
      return -1;
    }
    function advance() {
      var i = currentIndex();
      if (i === -1 || i >= stages.length - 1) return;
      stages[i].classList.remove("current");
      stages[i].classList.add("done");
      var t = stages[i].querySelector(".stage-time");
      if (t && t.textContent === "—") t.textContent = "JUST NOW";
      stages[i + 1].classList.remove("pending");
      stages[i + 1].classList.add("current");
    }
    if (dispatchForm) {
      dispatchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var carrier = dispatchForm.querySelector("#carrier").value;
        var tracking = dispatchForm.querySelector("#tracking").value.trim();
        if (!tracking) {
          dispatchForm.querySelector("#tracking").focus();
          toast("ENTER A TRACKING NUMBER FIRST");
          return;
        }
        advance();
        toast("LIGHTS OUT — DISPATCHED VIA " + carrier.toUpperCase());
        var btn = dispatchForm.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.style.opacity = ".4";
        btn.textContent = "DISPATCHED ✓";
      });
    }
  }

  /* ---------- Toast ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }
  window.liveryToast = toast;
})();
