# DRVN — Three Design Concepts

Three radically distinct, fully clickable interface concepts for DRVN, the build-aware marketplace for modified cars. Each is a self-contained static prototype (HTML/CSS/JS, no build step) with four cross-linked pages, custom AI-generated imagery (`assets/`), and a design brief + portable style-emulation prompt (`BRIEF.md` in each folder).

Each concept also ships a **full design system** in [Google's open `design.md` format](https://github.com/google-labs-code/design.md): a machine-readable YAML token block plus prose (`design.md`, the source of truth), mirrored by a live, self-contained style guide rendered in the concept's own visual language (`design.html`). The token values are faithful to what the prototypes actually ship.

| # | Concept | Thesis | Folder |
|---|---------|--------|--------|
| 01 | **The Registry** | "A part is only worth its paperwork." — the marketplace as archival institution | `the-registry/` |
| 02 | **APEX/OS** | "Data density is respect." — the marketplace as race-engineer's instrument | `apex-os/` |
| 03 | **After Hours** | "Buy the part. Keep the night." — the marketplace as 1am cinema | `after-hours/` |

## Run it

```bash
cd design-mockups
npx -y serve -l 4380 .
# open http://localhost:4380
```

(`serve.json` disables cleanUrls so relative asset paths resolve; any static server with directory support works. A `design-mockups` config also exists in `.claude/launch.json`.)

The root `index.html` is a hub linking all three concepts — each card links to the **Prototype**, its **Brief**, and its **Design system** (live style guide). Each concept's flow: landing → car/build page → part listing → seller/market context, with working nav, hover/focus states, filters (APEX/OS), and purchase confirm flows (Registry, After Hours).

### Per-concept files

| File | What it is |
|------|-----------|
| `index.html`, `car.html`, `listing.html`, `…` | the clickable prototype pages |
| `BRIEF.md` | design thesis, reference lineage, iteration-pass log, portable style-emulation prompt, "thesis as a design system", and the `design.md` standard explainer |
| `design.md` | the design system in Google's open `design.md` format (YAML tokens + prose) — source of truth |
| `design.html` | live, self-contained style guide mirroring `design.md`, rendered in the concept's own language |
