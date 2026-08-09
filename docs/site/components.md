# Component catalog

The complete Livesheet component inventory, categorized. Class names are the
production CSS in `src/app/globals.css`; React wrappers live in
`src/components/ui/`. The live rendered version of this catalog is at
`/docs/components`.

Format: **class — shape — key rules.**

## 01 Chrome & navigation

| Component | Shape | Key rules |
| --- | --- | --- |
| `.bar` | Sticky top bar; `.bar__inner` (maxw 1200) > `.bar__logo` (`DRVN.` + microlabel) + `nav.bar__nav` of `.bar__link` | 86% paper + blur(14px); mono 12.5 uppercase links; `.is-active` ink bg; ≤640px nav becomes one scrollable row |
| `.indexbtn` + `.indexwrap`/`.indexsheet`/`.indexrow` | "Index" trigger opening a full-page sheet of numbered rows (01, 02…) | The menu is a second sheet unrolled over the page; rows carry number, label, note; current row chips "Here" |
| `.rail` / `.railrow` | Signed-in desktop side rail with numbered rows | Same numbering language as the index |
| `.jumprow` / `.jumplink` | "ON THIS SHEET" microlabel + underlined mono ref-links | THE tab replacement — no pill tabs or segmented controls, ever |
| `.foot` | 1px rule-mid top; mono microlabels both ends | Every page ends with it |
| `.skip-link` | Focus-visible skip to content | Accessibility furniture |

## 02 Page structure

| Component | Shape | Key rules |
| --- | --- | --- |
| `.wrap` | Max-width 1200 content column with responsive x padding | |
| `.pagehead` | microlabel line → `h1` (one `.live-word`) → `.sub` | live-word once per page, h1 only |
| `.deck` | Grid, gap 14; `--kpi` 4-col, `--two` 1.35fr/1fr, `--three` 3-col | Children `min-width: 0`; never nest decks |
| `.tile` | The plate: tile bg, r16, p18; `.tile__head`, `.tile__img` (r10) | No borders/shadows; never tile-in-tile; `.tile--deep` secondary tone; `.tile--hover`/`a.tile` lift -2px |
| `.band` | Ink-inverted stat plate, r16, 3-col num-giants | Public home stats |
| `.hero-media` | r16 media frame, 16/8.5 aspect | 4/3 below 980px |
| `.callout` + `.callout__leader` | Absolute mono tag + JS-drawn 1px live leader line to an anchor point on the hero | ≤720px: static chip row, leaders hidden |

## 03 Annotation (the signature layer)

| Component | Shape | Key rules |
| --- | --- | --- |
| `.microlabel` | Mono 10.5–11.5 uppercase 0.14em dim | 2–6 words; variants `--ink`, `--live` |
| `.livedim` | pl18 + 1px spine + 7px ticks; microlabel + `.val` (mono 13 tabular) | `--live`: red value + pulsing dot; `--blank`: dashed spine — THE signature component |
| `.dimline-h` | 1px horizontal rule with end ticks | Draws in (scaleX) over 650ms when `.is-in` |
| `.num-giant` | Sans 650 clamp(40–64) tabular | KPI numeral above a livedim; `--blank` for `—` |
| `.kv` | Mono key-value inline | Small data callouts |

## 04 Actions

| Component | Shape | Key rules |
| --- | --- | --- |
| `.btn` | Mono 12 uppercase, 13×20 pad, r10, ink bg, `[` `]` bracket pseudos | Press scale(.97); `--live` (one per surface), `--ghost` (paper-deep); no spinner variant |
| `.chip` | Mono 11 uppercase, 4×10, r6 | `--live`, `--ok`, `--warn`, `--ink`, `--spent`; status, never navigation |
| `.capsule` | Ink band r10, 10×16, mono; `.dot` pulse + `.cd` countdown | `--paper` (+1px baseline shadow-rule), `--quiet` |
| `.relbtn` | Small release button in `.bline--own` rows | Owner "release this part" affordance |
| `.fbtn` / `.filters` | Mono 11 filter buttons, r10, paper-deep | `.is-on` ink; `[aria-pressed=true]` live (fitment switch); 44px touch target |
| `.search` | Tile-framed label + borderless input | |

## 05 Data display

| Component | Shape | Key rules |
| --- | --- | --- |
| `.bline` | Baseline grid 190px/1fr/auto: label / value / note / chip | `--ctl` puts a control in the value col; `--own` adds `.relbtn`; stacks ≤720px |
| `.spec` | 2-col ruled table, mono label left, mono value right | Spec tables (tracking, payout math) |
| `.rowlist` | Strips row bg/radius; rows get 1px rule-soft top | The ruled-row principle for every list in a tile |
| `.order` | Row: `.order__img` 56×44 + name/meta + `.order__actions` (Accept/Counter/Pass) | `.is-done` ok-tint; `.is-gone` slides out 420ms |
| `.ledger` | Ruled data table for the seller's listings register | The one genuinely tabular surface |
| `.feed` | `li`: mono time (74px col) + text + `.amt` right | `--live` amounts for money in motion |
| `.week` | 7-col strip; `.week__day` paper-deep r10 | `--hot` live bg + tag |
| `.pipe` / `.pip` | 9px pips + 14px dimline connectors + mono labels | `.is-on` live; empty pipeline renders at reduced opacity |
| `.guide` | 6px track r3 + ok-tint band + 2px live "you" marker + mono scale | Price guidance |
| `.review` | Ruled entry: head + mono live stars right + paragraph | |
| `.monogram` | 64px (44 sm) ink plate r10, mono initials | Avatar fallback |
| `.stamp` | Rotated live frame ("SOLD") | `--spent` desaturated |

