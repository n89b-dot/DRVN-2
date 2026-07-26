/* ATELIER — shared behaviours
   Slow, velvet: 400–600ms, cubic-bezier(.25,1,.35,1). No bounce, no snap. */

(function () {
  "use strict";

  /* ---------- Scroll reveal (6px rise + fade, rules that draw in) ---------- */
  var revealables = document.querySelectorAll(".reveal, .rule-draw");
  if ("IntersectionObserver" in window && revealables.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var el = entry.target;
            el.classList.add("is-visible");
            io.unobserve(el);
            /* Settle guard: once the 600ms rise (plus stagger) has had time
               to finish, pin the final state so throttled renderers can
               never leave a record half-revealed. */
            setTimeout(function () {
              el.style.transition = "none";
              el.style.opacity = "1";
              el.style.transform = "none";
            }, 1300);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealables.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i % 6, 4) * 70 + "ms";
      io.observe(el);
    });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- Mobile nav ---------- */
  var burger = document.querySelector(".nav__burger");
  var links = document.querySelector(".nav__links");
  if (burger && links) {
    burger.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.textContent = open ? "Close" : "Menu";
    });
  }

  /* ---------- Dashboard: offer consideration (Accept / Counter / Decline) ---------- */
  document.querySelectorAll("[data-offer]").forEach(function (offer) {
    var confirm = offer.querySelector(".confirm");
    var status = offer.querySelector("[data-offer-status]");
    var actions = offer.querySelector(".offer__actions");

    function closeConfirm() { if (confirm) confirm.classList.remove("is-open"); }

    offer.querySelectorAll("[data-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-action");

        if (action === "accept") {
          confirm.classList.add("is-open");
        } else if (action === "confirm-accept") {
          closeConfirm();
          if (actions) actions.style.display = "none";
          if (status) {
            status.innerHTML =
              '<span class="tag tag--brass">Offer accepted — sale entered into the ledger</span>';
          }
        } else if (action === "cancel-accept") {
          closeConfirm();
        } else if (action === "counter") {
          closeConfirm();
          if (status) {
            status.innerHTML =
              '<span class="tag tag--muted">Counter of ' +
              (btn.getAttribute("data-counter") || "—") +
              " sent to the buyer</span>";
          }
        } else if (action === "decline") {
          closeConfirm();
          if (actions) actions.style.display = "none";
          if (status) {
            status.innerHTML =
              '<span class="tag tag--muted">Offer declined, with regrets</span>';
          }
        }
      });
    });
  });

  /* ---------- Garage: "Enter a new part into the ledger" modal ---------- */
  var backdrop = document.querySelector("[data-modal]");
  if (backdrop) {
    var openers = document.querySelectorAll("[data-modal-open]");
    var form = backdrop.querySelector("form");
    var formWrap = backdrop.querySelector("[data-modal-form]");
    var doneWrap = backdrop.querySelector("[data-modal-done]");
    var doneText = backdrop.querySelector("[data-modal-done-text]");

    function openModal() {
      backdrop.classList.add("is-open");
      if (formWrap) formWrap.hidden = false;
      if (doneWrap) doneWrap.hidden = true;
      if (form) form.reset();
      var first = backdrop.querySelector("input, select");
      if (first) setTimeout(function () { first.focus(); }, 450);
    }
    function closeModal() { backdrop.classList.remove("is-open"); }

    openers.forEach(function (o) { o.addEventListener("click", openModal); });
    backdrop.querySelectorAll("[data-modal-close]").forEach(function (c) {
      c.addEventListener("click", closeModal);
    });
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var name = form.querySelector('[name="part-name"]').value.trim();
        var price = form.querySelector('[name="asking"]').value.trim();
        if (!name) return;
        if (doneText) {
          doneText.textContent =
            "“" + name + "” has been entered into the ledger" +
            (price ? " at £" + price.replace(/^£/, "") : "") + ".";
        }
        if (formWrap) formWrap.hidden = true;
        if (doneWrap) doneWrap.hidden = false;
      });
    }
  }

  /* ---------- Listings: expanding ledger rows ---------- */
  document.querySelectorAll(".lot__row").forEach(function (row) {
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "button");
    function toggle() {
      var lot = row.closest(".lot");
      var wasOpen = lot.classList.contains("is-open");
      document.querySelectorAll(".lot.is-open").forEach(function (l) {
        l.classList.remove("is-open");
      });
      if (!wasOpen) lot.classList.add("is-open");
      row.setAttribute("aria-expanded", !wasOpen ? "true" : "false");
    }
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });

  /* ---------- Listings: filter tabs ---------- */
  var tabs = document.querySelectorAll("[data-filter]");
  if (tabs.length) {
    var lots = document.querySelectorAll(".lot[data-state]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        var f = tab.getAttribute("data-filter");
        lots.forEach(function (lot) {
          var state = lot.getAttribute("data-state");
          /* "All" is the working ledger — the five live lots; sold records
             live under their own tab and in the season's table. */
          var show = f === "all" ? state !== "sold" : state === f;
          lot.style.display = show ? "" : "none";
          if (!show) lot.classList.remove("is-open");
        });
      });
    });
  }

  /* ---------- Listings: offer-lapse countdown ---------- */
  var cd = document.querySelector("[data-countdown]");
  if (cd) {
    var remaining = 5 * 3600 + 41 * 60 + 12; // 05:41:12
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var tick = function () {
      if (remaining <= 0) {
        cd.textContent = "Offer has lapsed";
        return;
      }
      var h = Math.floor(remaining / 3600);
      var m = Math.floor((remaining % 3600) / 60);
      var s = remaining % 60;
      cd.innerHTML =
        "Offer lapses in <strong>" + pad(h) + ":" + pad(m) + ":" + pad(s) + "</strong>";
      remaining -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }
})();
