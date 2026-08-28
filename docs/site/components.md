# Component catalog

The complete Livesheet component inventory, categorized. Class names are the
production CSS in `src/app/globals.css`; React contracts live in
`src/components/ui/` (primitives + card patterns) and `src/components/commerce/`
(domain patterns), indexed by the machine-readable registry
`src/components/registry.ts`. The live rendered version of this catalog is at
`/docs/components`; §12 is the "which component do I use?" taxonomy.

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
| `.btn` | Mono 12 uppercase, 13×20 pad, r10, ink bg, `[` `]` bracket pseudos | Press scale(.97); `--live` (one per surface), `--ghost` (paper-deep), `--destructive` (reads serious without competing with the one filled-red `--live`); no spinner — async buttons use `Button loading` + `pendingLabel` ("Saving…", aria-busy) |
| `.chip` | Mono 11 uppercase, 4×10, r6 | `--live`, `--ok`, `--warn`, `--ink`, `--spent`, `--danger`, `--info`, `--x` (removable filter chip); status, never navigation |
| `.capsule` | Ink band r10, 10×16, mono; `.dot` pulse + `.cd` countdown | `--paper` (+1px baseline shadow-rule), `--quiet` |
| `.relbtn` | Small release button in `.bline--own` rows | Owner "release this part" affordance |
| `.fbtn` / `.filters` | Mono 11 filter buttons, r10, paper-deep | `.is-on` ink; `[aria-pressed=true]` live (fitment switch); 44px touch target at every width. Consumed via `FilterGroup` (axis grammar: `stack` primary / `sub` quieter / `scroll` gutter-rides ≤760px) with `FilterLink` (aria-current) and `FilterButton` (aria-pressed) |
| `.search` | Tile-framed label + borderless input | Consumed via `SearchField` (accessible name required) and `Finder` (query row + refinement row, GET form — every search is an address) |
| `.saverow` | Commit row: aux left, status + commit right | Consumed via `ActionFooter`; ≤520px stacks aux / status / full-width 44px commit |
| `.buybar` | Fixed bottom action bar, safe-area padded | Consumed via `MobileActionBar`; body clearance reserved by the stylesheet; retires at 981px (plain) / 1024px (`--wide`, cart + checkout) |

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
| `.field` / `.ctl` | Grid gap 7: microlabel + control (mono, paper-deep, r10) + hint/err/ok | `.ctl` keeps `border: 1px solid transparent` so invalid/ok borders paint without layout shift; `.field--row` 2-col. Consumed via `FormField` / `TextField` / `TextArea` / `Select` — label, hint, error, success and `aria-describedby`/`aria-invalid` wired automatically |
| `.ctl__prefix` | Framed prefix ("$") input | |
| `input.sq` | 16px square checkbox, accent live | |
| `.drop` / `.thumbs` / `.thumb` | Dashed r16 dropzone (live tint on hover/dragover); 84px thumb grid with `__x`, `__tag`, `--ghost` | |
| `.field__labelrow` / `.field__count` | Label row with right-aligned live counter ("12 of 160"), mono 12 dim tabular | Only on fields with a real server-enforced limit; counter is aria-hidden |
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

## 10 React component registry

The reusable React layer, generated from the machine-readable registry.

Non-component helpers worth knowing (not in the table): `nav-routes.ts`
(`BAR_ROUTES`, `PRIMARY_NAV`, family matchers), `buttonClass`, `fieldDescribedBy`,
`ratingLine` (the canonical "4.8 ★ · 12 reviews" string), `mosaicSize`,
`resolveTab`, `withParams` (src/lib/url-params.ts), `vehicleLabel`/`provenanceLine`
(src/lib/vehicles/label.ts), and `uploadImages` (src/lib/media-upload.ts — the one
image upload loop: validation, storage placement, GC staging).

<!-- BEGIN GENERATED: component-registry (npm run docs:components) -->

