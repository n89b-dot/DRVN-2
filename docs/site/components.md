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
| `.microlabel` | Mono 12 uppercase 0.14em dim | 2–6 words; variants `--ink`, `--live` |
| `.livedim` | pl18 + 1px spine + 7px ticks; microlabel + `.val` (mono 13 tabular) | `--live`: red value + pulsing dot; `--blank`: dashed spine — THE signature component |
| `.dimline-h` | 1px horizontal rule with end ticks | Draws in (scaleX) over 650ms when `.is-in` |
| `.num-giant` | Sans 650 clamp(40–64) tabular | KPI numeral above a livedim; `--blank` for `—` |
| `.kv` | Mono key-value inline | Small data callouts |

## 04 Actions

| Component | Shape | Key rules |
| --- | --- | --- |
| `.btn` | Mono 12 uppercase, 13×20 pad, r10, ink bg, `[` `]` bracket pseudos | Press scale(.97); `--live` (one per surface), `--ghost` (paper-deep), `--destructive` (reads serious without competing with the one filled-red `--live`); no spinner variant |
| `.chip` | Mono 11 uppercase, 4×10, r6 | `--live`, `--ok`, `--warn`, `--ink`, `--spent`, `--danger`, `--info`, `--x` (removable filter chip); status, never navigation |
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
| `.pipe` / `.pip` | 9px pips + 14px dimline connectors + mono labels | `.is-on` live; empty pipeline renders at reduced opacity; `.pip` only exists as a `.pipe .pip` descendant — there is no standalone `.pip` class |
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
| `.toast` | Fixed bottom ink pill r10 mono uppercase | Renders `<output aria-live="polite">` (implicit status role), 3200ms default dwell |

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
| `LivesheetBar`, `Foot` | livesheet-bar.tsx | Product top bar (signed in/out), index sheet, theme toggle; page footer |
| `AppShell` | app-shell.tsx | Signed-in shell: rail + content |
| `BAR_ROUTES`, `PRIMARY_NAV`, `MARKETPLACE_FAMILY`, `PUBLIC_ROUTES`, `matchesFamily`, `isMarketplaceFamily` | nav-routes.tsx | The register, read by the rail, the index and the family subnav. Marketplace/Listings/Offers/Orders are one group; the family matchers keep `/listings` (seller register) and `/listings/<id>` (public part sheet) apart |
| `MarketplaceNav` | marketplace-nav.tsx | Marketplace \| Listings \| Offers \| Orders — the family's local register, on every family surface for signed-in users only |
| `Icon` (`IconName`) | icons.tsx | The stroke icon set |
| `CategoryIcon` | category-icon.tsx | Part-category glyphs |
| `ListingCard` | listing-card.tsx | Market card (`.mkt` tile) from `ListingCardData` |
| `FeedCard`, `MasonryFeed` | feed-card.tsx | Explore feed cards + masonry |
| `NarrowColumn`, `Avatar`, `Media`, `MetadataTags`, `SectionLabel`, `HorizontalGallery`, `TabNav` | primitives.tsx | Layout + media primitives (Media takes `fallbackClassName` for undrawn covers) |
| `LinkedTitle`, `TimelineRow`, `WebsitePill`, `ProfileHeader`, `VehicleGallery`, `KeyValueTable`, `EmbeddedVideo`, `SectionHeading` | patterns.tsx | Profile/build-log patterns |
| `Dialog` | dialog.tsx | Modal on the sheet idiom |
| `AuthIntentDialog` | auth-intent-dialog.tsx | The one place DRVN asks a signed-out visitor for an account — contextual copy per intent (offer/buy/save/follow/sell), carrying `?next=` back to the action |
| `ConfirmDialog` | confirm-dialog.tsx | Two-step destructive confirm on the dialog idiom |
| `Gallery`, `GalleryLightbox` (+ `GalleryPhoto` type) | gallery.tsx | Interactive gallery (hero + thumbs) and lightbox |
| `SheetTabs`, `resolveTab` | sheet-tabs.tsx | URL-driven jumprow tabs |
| `Toast` | toast.tsx | Status toast |
| `PaymentModeNotice` | payment-mode-notice.tsx | Test/live Stripe mode banner |
| `SkeletonRows`, `SkeletonPage` | skeleton.tsx | Ghost loading blocks — **not** exported from `ui/index.ts`; import from the file directly |

Components living outside the `ui/index.ts` barrel:

| Export | File | Purpose |
| --- | --- | --- |
| `FeedList` | src/components/ui/feed-list.tsx | Activity feed list (`.feed` rows) — in `ui/` but not the barrel |
| `Rv`, `LiveDim`, `Countdown` | src/components/livesheet.tsx | Behavior components: reveal wrapper, signature measured value, server-authoritative countdown |
| `ConditionSummary` | src/components/condition-summary.tsx | Part condition snapshot summary |
| `ProfileBody` | src/components/profile/profile-body.tsx | Profile page body composition |

## 11 Further CSS families (globals.css)

Previously undocumented class families, one line each:

| Family | Purpose |
| --- | --- |
| `.buybar` | Sticky phone purchase bar fixed to the bottom edge while the real purchase controls are off-screen (desktop keeps the full rail) |
| `.pdp` | Listing detail two-column layout: 1.35fr/1fr grid ≥981px, `.pdp__media` / `.pdp__more` column flow |
| `.finder` | The one search/filter recipe (tile plate) serving the marketplace, category sheets and console queues |
| `.gallery` / `.lightbox` | Interactive gallery hero + thumb strip (`.gallery__hero/__thumbs/__thumb`) and full-screen lightbox — backs `Gallery`/`GalleryLightbox` |
| `.tabstrip` | Real panel-switching tabs (car sheet, profile) reusing the `.fbtn` vocabulary; selection is ink, never signal red |
| `.star-pick` | Interactive star rating — a radiogroup of buttons, not a select |
| `.jobrow` | Seller job row inside `.rowlist` (orders register) |
| `.filterchips` | Active-filter readout between the finder and results (removable `.chip--x` chips) |
| `.barbadge` | Count badge on cart/notifications — a legitimately live number in the signal colour |
| `.authswap` | Mono link row swapping between login and signup on auth pages |
| `.spec-note` | Catalog-page furniture: dim mono footnote under spec tables |
| `.toc` | Table-of-contents link column for legal/long-form pages |
| `.prose` | Legal / long-form prose styling |
| `.shell` | The register rail layout: signed-in desktop rail + content ("the drawing's left margin") |
| `.cat-ico` | 40px category icon plate, r10 |
| `.indexlight` | The lighting (theme) switch spelled out inside the index sheet — the bar's version is icon-only |
| `.railtoggle` | Collapse/expand control for the register rail |
| `.console-nav` / `.console-main` | Admin console layer: console nav (a `.filters` compound, hidden ≤640px for the index button) and the console content column with its calmer display/stat scale |
