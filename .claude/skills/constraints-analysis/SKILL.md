---
name: constraints-analysis
description: >-
  Run a decision-grade pre-mortem on a plan, idea, design, or creative concept — surfacing failure modes across
  BOTH hard constraints (technical, legal, financial) and soft ones (taste, tone, brand, social dynamics), then
  propose crisp mitigations and name what's stable. Use when the user explicitly asks to pressure-test, stress-test,
  red-team, or run a pre-mortem: "run a pre-mortem on this", "what could go wrong with this plan", "do a constraints
  analysis", "stress-test this idea for risks", "where does this break", "find the failure modes before we commit".
---

# Constraints Analysis (Pre-Mortem)

Run a pre-mortem on the attached plan/idea with BOTH hard and soft constraints. Expose failure modes, taste/ethos violations, social misreads, and brand/aesthetic dissonance; propose crisp mitigations; and end with what's stable. Keep it decision-grade.

**1) Grounding Snapshot (10–15 lines max)**
- Assumptions & Constraints: time horizon, budget band (or "n/a"), risk tolerance, non-negotiables, known single-points-of-failure.
- Intent & Success Signals: what "good" looks/feels like here (plain language).
- Stakeholders & Incentives: who's affected; likely conflicts of interest.

**2) Lens Sweep (allow N/A but justify)**
- Technical / Operational (mechanisms, interfaces, dependencies)
- Security / Safety / Ethical (harm, consent, duty of care)
- Legal / Compliance (regimes, norms)
- Financial / Economic (unit costs, exposure)
- Social / Interpersonal (boundaries, status dynamics, trust)
- Aesthetic / Brand / Tone (style fit, "vibe cliffs," associative baggage)
- Cultural / Associative (taboos, unwanted echoes — e.g., "nothing reminiscent of ___")

**3) Risk Scale & Priority (deterministic)**
- Severity: Low = nuisance / reversible; Med = material rework / moderate harm; High = mission-threatening, legal/safety, or brand-integrity break.
- Likelihood: Low ≤10% under current plan; Med ≈30–60%; High ≥70% absent intervention.
- Priority grid: H×H → EXTREME; H×M or M×H → HIGH; M×M → MED; else LOW.

**4) Risk Table (top 8–15, Mode-aware)** — one row each:
Risk (one line) · Category · Impact (Low/Med/High + why) · Likelihood (+ why) · Priority · Early Signal/Tripwire (first observable + threshold) · Mitigation (smallest effective move) · Owner (role) · Confidence (+ because…)

**5) Soft-Constraint Handling (make it operational)**
- Goldilocks Bands (for "not too X"): define the middle band via comparative anchors — 2 positive, 2 negative. Example: Humor ≈ [John Mulaney, Abbott & Costello]; avoid ≈ [insult comic, cringe bait].
- Negative Similarity Guardrails ("nothing like Giger"): list the forbidden motif bundle (forms, textures, palettes, themes, narrative postures), then name 2–3 safe adjacencies to route toward.
- Boundary-Safe Social Moves (people in the loop): state the ethical frame (consent, kindness, clarity), model the plain-speech script, and list face-saving alternatives (channel/time/context) that preserve dignity without mixed signals.

**6) Bias & Narrative Scan (fast)** — Note incentives or story frames tilting judgment. What are we under-weighing because it feels good?

**7) Lifecycle Pass** (Build → Launch → Operate → Scale/Change → Degrade/Exit) — Call phase-specific hazards and handoffs. If creative/social, translate phases (Draft → Share → Feedback → Iterate → Archive/Retire).

**8) Critical Unknowns → Smallest Experiments** — List 3–5 uncertainties driving Priority ≥ High. For each: the smallest, low-stakes test to collapse the uncertainty (micro-audience sniff test, A/B tone tiles, red-team read, consent check-in).

**9) Stability Snapshot (5–8 bullets)** — Name what is robust now *and why* (choice of medium, constraint clarity, tone anchors, interface simplicity, etc.).

**Modes:** Quick Scan (≤10 risks; tight prose; ~5-min read) · Deep Dive (structured table; include anchors/motifs). Default to Deep Dive unless the user signals they want it fast.

Output voice: terse, humane, specific. Prefer examples over abstractions. If data is missing, state the single most valuable question to answer before proceeding.
