# TEARSHEET — Concept 14 Design Brief

## Thesis

**"Ninety-percent photography, ten-percent ink."** The energy of the golden-age Japanese tuner press — dense, image-led, unapologetically enthusiastic — used as the grammar for a modern parts marketplace.

## Generator family: era-media

This concept answers the question "what non-web medium's grammar gets ported?" The medium is the 1990s Japanese tuner magazine (Option / Hot Version era print). The critical discipline of the era-media family is **porting the grammar, not the artifact**:

- **Grammar (ported):** condensed type set tight and loud; kickers and deks above heavy rules; visible 1px ink columns; spec boxes as ruled tables; price callouts set huge with a red underscore; flash photography bleeding to the module edge; density as a virtue.
- **Artifact (left behind):** no fake page numbers, no diegetic masthead or "Issue 07" conceits, no page-turn transitions, no aged-paper cosplay. The pages are a real marketplace — live search, working filters, a buy flow with a confirm sheet. The magazine is a way of *setting* the marketplace, not a costume the marketplace wears.

During the build I caught one drift toward artifact-thinking (a "Week 29" issue-date framing on the lead kicker) and kept it only because a weekly-market cadence is genuinely how marketplaces communicate freshness — it earns its place functionally, not diegetically.

## Reference lineage (honest)

Mobbin/web research was not exercised for this pass; the conventions below are drawn from working knowledge of the genre — 90s Option, Hot Version's print companions, and adjacent Japanese enthusiast print (Auto Works, Drift Tengoku) — and of Japanese magazine design generally:

1. **The kicker–headline–dek stack over a rule.** Every editorial unit in that press opens with a small red or black eyebrow line, a condensed shout of a headline, and one grey sentence of context — then a rule, then content. This is the skeleton of every section header here.
2. **The price callout.** Tuner mags printed prices *large*, in condensed numerals, often underscored or boxed in red — price was content, not metadata. TEARSHEET's `.price` component (condensed numerals, red underscore, three sizes) is a direct port, and it is the single most marketplace-serving element on the page.
3. **The spec box.** Ruled two-column tables with reversed-out title bars, dropped into any spread. Ported verbatim as `.specbox` — it serves listings (fitment, condition, mileage) and build pages (engine, power, wheels) with the same component.
4. **Density as respect for the reader.** Those spreads assumed an obsessive reader who wanted *more per page*. The front-of-book here runs a hero module, six listing rows, a six-cell category grid, a featured build, and a sellers table without apology — because on a marketplace, density *is* selection.
5. **Flash photography on white/dusk.** The era's product photography was direct-flash, unglamorous, honest. The art direction of the five assets follows it; the ink-rule frames around every photo are the print grammar holding it.
6. **Functional vertical labels.** Japanese print uses vertical setting structurally. Used twice, small and functional (`.vlabel` as a section marker), never as decoration soup.

## Why print-density grammar serves the marketplace mission

The mission is selection, easy listing, easy buying, and enthusiast identity. Print density maps to each: **density = selection** (a spread that shows 12 parts beats a hero that shows one); **energy = enthusiasm** (the loud condensed headline and red price say "this hobby is alive," which is the identity piece); **rules = scannability** (ink columns make a dense grid legible, which is easy buying); **the price callout = commerce honesty** (the mag tradition of printing price big means the buy decision is never buried). Provenance appears exactly where the genre would put it — as an editorial cross-reference line ("removed from the S14 featured this month →"), not a certificate.

## Three iteration passes (actually performed)

1. **Token-purity pass.** After the first CSS draft, a sweep for raw color values found three `rgba()` literals outside the token block (paper grain, halftone fallback texture, modal scrim). Finding: textures and scrims are where token discipline silently dies — they were promoted to `--grain-line`, `--halftone-line`, `--scrim`.
2. **Artifact-drift pass.** Re-read all four pages hunting for magazine cosplay. Finding: the footer's first draft read "Printed weekly" — a diegetic lie. Rewritten as a plain colophon ("Set in Archivo Narrow & Inter · One red, printed heavy") that describes the *design*, which is true, rather than pretending the site is an issue.
3. **Missing-asset resilience pass.** Only two of five images existed at build time. Finding: a broken image inside an ink-ruled frame reads as a printing error, not a loading state — so `tearsheet.js` swaps failed images to a halftone-textured paper module carrying the alt text as a set caption, which keeps the ruled grid intact regardless of asset availability.

## What a design system for this thesis looks like

A system for TEARSHEET is small and severe: four inks (paper, ink, mid-grey, one red), two families (a condensed display, a compact grotesque), and a component set built almost entirely from **rules and scale** — kicker, rule (1px / 3px), headline (three sizes), dek, price callout (three sizes, red underscore), flash tag (solid / ghost red), spec box, ruled row-list, ruled card grid. There are no radii, no shadows, no gradients; depth is forbidden, so every hierarchy decision must be answered with size, weight, a rule, or red. That constraint is the system's enforcement mechanism — a contributor cannot reach for a drop shadow, so drift is structurally difficult. Motion is a fixed vocabulary of two: a 150ms crossfade for content changes and a 180ms red underscore for state. Red budget is the one governance rule that needs policing: red is for commerce and state (prices, kickers, active, fits-your-car), never for decoration.

## The design system in Google's design.md standard

`design.md` in this folder follows the format Google's design.md project established for agent-readable design systems: a fenced **YAML block of tokens** (colors, typography, spacing, radius, motion — matching `tearsheet.css` `:root` exactly, so an agent can diff them) followed by **prose sections** describing component anatomy, states, and usage rules in plain language. The YAML is the machine contract; the prose carries the judgment calls (when a price is `--md` vs `--xl`, what red may and may not touch). `design.html` renders the same tokens live so a human can verify the contract by eye.

## Portable style emulation

To emulate TEARSHEET elsewhere: set everything on warm print-white `#FAFAF7` with near-black `#141414` ink and exactly one red, `#D42B1E`, reserved for kickers, price underscores, tags, and active states. Headlines are a condensed grotesque (Archivo Narrow 600/700) set uppercase at line-height 0.95; body is Inter at 13px with tight leading. Structure comes from visible 1px ink rules — between columns, around cards, under section heads (3px for section rules) — never from shadows, radii, or background tints beyond a recessed `#F1F1EC`. Prices are content: condensed, large, red-underscored. Photography is direct-flash and honest, bled to module edges inside 1px frames. Density is a goal, not a compromise; motion is limited to 150ms crossfades and a 180ms sliding red underscore. If a decision can't be expressed with scale, weight, a rule, or red, the design says no.
