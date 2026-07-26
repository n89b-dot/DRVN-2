/* ============================================================
   WERKBANK — shared behaviour
   Precise, instrument-like. No easing theatrics.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Dimension lines: draw in on scroll ---------- */
  const dims = document.querySelectorAll("[data-dim]");
  if ("IntersectionObserver" in window && dims.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-drawn");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    dims.forEach((d) => io.observe(d));
  } else {
    dims.forEach((d) => d.classList.add("is-drawn"));
  }

  /* ---------- Numbers tick up ---------- */
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || "";
    const dur = 700;
    const t0 = performance.now();
    const fmt = (n) =>
      prefix + Math.round(n).toLocaleString("en-GB");
    function step(t) {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });

  /* ---------- SVG chart: stroke draw ---------- */
  document.querySelectorAll(".wb-chart .line").forEach((path) => {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    path.style.strokeDashoffset = len;
    path.getBoundingClientRect(); // force layout
    path.style.transition = "stroke-dashoffset 900ms cubic-bezier(0.2,0,0,1)";
    requestAnimationFrame(() => (path.style.strokeDashoffset = "0"));
  });

  /* ---------- Toast ---------- */
  let toastEl = document.querySelector(".wb-toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "wb-toast";
    toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);
  }
  let toastTimer;
  window.wbToast = function (msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-shown"), 2600);
  };

  /* ---------- Modals / confirm sheets ----------
     Trigger: [data-modal-open="id"] — Target: .wb-scrim#id */
  document.querySelectorAll("[data-modal-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scrim = document.getElementById(btn.dataset.modalOpen);
      if (!scrim) return;
      // One sheet at a time — close any other open scrim first
      document.querySelectorAll(".wb-scrim.is-open").forEach((s) => {
        if (s !== scrim) s.classList.remove("is-open");
      });
      // Optional payload -> fill [data-slot] targets in sheet
      if (btn.dataset.payload) {
        try {
          const p = JSON.parse(btn.dataset.payload);
          Object.keys(p).forEach((k) => {
            const slot = scrim.querySelector('[data-slot="' + k + '"]');
            if (slot) slot.textContent = p[k];
          });
        } catch (_) {}
      }
      scrim.classList.add("is-open");
      const focusable = scrim.querySelector("button, input, select");
      if (focusable) focusable.focus();
    });
  });
  document.querySelectorAll(".wb-scrim").forEach((scrim) => {
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim || e.target.closest("[data-modal-close]")) {
        scrim.classList.remove("is-open");
      }
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".wb-scrim.is-open").forEach((s) => s.classList.remove("is-open"));
    }
  });

  /* ---------- Offer actions (dashboard) ---------- */
  document.querySelectorAll("[data-offer-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const scrim = btn.closest(".wb-scrim");
      if (scrim) scrim.classList.remove("is-open");
      const row = document.querySelector('[data-offer-row="' + btn.dataset.offerConfirm + '"]');
      if (row) {
        row.style.transition = "opacity 300ms ease-out";
        row.style.opacity = "0.35";
        const actions = row.querySelector(".wb-offer__actions");
        if (actions) actions.innerHTML = '<span class="wb-tag wb-tag--fill">ACCEPTED</span>';
      }
      wbToast("OFFER ACCEPTED — ORDER RAISED");
    });
  });
  document.querySelectorAll("[data-offer-decline]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("[data-offer-row]");
      if (row) {
        row.style.transition = "opacity 300ms ease-out";
        row.style.opacity = "0.35";
        row.querySelector(".wb-offer__actions").innerHTML =
          '<span class="wb-tag">DECLINED</span>';
      }
      wbToast("OFFER DECLINED");
    });
  });
  document.querySelectorAll("[data-offer-counter]").forEach((btn) => {
    btn.addEventListener("click", () => wbToast("COUNTER SENT — £" + (btn.dataset.offerCounter || "—")));
  });

  /* ---------- Countdowns ----------
     [data-countdown="HH:MM:SS"] ticks down every second */
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    const parts = el.dataset.countdown.split(":").map(Number);
    let secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    const pad = (n) => String(n).padStart(2, "0");
    const render = () => {
      const h = Math.floor(secs / 3600),
        m = Math.floor((secs % 3600) / 60),
        s = secs % 60;
      el.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);
    };
    render();
    const iv = setInterval(() => {
      secs = Math.max(0, secs - 1);
      render();
      if (secs === 0) clearInterval(iv);
    }, 1000);
  });

  /* ---------- Accordion rows (listings) ---------- */
  document.querySelectorAll(".wb-acc__row").forEach((row) => {
    row.setAttribute("aria-expanded", "false");
    row.setAttribute("tabindex", "0");
    const toggle = () => {
      const panel = row.nextElementSibling;
      if (!panel || !panel.classList.contains("wb-acc__panel")) return;
      const inner = panel.querySelector(".wb-acc__inner");
      const open = row.getAttribute("aria-expanded") === "true";
      // close others
      document.querySelectorAll('.wb-acc__row[aria-expanded="true"]').forEach((r) => {
        if (r !== row) {
          r.setAttribute("aria-expanded", "false");
          const i = r.nextElementSibling.querySelector(".wb-acc__inner");
          if (i) i.style.maxHeight = "0px";
        }
      });
      row.setAttribute("aria-expanded", String(!open));
      inner.style.maxHeight = open ? "0px" : inner.scrollHeight + "px";
    };
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) return;
      toggle();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });

  /* ---------- Filter tabs (listings) ---------- */
  const tabs = document.querySelectorAll(".wb-tab[data-filter]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const f = tab.dataset.filter;
      document.querySelectorAll("[data-status]").forEach((row) => {
        const show = f === "all" || row.dataset.status === f;
        row.style.display = show ? "" : "none";
        // hide attached accordion panel too
        const panel = row.nextElementSibling;
        if (panel && panel.classList.contains("wb-acc__panel")) {
          panel.style.display = show ? "" : "none";
          if (!show) {
            row.setAttribute("aria-expanded", "false");
            const i = panel.querySelector(".wb-acc__inner");
            if (i) i.style.maxHeight = "0px";
          }
        }
      });
    });
  });

  /* ---------- Dispatch pipeline (orders) ---------- */
  const dispatchBtn = document.getElementById("markDispatched");
  if (dispatchBtn) {
    dispatchBtn.addEventListener("click", () => {
      const tracking = document.getElementById("trackingInput");
      if (tracking && tracking.value.trim() === "") {
        tracking.focus();
        tracking.style.borderColor = "var(--wb-accent)";
        wbToast("TRACKING NO. REQUIRED");
        return;
      }
      const steps = document.querySelectorAll(".wb-pipe__step");
      const current = document.querySelector(".wb-pipe__step.is-current");
      if (current) {
        current.classList.remove("is-current");
        current.classList.add("is-done");
        const next = current.nextElementSibling;
        if (next) next.classList.add("is-current");
      }
      const stateTag = document.getElementById("orderStateTag");
      if (stateTag) stateTag.textContent = "DELIVERED — AWAITING CONFIRM";
      dispatchBtn.disabled = true;
      dispatchBtn.textContent = "DISPATCHED ✓";
      dispatchBtn.classList.remove("wb-btn--accent");
      wbToast("MARKED DISPATCHED — BUYER NOTIFIED");
    });
  }

  /* ---------- Release-a-part form (garage modal) ---------- */
  const releaseForm = document.getElementById("releaseForm");
  if (releaseForm) {
    releaseForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("relName").value.trim();
      if (!name) {
        document.getElementById("relName").focus();
        return;
      }
      releaseForm.closest(".wb-scrim").classList.remove("is-open");
      wbToast("DRAFT LISTING CREATED — " + name.toUpperCase());
      releaseForm.reset();
    });
  }
})();