Source of truth: `src/components/registry.ts` (validated by `src/components/registry.test.ts`).

### Primitives (72)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `ActionFooter` | Primitive | `@/components/ui` | The save row — aux slot, status chip/error, actions. — `.saverow` | Form commit rows. |
| `ActiveFilterChip` | Primitive | `@/components/ui` | Removable applied-filter chip. — `.chip--x` | Active filter rows. |
| `Alert` | Primitive | `@/components/ui` | Notice plate — icon column, bold head, body. — `.alert` | Inline notices; `live` when the reader must act, `ok` for confirmation. *Not for:* Action results inside forms — that's ResultNote. |
| `AppShell` | Primitive | `@/components/ui` | The signed-in application frame: bar, content column, foot. | Product route-group layouts. *Not for:* Docs and marketing surfaces, which own their chrome. |
| `Avatar` | Primitive | `@/components/ui` | Monogram identity plate (soft square, never a circle). — `.monogram` | People without photos; photo avatars go through Media. |
| `BottomSheet` | Primitive | `@/components/ui` | Compact bottom sheet; keeps children mounted; dissolves inline ≥ its breakpoint. — `.bsheet` | Compact-width pickers and refinements. |
| `Button` | Primitive | `@/components/ui` | The canonical action — `.btn` variants plus a defined loading state. — `.btn / .relbtn` | Every button. One `live` action per surface. |
| `ButtonLink` | Primitive | `@/components/ui` | The action contract as a real link. — `.btn` | CTAs that navigate — keeps middle-click/new-tab semantics. |
| `Checkbox` | Primitive | `@/components/ui` | Live-accent square checkbox with its label as one touch target. — `.sq` | Boolean options. |
| `ComboField` | Primitive | `@/components/ui` | Searchable single-select (ARIA combobox) in the field contract: ranked options, keyword matching (aliases), optional footer escape hatch. — `.field / .ctl / .combo` | Choosing one option from a ranked list too long for Select — vehicle makes/models. *Not for:* Short fixed lists (Select) and free-text with suggestions (TextField + datalist). |
| `ConfirmDialog` | Primitive | `@/components/ui` | Destructive confirmation with optional type-to-confirm gate. | Deletes and irreversible actions. |
| `Countdown` | Primitive | `@/components/livesheet` | H:MM:SS countdown from an absolute expiry; server-authoritative. | Offer/order expiry windows. |
| `CountedField` | Primitive | `@/components/ui` | Controlled input/textarea with a live character counter. — `.field__count` | Length-limited titles and bios. |
| `DataRow` | Primitive | `@/components/ui` | Ruled baseline row (`.bline`) — read-only value row or labelled control row. — `.bline` | Settings-style label/value and label/control lines. *Not for:* Full form fields with hints/errors — that's the `.field` family. |
| `Dialog` | Primitive | `@/components/ui` | The sheet dialog — focus management, escape/backdrop dismissal. | Modal editing/confirmation surfaces. |
| `DropZone` | Primitive | `@/components/ui` | Click/drag file target with busy state and keyboard support. — `.drop` | Every upload entry point (pair with lib/media-upload's uploadImages). |
| `EmbeddedVideo` | Primitive | `@/components/ui` | External video as an ink plate with a play mark. | Video links in updates. |
| `EmptyState` | Primitive | `@/components/ui` | The undrawn plate — dashed mark badge, title, body, optional action. — `.undrawn` | Every empty collection or missing object. |
| `FilterButton` | Primitive | `@/components/ui` | Filter as a button. — `.fbtn` | Client-side filters. |
| `FilterGroup` | Primitive | `@/components/ui` | Labelled filter cluster. — `.filters` | Filter bars. |
| `FilterLink` | Primitive | `@/components/ui` | GET filter as a link. — `.fbtn` | Stateless filters. |
| `Finder` | Primitive | `@/components/ui` | The find-in-sheet search band. — `.finder` | List filtering headers. |
| `FinderClear` | Primitive | `@/components/ui` | Finder's clear control. | Inside Finder. |
| `FinderLabel` | Primitive | `@/components/ui` | Finder's mono label. | Inside Finder. |
| `Foot` | Primitive | `@/components/ui` | The ruled page foot. — `.foot` | Bottom of full pages. |
| `FormField` | Primitive | `@/components/ui` | Labelled field wrapper — label, hint, error (role=alert), ok, aria wiring. — `.field` | Custom controls the family doesn't cover (wire aria via fieldDescribedBy). |
| `FormSection` | Primitive | `@/components/ui` | Numbered form section tile — mono step numeral, heading, hint. | Long editing workflows (Sell, editors). |
| `Gallery` | Primitive | `@/components/ui` | PDP media gallery. — `.gallery` | Listing detail media. |
| `GalleryLightbox` | Primitive | `@/components/ui` | Full-screen lightbox with keyboard navigation. | Expanding gallery/vehicle media. |
| `HorizontalGallery` | Primitive | `@/components/ui` | Scrollable thumbnail strip. | Inline media rows in feeds/timelines. |
| `Icon` | Primitive | `@/components/ui` | The stroke icon set. | Any inline icon; never ad-hoc SVGs. |
| `KeyValueTable` | Primitive | `@/components/ui` | Ruled key/value spec table. — `.spec` | Spec sheets (wheels & tires, dimensions). |
| `LinkedTitle` | Primitive | `@/components/ui` | Linked title with the drafting-office arrow. | Row/section titles that navigate. |
| `LiveDim` | Primitive | `@/components/livesheet` | The drafting leader line with a measured value; live and blank variants. — `.livedim` | Measured facts on tiles and sheets. |
| `LivesheetBar` | Primitive | `@/components/ui` | The top bar — wordmark, primary nav, counts, account. — `.bar` | Via AppShell / group layouts only. |
| `Media` | Primitive | `@/components/ui` | Optimized image plate with role-based `sizes` presets and the undrawn no-photo fallback. | Every product image. Pick a `role` (hero/card/row/thumb/avatar…). *Not for:* Raw <img> tags anywhere. |
| `Message` | Primitive | `@/components/ui` | One message — sender line, body, meta; `me` right-tones the row. — `.msg` | Order messages, offer threads, Q&A, comments. Features decide what `me` means. |
| `MessageComposer` | Primitive | `@/components/ui` | The send row — hidden fields, `.ctl` input, submit; block variant for the Q&A ask box. — `.composer__row / .composer` | Thread reply rows. The owning feature supplies action + pending. |
| `MessageThread` | Primitive | `@/components/ui` | Conversation container (`.thread`). — `.thread` | Wrapping Message runs on any discussion surface. |
| `MetadataTags` | Primitive | `@/components/ui` | Wrapping row of plain chips. — `.chip` | Tag lists. |
| `MetricCard` | Primitive | `@/components/ui` | KPI tile — microlabel, giant numeral, measured LiveDim line, floor-pinned footer link. — `.tile + .num-giant` | KPI decks (`.deck--kpi`); calculations stay with the feature. |
| `MobileActionBar` | Primitive | `@/components/ui` | Pinned bottom action bar (buybar) for compact widths. — `.buybar` | Primary commerce actions on PDP-like pages. One bottom surface per route. |
| `NarrowColumn` | Primitive | `@/components/ui` | Constrained page column (narrow 720 / medium / wide). — `.wrap--*` | Reading and list surfaces that shouldn't span the full 1200px wrap. |
| `ObjectRow` | Primitive | `@/components/ui` | The `.order` dense row — leading media plate, name, dim meta, trailing actions — inside `.rowlist`. — `.order / .rowlist` | Any object in a dense collection (saved items, cart lines, inbox rows, task rows). *Not for:* Marketplace browsing — that's the mosaic card family. Sortable tables — that's `.ledger`. |
| `PageHead` | Primitive | `@/components/ui` | Page header: mono eyebrow, display h1, dim sub line, revealed on entry. — `.pagehead` | The head of every page instead of hand-assembling `.pagehead` markup. |
| `Pagination` | Primitive | `@/components/ui` | Ghost prev/next with mono page marker; renders nothing on a lone first page. | Every paginated list. (Admin's jumplink Pager is a deliberate console variant.) |
| `Radio` | Primitive | `@/components/ui` | Radio in the square-mark language. — `.sq` | Exclusive options. |
| `RatingStars` | Primitive | `@/components/ui` | Read-only five-star display with sr-only value. — `.review__stars` | Displaying a rating. (The interactive picker is the review form's `.star-pick`.) |
| `ResultNote` | Primitive | `@/components/ui` | Action outcome line — ok chip or error text, role=alert. | useActionState results next to a form. |
| `Rv` | Primitive | `@/components/livesheet` | Livesheet spring reveal (`.rv → .is-in`), staggered per index, reduced-motion safe. — `.rv` | Entry reveal on page heads, tiles, cards. |
| `ScrollActiveIntoView` **[internal]** | Primitive | `@/components/ui` | Scrolls the active nav item into view on mount. | Inside scrolling nav strips. |
| `SearchField` | Primitive | `@/components/ui` | The `.search` input band. — `.search` | Search inputs. |
| `SectionHeading` | Primitive | `@/components/ui` | Mono microlabel section heading. — `.microlabel` | Section labels inside sheets/profiles. |
| `SectionLabel` | Primitive | `@/components/ui` | Ink microlabel paragraph. — `.microlabel--ink` | Ink-toned section labels. |
| `Select` | Primitive | `@/components/ui` | Native select in the field contract (platform picker on compact). — `.ctl` | Enumerated choices. |
| `SheetTabs` | Primitive | `@/components/ui` | URL-backed sheet tabs. | Profile/car sheet sections. |
| `SkeletonCardGrid` | Primitive | `@/components/ui` | Card-grid placeholder matching the marketplace 3→2→1 grid. | loading.tsx for card-grid routes. |
| `SkeletonLedger` | Primitive | `@/components/ui` | Console placeholder — pagehead + ledger ghost rows, no wrap. | Admin console loading. |
| `SkeletonMasonry` | Primitive | `@/components/ui` | Masonry placeholder with varied plate heights. | loading.tsx for feed walls (Explore). |
| `SkeletonPage` | Primitive | `@/components/ui` | Generic page placeholder — pagehead + rows. | loading.tsx when no closer geometry exists; pass a label naming the surface. |
| `SkeletonPdp` | Primitive | `@/components/ui` | Two-column PDP placeholder (media + purchase rail). | loading.tsx for listing detail. |
| `SkeletonRows` | Primitive | `@/components/ui` | N ghost ledger rows. — `.ghostrow` | Inside larger skeletons / list regions. |
| `Stepper` | Primitive | `@/components/ui` | Auto-numbered workflow progress rail; live numeral on the current step. — `.steps` | Multi-step workflows (checkout). Workflow state stays with the feature. |
| `TabNav` | Primitive | `@/components/ui` | The system's tab replacement — a quiet jumprow of mono links. — `.jumprow` | On-page section switching. |
| `TextArea` | Primitive | `@/components/ui` | Textarea in the field contract. — `.ctl` | Multi-line input. |
| `TextField` | Primitive | `@/components/ui` | Text input in the field contract; mono prefix support ($, PN). — `.field / .ctl` | Every text input. |
| `ThreadDivider` | Primitive | `@/components/ui` | Centered mono divider (day buckets). | Grouped threads. |
| `TileHead` | Primitive | `@/components/ui` | Tile rule line — ink microlabel left, optional chip/jumplink right. — `.tile__head` | The head of any `.tile` section. *Not for:* Heads with bespoke inner structure — keep those raw. |
| `TimelineRow` | Primitive | `@/components/ui` | Date-rail timeline row — mono date column beside content. | Activity/history feeds on profiles and sheets. |
| `Toast` | Primitive | `@/components/ui` | Bottom-center transient confirmation, portalled to <body>. — `.toast` | Post-action confirmations that need no reply. |
| `ValidationSummary` | Primitive | `@/components/ui` | Assertive submit-blocking error list with per-field jump links. | Above long forms on failed submit; fields keep their inline errors. |
| `WebsitePill` | Primitive | `@/components/ui` | Quiet mono external-link pill. | Profile websites. |

### Product patterns (19)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `AuthIntentDialog` | Product pattern | `@/components/ui` | Signed-out interception — explains the action and routes to login with intent. | Any engagement control a guest can press. |
| `CategoryIcon` | Product pattern | `@/components/ui` | Marketplace taxonomy category mark. | Category navigation and headers. |
| `ConditionSummary` | Product pattern | `@/components/commerce` | Structured part-condition grid (grade + checklist). | PDP and sell preview condition blocks. |
| `FeedList` | Product pattern | `@/components/ui/feed-list` | Feed items as dense `.order`-based rows (Home's list-shaped feed). — `.feedrow on .order` | Home feeds where the wall would be too loud. *Not for:* Browse surfaces — that's the mosaic family. |
| `FeedMosaicCell` | Product pattern | `@/components/ui` | A feed item (part / build / update) as a mosaic card. | Explore and mixed feeds, via MasonryFeed. |
| `FinderRefineSheet` | Product pattern | `@/components/ui` | Finder's compact refine sheet. | Marketplace filtering on compact widths. |
| `ListingCard` | Product pattern | `@/components/ui` | THE listing card — canonical marketplace/browse representation (delegates to ListingMosaicCell). | Anywhere a listing is browsed: marketplace, home recs, PDP rails, saved grid. *Not for:* Seller-scoped dense lists — that's ListingRow. |
| `ListingMosaicCell` | Product pattern | `@/components/ui` | A listing as a mosaic card (price, shipping, provenance, seller trust). | Via ListingCard. |
| `ListingRow` | Product pattern | `@/components/commerce` | A seller's listing as a dense ledger row — cover, title, price, Live/Sold chip. — `.order` | Seller-scoped lists (profile shopfront, car sheet parts). *Not for:* Marketplace browsing — that's ListingCard. |
| `MarketplaceNav` | Product pattern | `@/components/ui` | The marketplace-family console nav. | Marketplace-family pages. |
| `MasonryFeed` | Product pattern | `@/components/ui` | The Explore wall — FeedMosaicCells in a dense Mosaic, with its empty state. | Mixed-kind feed walls. |
| `Mosaic` | Product pattern | `@/components/ui` | The card wall grid (`.mosaic`), commerce variant included. — `.mosaic` | Container for MosaicCell families on browse surfaces. |
| `MosaicCell` | Product pattern | `@/components/ui` | The single card primitive — eyebrow/kind, media, title, value, provenance, trust, engagement slots. — `.mcell` | Underlying anatomy for every card; compose, don't fork. |
| `OrderPipeline` | Product pattern | `@/components/commerce` | The order lifecycle as a `.pipe` stage rail, terminal states included. — `.pipe` | Order rows and order detail. |
| `PaymentModeNotice` | Product pattern | `@/components/ui` | Test-mode payments banner. | Payment surfaces while Stripe runs in test mode. |
| `ProfileHeader` | Product pattern | `@/components/ui` | Identity block — avatar plate, name, handle, tagline, website, action slot. | Profile and car sheet heads. |
| `StatusChip` | Product pattern | `@/components/commerce` | Order/offer lifecycle state as a toned chip (ok / live / spent). — `.chip--ok/--live/--spent` | Orders, offers, and anywhere an order-family status appears. *Not for:* Non-lifecycle chips — use `.chip` variants directly. |
| `VehicleCard` | Product pattern | `@/components/ui` | A vehicle as a dashboard row — 3:2 media, identity, pulse stats, whole-row link. — `.vehicle--row` | Home garage tile. (The Garage's management card is the feature-level GarageSheetCard.) |
| `VehicleGallery` | Product pattern | `@/components/ui` | Asymmetric hero + supporting plates for a build's photos. | Car sheets. |

### Features (10)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `CardEngagement` | Feature | `@/features/social/card-actions` | Like · comment · share · save strip on cards; optimistic with rollback; guest → AuthIntentDialog. — `.cardeng` | Via the mosaic card family's engagement slot. |
| `CheckoutSteps` | Feature | `@/app/(discover)/checkout/checkout-steps` | The checkout workflow (shipping → payment), shared by cart and order checkout. | Feature-owned; the Stepper and field primitives inside it are the reusable parts. |
| `FollowButton` | Feature | `@/features/social/buttons` | Follow toggle with configurable labels. | Profiles and car sheets. |
| `GarageSheetCard` | Feature | `@/app/(product)/garage/garage-sheet` | The Garage management sheet card (`.gsheet`) — dims, notes, latest update, orders. | Garage only. The public vehicle row is VehicleCard. |
| `ListingQuickCommerce` | Feature | `@/features/commerce/quick-commerce` | Card-level quick buy/offer actions. | Commerce mosaic walls. |
| `ProfileBody` | Feature | `@/components/profile/profile-body` | The public profile's tabbed body (vehicles, activity, listings, reviews). | Profile routes. |
| `SaveButton` | Feature | `@/features/social/buttons` | Full-size save toggle for detail pages. | PDP / car sheet headers. |
| `SellerKpis` | Feature | `@/app/(product)/home/seller-kpis` | Seller KPI deck on Home — data fetching + MetricCard composition. | Home only. |
| `SellForm` | Feature | `@/app/(product)/sell/sell-form` | The listing create/edit workflow (also used by Edit Listing). | Feature-owned; compose FormSection/ValidationSummary/fields from it, don't fork it. |
| `ThreadView` | Feature | `@/app/(product)/messages/[orderId]/thread-view` | The order-messages surface: day buckets, windowed history, pinned composer. | Feature-owned; its grammar is Message/MessageThread/MessageComposer. |

<!-- END GENERATED: component-registry -->

## 11 Further CSS families (globals.css)

Previously undocumented class families, one line each:

| Family | Purpose |
| --- | --- |
| `.buybar` | Sticky phone purchase bar fixed to the bottom edge while the real purchase controls are off-screen (desktop keeps the full rail). `.buybar--wide` carries it to 1024px for the cart, whose side column arrives at Tailwind's `lg` rather than the PDP's 981px |
| `.modrow` | The mods-editor line: a dense ledger row on desktop, recomposed under `sm` into a labelled record (`__head` / `__n` / `__lab` / `__foot`) via `display: contents`, so one set of controls serves both |
| `.saverow` | An editing surface's commit row — optional `__aux` action, `__status`, then the button; stacks and goes full-width under 520px |
| `.ordersum` | Checkout's phone-only compact order summary: a native `<details>` stating the total, standing in for the desktop aside |
| `.sectionnav` | Settings' section register — sideways-scrolling with gutter bleed on a phone, the sticky vertical rail from `md` up |
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

## 12 Taxonomy — which component do I use?

Layers: **CSS recipes** (globals.css) define the visual foundations ·
**primitives** (`@/components/ui`) are the generic React contracts ·
**product patterns** (`@/components/ui` cards + `@/components/commerce`) represent
DRVN objects · **features** (routes, `src/features`) own business logic and
compose the rest. Registry: `src/components/registry.ts`.

### Cards (browsing an object)

One family, built on `MosaicCell` (`.mcell`):

- **`ListingCard`** — a listing anywhere it is browsed (Marketplace, Home recs, PDP rails, Saved grid). Delegates to `ListingMosaicCell`.
- **`MasonryFeed` → `FeedMosaicCell`** — mixed feed items (part / build / update) on Explore-style walls.
- **`VehicleCard`** — a vehicle as a dashboard row (Home). The Garage management card is the feature-level `GarageSheetCard` (`.gsheet`) — deliberately not shared.
- The old `FeedCard` tile deck is **gone** (no call sites); the landing page's `.mkt` tiles are an intentional marketing-surface exception.

### Rows (dense collections)

- **`ObjectRow`** (primitive, `.order`/`.rowlist`) — any object in a dense list: saved items, cart/checkout lines, inbox rows, task rows, payment methods.
- **`ListingRow`** (`@/components/commerce`) — a seller's listing in a seller-scoped list (profile shopfront, car sheet parts).
- **`FeedList`** — feed items as rows on Home.
- **`.ledger`** — the seller register's sortable table; genuinely tabular, stays feature-local. `TimelineRow` for dated activity.

### Messages

- **`MessageThread` / `Message` / `ThreadDivider` / `MessageComposer`** carry the whole `.thread`/`.msg`/`.composer` grammar. Features decide semantics: `me` = current user in order/offer threads, = seller in listing Q&A. Day grouping, pagination, send actions, optimistic state stay feature-local (`ThreadView`, `OfferThread`, `QASection`, activity comments).
- **`ResultNote`** — the ok-chip/error outcome line beside any action form.

### Status & chips

- **`.chip` variants** (raw or `MetadataTags`) — generic labels; `ActiveFilterChip` for removable filters.
- **`StatusChip`** (`@/components/commerce`) — order/offer lifecycle states; `OrderPipeline` for the stage rail. Payout/admin state maps are deliberate feature-local variants (different state vocabularies).

### Forms

- **Primitives**: `TextField` / `TextArea` / `Select` / `Checkbox` / `Radio` / `CountedField` (+ `FormField` for custom controls) — never hand-write `.field`/`.ctl`.
- **Composition**: `FormSection` (numbered sections), `ValidationSummary` (submit-blocking error list), `ActionFooter` (commit row), `Stepper` (workflow rail), `DataRow` (settings `.bline` lines), `DropZone` + `uploadImages` (media in).
- **Workflows stay features**: `SellForm`, `CheckoutSteps`, garage editors — compose primitives inside them, never generalize the workflow itself.

## 13 Contributing a component (and how drift is blocked)

Adding UI? The workflow is: **look it up** (registry / §12) → **compose** from
`@/components/ui` + `@/components/commerce` → only if nothing covers it, build
the new piece from existing primitives and recipes, export it from the barrel,
add a `registry.ts` entry, run `npm run docs:components`, and add a specimen to
`/docs/components` if it is visual.

Four vitest gates enforce this (`npm test`):

1. **Registry sync** — every public export has a registry entry and every entry
   resolves (`src/components/registry.test.ts`).
2. **Docs sync** — the §10 table above is generated from the registry and fails
   when stale (`src/lib/docs/registry-docs.test.ts`).
3. **Route boundaries** — routes may not import other routes' components;
   shared pieces move to `src/components` (`src/components/architecture.test.ts`).
4. **Recipe ratchet** — raw usage of component-backed recipe classes
   (`.btn`, `.field__label`, `.pagehead`, `.undrawn`, `.msg`…) in feature code
   is counted against `src/components/recipe-baseline.json` and may only
   decrease (`src/components/recipe-ratchet.test.ts`). After migrating old
   markup, lock in the lower counts with
   `UPDATE_RECIPE_BASELINE=1 npx vitest run src/components/recipe-ratchet.test.ts`.
