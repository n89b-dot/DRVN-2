# DRVN — Sixteen Design Concepts

Sixteen radically distinct, clickable interface concepts for DRVN, explored in July 2026 (the root `index.html` hub says "Sixteen Concepts"; `LEDGER.md` is the exploration's memory). Each is a self-contained static prototype (HTML/CSS/JS, no build step) with cross-linked pages, custom AI-generated imagery (`assets/`), a design brief (`BRIEF.md`) and a design system in [Google's open `design.md` format](https://github.com/google-labs-code/design.md) (`design.md` + a live `design.html` style guide).

**One of them shipped.** Concept 16, **Livesheet** (`livesheet/`), was promoted to DRVN's production design system in the August 2026 port (`docs/plans/livesheet-component-system.md`). Its `livesheet/design.md` is no longer a mockup description but the **living token contract** for the app: its `source_of_truth` is `src/app/styles/` (tokens in `00-tokens-base.css`), and it is served inside the product at `/docs/md/livesheet-design-md` (`src/lib/docs/site.ts`). Treat it as the canonical `design.md`; where `livesheet/BRIEF.md` or `LEDGER.md` disagree with it (red `#F03A20` vs production `#C02C14`, 20px vs 16px tiles, "no tabs" vs `SheetTabs`), `design.md` wins.

**The other fifteen are historical.** They are kept as the record of what was explored and rejected, and their `design.md`/`design.html` describe only their own prototypes.

| # | Concept | Folder | Status |
|---|---------|--------|--------|
| 01 | The Registry | `the-registry/` | historical |
| 02 | APEX/OS | `apex-os/` | historical |
| 03 | After Hours | `after-hours/` | historical |
| 04 | Werkbank | `werkbank/` | historical (one parent of Livesheet) |
| 05 | Livery | `livery/` | historical (retired, see LEDGER vetoes) |
| 06 | Atelier | `atelier/` | historical |
| 07 | Sunday | `sunday/` | historical |
| 08 | Meridian | `meridian/` | historical |
| 09 | Monograph | `monograph/` | historical |
| 10 | Atlas | `atlas/` | historical |
| 11 | Circuit | `circuit/` | historical |
| 12 | Billet | `billet/` | historical |
| 13 | Counter | `counter/` | historical |
| 14 | Tearsheet | `tearsheet/` | historical |
| 15 | Glance | `glance/` | historical (one parent of Livesheet) |
| 16 | **Livesheet** | `livesheet/` | **promoted to production, Aug 2026** |

## Run it

```bash
cd design-mockups
npx -y serve -l 4380 .
# open http://localhost:4380
```

(`serve.json` disables cleanUrls and redirects each `/<concept>` to its `index.html`; any static server works. The `design-mockups` entry in `.claude/launch.json` runs the same `npx serve -l 4380 design-mockups`. The old `MOCKUPS.md` / `Open DRVN Mockups.command` launcher pointed at Next.js routes that no longer exist and was removed in October 2026.)

The root `index.html` is a hub linking all sixteen concepts — each card links to the **Prototype**, its **Brief**, and its **Design system** (live style guide). The early concepts follow a four-page flow (landing → car/build page → part listing → seller/market context); later ones, Werkbank and Livesheet especially, cover the logged-in product surface.

### Per-concept files

| File | What it is |
|------|-----------|
| `index.html`, `car.html`, `listing.html`, `…` | the clickable prototype pages (most concepts: 4; `livesheet/` has 26 — home, explore, market, garage, car, listing, sell, orders, buyer-orders, buyer-offers, messages, notifications, profile, settings, dashboard, watchlist, auth, first-run, add-car, legal, safety, empty-states, edge-cases, form-states, index, design) |
| `BRIEF.md` | design thesis, reference lineage, iteration-pass log, portable style-emulation prompt — a July 2026 historical document for every concept, Livesheet included |
| `design.md` | the design system in Google's open `design.md` format (YAML tokens + prose). For the fifteen historical concepts it describes the prototype; for `livesheet/` it is the production token contract |
| `design.html` | live, self-contained style guide mirroring `design.md`, rendered in the concept's own language |
| `livesheet.css`, `livesheet.js`, `manifest.json` | Livesheet only: the mockup's shared stylesheet, behaviour (theme, live counters, countdowns) and page manifest. The production equivalents are `src/app/styles/` and `src/components/livesheet.tsx`; these files are frozen |