/* ---------- Theme (shift) toggle ---------- */
(function () {
  var KEY = "wb-theme";
  var root = document.documentElement;
  function apply(theme) {
    if (theme === "dark") { root.dataset.theme = "dark"; } else { delete root.dataset.theme; }
    document.querySelectorAll("[data-theme-val]").forEach(function (el) {
      el.textContent = theme === "dark" ? "NIGHT" : "DAY";
    });
    var btn = document.getElementById("wbTheme");
    if (btn) btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved === "dark" ? "dark" : "light");
  var btn = document.getElementById("wbTheme");
  if (btn) btn.addEventListener("click", function () {
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  });
})();

/* ============================================================
   PASS 6 — record tabs + mobile menu
   ============================================================ */

/* ---------- Record / profile panel tabs ----------
   Trigger: .wb-tab[data-panel-tab="panelId"] — Target: .wb-panel#panelId
   Deep-linkable: #panelId in the URL selects that tab on load. */
(function () {
  "use strict";
  var tabs = document.querySelectorAll("[data-panel-tab]");
  if (!tabs.length) return;

  function activate(tab, updateHash) {
    var group = tab.closest(".wb-tabrow") || document;
    group.querySelectorAll("[data-panel-tab]").forEach(function (t) {
      var on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      var panel = document.getElementById(t.dataset.panelTab);
      if (panel) panel.classList.toggle("is-active", on);
    });
    if (updateHash && history.replaceState) {
      history.replaceState(null, "", "#" + tab.dataset.panelTab);
    }
  }

  tabs.forEach(function (tab) {
    tab.setAttribute("role", "tab");
    tab.addEventListener("click", function () { activate(tab, true); });
  });

  var fromHash = location.hash &&
    document.querySelector('[data-panel-tab="' + location.hash.slice(1) + '"]');
  if (fromHash) activate(fromHash, false);
})();

