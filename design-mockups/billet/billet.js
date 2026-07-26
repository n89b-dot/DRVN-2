/* BILLET — shared behaviour. Machine-tolerance interactions only. */
(function () {
  "use strict";

  /* ---------- Milling reveal on scroll ---------- */
  var mills = document.querySelectorAll(".mill");
  if ("IntersectionObserver" in window && mills.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("milled");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
    mills.forEach(function (m) { io.observe(m); });
  } else {
    mills.forEach(function (m) { m.classList.add("milled"); });
  }

  /* ---------- Toast ---------- */
  window.billetToast = function (msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.querySelector(".toast-msg").textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  };

  /* ==========================================================
     MARKET — chips filter, search, sort, fitment switch
     ========================================================== */
  var grid = document.getElementById("market-grid");
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll("[data-cat]"));
    var chips = document.querySelectorAll(".chip[data-filter]");
    var search = document.getElementById("market-search");
    var sortSel = document.getElementById("market-sort");
    var priceSel = document.getElementById("market-price");
    var fitSwitch = document.getElementById("fit-switch");
    var countEl = document.getElementById("market-count");
    var noRes = document.getElementById("no-results");
    var state = { cat: "all", q: "", fit: false, price: "any", sort: "featured" };

    function priceOk(p) {
      if (state.price === "any") return true;
      if (state.price === "u250") return p < 250;
      if (state.price === "250-1000") return p >= 250 && p <= 1000;
      return p > 1000;
    }

    function apply() {
      var shown = 0;
      var visible = [];
      cards.forEach(function (c) {
        var ok =
          (state.cat === "all" || c.dataset.cat === state.cat) &&
          (!state.fit || c.dataset.fit === "verified") &&
          priceOk(parseFloat(c.dataset.price)) &&
          (state.q === "" || c.dataset.title.toLowerCase().indexOf(state.q) !== -1);
        c.style.display = ok ? "" : "none";
        if (ok) { shown++; visible.push(c); }
      });
      visible.sort(function (a, b) {
        var pa = parseFloat(a.dataset.price), pb = parseFloat(b.dataset.price);
        if (state.sort === "price-asc") return pa - pb;
        if (state.sort === "price-desc") return pb - pa;
        return parseInt(a.dataset.order, 10) - parseInt(b.dataset.order, 10);
      });
      visible.forEach(function (c) { grid.appendChild(c); });
      if (noRes) { noRes.style.display = shown ? "none" : ""; grid.appendChild(noRes); }
      if (countEl) countEl.textContent = shown + " parts on the bench";
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        chip.setAttribute("aria-pressed", "true");
        state.cat = chip.dataset.filter;
        apply();
      });
    });
    if (search) search.addEventListener("input", function () { state.q = search.value.trim().toLowerCase(); apply(); });
    if (sortSel) sortSel.addEventListener("change", function () { state.sort = sortSel.value; apply(); });
    if (priceSel) priceSel.addEventListener("change", function () { state.price = priceSel.value; apply(); });
    if (fitSwitch) fitSwitch.addEventListener("click", function () {
      state.fit = !state.fit;
      fitSwitch.setAttribute("aria-checked", String(state.fit));
      apply();
    });
    apply();
  }

  /* ==========================================================
     LISTING — gallery swap, purchase sheet, offer sheet
     ========================================================== */
  var mainImg = document.getElementById("gallery-main-img");
  if (mainImg) {
    var thumbs = document.querySelectorAll(".g-thumb[data-src]");
    thumbs.forEach(function (t) {
      t.addEventListener("click", function () {
        thumbs.forEach(function (x) { x.setAttribute("aria-current", "false"); });
        t.setAttribute("aria-current", "true");
        mainImg.src = t.dataset.src;
        mainImg.alt = t.dataset.alt || mainImg.alt;
      });
    });
  }

  function wireSheet(openBtnId, sheetId) {
    var btn = document.getElementById(openBtnId);
    var sheet = document.getElementById(sheetId);
    var veil = document.getElementById("sheet-veil");
    if (!btn || !sheet || !veil) return null;
    function open() {
      document.querySelectorAll(".sheet.open").forEach(function (s) { s.classList.remove("open"); });
      sheet.classList.add("open");
      veil.classList.add("open");
      var f = sheet.querySelector("button, input");
      if (f) f.focus();
    }
    function close() { sheet.classList.remove("open"); veil.classList.remove("open"); btn.focus(); }
    btn.addEventListener("click", open);
    sheet.querySelectorAll(".sheet-close").forEach(function (c) { c.addEventListener("click", close); });
    veil.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheet.classList.contains("open")) close(); });
    return { open: open, close: close, el: sheet };
  }

  var buySheet = wireSheet("buy-open", "buy-sheet");
  if (buySheet) {
    var qty = document.getElementById("buy-qty");
    var confirmBtn = document.getElementById("buy-confirm");
    var step1 = document.getElementById("buy-step-1");
    var step2 = document.getElementById("buy-step-2");
    var unit = 1850;
    function refreshTotals() {
      var n = Math.max(1, Math.min(9, parseInt(qty.value, 10) || 1));
      qty.value = n;
      document.getElementById("buy-line-qty").textContent = String(n);
      document.getElementById("buy-line-sub").textContent = "£" + (unit * n).toLocaleString("en-GB");
      document.getElementById("buy-line-total").textContent = "£" + (unit * n + 24).toLocaleString("en-GB");
    }
    if (qty) qty.addEventListener("input", refreshTotals);
    document.getElementById("buy-open").addEventListener("click", function () {
      var pageQty = document.getElementById("listing-qty");
      if (pageQty && qty) { qty.value = pageQty.value; }
      refreshTotals();
      step1.style.display = "";
      step2.style.display = "none";
    });
    if (confirmBtn) confirmBtn.addEventListener("click", function () {
      step1.style.display = "none";
      step2.style.display = "";
      document.getElementById("buy-order-no").textContent =
        "ORDER Nº DRVN-" + String(Math.floor(10000 + Math.random() * 89999));
    });
    refreshTotals();
  }

  var offerSheet = wireSheet("offer-open", "offer-sheet");
  if (offerSheet) {
    var offerInput = document.getElementById("offer-amount");
    var offerErr = document.getElementById("offer-err");
    var offerSend = document.getElementById("offer-send");
    var offerDone = document.getElementById("offer-done");
    var offerForm = document.getElementById("offer-form");
    offerSend.addEventListener("click", function () {
      var v = parseFloat(offerInput.value);
      offerInput.setAttribute("aria-invalid", "false");
      offerErr.textContent = "";
      if (isNaN(v) || v <= 0) {
        offerErr.textContent = "Enter an amount in pounds.";
        offerInput.setAttribute("aria-invalid", "true");
        offerInput.focus();
        return;
      }
      if (v < 1850 * 0.5) {
        offerErr.textContent = "Offers below £925 are auto-declined by the seller.";
        offerInput.setAttribute("aria-invalid", "true");
        offerInput.focus();
        return;
      }
      offerForm.style.display = "none";
      offerDone.style.display = "";
      document.getElementById("offer-echo").textContent = "£" + v.toLocaleString("en-GB");
    });
  }

  /* ==========================================================
     SELL — live preview, photo trays, garage link, publish
     ========================================================== */
  var sellForm = document.getElementById("sell-form");
  if (sellForm) {
    var pvTitle = document.getElementById("pv-title");
    var pvPrice = document.getElementById("pv-price");
    var pvCond = document.getElementById("pv-cond");
    var pvCat = document.getElementById("pv-cat");
    var pvFit = document.getElementById("pv-fit");
    var pvShip = document.getElementById("pv-ship");

    function bind(id, fn) {
      var el = document.getElementById(id);
      if (el) { el.addEventListener("input", fn); el.addEventListener("change", fn); }
      return el;
    }
    var fName = bind("f-name", update);
    var fCat = bind("f-cat", update);
    var fCond = bind("f-cond", update);
    var fPrice = bind("f-price", update);
    var fShip = bind("f-ship", update);
    var garageToggle = document.getElementById("garage-toggle");

    function update() {
      pvTitle.textContent = fName.value.trim() || "Untitled part";
      var p = parseFloat(fPrice.value);
      pvPrice.textContent = isNaN(p) || p <= 0 ? "£ —" : "£" + p.toLocaleString("en-GB");
      pvCond.textContent = fCond.value || "Condition —";
      pvCat.textContent = fCat.value || "Uncategorised";
      pvShip.textContent = fShip.value === "collect" ? "Collection only" : fShip.value === "uk" ? "Ships UK" : "Ships worldwide";
      pvFit.style.display = garageToggle && garageToggle.getAttribute("aria-checked") === "true" ? "" : "none";
    }
    if (garageToggle) garageToggle.addEventListener("click", function () {
      var on = garageToggle.getAttribute("aria-checked") === "true";
      garageToggle.setAttribute("aria-checked", String(!on));
      update();
    });

    document.querySelectorAll(".tray").forEach(function (tray, i) {
      tray.addEventListener("click", function () {
        tray.classList.toggle("filled");
        var lbl = tray.querySelector(".tray-lbl");
        if (lbl) lbl.textContent = tray.classList.contains("filled") ? "photo_0" + (i + 1) + ".jpg" : "Add photo";
        var n = document.querySelectorAll(".tray.filled").length;
        var pvPhotos = document.getElementById("pv-photos");
        if (pvPhotos) pvPhotos.textContent = n ? n + (n === 1 ? " photo" : " photos") : "No photos yet";
      });
    });

    document.getElementById("sell-publish").addEventListener("click", function () {
      var errs = [];
      if (!fName.value.trim()) errs.push(["f-name", "Give the part a name."]);
      if (!fCat.value) errs.push(["f-cat", "Pick a category."]);
      var p = parseFloat(fPrice.value);
      if (isNaN(p) || p <= 0) errs.push(["f-price", "Set an asking price."]);
      ["f-name", "f-cat", "f-price"].forEach(function (id) {
        document.getElementById(id).setAttribute("aria-invalid", "false");
        var e = document.getElementById(id + "-err");
        if (e) e.textContent = "";
      });
      if (errs.length) {
        errs.forEach(function (pair) {
          document.getElementById(pair[0]).setAttribute("aria-invalid", "true");
          var e = document.getElementById(pair[0] + "-err");
          if (e) e.textContent = pair[1];
        });
        document.getElementById(errs[0][0]).focus();
        return;
      }
      document.getElementById("sell-body").style.display = "none";
      document.getElementById("sell-success").style.display = "";
      window.billetToast("Listing published — live on the market.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    update();
  }
})();
