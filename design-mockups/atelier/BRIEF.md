# CONCEPT 06 — ATELIER

**"A dealership back office from a world with taste."**

## Thesis

DRVN's core promise is provenance: every part answers *what car did this come off, who is the seller, will it fit, what was it paired with*. ATELIER takes that promise literally and dresses the product as the thing provenance has always lived in — a ledger. Not a feed, not a dashboard of KPI cards, but a private coach-builder's book of record: espresso surfaces, brass rules, tan-leather warmth, serif-numbered entries. The seller's tools (offers, lots, sales) are staged as correspondence and hammer prices; the car profile is staged as a registry entry with a coach-builder's specification table and a hand-kept journal. Old-money materials, modern software discipline.

## Reference lineage (honest)

- **Vintage Aston Martin & Bentley sales brochures (1960s–70s)** — the double-keyline certificate frame around the hero image, specification set as a two-column table, restrained serif headlines.
- **Private-bank and Lloyd's annual reports** — figures as the typographic event: large oldstyle serif numerals, tabular alignment, hairline rules instead of boxes, roman-numbered sections.
- **The Connolly leather-goods world / Savile Row invoicing** — the palette itself: espresso, parchment, saddle tan; warmth as a trust signal rather than decoration.
- **Hodinkee's editorial restraint** — small-caps letterspaced labels, generous measure, the discipline of letting one accent (here, brass) do all the accent work.
- **Auction-house lot cataloguing (Bonhams, H&H Classics)** — "lots", "hammer prices", offer histories as provenance records; the language of the copy follows this register.

## Why warm-materials trust serves DRVN

Provenance is fundamentally a *credibility* claim, and credibility has a visual history: ledgers, certificates, hallmarks, bank paper. Cool-toned tech dashboards signal speed and disposability — precisely wrong for "this part's history is documented and the seller is known." Espresso and brass borrow the semiotics of institutions that have kept records for a century: the buyer reads the interface itself as evidence of care. Every design decision routes back to this — rows as ledger entries rather than cards (records, not products), prices in serif oldstyle (hammer prices, not price tags), the double-line frame reserved for the single most important object (the certificate treatment).

## Iteration-pass log

- **Pass 1 — Flaws.** Functional audit in the browser found a real filter bug on `listings.html`: the "All 5" tab revealed **six** lots because the sold record (display:none by default) was un-hidden by the `all` filter. Fixed in `atelier.js` — "All" is now the working ledger (live lots only); sold records live under their own tab and in the Season's sales table.
- **Pass 2 — Elevation.** Two elevations after visual review. (a) The sold lot's row was missing its "Asking" cell, so its columns fell out of register with the live lots — added the cell (£240 asking, muted) so the ledger's vertical rhythm holds across states. (b) Added a "settle guard" to the reveal system: 1.3s after a record is revealed its final state is pinned inline, so throttled or low-power renderers can never leave an entry half-faded — the velvet motion is now decorative, never load-bearing.
- **Pass 3 — Coherence.** Semantic audit of the brass serif "price" slot: on the home ledger, the two registry cars carried the words "Registry car" set in the price style — a non-price wearing money's clothes, diluting the rule that *brass serif numerals mean money*. Restyled to muted italic. After this, brass-serif-large is used exclusively for figures (prices, takings, summary numerals) across all four pages.

## What a design system for this thesis looks like

**Token architecture.** Three layers. *Material tokens* name the physical metaphor, not the hue: `espresso` (bg), `panel`, `inset`, `parchment` (text), `mutedInk`, `brass`, `brassDim`, `tan`, plus derived hairlines `rule` / `ruleStrong` (brass at .32/.55 alpha). *Role tokens* map material to function: `surface.page → espresso`, `accent → brass`, `accent.structural → brassDim`, `warmth.secondary → tan`. *Component tokens* only where a component needs an override (e.g. `frame.borderEmphasis → brass`). No component may reference a raw hex — everything routes through a role.

**Naming.** Ledger vocabulary is the API: `ledger-row`, `framed-panel`, `offer-record`, `entry`, `lot`, `colophon`, `spec-table`, `journal-entry`. If a component name wouldn't appear in an auction catalogue or a bound ledger, it doesn't belong in this system.

**Component inventory.** Nav (top bar + user record), `btn` (brass outline → brass fill on hover), `btn-text` (understated small-caps text action), `ledger-row` (the workhorse record; variants: link, offer, entry, lot), `framed-panel` (double-line certificate frame; `--emphasis` variant in full brass, reserved for one object per page), `tag` (hairline stamp; brass/tan/muted), `spec-table`, `journal-entry` (with serif drop cap), `summary` (ruled figures strip — explicitly *not* KPI cards), `confirm` (inline consideration panel), `modal` (framed dialogue), `filters` (small-caps tabs with brass underline), `sales` (closing table), `input`/`select`.

**Governance rules.**
1. Brass serif numerals mean money or count-of-record; nothing else may use them.
2. One `frame--emphasis` per page — the certificate treatment loses meaning if repeated.
3. Records are separated by rules, never boxed, unless the object is being *certified* (frame) or *confirmed* (modal/confirm panel).
4. No cool hue, no pure black (#000), no pure white (#FFF), no drop shadow — depth is layered warmth plus keylines only.
5. Motion is 400–600ms on `cubic-bezier(.25,1,.35,1)`, fade + ≤6px rise; hovers warm colors, they never move geometry.
6. Corners never exceed 4px; pills do not exist in this world.
7. New components must be expressible in ledger vocabulary before they may be built.

## The design system in Google's design.md standard

The accompanying `design.md` follows Google's open **design.md** format: a YAML frontmatter block carrying machine-readable tokens (version, name, colors, typography scale, rounded, spacing, and a `components` map whose values reference tokens by path, e.g. `"{colors.accent}"`), followed by prose sections (Overview, Colors, Typography, Layout, Components, Do's and Don'ts) that carry the judgment a token table can't. A coding agent consumes it in two reads: first the frontmatter, parsed as data, becomes the single source for every color, size and radius it emits (never a literal hex — always the token value, which here mirrors `atelier.css` custom properties one-to-one); second the prose, read as constraints, resolves the cases tokens can't decide — when to frame versus rule, what may be brass, how motion behaves. Because the YAML values match `atelier.css` exactly, drift between spec and implementation is detectable by direct string comparison, and a change to the system is made once in the frontmatter and once in `:root`.

## Style-emulation prompt

Design a warm dark "private ledger" interface: espresso base #1E1813 with panel #292219 and inset #171310, parchment text #EFE7DA with muted #A6988A, and a single brass accent — #8C7350 at ~30% opacity for 1px hairline rules between records, full #C9A96A for prices, active states and keylines — plus a saddle tan #B4835B for avatars and stamps; no pure black or white, no cool hues, no drop shadows (depth comes from layered warm tones and brass keylines). Set headings, ledger titles and all money in Cormorant Garamond 500/600 with true italics and oldstyle-feeling numerals; body/UI in Figtree 400/500; labels as uppercase 10.5px sans letterspaced .16em in dim brass; tabular numerals in tables. Compose content as ledger records — horizontal rows separated by hairline rules, generous padding, roman-numeral section numbers (No. I, No. II) with flanking rules — reserving one double-line brass "certificate frame" (1px + 1px offset) per page for the most important object; corners 4px maximum. Write copy in a courteous auction-house register ("offers awaiting your consideration", "entered into the ledger"). Motion is slow velvet: 400–600ms cubic-bezier(.25,1,.35,1) fades with 6px rises and rules that draw in; hover states warm from parchment to brass rather than moving; absolutely no bounce or snap.