/* ---------- Mobile menu (≤640px) ----------
   Built from the tool-rail when present, otherwise from
   [data-mobile-link] anchors in the public masthead. */
(function () {
  "use strict";
  var rail = document.querySelector(".wb-rail");
  var mast = document.querySelector(".wb-mast");
  if (!rail && !mast) return;

  /* Collect nav items */
  var items = [];
  if (rail) {
    rail.querySelectorAll(".wb-rail__item").forEach(function (a) {
      items.push({
        href: a.getAttribute("href"),
        label: a.querySelector(".label") ? a.querySelector(".label").textContent : a.textContent.trim(),
        idx: a.querySelector(".wb-rail__idx") ? a.querySelector(".wb-rail__idx").textContent : "",
        active: a.classList.contains("is-active"),
        stub: a.classList.contains("is-stub")
      });
    });
  } else {
    mast.querySelectorAll("[data-mobile-link]").forEach(function (a) {
      items.push({
        href: a.getAttribute("href"),
        label: a.textContent.trim(),
        idx: "",
        active: false,
        stub: false
      });
    });
  }

  /* Scrim + panel */
  var scrim = document.createElement("div");
  scrim.className = "wb-menu-scrim";
  var menu = document.createElement("nav");
  menu.className = "wb-menu";
  menu.id = "wbMenu";
  menu.setAttribute("aria-label", "Mobile");
  var navHtml = items.map(function (it) {
    return '<a class="wb-menu__item' + (it.active ? " is-active" : "") + (it.stub ? " is-stub" : "") + '" href="' + it.href + '"' + (it.active ? ' aria-current="page"' : "") + '>' +
      '<span>' + it.label + '</span>' +
      (it.idx ? '<span class="wb-rail__idx">' + it.idx + '</span>' : "") +
      '</a>';
  }).join("");
  var userHtml = rail
    ? '<a class="wb-rail__user" href="profile.html" style="padding:0"><div class="wb-rail__avatar">LV</div><div><div class="wb-rail__username">L. VOGEL</div><div class="wb-rail__workshop">Workshop 7 · @werk7</div></div></a>'
    : '<a class="wb-btn wb-btn--accent" href="index.html">Open the workshop</a>';
  menu.innerHTML =
    '<div class="wb-menu__head">' +
      '<span class="microlabel microlabel--ink">INDEX — SHEETS</span>' +
      '<button class="wb-sheet__close" type="button" data-menu-close aria-label="Close menu">ESC ×</button>' +
    '</div>' +
    '<div class="wb-menu__nav">' + navHtml + '</div>' +
    '<div class="wb-menu__foot">' +
      '<button class="wb-rail__theme" type="button" data-menu-theme>' +
        '<span class="microlabel">Shift</span>' +
        '<span class="wb-rail__theme-val mono" data-theme-val>DAY</span>' +
      '</button>' + userHtml +
    '</div>';
  document.body.appendChild(scrim);
  document.body.appendChild(menu);

  /* Sync the cloned theme value with the saved shift */
  try {
    if (localStorage.getItem("wb-theme") === "dark") {
      menu.querySelector("[data-theme-val]").textContent = "NIGHT";
    }
  } catch (e) {}

  /* Burger: build the fixed bar on rail pages; reuse masthead slot on home */
  var burger;
  if (rail) {
    var bar = document.createElement("div");
    bar.className = "wb-mobilebar";
    bar.innerHTML = '<a class="wb-rail__logo mono" href="index.html">DRVN<b style="color:var(--wb-accent)">/</b>WERKBANK</a>';
    burger = document.createElement("button");
    bar.appendChild(burger);
    document.body.insertBefore(bar, document.body.firstChild);
  } else {
    burger = document.getElementById("wbBurger") || document.createElement("button");
    if (!burger.parentNode) mast.appendChild(burger);
  }
  burger.className = "wb-burger";
  burger.type = "button";
  burger.setAttribute("aria-label", "Open menu");
  burger.setAttribute("aria-expanded", "false");
  burger.setAttribute("aria-controls", "wbMenu");
  burger.innerHTML = "<span></span><span></span>";

  function setOpen(open) {
    menu.classList.toggle("is-open", open);
    scrim.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.style.overflow = open ? "hidden" : "";
  }
  burger.addEventListener("click", function () {
    setOpen(!menu.classList.contains("is-open"));
  });
  scrim.addEventListener("click", function () { setOpen(false); });
  menu.addEventListener("click", function (e) {
    if (e.target.closest("[data-menu-close]") || e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.classList.contains("is-open")) setOpen(false);
  });

  /* Menu shift button drives the canonical #wbTheme toggle */
  menu.querySelector("[data-menu-theme]").addEventListener("click", function () {
    var main = document.getElementById("wbTheme");
    if (main) main.click();
  });
})();

