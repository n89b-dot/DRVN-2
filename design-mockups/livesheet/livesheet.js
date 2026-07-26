/* LIVESHEET — shared behaviour. "A drawing that knows what's happening." */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- reveals: spring entrance, staggered per group ---------- */
  var rv = document.querySelectorAll(".rv");
  if (reduce || !("IntersectionObserver" in window)) {
    rv.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var el = e.target;
          var idx = parseInt(el.getAttribute("data-stagger") || "0", 10);
          setTimeout(function () { el.classList.add("is-in"); }, idx * 70);
          io.unobserve(el);
        }
      });
    }, { threshold: 0.15 });
    rv.forEach(function (el) { io.observe(el); });
  }

  /* ---------- count-ups ---------- */
  document.querySelectorAll("[data-count]").forEach(function (el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    if (reduce) { el.textContent = prefix + target.toLocaleString("en-US"); return; }
    var t0 = null, dur = 900;
    function tick(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });

  /* ---------- live tickers: values that drift upward over time ---------- */
  document.querySelectorAll("[data-tick]").forEach(function (el) {
    var val = parseInt(el.getAttribute("data-tick"), 10);
    el.textContent = val.toLocaleString("en-US");
    if (reduce) return;
    setInterval(function () {
      if (Math.random() < 0.4) {
        val += 1;
        el.textContent = val.toLocaleString("en-US");
        el.animate(
          [{ color: "var(--live)" }, { color: "" }],
          { duration: 900, easing: "ease-out" }
        );
      }
    }, 4200);
  });

  /* ---------- countdowns (HH:MM:SS from data-seconds) ---------- */
  document.querySelectorAll("[data-seconds]").forEach(function (el) {
    var s = parseInt(el.getAttribute("data-seconds"), 10);
    function render() {
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      el.textContent =
        (h > 0 ? h + ":" : "") +
        String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    }
    render();
    setInterval(function () { if (s > 0) { s--; render(); } }, 1000);
  });

  /* ---------- offer work-orders: accept / counter / decline ---------- */
  document.querySelectorAll("[data-order]").forEach(function (order) {
    var meta = order.querySelector(".order__meta");
    var actions = order.querySelector(".order__actions");
    order.addEventListener("click", function (ev) {
      var act = ev.target.closest("[data-act]");
      if (!act) return;
      var kind = act.getAttribute("data-act");
      if (kind === "accept") {
        order.classList.add("is-done");
        meta.innerHTML = "ACCEPTED — job card raised · payout on delivery";
        actions.innerHTML = '<span class="chip chip--ok">SOLD ' + (order.getAttribute("data-price") || "") + "</span>";
        var takings = document.querySelector("[data-takings]");
        if (takings) {
          var cur = parseInt(takings.getAttribute("data-takings"), 10);
          var add = parseInt(order.getAttribute("data-amount") || "0", 10);
          takings.setAttribute("data-takings", cur + add);
          takings.textContent = "$" + (cur + add).toLocaleString("en-US");
          takings.animate([{ color: "var(--live)" }, { color: "" }], { duration: 1200 });
        }
      } else if (kind === "decline") {
        order.classList.add("is-gone");
        setTimeout(function () { order.remove(); }, 420);
      } else if (kind === "counter") {
        actions.innerHTML =
          '<input class="mono" data-counter-input type="text" inputmode="numeric" placeholder="$" ' +
          'style="width:90px;background:var(--paper-deep);border:0;border-radius:10px;padding:10px 12px;font-size:12px;color:var(--ink)">' +
          '<button class="btn" data-act="send">Send</button>';
        actions.querySelector("input").focus();
      } else if (kind === "send") {
        var v = actions.querySelector("[data-counter-input]").value.replace(/[^0-9]/g, "");
        if (!v) return;
        meta.innerHTML = 'COUNTERED AT <span class="cd">$' + parseInt(v, 10).toLocaleString("en-US") + "</span> — waiting on buyer";
        actions.innerHTML = '<span class="chip chip--live">COUNTER SENT</span>';
      }
    });
  });

  /* ---------- follow toggle ---------- */
  document.querySelectorAll("[data-follow]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var on = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!on));
      btn.textContent = on ? "Follow" : "Following";
      btn.classList.toggle("btn--live", !on);
    });
  });

  /* ---------- buy sheet: 2-step ---------- */
  var sheetwrap = document.querySelector("[data-sheet]");
  if (sheetwrap) {
    var step1 = sheetwrap.querySelector("[data-step1]");
    var step2 = sheetwrap.querySelector("[data-step2]");
    function openSheet() {
      sheetwrap.classList.add("is-open");
      if (step1 && step2) { step1.style.display = ""; step2.style.display = "none"; }
    }
    function closeSheet() { sheetwrap.classList.remove("is-open"); }
    document.querySelectorAll("[data-open-sheet]").forEach(function (b) { b.addEventListener("click", openSheet); });
    sheetwrap.addEventListener("click", function (e) {
      if (e.target === sheetwrap || e.target.closest("[data-close-sheet]")) closeSheet();
      if (e.target.closest("[data-confirm-sheet]")) { step1.style.display = "none"; step2.style.display = ""; }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  /* ---------- market filters ---------- */
  var filterBar = document.querySelector("[data-filters]");
  if (filterBar) {
    filterBar.addEventListener("click", function (e) {
      var b = e.target.closest(".fbtn"); if (!b) return;
      filterBar.querySelectorAll(".fbtn").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      var f = b.getAttribute("data-f");
      var n = 0;
      document.querySelectorAll("[data-cat]").forEach(function (card) {
        var show = f === "all" || card.getAttribute("data-cat") === f;
        card.style.display = show ? "" : "none";
        if (show) n++;
      });
      var count = document.querySelector("[data-result-count]");
      if (count) count.textContent = n;
    });
  }

  /* ---------- photo callout leader lines (car page) ----------
     Each .callout carries data-anchor="x,y" as % of the hero box;
     we draw a 1px leader from the callout edge to that point. */
  function drawLeaders() {
    document.querySelectorAll("[data-hero]").forEach(function (hero) {
      hero.querySelectorAll(".callout__leader").forEach(function (l) { l.remove(); });
      hero.querySelectorAll(".callout[data-anchor]").forEach(function (c) {
        var box = hero.getBoundingClientRect();
        var cb = c.getBoundingClientRect();
        var a = c.getAttribute("data-anchor").split(",");
        var ax = box.width * parseFloat(a[0]) / 100;
        var ay = box.height * parseFloat(a[1]) / 100;
        var side = c.offsetLeft + cb.width / 2 < ax ? "right" : "left";
        var sx = side === "right" ? c.offsetLeft + cb.width : c.offsetLeft;
        var sy = c.offsetTop + cb.height / 2;
        var dx = ax - sx, dy = ay - sy;
        var len = Math.sqrt(dx * dx + dy * dy);
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;
        var leader = document.createElement("span");
        leader.className = "callout__leader";
        leader.style.left = sx + "px";
        leader.style.top = sy + "px";
        leader.style.width = len + "px";
        leader.style.transform = "rotate(" + ang + "deg)";
        hero.appendChild(leader);
      });
    });
  }
  window.addEventListener("load", drawLeaders);
  window.addEventListener("resize", drawLeaders);
})();

/* ---------- tabs (car page) — hash deep-linkable ---------- */
(function () {
  var tabs = document.querySelectorAll("[data-tab]");
  if (!tabs.length) return;
  function show(name, push) {
    tabs.forEach(function (t) { t.classList.toggle("is-on", t.getAttribute("data-tab") === name); });
    document.querySelectorAll("[data-panel]").forEach(function (p) {
      p.classList.toggle("is-on", p.getAttribute("data-panel") === name);
    });
    if (push && history.replaceState) history.replaceState(null, "", "#" + name);
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { show(t.getAttribute("data-tab"), true); });
  });
  var h = (location.hash || "").replace("#", "");
  show(document.querySelector('[data-panel="' + h + '"]') ? h : tabs[0].getAttribute("data-tab"), false);
})();

