/* COUNTER — shared interactions. The deal is the design. */
(function () {
  "use strict";

  /* ---------- gentle scroll rise ---------- */
  var risers = document.querySelectorAll(".rise");
  if ("IntersectionObserver" in window && risers.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    risers.forEach(function (el) { io.observe(el); });
  } else {
    risers.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- image fallback (missing assets → warm putty token panel) ---------- */
  document.querySelectorAll("img[data-fallback]").forEach(function (img) {
    img.addEventListener("error", function () {
      var span = document.createElement("span");
      span.className = "img-fallback";
      span.textContent = img.getAttribute("data-fallback");
      img.replaceWith(span);
    });
  });

  var fmt = function (n) {
    return "£" + Number(n).toLocaleString("en-GB");
  };

  /* ---------- MARKET: filter chips + open-to-offers toggle ---------- */
  var marketGrid = document.getElementById("marketGrid");
  if (marketGrid) {
    var chips = document.querySelectorAll(".filter-bar .chip[data-cat]");
    var oboToggle = document.getElementById("oboToggle");
    var emptyMsg = document.getElementById("marketEmpty");
    var activeCat = "all";

    var applyFilters = function () {
      var oboOnly = oboToggle.getAttribute("aria-pressed") === "true";
      var visible = 0;
      marketGrid.querySelectorAll(".part-card").forEach(function (card) {
        var catOk = activeCat === "all" || card.dataset.cat === activeCat;
        var oboOk = !oboOnly || card.dataset.obo === "true";
        var show = catOk && oboOk;
        card.style.display = show ? "" : "none";
        if (show) visible++;
      });
      if (emptyMsg) emptyMsg.style.display = visible === 0 ? "block" : "none";
    };

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        chip.setAttribute("aria-pressed", "true");
        activeCat = chip.dataset.cat;
        applyFilters();
      });
    });
    if (oboToggle) {
      oboToggle.addEventListener("click", function () {
        oboToggle.setAttribute("aria-pressed",
          oboToggle.getAttribute("aria-pressed") === "true" ? "false" : "true");
        applyFilters();
      });
    }
  }

  /* ---------- LISTING: gallery swap ---------- */
  var galleryMain = document.getElementById("galleryMain");
  if (galleryMain) {
    document.querySelectorAll(".gthumb").forEach(function (thumb) {
      thumb.addEventListener("click", function () {
        document.querySelectorAll(".gthumb").forEach(function (t) {
          t.setAttribute("aria-current", "false");
        });
        thumb.setAttribute("aria-current", "true");
        var src = thumb.dataset.src;
        var alt = thumb.dataset.alt || "";
        galleryMain.innerHTML = "";
        if (src) {
          var img = document.createElement("img");
          img.src = src; img.alt = alt;
          img.addEventListener("error", function () {
            galleryMain.innerHTML = '<span class="img-fallback" style="display:flex;align-items:center;justify-content:center;height:100%;">' + alt + "</span>";
          });
          galleryMain.appendChild(img);
        }
      });
    });
  }

  /* ---------- LISTING: offer composer → deal page ---------- */
  var listingComposer = document.getElementById("listingOfferForm");
  if (listingComposer) {
    listingComposer.addEventListener("submit", function (e) {
      e.preventDefault();
      var amtInput = document.getElementById("listingOfferAmount");
      var noteInput = document.getElementById("listingOfferNote");
      var err = document.getElementById("listingOfferError");
      var amt = parseInt(amtInput.value, 10);
      if (!amt || amt < 50) {
        err.textContent = "Enter an offer of at least £50 to start the deal.";
        err.classList.add("show");
        amtInput.closest(".amount-field").classList.remove("nudge");
        void amtInput.offsetWidth;
        amtInput.closest(".amount-field").classList.add("nudge");
        return;
      }
      if (amt >= 1250) {
        err.textContent = "That's the full price — use Buy now instead, save the haggle.";
        err.classList.add("show");
        return;
      }
      err.classList.remove("show");
      var params = new URLSearchParams({ offer: amt, note: noteInput.value.trim() });
      window.location.href = "deal.html?" + params.toString();
    });
  }

  /* ---------- LISTING: buy now confirm sheet ---------- */
  var buyBtn = document.getElementById("buyNowBtn");
  var sheet = document.getElementById("buySheet");
  if (buyBtn && sheet) {
    var openSheet = function () { sheet.classList.add("open"); sheet.querySelector(".btn-primary").focus(); };
    var closeSheet = function () { sheet.classList.remove("open"); buyBtn.focus(); };
    buyBtn.addEventListener("click", openSheet);
    document.getElementById("buyCancel").addEventListener("click", closeSheet);
    document.getElementById("buyConfirm").addEventListener("click", function () {
      var body = sheet.querySelector(".sheet");
      body.innerHTML = '<h3>Order placed</h3><p>Bronze forged wheels — <span class="money">£1,250</span> paid to Priya S. Order <span class="order-no">#DRVN-8841</span>. She usually ships within 2 days.</p><div class="sheet-actions"><a class="btn btn-moss" href="index.html">Done</a></div>';
    });
    sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sheet.classList.contains("open")) closeSheet();
    });
  }

  /* ---------- DEAL PAGE ---------- */
  var thread = document.getElementById("thread");
  if (thread) {
    var state = {
      lastTheirs: 1150,   // Priya's latest counter
      lastMine: 1120,     // Jonah's latest offer
      agreed: false
    };

    /* If arriving from the listing composer with a fresh offer, append it. */
    var qs = new URLSearchParams(window.location.search);
    var incoming = parseInt(qs.get("offer"), 10);

    var makeBubble = function (side, amount, note, stateLabel, stateClass) {
      var b = document.createElement("div");
      b.className = "bubble bubble-" + side + " bubble-new";
      var now = new Date();
      var time = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
      b.innerHTML =
        '<div class="bubble-amount">' + fmt(amount) + "</div>" +
        (note ? '<div class="bubble-note">' + note.replace(/[<>]/g, "") + "</div>" : "") +
        '<div class="bubble-meta"><span>Today, ' + time + '</span><span class="state-chip ' + stateClass + '">' + stateLabel + "</span></div>";
      return b;
    };

    var demoteOpenChips = function () {
      thread.querySelectorAll(".state-chip.state-open").forEach(function (chip) {
        chip.className = "state-chip state-countered";
        chip.textContent = "Countered";
      });
    };

    var updateHeader = function (best) {
      var bestEl = document.getElementById("bestAmount");
      if (bestEl) bestEl.textContent = fmt(best);
    };

    if (incoming && !isNaN(incoming)) {
      demoteOpenChips();
      thread.appendChild(makeBubble("mine", incoming, qs.get("note") || "", "Open", "state-open"));
      state.lastMine = incoming;
      var sys = document.createElement("div");
      sys.className = "sys-row";
      sys.textContent = "Your offer is with Priya — she usually responds in ~20 min";
      thread.appendChild(sys);
    }

    /* countdown */
    var cdEl = document.getElementById("countdown");
    var remaining = 4 * 3600 + 12 * 60 + 33; // 4h 12m 33s
    var cdTimer = setInterval(function () {
      if (state.agreed) { clearInterval(cdTimer); return; }
      remaining--;
      if (remaining <= 0) { clearInterval(cdTimer); cdEl.textContent = "expired"; return; }
      var h = Math.floor(remaining / 3600),
          m = Math.floor((remaining % 3600) / 60),
          s = remaining % 60;
      cdEl.textContent = h + "h " + String(m).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
    }, 1000);

    /* composer: counter with validation — must sit between the last two offers */
    var dealForm = document.getElementById("dealComposerForm");
    var dealAmt = document.getElementById("dealAmount");
    var dealNote = document.getElementById("dealNote");
    var dealErr = document.getElementById("dealError");

    var nudgeField = function () {
      var f = dealAmt.closest(".amount-field");
      f.classList.remove("nudge"); void f.offsetWidth; f.classList.add("nudge");
    };

    dealForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (state.agreed) return;
      var amt = parseInt(dealAmt.value, 10);
      var lo = Math.min(state.lastMine, state.lastTheirs);
      var hi = Math.max(state.lastMine, state.lastTheirs);
      if (!amt || isNaN(amt)) {
        dealErr.textContent = "Put a number in — Priya can't counter a blank.";
        dealErr.classList.add("show"); nudgeField(); return;
      }
      if (amt <= lo || amt >= hi) {
        dealErr.textContent = "A counter should land between " + fmt(lo) + " and " + fmt(hi) + " — otherwise you're moving backwards.";
        dealErr.classList.add("show"); nudgeField(); return;
      }
      dealErr.classList.remove("show");
      demoteOpenChips();
      var b = makeBubble("mine", amt, dealNote.value.trim(), "Open", "state-open");
      thread.appendChild(b);
      state.lastMine = amt;
      dealAmt.value = ""; dealNote.value = "";
      b.scrollIntoView({ behavior: "smooth", block: "end" });
    });

    /* accept → HANDSHAKE */
    var acceptBtn = document.getElementById("acceptBtn");
    var counterBtn = document.getElementById("counterBtn");
    var walkBtn = document.getElementById("walkBtn");

    if (counterBtn) counterBtn.addEventListener("click", function () {
      dealAmt.focus();
      dealForm.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    if (walkBtn) walkBtn.addEventListener("click", function () {
      if (state.agreed) return;
      var sys = document.createElement("div");
      sys.className = "sys-row";
      sys.textContent = "You stepped away from the deal — Priya has been told. No hard feelings.";
      thread.appendChild(sys);
      walkBtn.disabled = true;
    });

    if (acceptBtn) acceptBtn.addEventListener("click", function () {
      if (state.agreed) return;
      state.agreed = true;

      /* resolve chips: their standing counter is accepted; any open offer of mine is superseded */
      thread.querySelectorAll(".bubble-mine .state-chip.state-open").forEach(function (chip) {
        chip.className = "state-chip state-countered";
        chip.textContent = "Superseded";
      });
      var theirChips = thread.querySelectorAll(".bubble-theirs .state-chip");
      var lastTheirChip = theirChips[theirChips.length - 1];
      if (lastTheirChip) {
        lastTheirChip.className = "state-chip state-accepted";
        lastTheirChip.textContent = "Accepted";
      }

      /* system row */
      var sys = document.createElement("div");
      sys.className = "sys-row";
      sys.textContent = "Deal agreed at " + fmt(state.lastTheirs);
      thread.appendChild(sys);

      /* handshake band */
      var hs = document.createElement("div");
      hs.className = "handshake drawing bubble-new";
      hs.setAttribute("role", "status");
      hs.innerHTML =
        '<div class="handshake-side hs-mine"><span class="mini-av av-mine">JB</span><div><div class="hs-name">Jonah Barr</div><div class="hs-role">Buyer · Leeds</div></div></div>' +
        '<div class="handshake-side hs-theirs"><div><div class="hs-name">Priya S.</div><div class="hs-role">Seller · Sheffield</div></div><span class="mini-av av-theirs">PS</span></div>' +
        '<div class="handshake-seam"></div>' +
        '<div class="handshake-center">Shaken on <span class="money">' + fmt(state.lastTheirs) + "</span></div>";
      thread.appendChild(hs);

      /* payment stub */
      var pay = document.createElement("div");
      pay.className = "card pay-stub bubble-new";
      pay.innerHTML =
        "<h3>Nice dealing. Now make it official.</h3>" +
        '<p>Order <span class="order-no">#DRVN-8842</span> · Bronze forged wheels · agreed at <span class="money">' + fmt(state.lastTheirs) + "</span>. Payment is held by DRVN until you confirm the parts arrive as described.</p>" +
        '<button class="btn btn-moss btn-lg" type="button">Pay ' + fmt(state.lastTheirs) + " securely</button>";
      thread.appendChild(pay);

      /* header + actions */
      updateHeader(state.lastTheirs);
      var headSub = document.getElementById("dealHeadSub");
      if (headSub) headSub.innerHTML = 'Agreed at <span class="money">' + fmt(state.lastTheirs) + "</span> · awaiting payment";
      acceptBtn.disabled = true; acceptBtn.textContent = "Agreed";
      if (walkBtn) walkBtn.disabled = true;
      if (counterBtn) counterBtn.disabled = true;
      var composer = document.getElementById("dealComposer");
      if (composer) composer.style.display = "none";

      hs.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
})();