/* ============================================================
   PASS 7 — configuration & commerce
   settings.html (dirty flag, save, theme preference control,
   close-workshop sheet) + part.html (thumb strip, offer sheet,
   multi-step purchase flow).
   ============================================================ */

/* ---------- Settings sheet (settings.html) ---------- */
(function () {
  "use strict";
  var saveBar = document.getElementById("configSaveBar");
  if (!saveBar) return;

  var revEl = document.getElementById("configRev");
  var rev = 13;

  function setDirty(on) { saveBar.classList.toggle("is-dirty", on); }

  /* Any touched field flags the sheet as pending — controls marked
     data-nodirty (the SHIFT preference applies instantly) are exempt. */
  document.querySelectorAll("[data-config] input, [data-config] select, [data-config] textarea").forEach(function (el) {
    if (el.hasAttribute("data-nodirty")) return;
    el.addEventListener("input", function () { setDirty(true); });
    el.addEventListener("change", function () { setDirty(true); });
  });

  document.getElementById("configSave").addEventListener("click", function () {
    setDirty(false);
    wbToast("CONFIGURATION FILED — REV " + rev);
    if (revEl) revEl.textContent = "REV " + rev;
    rev++;
  });

  /* SHIFT preference select — drives the canonical #wbTheme toggle
     so localStorage("wb-theme") stays the single source of truth. */
  var pref = document.getElementById("themePref");
  if (pref) {
    var syncPref = function () {
      pref.value = document.documentElement.dataset.theme === "dark" ? "night" : "day";
    };
    syncPref();
    pref.addEventListener("change", function () {
      var wantDark = pref.value === "night";
      var isDark = document.documentElement.dataset.theme === "dark";
      if (wantDark !== isDark) {
        var main = document.getElementById("wbTheme");
        if (main) main.click();
      }
    });
    var themeBtn = document.getElementById("wbTheme");
    if (themeBtn) themeBtn.addEventListener("click", function () {
      /* run after the toggle handler has applied the theme */
      setTimeout(syncPref, 0);
    });
  }

  /* Close-workshop confirm — always cancels safely in the prototype */
  var closeConfirm = document.getElementById("closeWorkshopConfirm");
  if (closeConfirm) {
    closeConfirm.addEventListener("click", function () {
      closeConfirm.closest(".wb-scrim").classList.remove("is-open");
      wbToast("CLOSURE REQUEST NOT FILED — NOTHING CHANGED");
    });
  }
})();