## 06 Forms

| Component | Shape | Key rules |
| --- | --- | --- |
| `.field` / `.ctl` | Grid gap 7: microlabel + control (mono, paper-deep, r10) + hint/err/ok | `.ctl` keeps `border: 1px solid transparent` so invalid/ok borders paint without layout shift; `.field--row` 2-col |
| `.ctl__prefix` | Framed prefix ("$") input | |
| `input.sq` | 16px square checkbox, accent live | |
| `.drop` / `.thumbs` / `.thumb` | Dashed r16 dropzone (live tint on hover/dragover); 84px thumb grid with `__x`, `__tag`, `--ghost` | |
| `.steps` / `.step` | Counter rows 01/02/… grid 34/1fr/auto, ruled | `.is-now` live number; `.is-done` dim |
| `.savebar` | Sticky bottom tile r16 + baseline shadow-rule | Fixed full-width ≤720px; appears on dirty settings |
| `.authwrap` | 420px centered auth column | |

## 07 Commerce

| Component | Shape | Key rules |
| --- | --- | --- |
| `.mkt` | 3-col grid of `a.tile` market cards: `.tile__img` 3/2 + `__name` + `__price` + `__meta` chips | Steps 3 → 2 → 1 columns |
| `.sheetwrap` / `.sheet` | Fixed scrim + bottom sheet min(480px); 2-step (`data-step1/2`) | Buy sheet, release sheet |
| `.plate-undrawn` | Card cover fallback: dashed construction rule + cross-hair | A photoless listing is "a plate nobody has drawn yet", not an error |

## 08 Communication & feedback

| Component | Shape | Key rules |
| --- | --- | --- |
| `.alert` | r10 tinted ground + icon color, grid auto/1fr | `--live`, `--ok`; never a side-bar stroke |
| `.msg` / `.thread` / `.composer` | 2px left spine; `--me` live spine, `--sys` dashed; mono who/meta | Annotations, not chat bubbles |
| `.mail` | 1px rule-mid frame: bar/body/foot | The ONLY framed component — it depicts an external artifact |
| `.toast` | Fixed bottom ink pill r10 mono uppercase | `role=status`, 2600ms dwell |

## 09 States

| Component | Shape | Key rules |
| --- | --- | --- |
| `.undrawn` | Dashed r16 ghost plate + `__mark` + h3 + p | Empty = same geometry as real content; `--hero` variant |
| `.ghostrow` / `.gbar` / `.gbox` | Grid 56/1fr/76 ruled skeleton, bars r3 | `.is-loading` gradient sweep 1.5s; no spinners |
| `.num-giant--blank` | `—` numeral | Blank KPI |
| `.clamp2` / `.trunc` | Truncation utilities | Edge-case text |

## 10 React components (`src/components/ui`)

| Export | File | Purpose |
| --- | --- | --- |
| `LivesheetBar`, `Foot`, `BAR_ROUTES` | livesheet-bar.tsx | Product top bar (signed in/out), index sheet, theme toggle; page footer |
| `AppShell` | app-shell.tsx | Signed-in shell: rail + content |
| `Icon` (`IconName`) | icons.tsx | The stroke icon set |
| `CategoryIcon` | category-icon.tsx | Part-category glyphs |
| `ListingCard` | listing-card.tsx | Market card (`.mkt` tile) from `ListingCardData` |
| `FeedCard`, `MasonryFeed` | feed-card.tsx | Explore feed cards + masonry |
| `NarrowColumn`, `Avatar`, `Media`, `MetadataTags`, `SectionLabel`, `HorizontalGallery`, `TabNav` | primitives.tsx | Layout + media primitives (Media takes `fallbackClassName` for undrawn covers) |
| `LinkedTitle`, `TimelineRow`, `WebsitePill`, `ProfileHeader`, `VehicleGallery`, `KeyValueTable`, `EmbeddedVideo`, `SectionHeading` | patterns.tsx | Profile/build-log patterns |
| `Dialog` | dialog.tsx | Modal on the sheet idiom |
| `SheetTabs`, `resolveTab` | sheet-tabs.tsx | URL-driven jumprow tabs |
| `Toast` | toast.tsx | Status toast |
| `Skeleton` | skeleton.tsx | Ghost loading blocks |