/* ---------- theme: night sheet ---------- */
(function () {
  var KEY = "ls-theme", root = document.documentElement;
  function apply(t) {
    if (t === "dark") root.dataset.theme = "dark"; else delete root.dataset.theme;
    document.querySelectorAll("[data-theme-val]").forEach(function (el) {
      el.textContent = t === "dark" ? "NIGHT" : "DAY";
    });
  }
  var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "dark" ? "dark" : "light");
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme-toggle]"); if (!b) return;
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch (err) {}
    apply(next);
  });
})();

/* ---------- market: live search + fitment switch ---------- */
(function () {
  var search = document.querySelector("[data-search]");
  var fitsw = document.querySelector("[data-fitswitch]");
  function applyMarket() {
    var q = search ? search.value.trim().toLowerCase() : "";
    var fitOnly = fitsw ? fitsw.getAttribute("aria-pressed") === "true" : false;
    var n = 0;
    document.querySelectorAll("[data-cat]").forEach(function (card) {
      var name = (card.getAttribute("data-name") || card.textContent).toLowerCase();
      var okQ = !q || name.indexOf(q) !== -1;
      var okF = !fitOnly || card.getAttribute("data-fit") === "yes";
      var activeF = document.querySelector("[data-filters] .fbtn.is-on");
      var f = activeF ? activeF.getAttribute("data-f") : "all";
      var okC = f === "all" || card.getAttribute("data-cat") === f;
      var show = okQ && okF && okC;
      card.style.display = show ? "" : "none";
      if (show) n++;
    });
    var count = document.querySelector("[data-result-count]");
    if (count) count.textContent = n;
  }
  if (search) search.addEventListener("input", applyMarket);
  if (fitsw) fitsw.addEventListener("click", function () {
    var on = fitsw.getAttribute("aria-pressed") === "true";
    fitsw.setAttribute("aria-pressed", String(!on));
    fitsw.classList.toggle("is-on", !on);
    var lbl = fitsw.querySelector("b");
    if (lbl) lbl.textContent = on ? "OFF" : "ON";
    applyMarket();
  });
  var fb = document.querySelector("[data-filters]");
  if (fb && (search || fitsw)) fb.addEventListener("click", function () { setTimeout(applyMarket, 0); });
})();