/* ---------- Part record (part.html) ---------- */
(function () {
  "use strict";
  var mainImg = document.getElementById("partMainImg");
  if (!mainImg) return;

  /* Thumb strip swaps the main plate image */
  document.querySelectorAll("[data-thumb]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-thumb]").forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      mainImg.src = btn.dataset.thumb;
      mainImg.alt = btn.dataset.alt || mainImg.alt;
      var ref = document.getElementById("photoRef");
      if (ref && btn.dataset.ref) ref.textContent = btn.dataset.ref;
    });
  });

  /* Offer sheet — validated against the keeper's £900 floor */
  var offerForm = document.getElementById("offerForm");
  if (offerForm) {
    offerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("offerAmount");
      var hint = document.getElementById("offerHint");
      var v = parseFloat(input.value);
      if (isNaN(v) || v <= 0) {
        input.focus();
        hint.textContent = "ENTER AN AMOUNT IN £";
        hint.style.color = "var(--wb-danger)";
        return;
      }
      if (v < 900) {
        input.focus();
        hint.textContent = "BELOW THE KEEPER'S £900 FLOOR — WILL AUTO-DECLINE";
        hint.style.color = "var(--wb-danger)";
        return;
      }
      offerForm.closest(".wb-scrim").classList.remove("is-open");
      wbToast("OFFER FILED — £" + Math.round(v).toLocaleString("en-GB") + " · EXPIRES IN 48 H");
      offerForm.reset();
      hint.textContent = "KEEPER'S FLOOR IS £900 — OFFERS BELOW AUTO-DECLINE";
      hint.style.color = "";
    });
  }

  /* Multi-step purchase sheet */
  var buySheet = document.getElementById("buySheet");
  if (buySheet) {
    var step = 1;
    var panels = buySheet.querySelectorAll(".wb-step-panel");
    var ticks = buySheet.querySelectorAll(".wb-ticks__n");

    function show(n) {
      step = n;
      panels.forEach(function (p) {
        p.classList.toggle("is-active", parseInt(p.dataset.step, 10) === n);
      });
      ticks.forEach(function (t, i) {
        t.classList.toggle("is-current", i + 1 === n);
        t.classList.toggle("is-done", i + 1 < n);
      });
    }

    /* Reset to step 1 every time the sheet opens */
    document.querySelectorAll('[data-modal-open="buySheet"]').forEach(function (btn) {
      btn.addEventListener("click", function () { show(1); });
    });

    buySheet.querySelectorAll("[data-step-next]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        show(Math.min(step + 1, panels.length));
        if (step === panels.length) wbToast("ORDER FILED — JOB CARD #1048");
      });
    });
    buySheet.querySelectorAll("[data-step-back]").forEach(function (btn) {
      btn.addEventListener("click", function () { show(Math.max(step - 1, 1)); });
    });
    show(1);
  }
})();
