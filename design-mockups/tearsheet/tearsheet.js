/* TEARSHEET — shared interactions
   1. image fallback (missing asset → paper token module)
   2. market: category tabs + under-£500 quick filter (fast crossfade)
   3. listing: gallery cut-swap, buy confirm sheet, offer validation
*/

(function () {
  "use strict";

  /* ---------- 1. image fallbacks ---------- */
  document.querySelectorAll(".photo img, .rowlist__thumb img, .thumbbtn img").forEach(function (img) {
    img.addEventListener("error", function () {
      var wrap = img.closest(".photo");
      if (wrap) {
        wrap.classList.add("photo--fallback");
        if (!wrap.dataset.caption) wrap.dataset.caption = img.alt || "Photo";
      } else {
        img.style.display = "none";
      }
    });
    if (img.complete && img.naturalWidth === 0) {
      img.dispatchEvent(new Event("error"));
    }
  });

  /* ---------- 2. market filters ---------- */
  var grid = document.getElementById("market-grid");
  if (grid) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab[data-cat]"));
    var chip = document.getElementById("chip-under500");
    var countEl = document.getElementById("result-count");
    var emptyEl = document.getElementById("empty-note");
    var state = { cat: "all", under500: false };

    function applyFilters() {
      grid.classList.add("is-fading");
      window.setTimeout(function () {
        var visible = 0;
        Array.prototype.forEach.call(grid.querySelectorAll(".card"), function (card) {
          var okCat = state.cat === "all" || card.dataset.cat === state.cat;
          var okPrice = !state.under500 || parseInt(card.dataset.price, 10) < 500;
          var show = okCat && okPrice;
          card.classList.toggle("is-hidden", !show);
          if (show) visible++;
        });
        if (countEl) countEl.textContent = visible + (visible === 1 ? " listing" : " listings");
        if (emptyEl) emptyEl.classList.toggle("is-hidden", visible > 0);
        grid.classList.remove("is-fading");
      }, 150);
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");
        state.cat = tab.dataset.cat;
        applyFilters();
      });
    });

    if (chip) {
      chip.addEventListener("click", function () {
        state.under500 = !state.under500;
        chip.classList.toggle("is-active", state.under500);
        chip.setAttribute("aria-pressed", String(state.under500));
        applyFilters();
      });
    }

    var searchForm = document.getElementById("market-search");
    if (searchForm) {
      searchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = (searchForm.querySelector("input").value || "").trim().toLowerCase();
        grid.classList.add("is-fading");
        window.setTimeout(function () {
          var visible = 0;
          Array.prototype.forEach.call(grid.querySelectorAll(".card"), function (card) {
            var hay = card.textContent.toLowerCase();
            var okCat = state.cat === "all" || card.dataset.cat === state.cat;
            var okPrice = !state.under500 || parseInt(card.dataset.price, 10) < 500;
            var show = okCat && okPrice && (q === "" || hay.indexOf(q) !== -1);
            card.classList.toggle("is-hidden", !show);
            if (show) visible++;
          });
          if (countEl) countEl.textContent = visible + (visible === 1 ? " listing" : " listings");
          if (emptyEl) emptyEl.classList.toggle("is-hidden", visible > 0);
          grid.classList.remove("is-fading");
        }, 150);
      });
    }
  }

  /* ---------- 3a. gallery cut-swap ---------- */
  var stage = document.getElementById("stage-img");
  if (stage) {
    var stageWrap = stage.closest(".photo");
    document.querySelectorAll(".thumbbtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".thumbbtn").forEach(function (b) {
          b.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        /* hard cut, no slide */
        stageWrap.classList.remove("photo--fallback");
        stage.style.display = "";
        stage.src = btn.dataset.src;
        stage.alt = btn.dataset.alt || stage.alt;
        stageWrap.dataset.caption = btn.dataset.alt || "Photo";
      });
    });
  }

  /* ---------- 3b. buy confirm sheet ---------- */
  var sheet = document.getElementById("buy-sheet");
  if (sheet) {
    var backdrop = document.getElementById("sheet-backdrop");
    var step1 = document.getElementById("sheet-step-1");
    var step2 = document.getElementById("sheet-step-2");
    var openBtn = document.getElementById("buy-now");
    var lastFocus = null;

    function openSheet() {
      lastFocus = document.activeElement;
      sheet.classList.add("is-open");
      backdrop.classList.add("is-open");
      step1.classList.remove("is-hidden");
      step2.classList.add("is-hidden");
      sheet.querySelector(".sheet__close").focus();
    }
    function closeSheet() {
      sheet.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      if (lastFocus) lastFocus.focus();
    }

    openBtn.addEventListener("click", openSheet);
    backdrop.addEventListener("click", closeSheet);
    sheet.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", closeSheet);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sheet.classList.contains("is-open")) closeSheet();
    });
    document.getElementById("confirm-order").addEventListener("click", function () {
      step1.classList.add("is-hidden");
      step2.classList.remove("is-hidden");
      document.getElementById("order-num").textContent =
        "DRVN-" + String(Math.floor(10000 + Math.random() * 89999));
    });
  }

  /* ---------- 3c. make-offer validation ---------- */
  var offerToggle = document.getElementById("make-offer");
  if (offerToggle) {
    var field = document.getElementById("offer-field");
    var input = document.getElementById("offer-input");
    var msg = document.getElementById("offer-msg");
    var askPrice = parseInt(field.dataset.ask, 10);
    var floor = Math.round(askPrice * 0.6);

    offerToggle.addEventListener("click", function () {
      field.classList.toggle("is-open");
      if (field.classList.contains("is-open")) input.focus();
    });

    document.getElementById("offer-send").addEventListener("click", function () {
      var val = parseFloat(input.value);
      input.classList.remove("is-invalid");
      msg.classList.remove("is-ok");
      if (isNaN(val) || val <= 0) {
        input.classList.add("is-invalid");
        msg.textContent = "Enter an amount in pounds.";
        return;
      }
      if (val < floor) {
        input.classList.add("is-invalid");
        msg.textContent = "Seller declines offers under £" + floor + ".";
        return;
      }
      if (val >= askPrice) {
        msg.classList.add("is-ok");
        msg.textContent = "That's the asking price — use Buy Now for instant checkout.";
        return;
      }
      msg.classList.add("is-ok");
      msg.textContent = "Offer of £" + val.toFixed(0) + " sent to @sato.s14works. Replies in ~4 hrs.";
      input.value = "";
    });
  }
})();