/* ============================================================
   PARITY PASS (Pass 9) — toast, release modal, dispatch form,
   settings dirty-flag/save, theme-select sync (delegates to the
   existing [data-theme-toggle] mechanism — no second store).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- toast helper ---------- */
  var toastEl = null, toastTimer;
  function lsToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-shown"); }, 2600);
  }
  window.lsToast = lsToast;
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-toast]");
    if (!t) return;
    if (t.tagName === "A") e.preventDefault();
    lsToast(t.getAttribute("data-toast"));
  });

  /* ---------- release-a-part modal (garage) — one instance, prefilled ---------- */
  var rel = document.getElementById("releaseSheet");
  if (rel) {
    var rs1 = rel.querySelector("[data-step1]");
    var rs2 = rel.querySelector("[data-step2]");
    var relName = rel.querySelector("#relName");
    var relCond = rel.querySelector("#relCond");
    var relPrice = rel.querySelector("#relPrice");
    var srcLine = null;
    function openRelease(btn) {
      srcLine = btn ? btn.closest(".bline") : null;
      relName.value = btn ? (btn.getAttribute("data-part") || "") : "";
      if (btn && btn.getAttribute("data-cond")) relCond.value = btn.getAttribute("data-cond");
      else relCond.selectedIndex = 1;
      relPrice.value = btn ? (btn.getAttribute("data-price") || "") : "";
      rs1.style.display = ""; rs2.style.display = "none";
      rel.classList.add("is-open");
      relName.focus();
    }
    document.querySelectorAll("[data-release]").forEach(function (b) {
      b.addEventListener("click", function () { openRelease(b.hasAttribute("data-part") ? b : null); });
    });
    rel.addEventListener("click", function (e) {
      if (e.target === rel || e.target.closest("[data-close-release]")) rel.classList.remove("is-open");
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") rel.classList.remove("is-open"); });
    rel.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var p = parseInt(String(relPrice.value).replace(/[^0-9]/g, ""), 10);
      var sum = rel.querySelector("[data-rel-summary]");
      if (sum) sum.textContent = (relName.value || "Part") + (p ? " — asking $" + p.toLocaleString("en-US") : "");
      rs1.style.display = "none"; rs2.style.display = "";
      if (srcLine) {
        var chip = srcLine.querySelector(".chip");
        if (chip) { chip.className = "chip chip--live"; chip.textContent = "DRAFT RAISED"; }
        var act = srcLine.querySelector(".relbtn");
        if (act) act.remove();
      }
      lsToast("DRAFT LISTING RAISED — PROVENANCE ATTACHED FROM SHEET C-0416");
    });
  }

  /* ---------- dispatch form (orders) — advances the job pipeline ---------- */
  var dbtn = document.querySelector("[data-dispatch]");
  if (dbtn) {
    dbtn.addEventListener("click", function () {
      var tr = document.querySelector("[data-tracking]");
      if (tr && !tr.value.trim()) { lsToast("ENTER A TRACKING NUMBER FIRST"); tr.focus(); return; }
      var pipe = document.querySelector(dbtn.getAttribute("data-dispatch"));
      if (pipe) {
        var next = pipe.querySelector(".pip:not(.is-on)");
        if (next) next.classList.add("is-on");
      }
      var state = document.querySelector("[data-job-state]");
      if (state) { state.className = "chip chip--ok"; state.textContent = "DISPATCHED · " + (tr ? tr.value.trim().toUpperCase() : ""); }
      var due = document.querySelector("[data-dispatch-due]");
      if (due) due.remove();
      dbtn.replaceWith(Object.assign(document.createElement("span"), { className: "chip chip--ok", textContent: "DISPATCHED" }));
      lsToast("JOB #1058 MARKED DISPATCHED — @KESSLER.M NOTIFIED");
    });
  }

  /* ---------- settings: dirty flag + save ---------- */
  var cfg = document.querySelector("[data-config]");
  if (cfg) {
    var pending = document.querySelector("[data-pending]");
    function setDirty(on) { if (pending) pending.style.visibility = on ? "visible" : "hidden"; }
    setDirty(false);
    ["input", "change"].forEach(function (ev) {
      cfg.addEventListener(ev, function (e) { if (!e.target.closest("[data-nodirty]")) setDirty(true); });
    });
    var save = document.querySelector("[data-save]");
    if (save) save.addEventListener("click", function () { setDirty(false); lsToast("SHEET SAVED — REV 17 FILED"); });
  }

  /* ---------- settings: theme select — syncs with the bar toggle ---------- */
  var tsel = document.querySelector("[data-theme-select]");
  if (tsel) {
    var root = document.documentElement;
    function syncSel() { tsel.value = root.dataset.theme === "dark" ? "dark" : "light"; }
    syncSel();
    tsel.addEventListener("change", function () {
      var wantDark = tsel.value === "dark";
      if ((root.dataset.theme === "dark") !== wantDark) {
        var tog = document.querySelector("[data-theme-toggle]");
        if (tog) tog.click(); /* single source of truth: the existing toggle */
      }
    });
    if ("MutationObserver" in window) {
      new MutationObserver(syncSel).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    }
  }
})();

/* ---------- order pipeline advance (dashboard) ---------- */
document.querySelectorAll("[data-advance]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var pipe = document.querySelector(btn.getAttribute("data-advance"));
    if (!pipe) return;
    var next = pipe.querySelector(".pip:not(.is-on)");
    if (next) { next.classList.add("is-on"); }
    var steps = pipe.querySelectorAll(".pip");
    var on = pipe.querySelectorAll(".pip.is-on").length;
    if (on >= steps.length) { btn.replaceWith(Object.assign(document.createElement("span"), {className:"chip chip--ok", textContent:"DELIVERED"})); }
  });
});
