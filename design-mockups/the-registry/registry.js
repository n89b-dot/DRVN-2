/* THE REGISTRY — shared behaviour */
(function () {
  "use strict";

  /* ---------- Reveal on scroll ---------- */
  var revealables = document.querySelectorAll(".reveal, .img-reveal, .rule-draw");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-revealed"); });
  }

  /* Stagger: elements inside a [data-stagger] parent get incremental delays */
  document.querySelectorAll("[data-stagger]").forEach(function (parent) {
    var step = parseInt(parent.getAttribute("data-stagger"), 10) || 120;
    var children = parent.querySelectorAll(".reveal, .img-reveal");
    children.forEach(function (child, i) {
      child.style.setProperty("--d", i * step + "ms");
      child.style.transitionDelay = i * step + "ms";
    });
  });

  /* ---------- Mobile menu ---------- */
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.querySelector(".masthead__nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- Confirm sheet (Buy / Offer) ---------- */
  var backdrop = document.querySelector(".sheet-backdrop");
  if (backdrop) {
    var sheet = backdrop.querySelector(".sheet");
    var titleEl = sheet.querySelector("[data-sheet-title]");
    var subEl = sheet.querySelector("[data-sheet-sub]");
    var formView = sheet.querySelector("[data-sheet-form]");
    var doneView = sheet.querySelector("[data-sheet-done]");
    var lastFocused = null;

    function openSheet(mode) {
      lastFocused = document.activeElement;
      if (mode === "offer") {
        titleEl.textContent = "Submit an offer";
        subEl.textContent = "Offers are relayed to the seller through the Registry. Marcus typically responds within 2 hours.";
      } else {
        titleEl.textContent = "Confirm acquisition";
        subEl.textContent = "Payment is held in escrow until the lot arrives as described. The certificate transfers with it.";
      }
      formView.hidden = false;
      doneView.hidden = true;
      backdrop.classList.add("is-open");
      backdrop.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      var closeBtn = sheet.querySelector(".sheet__close");
      if (closeBtn) closeBtn.focus();
    }

    function closeSheet() {
      backdrop.classList.remove("is-open");
      backdrop.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocused) lastFocused.focus();
    }

    document.querySelectorAll("[data-open-sheet]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openSheet(btn.getAttribute("data-open-sheet"));
      });
    });

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeSheet();
    });
    sheet.querySelectorAll("[data-close-sheet]").forEach(function (btn) {
      btn.addEventListener("click", closeSheet);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && backdrop.classList.contains("is-open")) closeSheet();
    });

    var confirmBtn = sheet.querySelector("[data-sheet-confirm]");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        formView.hidden = true;
        doneView.hidden = false;
      });
    }
  }

  /* ---------- Image fallback: keep panel colour if asset missing ---------- */
  document.querySelectorAll(".img-reveal img").forEach(function (img) {
    img.addEventListener("error", function () {
      img.style.display = "none";
    });
  });
})();
