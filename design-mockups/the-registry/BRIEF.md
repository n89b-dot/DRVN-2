# Concept 01 — THE REGISTRY

**Thesis:** *"A part is only worth its paperwork."* The marketplace as an archival institution — every car a registry entry, every part a documented artifact with a certificate of provenance. Trust is rendered as literal paperwork.

## Pages
`index.html` (landing) → `car.html` (registry entry DRVN-0042) → `listing.html` (Lot 217, Jenvey ITBs) → `seller.html` (dossier № 88). Fully cross-linked; buy/offer opens an escrow confirm sheet.

## Reference lineage
RM Sotheby's and Bonhams auction catalogues (lot numbering, condition grading, plates and folios); museum accession records; read.cv restraint; Fraunces-era editorial sites (Commission Studio, The Gourmand); classic.com's data-with-dignity. Coin-grading language ("Grade II — Excellent") borrowed from numismatics to make used-parts condition feel governed rather than haggled.

## Why it serves DRVN's trust-and-context mission
DRVN's four trust questions are staged as a formal **Certificate of Provenance** on every listing — source vehicle, seller of record, fitment (stamped *seller-stated, not verified*, honoring the "never trust user-asserted fitment" principle), and companion history. The car page is a dated provenance ledger whose entries cross-reference the lots they released — the car profile literally becomes the paper trail behind the marketplace.

## Visual language
Warm ivory paper `#F4F0E6`, ink `#171412`, hairline rules `#C9C1AE`, single oxblood accent `#7A2E24`. Fraunces (300–600, optical sizing, italic flourishes) for display; Archivo small-caps metadata with letterspaced 11px labels. Paper-grain noise, rotated rubber stamps, serial numbers, folio corners. Motion is slow and dignified: 400–700ms reveals, rules that draw in, images that desaturate until hover.

## Iteration pass log
- **Pass 1 — flaws:** Mobile (≤720px) hero overflowed horizontally: the three-span folio-corner row could not wrap. Fixed — folio row now wraps and drops its middle span on small screens; `overflow-x` guarded. Desktop pages audited clean (hierarchy, contrast, spacing all hold).
- **Pass 2 — elevation:** No change needed — the concept already carries its second-read details (rough-edged provenance stamps via SVG turbulence masks, ledger cross-references, colophon footer); adding more ornament would tip catalogue into pastiche.
- **Pass 3 — coherence:** All four pages audited against the thesis; every surface speaks "document of record" (even the buy flow is an escrow *sheet* with a stamp on success). Nothing off-voice found; no change.

## Style-emulation prompt (portable)
> Design this product as an archival institution's document of record. Light mode only: warm ivory paper (#F4F0E6) with a deeper panel tone (#ECE7D9), near-black ink text (#171412), muted ink secondary (#6E675B), hairline rules (#C9C1AE), and exactly one accent — oxblood (#7A2E24) — reserved for links, prices, and stamp motifs. Display type is a high-contrast optical serif (Fraunces or Canela) used enormous (up to 8rem) at weight 300–400 with italic flourishes on emotional words; all metadata is a plain grotesque (Archivo/Inter) set as 10–11px letterspaced uppercase labels with tabular numerals. Compose on a strict editorial paper grid: generous margins, asymmetric columns, visible hairline column rules, numbered sections (01, 02…), folio lines in page corners, footnote-style side annotations. Texture is subtle paper grain (SVG turbulence at low opacity) plus rotated rubber-stamp elements with rough masked edges. Every entity is treated as a catalogued object: serial numbers, accession dates, condition grades, certificates laid out as formal documents with roman-numeral clauses. Motion is slow and dignified — 400–700ms opacity/8px reveals with generous stagger, hairlines that draw in via scaleX, images that begin desaturated and warm to full color on hover; nothing bounces. Buttons are rectangular paper buttons with thin ink borders; the primary action is solid oxblood. The voice is registrar's English: formal, precise, quietly proud.

## The thesis as a design system

"A part is only worth its paperwork" scales into a coherent, swappable token system rather than a one-off look. The discipline that makes it hold is **one accent**: `accent` (oxblood `#7A2E24`) is the only hue in the system — reserved for links, prices, and stamps — so the car photography, always shot on the same ivory seamless, supplies every other color. Structure is never boxed or shadowed; it is drawn with a single `hairline` rule (`#C9C1AE`) over a `surface` of warm paper (`#F4F0E6`) with a `surface-panel` inset tone (`#ECE7D9`) for depth.

Type is a **system with two enforced roles**, not a pairing of favourite fonts. Fraunces (the `display`/`h1`/`h2`/`price` tokens) carries everything a human reads for pleasure — headlines, editorial voice, and money, which is deliberately set as a headline. Archivo (the `label` and `body` tokens) carries every machine coordinate: the `label` token — `11px`, weight `500`, `0.18em` letterspaced uppercase — renders every lot number, accession date, and folio line. If it's a sentence, it's serif; if it's a coordinate the system records, it's grotesque smallcaps. That rule alone prevents "font soup" across any new page.

Shape and elevation are governed by the paper metaphor. `rounded.none (0px)` holds for cards, buttons, inputs, and chips; the only softening in the entire system is `rounded.stamp (3px)`, which combined with a fractal-turbulence mask sells the "Verified Provenance" mark as physical ink. Depth is paper craft — hairlines, grain, inset tone, and the rough stamp edge — never a drop shadow. Components are documentary and reusable: `stamp`, `ledger-entry` (a dated provenance row that cross-references the lots it released), certificate blocks, and square paper `button-primary`/`button-ink` whose every state is its own token (`-hover`). Motion is a single governed rule — 400–700ms reveals with hairlines drawing in via `scaleX` and images warming from desaturated to full color — so nothing on a new surface can drift quick or bouncy. Because every value is a named token, a future design system drops in wholesale without touching page markup.

## design.md — Google's open standard

[Google's open `design.md` format](https://github.com/google-labs-code/design.md) captures a design system as a single machine-readable file: a YAML token block (colors, typography, rounded, spacing, components) that a coding agent implements from exactly, followed by human prose (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's & Don'ts) explaining the *why* behind the values. It is the source of truth, mirrored by a live `design.html` style guide so the agent and the human read the same system. This fits DRVN's own "everything is a token / swappable design system" principle precisely — the tokens below could be dropped into the real product without rewriting a single page.

This concept ships a complete one. An excerpt of the actual token block:

```yaml
colors:
  surface: "#F4F0E6"
  surface-panel: "#ECE7D9"
  on-surface: "#171412"
  on-surface-muted: "#6E675B"
  hairline: "#C9C1AE"
  accent: "#7A2E24"
  on-accent: "#F4F0E6"

components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "15px 32px"
```

Full system: **[design.md](design.md)** (source of truth) · **[design.html](design.html)** (live style guide, rendered in The Registry's own language).
