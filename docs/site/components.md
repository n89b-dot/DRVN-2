# Component catalog

The complete Livesheet component inventory, categorized. Class names are the
production CSS in `src/app/styles/` (imported in order by `globals.css`); React contracts live in
`src/components/ui/` (primitives + card patterns) and `src/components/commerce/`
(domain patterns), indexed by the machine-readable registry
`src/components/registry.ts`. The live rendered version of this catalog is at
`/docs/components`; §12 is the "which component do I use?" taxonomy.

Format: **class — shape — key rules.**

## 01 Chrome & navigation

| Component | Shape | Key rules |
| --- | --- | --- |
| `.bar` | Sticky top bar; `.bar__inner` aligned to the content column > `.bar__logo` + `nav.bar__nav` of `.bar__link` + `.bar__search` (560px) + icon links with `.barbadge` counts | 86% paper + blur(14px) — declare `-webkit-backdrop-filter` BEFORE `backdrop-filter` (the build keeps only the last of the pair, and Chrome ignores the prefixed one); the bar is identical on every page, search included — Explore and Marketplace add their own scoped search below it |
| `.indexbtn` + `.indexwrap`/`.indexsheet`/`.indexrow` | "Index" trigger opening a full-page sheet: search, Post, then one row per destination | A menu, not a document: 48px single-line rows (icon + 17px label; `--child` 15px/44px), descriptions hidden; the current row chips "Here"; the whole menu fits in about 1.5 phone screens |
| `.rail` / `.railrow` | Signed-in desktop side rail with numbered rows | Same numbering language as the index |
| `.jumprow` / `.jumplink` | "ON THIS SHEET" microlabel + underlined mono ref-links | In-page references, not navigation between panels — panels switch with `SheetTabs` (`.tabstrip`); feed segments are `.fbtn` chips in a `FilterGroup` |
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
| `.num-giant` | Sans 600 clamp(40–64) tabular | KPI numeral above a livedim; `--blank` for `—` |
| `.kv` | Sans 16 tabular key-value inline | Figures and names at reading size (mono 16px read like code); `b` inks the value |

## 04 Actions

| Component | Shape | Key rules |
| --- | --- | --- |
| `.btn` | Mono 12 uppercase, 13×20 pad, r10, ink bg | Press scale(.97). `--live` is THE action — one red fill per surface — and the only variant with the `[` `]` bracket pseudos. `--ghost` (`--ghost-fill`: recessed paper-deep by day, raised at night) and `--destructive` are Plex Sans 14/500 in sentence case, as written. No spinner — async buttons use `Button loading` + `pendingLabel` ("Saving…", aria-busy) |
| `.chip` | Mono 12 uppercase, 4×10, r6 | `--live`, `--ok`, `--warn`, `--ink`, `--spent`, `--danger`, `--info`, `--x` (removable filter chip); status, never navigation |
| `.capsule` | Ink band r10, 10×16, mono; `.dot` pulse + `.cd` countdown | `--paper` (+1px baseline shadow-rule), `--quiet` |
| `.relbtn` | Quiet row action — Sans 13/500, dim, dotted underline, no brackets | Row-level release/remove actions (`Button variant="quiet"`), sheet dismiss words |
| `.fbtn` / `.filters` | Mono 12 uppercase chips in a hairline outline (transparent ground), r10, 44px min height | `.is-on` ink (night: a tile plate with an accent edge); `.n` is a quiet tabular count after the label; `[aria-pressed=true]` live (fitment switch). Consumed via `FilterGroup` (axis grammar: `stack` primary / `sub` quieter / `scroll` gutter-rides ≤760px / `fit` — a short fixed set that shares one phone row, never scrolls) with `FilterLink` (aria-current) and `FilterButton` (aria-pressed) |
| `.search` | Tile-framed label + borderless input, Plex Sans 15 (16 on phones) | One focus ring, on the pill (`:focus-within`); no WebKit clear glyph. Consumed via `SearchField` (accessible name required), `SuggestingSearchField` and `Finder` (query row + refinement row, GET form — every search is an address) |
| `.saverow` | Commit row: aux left, status + commit right | Consumed via `ActionFooter`; ≤520px stacks aux / status / full-width 44px commit |
| `.buybar` | Fixed bottom action bar, safe-area padded | Consumed via `MobileActionBar`; body clearance reserved by the stylesheet; retires at 981px (plain) / 1024px (`--wide`, cart + checkout) |

## 05 Data display

| Component | Shape | Key rules |
| --- | --- | --- |
| `.bline` | Baseline grid 190px/1fr/auto: label / value / note / chip | `--ctl` puts a control in the value col; `--own` adds `.relbtn`; stacks ≤720px |
| `.spec` | 2-col ruled table, mono label left, mono value right | Spec tables (tracking, payout math) |
| `.rowlist` | Strips row bg/radius; rows get 1px rule-soft top | The ruled-row principle for every list in a tile |
| `.order` | Row: `.order__img` 56×44 + one text column (name over meta) + `.order__actions` | Text flex-basis 10rem so a 320px rail keeps the photo beside the title; phones use a 56px thumb column; `.is-done` ok-tint; `.is-gone` slides out 420ms |
| `.ledger` | Ruled data table for the seller's listings register | The one genuinely tabular surface. Below 860px each `tr.ledger__row` becomes a compact card (4-column grid: title + actions, car + status, then Views · Watch · Asking · Top offer side by side) |
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
| `.field` / `.ctl` | Grid gap 8: microlabel + control (Plex Sans 16, paper-deep, r10) + hint/err/ok/status | `.ctl` keeps `border: 1px solid transparent` so invalid/ok borders paint without layout shift; on a raised surface (tile, sheet, filter panel) it is outlined on `--tile-2` instead. `.field--row` is a 2-col grid (18px row / 16px column gap; 1 col ≤640px), its fields aligned to the top. Consumed via `FormField` / `TextField` / `TextArea` / `Select` — label, hint, error, success, live `status` and `aria-describedby`/`aria-invalid` wired automatically |
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
| `.msg` / `.thread` / `.composer` | 2px left spine; `--me` live spine, `--sys` dashed; mono who/meta | Public discussion only (listing Q&A, comments): annotations in the margin |
| `.convthread` / `.msgrun` / `.bubble` / `.tevent` | Runs of one side's messages under one meta line; `.bubble` r16 soft block — theirs tile + rule-soft, yours ink; consecutive blocks tighten the joined corner to r6; `.tevent` dashed r10 centred event | Person-to-person conversations (/messages). No tails, no pills, no gradients; events never look typed |
| `.chatbox` | Sticky bottom plate: auto-growing `.chatbox__input` (r10), 44px photo button, one Send (live when there is something to send) | Enter sends on fine pointers, Return adds a line on touch |
| `.convrow` / `.dealchip` / `.dealcard` / `.offercard` / `.msgsplit` | Person row (44px avatar, name, when, last line, deal chips); deal chip r6 (`--move` live tint = your turn, `--ok`); deal card with 48px photo; offer card (`--move` live border; `--block` full-width plate on the offer page); list beside conversation ≥981px | One row per person, never per deal |
| `.mail` | 1px rule-mid frame: bar/body/foot | The ONLY framed component — it depicts an external artifact |
| `.toast` | Fixed bottom ink plate, r10, mono uppercase | Renders `<output aria-live="polite">` (implicit status role), 3200ms default dwell |

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

### Primitives (90)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `ActionFooter` | Primitive | `@/components/ui` | The save row — aux slot, status chip/error, actions. — `.saverow` | Form commit rows. |
| `ActiveFilterChip` | Primitive | `@/components/ui` | Removable applied-filter chip. — `.chip--x` | Active filter rows. |
| `Alert` | Primitive | `@/components/ui` | Notice plate — icon column, bold head, body. — `.alert` | Inline notices; `live` when the reader must act, `ok` for confirmation. *Not for:* Action results inside forms — that's ResultNote. |
| `AppShell` | Primitive | `@/components/ui` | The signed-in application frame: bar, content column, foot. | Product route-group layouts. *Not for:* Docs and marketing surfaces, which own their chrome. |
| `Avatar` | Primitive | `@/components/ui` | Monogram identity plate (soft square, never a circle). — `.monogram` | People without photos; photo avatars go through Media. |
| `Badge` | Primitive | `@/components/ui` | The one badge system for cards: `variant="kind"` is a neutral outline (+ icon); `variant="state"` is a tint whose tone is colour only for real state (neutral for plain facts like Used / Grade B). — `.chip.chip--kind / .chip--state / .chip--ok / .chip--live / .chip--spent` | A card's condition or grade, a listing's sold/live state, anything that labels what a thing is or what state it is in. *Not for:* Order/offer lifecycle — StatusChip. Filters — FilterLink/ActiveFilterChip. |
| `BeforeAfter` | Primitive | `@/components/ui` | Two-image comparison plate: clip-path reveal on pointer drag/touch, keyboard slider divider, corner label tags. — `.ba` | Before/after photography — suspension drops, wheels, wraps, detailing. *Not for:* Plain image pairs with no comparison story (use Media in a grid). |
| `BottomNav` | Primitive | `@/components/ui` | The phone and tablet tab bar, fixed to the bottom edge below 1081px where the rail goes away. Stands down while the keyboard is up and wherever another bottom surface (buybar, savebar, chatbox) owns the edge; `hidden` takes it off focused screens. — `.bnav` | Via AppShell only, fed from BOTTOM_NAV / BOTTOM_NAV_PUBLIC in nav-routes.ts. *Not for:* Page-level actions (MobileActionBar) and in-page section switching (TabNav). |
| `BottomSheet` | Primitive | `@/components/ui` | Compact bottom sheet; keeps children mounted; dissolves inline ≥ its breakpoint. On phones it adds a quiet dismiss word (`closeLabel`, default Done) under the content; pass `closeLabel={null}` when the content already ends in its own Done/Cancel so the two never stack. — `.bsheet` | Compact-width pickers and refinements. |
| `Button` | Primitive | `@/components/ui` | The canonical action — `.btn` variants plus a defined loading state. `live` is THE action on a surface and the only variant that carries the brackets; `default` (ink) keeps the mono caps voice without them; `ghost` and `destructive` read as words (Plex Sans, sentence case as written). — `.btn / .relbtn` | Every button. One `live` action — one red fill — per surface; secondary actions are `ghost`. |
| `ButtonLink` | Primitive | `@/components/ui` | The action contract as a real link. — `.btn` | CTAs that navigate — keeps middle-click/new-tab semantics. |
| `ChatComposer` | Primitive | `@/components/ui` | Conversation reply box — auto-growing field, optional photo button, one Send, pinned to the viewport bottom. — `.chatbox` | Replying in a person-to-person conversation. The feature holds the draft, uploads and send action; slots above/below carry topic, pending photos and the result. *Not for:* Q&A and comment boxes — MessageComposer. |
| `Checkbox` | Primitive | `@/components/ui` | Live-accent square checkbox with its label as one touch target. — `.sq` | Boolean options. |
| `ComboField` | Primitive | `@/components/ui` | Searchable single-select (ARIA combobox) in the field contract: ranked options, keyword matching (aliases), optional footer escape hatch. — `.field / .ctl / .combo` | Choosing one option from a ranked list too long for Select — vehicle makes/models. *Not for:* Short fixed lists (Select) and free-text with suggestions (TextField + datalist). |
| `ConfirmDialog` | Primitive | `@/components/ui` | Destructive confirmation with optional type-to-confirm gate. | Deletes and irreversible actions. |
| `ConsentVideo` | Primitive | `@/components/ui` | YouTube video behind a play plate: nothing loads from YouTube until the visitor presses play. | Every embedded YouTube video (post bodies, the composer preview). Never render a YouTube iframe directly. |
| `Countdown` | Primitive | `@/components/livesheet` | H:MM:SS countdown from an absolute expiry; server-authoritative. | Offer/order expiry windows. |
| `CountedField` | Primitive | `@/components/ui` | Controlled input/textarea with a live character counter. — `.field__count` | Length-limited titles and bios. |
| `DataRow` | Primitive | `@/components/ui` | Ruled baseline row (`.bline`) — read-only value row or labelled control row, with an optional trailing action (`end`). — `.bline` | Settings-style label/value and label/control lines, and build-sheet lines whose trailing slot carries a state chip or a 'Sell it' action. *Not for:* Full form fields with hints/errors — that's the `.field` family. |
| `Dialog` | Primitive | `@/components/ui` | The sheet dialog — focus management, escape/backdrop dismissal, and a quiet Close in the panel's top-right corner (`.dialogbox__close`), never on the scrim below it. | Modal editing/confirmation surfaces. |
| `DropZone` | Primitive | `@/components/ui` | Click/drag file target with busy state and keyboard support. — `.drop` | Every upload entry point (pair with lib/media-upload's uploadImages). |
| `EmbeddedVideo` | Primitive | `@/components/ui` | External video as an ink plate with a play mark. | Video links in updates. |
| `EmptyState` | Primitive | `@/components/ui` | The undrawn plate — dashed mark badge, title, body, optional action. — `.undrawn` | Every empty collection or missing object. |
| `FilterButton` | Primitive | `@/components/ui` | Filter as a button. — `.fbtn` | Client-side filters. |
| `FilterGroup` | Primitive | `@/components/ui` | Labelled filter cluster. `scroll` rows scroll sideways on phones and drop the leading label below 640px; `fit` is for a short, fixed set of segments (Explore's five) that must all be visible on a phone — equal columns, icon over word, never a sideways scroll. — `.filters` | Filter bars. |
| `FilterLink` | Primitive | `@/components/ui` | GET filter as a link. — `.fbtn` | Stateless filters. |
| `Finder` | Primitive | `@/components/ui` | The search instrument: the SearchField owning its row, optional Clear, refinements beneath. — `.finder` | Any GET search with refinements (Saved, Messages). No Search button — Enter submits. |
| `FinderClear` | Primitive | `@/components/ui` | Finder's clear control. | Inside Finder. |
| `FinderLabel` | Primitive | `@/components/ui` | Finder's mono label. | Inside Finder. |
| `Foot` | Primitive | `@/components/ui` | The ruled page foot. — `.foot` | Bottom of full pages. |
| `FormField` | Primitive | `@/components/ui` | Labelled field wrapper — label, hint, error (role=alert), ok, and `status`: a stable polite live region for checks that run against the value ("Checking…", "✓ Available"); aria wiring for all of them. — `.field` | Custom controls the family doesn't cover (wire aria via fieldDescribedBy). |
| `FormSection` | Primitive | `@/components/ui` | Numbered form section tile — mono step numeral, heading, hint. | Long editing workflows (Sell, editors). |
| `Gallery` | Primitive | `@/components/ui` | PDP media gallery. — `.gallery` | Listing detail media. |
| `GalleryLightbox` | Primitive | `@/components/ui` | Full-screen lightbox with keyboard navigation. | Expanding gallery/vehicle media. |
| `HorizontalGallery` | Primitive | `@/components/ui` | Scrollbarless thumbnail strip — edge fades + hover paddles signal overflow. | Inline media rows in feeds/timelines. |
| `Icon` | Primitive | `@/components/ui` | The stroke icon set. | Any inline icon; never ad-hoc SVGs. |
| `KeyValueTable` | Primitive | `@/components/ui` | Ruled key/value spec table. — `.spec` | Spec sheets (wheels & tires, dimensions). |
| `KindBadge` | Primitive | `@/components/ui` | Badge variant="kind" for the feed's three kinds — Build, Update, For sale — with Explore's segment icons. — `.chip.chip--kind + .chip__ico` | Every card that says what it is: Explore/mosaic cells, Home feed cards and rows. *Not for:* Colouring a kind — kind is never a state. |
| `LinkedTitle` | Primitive | `@/components/ui` | Linked title with the drafting-office arrow. | Row/section titles that navigate. |
| `LiveDim` | Primitive | `@/components/livesheet` | The drafting leader line with a measured value; live and blank variants. — `.livedim` | Measured facts on tiles and sheets. |
| `LivesheetBar` | Primitive | `@/components/ui` | The top bar — wordmark, primary nav, global search (on every page — the bar is identical everywhere; Explore and Marketplace add their own scoped search below it), compact count badges, account. The cart icon and its count show to everyone (guests can fill a cart and buy); notifications and saved are members-only. Opaque-frosted (`.bar`, unprefixed backdrop-filter declared last). On phones the index menu is 48px single-line rows with search leading; visitors get Cart in it too. The index foot carries the theme switch and, for members, Log out (a form POST to /logout). — `.bar` | Via AppShell / group layouts only. |
| `Media` | Primitive | `@/components/ui` | Optimized image plate with role-based `sizes` presets and the undrawn no-photo fallback. | Every product image. Pick a `role` (hero/card/row/thumb/avatar…). *Not for:* Raw <img> tags anywhere. |
| `Message` | Primitive | `@/components/ui` | One annotation-style message — sender line, body, meta; `me` right-tones the rule. — `.msg` | Listing Q&A and comments, where a message is a public note with a sender line. Features decide what `me` means. *Not for:* Private conversations between two people — use MessageRun + MessageBubble. |
| `MessageBubble` | Primitive | `@/components/ui` | One message block inside a MessageRun — text, up to four photos, or both. — `.bubble / .bubble--photos` | Every message in a MessageRun. Photos are resolved URLs (signed, for private buckets); each opens full size. |
| `MessageComposer` | Primitive | `@/components/ui` | The one-line send row — hidden fields, `.ctl` input, submit; block variant for the Q&A ask box. — `.composer__row / .composer` | Q&A ask/reply rows and comment boxes. The owning feature supplies action + pending. *Not for:* Replying in a conversation — use ChatComposer (multi-line, photos, pinned). |
| `MessageRun` | Primitive | `@/components/ui` | Consecutive messages from one side of a conversation under a single meta line (who · time · about tag); `me` aligns right. — `.msgrun` | Person-to-person conversations (/messages, the offer page preview). The feature groups messages into runs. *Not for:* Public Q&A or comments — use Message. |
| `MessageThread` | Primitive | `@/components/ui` | Discussion container (`.thread`) — annotation-style rows. — `.thread` | Public discussion: listing Q&A, comments, a short message preview on an order/offer page. *Not for:* A person-to-person conversation — that is MessageRun/MessageBubble/ThreadEvent inside `.convthread` (/messages). |
| `MetadataTags` | Primitive | `@/components/ui` | Wrapping row of plain chips. — `.chip` | Tag lists. |
| `MetricCard` | Primitive | `@/components/ui` | KPI tile — microlabel, giant numeral, measured LiveDim line, floor-pinned footer link. With nothing to count pass the real zero ("0", "$0") and `blank`: a dim figure reads as a settled answer, where a dash read as loading. — `.tile + .num-giant` | KPI decks (`.deck--kpi`); calculations stay with the feature. |
| `MobileActionBar` | Primitive | `@/components/ui` | Pinned bottom action bar (buybar) for compact widths. — `.buybar` | Primary commerce actions on PDP-like pages. One bottom surface per route. |
| `MotionPolicy` | Primitive | `@/components/ui` | App-level Motion for React policy provider (`MotionConfig reducedMotion="user"`). Semantic tokens/springs/recipes live in `src/lib/motion`. | Mounted once in the root layout. Never nest a second one. *Not for:* Per-feature MotionConfig overrides — the global policy is the contract. |
| `NarrowColumn` | Primitive | `@/components/ui` | Constrained page column (narrow 720 / medium / wide). — `.wrap--*` | Reading and list surfaces that shouldn't span the full 1200px wrap. |
| `ObjectRow` | Primitive | `@/components/ui` | The `.order` dense row — leading media plate, then one text column (name over dim meta), trailing actions — inside `.rowlist`. With `meta` set, title and meta stack as a single column at every width; never nest meta spans inside `title` (they inherit its weight). — `.order / .rowlist` | Any object in a dense collection (saved items, cart lines, inbox rows, task rows). *Not for:* Marketplace browsing — that's the mosaic card family. Sortable tables — that's `.ledger`. |
| `PageHead` | Primitive | `@/components/ui` | Page header: mono eyebrow, display h1, dim sub line, revealed on entry. — `.pagehead` | The head of every page instead of hand-assembling `.pagehead` markup. |
| `Pagination` | Primitive | `@/components/ui` | Ghost prev/next with mono page marker; renders nothing on a lone first page. | Every paginated list. (Admin's jumplink Pager is a deliberate console variant.) |
| `PasswordField` | Primitive | `@/components/ui` | TextField's password sibling with a labelled reveal/conceal eye toggle; type flips client-side only. — `.field / .ctl` | Every password input — never a bare TextField type=password. |
| `Radio` | Primitive | `@/components/ui` | Radio in the square-mark language. — `.sq` | Exclusive options. |
| `RatingStars` | Primitive | `@/components/ui` | Read-only five-star display with sr-only value. — `.review__stars` | Displaying a rating. (The interactive picker is the review form's `.star-pick`.) |
| `ResultNote` | Primitive | `@/components/ui` | Action outcome line — ok chip or error text, role=alert. Motion-driven enter/exit presence. | useActionState results next to a form. |
| `Rv` | Primitive | `@/components/livesheet` | Livesheet spring reveal, staggered per index, reduced-motion safe. Motion for React drives the animation (shared `reveal` recipe from `src/lib/motion`). | Entry reveal on page heads, tiles, cards. Pass `immediate` around a page's leading media (hero, first feed card) so it renders settled — a hidden hero delays the largest paint. |
| `ScrollActiveIntoView` **[internal]** | Primitive | `@/components/ui` | Scrolls the active nav item into view on mount. | Inside scrolling nav strips. |
| `SearchField` | Primitive | `@/components/ui` | The one search field: icon + native search input on a raised tile. — `.search` | Every search input on the platform — never hand-roll `.search` markup. Enter submits. |
| `SectionHeading` | Primitive | `@/components/ui` | Mono microlabel section heading. — `.microlabel` | Section labels inside sheets/profiles. |
| `SectionLabel` | Primitive | `@/components/ui` | Ink microlabel paragraph. — `.microlabel--ink` | Ink-toned section labels. |
| `Select` | Primitive | `@/components/ui` | Native select in the field contract (platform picker on compact). — `.ctl` | Enumerated choices. |
| `ShareButton` | Primitive | `@/components/ui` | Labelled share control: the system share sheet where one exists, the clipboard elsewhere, with a "Link copied" confirmation. | Sharing a whole page where there is room for a word — a profile header (P-2), a build page. *Not for:* The icon in a feed card's engagement strip — CardEngagement owns that. |
| `SheetTabs` | Primitive | `@/components/ui` | URL-backed sheet tabs over the `.tabstrip` recipe: Sans labels on a ruled baseline, the current tab underlined in the accent; five tabs with counts fit a 358px phone column. Optional `onChange(key)` for callers that react to the switch (e.g. hiding a rail). | Profile/car sheet sections. |
| `SidePanel` | Primitive | `@/components/ui` | A non-modal right-hand panel beside the page on desktop: the sheet plate on its side, no scrim and no focus trap, so the page stays usable. One open at a time by key (SidePanelProvider in AppShell, remembered in the `ls-panel` cookie); Esc closes it from inside and focus returns to the opener. Children mount on first open and stay mounted. — `.sidepanel` | A companion you use alongside the page: the agent (AppShell `aside`, opened by the rail's Agent row or useSidePanel().open). *Not for:* Anything that must be answered before going on (Dialog, ConfirmDialog) and compact screens (BottomSheet, or the full page; check useSidePanel().available). |
| `SidePanelProvider` | Primitive | `@/components/ui` | Holds which SidePanel is open (by key), what its opener passed, and which panels are on the page. AppShell renders it; useSidePanel() reads it (open, close, toggle, available). | Already in AppShell; render it yourself only around a shell-less surface that has a SidePanel. *Not for:* Page state of any other kind. |
| `SkeletonCardGrid` | Primitive | `@/components/ui` | Card-grid placeholder matching the marketplace 3→2→1 grid. | loading.tsx for card-grid routes. |
| `SkeletonLedger` | Primitive | `@/components/ui` | Console placeholder — pagehead + ledger ghost rows, no wrap. | Admin console loading. |
| `SkeletonMasonry` | Primitive | `@/components/ui` | Masonry placeholder with varied plate heights. | loading.tsx for feed walls (Explore). |
| `SkeletonPage` | Primitive | `@/components/ui` | Generic page placeholder — pagehead + rows. | loading.tsx when no closer geometry exists; pass a label naming the surface. |
| `SkeletonPdp` | Primitive | `@/components/ui` | Two-column PDP placeholder (media + purchase rail). | loading.tsx for listing detail. |
| `SkeletonRows` | Primitive | `@/components/ui` | N ghost ledger rows. — `.ghostrow` | Inside larger skeletons / list regions. |
| `SortableGrid` | Primitive | `@/components/ui` | Drag-and-drop ordering for photo strips/tile grids (dnd-kit: pointer, touch, keyboard sensors). — `.sortable--lifted` | Wrap reorderable thumbs; pair with SortableItem per cell. Keep explicit ↑/↓ controls alongside. *Not for:* Single-item or fixed-order sets. |
| `SortableItem` | Primitive | `@/components/ui` | One draggable cell inside a SortableGrid. | Only inside SortableGrid. |
| `Stepper` | Primitive | `@/components/ui` | Auto-numbered workflow progress rail; live numeral on the current step. — `.steps` | Multi-step workflows (checkout). Workflow state stays with the feature. |
| `SuggestingSearchField` | Primitive | `@/components/ui` | The `.search` plate with grouped autocomplete (ARIA combobox over a `.combo` popover): builds, then parts, then people, then updates — two per group on phones — and a pinned “Search for …” row. Progressive enhancement on a GET search form: debounced fetch from a suggest endpoint, stale requests aborted, Enter without a selection submits. One focus ring, on the pill. — `.search / .combo` | A search field whose short queries should surface direct destinations — Explore's cross-family search. *Not for:* Plain filter search where results are the page anyway (SearchField), and picking one option from a bounded list (ComboField). |
| `TabNav` | Primitive | `@/components/ui` | The system's tab replacement — a quiet jumprow of mono links. — `.jumprow` | On-page section switching. |
| `TextArea` | Primitive | `@/components/ui` | Textarea in the field contract. — `.ctl` | Multi-line input. |
| `TextField` | Primitive | `@/components/ui` | Text input in the field contract; mono prefix support ($, PN). — `.field / .ctl` | Every text input. |
| `ThreadDivider` | Primitive | `@/components/ui` | Centered mono divider (day buckets). | Grouped threads. |
| `ThreadEvent` | Primitive | `@/components/ui` | A lifecycle fact inside a conversation — centred, dashed, never styled like something a person typed. — `.tevent` | Offers made/countered/accepted, shipping, dispute and return notes (`messages.kind = 'event'`). *Not for:* Anything a person wrote — that's a MessageBubble. |
| `TileHead` | Primitive | `@/components/ui` | Tile rule line — ink microlabel left, optional chip/jumplink right. — `.tile__head` | The head of any `.tile` section. *Not for:* Heads with bespoke inner structure — keep those raw. |
| `TimelineRow` | Primitive | `@/components/ui` | Date-rail timeline row — mono date column beside content. | Activity/history feeds on profiles and sheets. |
| `Toast` | Primitive | `@/components/ui` | Bottom-center transient confirmation, portalled to <body>. — `.toast` | Post-action confirmations that need no reply. |
| `UnconfirmedOutcome` | Primitive | `@/components/ui` | A mutation whose Server Action response was lost — says what couldn't be confirmed and offers a reload to read the real state. | In place of a money or destructive action (label purchase, deletion, hand-off) once useRecoverableAction reports a lost response, so the action isn't offered again blindly. *Not for:* Ordinary validation or refusal errors — that's ResultNote. Safe-to-retry actions can keep their button and show the error. |
| `ValidationSummary` | Primitive | `@/components/ui` | Assertive submit-blocking error list with per-field jump links. | Above long forms on failed submit; fields keep their inline errors. |
| `WebsitePill` | Primitive | `@/components/ui` | Quiet mono external-link pill. | Profile websites. |

### Product patterns (27)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `AccountRowList` | Product pattern | `@/components/commerce` | People as compact identity rows — avatar, name, one line of who they are, optional trailing action. — `.rowlist / .order` | Anywhere a list of members is shown: Explore's account results, Explore's 'Builders to follow' breaker, Home's rail suggestions. *Not for:* A single member's header — that's ProfileHeader. |
| `AgentHeader` | Product pattern | `@/components/commerce` | The agent's header: "Agent" with a Beta label and one status line ("Handling offers on 3 listings · 2 need you"). Composes PageHead and Badge. — `.pagehead` | /agent, and the desktop side panel when chat arrives (A3c). *Not for:* Any other page head — use PageHead. |
| `AgentResultCard` | Product pattern | `@/components/commerce` | A result card in the agent's thread: an eyebrow (what it is), the object as an ObjectRow, and the real page it opens. Never holds a form. With `action` it's a confirm card: the exact change, then Confirm and Edit. — `.tile / .order` | Agent replies on /agent (and the desktop side panel): listings the agent looked up, and confirm cards such as 'Update my build'; negotiation and offer set-up cards as they arrive. *Not for:* Listing grids (ListingCard) and offers in a conversation (OfferCard). |
| `AuthIntentDialog` | Product pattern | `@/components/ui` | Signed-out interception — explains the action in its own words (`subject`: save, like, reply, react, offer…) and routes to sign in or join with the intent carried through. | Any engagement control a guest can press. |
| `CategoryIcon` | Product pattern | `@/components/ui` | Marketplace taxonomy category mark. | Category navigation and headers. |
| `ConditionSummary` | Product pattern | `@/components/commerce` | Structured part-condition grid (grade + checklist). | PDP and sell preview condition blocks. |
| `ConversationRow` | Product pattern | `@/components/commerce` | One person in the inbox — avatar, name, when, last line, unread dot, and the deals between you as DealChips. — `.convrow` | The /messages people list (one row per person, never per deal). *Not for:* Order or offer ledgers — ObjectRow / ListingRow. |
| `DealCard` | Product pattern | `@/components/commerce` | A deal in a conversation header — part photo, "Selling · Paid", title link, price, one action. — `.dealcard / .dealstrip` | The deal strip above a conversation (active deals first, up to three). |
| `DealChip` | Product pattern | `@/components/commerce` | A deal between two people in one line — side (Buying/Selling), part, where it stands. — `.dealchip` | Inbox rows. Tone `move` = it's your turn (red), `ok` = going well, `quiet` = nothing for you to do. *Not for:* A bare order/offer status — StatusChip. |
| `FeedList` | Product pattern | `@/components/ui/feed-list` | Home's feed over one description per item: `cards` (photo-first, Home's column) or `rows` (dense `.order`-based rows). — `.feedcards / .feedcard; .feedrow on .order` | Home feeds — `cards` for the main column, `rows` where a photo column would be too loud. Pass `eagerFirst` when the list leads the page so its first photo loads at high priority. Pass `engagement` ({ path, isLoggedIn }) to give each card the CardEngagement strip (like · comment · share · save). Photo-less legacy updates are left off `cards`. *Not for:* Browse surfaces — that's the mosaic family. |
| `FeedMosaicCell` | Product pattern | `@/components/ui` | A feed item (part / build / update) as a mosaic card, the Figma card set — one tile for all three. Update: title → excerpt (two lines on wider cells, one on phone cells), then owner byline → full vehicle label in the foot. Part (always 1×1): FOR SALE pill + time, title → price row (price alone, no ship line on the discovery wall; condition chip + grade beside it), then seller byline → source car in the foot, with ListingCartButton at the end of the strip. Build: name → vehicle, then owner byline → activity line in the foot. An update that leads with a before/after plate shows the pair as a static split; a nameless build leads with its vehicle label and drops the duplicate subline (vehicleSubline). | Explore and mixed feeds, via MasonryFeed. |
| `FinderRefineSheet` | Product pattern | `@/components/ui` | Finder filters in a sheet at every width; optional onDismiss discards drafts and labels the close action Cancel. `actions` renders one footer row inside the sheet (quiet Reset left, Apply right) — pass it instead of stacking full-width buttons, and the sheet adds no extra Cancel. | Finder filtering — a sliders-icon trigger ("Filters" label ≥640px, icon-only on compact) with a live count, opening the refinement sheet (bottom sheet on compact, centered dialog wider). |
| `ListingCard` | Product pattern | `@/components/ui` | Canonical listing card with two explicit contexts: feed (default, delegates to ListingMosaicCell) and shopping (cover-cropped 4:3 photo, two-line title, ink price, condition · place, seller, 'Off my {car}', icon Save + outlined cart). Fitment shows only when there is evidence; at phone-width cells the delivery line and the seller's blurb drop out. | Anywhere a listing is browsed: marketplace, home recs, PDP rails, saved grid. *Not for:* Seller-scoped dense lists — that's ListingRow. |
| `ListingMosaicCell` | Product pattern | `@/components/ui` | A listing as a mosaic card: title → price + ship line → condition chip · fit · location → provenance → seller byline (name · rating). | Via ListingCard. |
| `ListingRow` | Product pattern | `@/components/commerce` | A seller's listing as a dense ledger row — cover, title, price, and a state chip only when not live (Sold, Reserved, Paused). — `.order` | Seller-scoped lists (profile shopfront, car sheet parts). *Not for:* Marketplace browsing — that's ListingCard. |
| `MasonryFeed` | Product pattern | `@/components/ui` | The Explore wall — FeedMosaicCells in a dense Mosaic, with its empty state. | Mixed-kind feed walls. |
| `Mosaic` | Product pattern | `@/components/ui` | The card wall grid (`.mosaic`), commerce variant included. 1×1 cards, plus 2×1 wides on the two-column phone wall for builds and updates only — a listing is always square (part photos are often portrait; the wide shape letterboxes them); there is no 2×2 shape (it filled a phone viewport with one card). — `.mosaic` | Container for MosaicCell families on browse surfaces. |
| `MosaicCell` | Product pattern | `@/components/ui` | The single card primitive — kind badge (`KindBadge`) + time, a photo plate, then a caption head (title, lede, value, price row) and a foot anchored to the caption's floor (byline with a real avatar when `byline.avatarUrl` is set, then the car or the activity line); engagement strip pinned below. On uniform walls every plate is one 4:3 frame and cells size to content (rows stretch to align); `chip` renders a state `Badge`. The price never truncates — the detail wraps under it. — `.mcell` | Underlying anatomy for every card; compose, don't fork. `compareSrc` draws a before/after pair as a static split plate (no slider) for comparison updates. Head order: title → `lede` (an update's two-line excerpt) → `value` (a build's vehicle under its name, mono ink) → `price` (ink, Sans 600, tabular — never green) with `detail` (condition chip + grade) beside it when `detailBesidePrice` is set, else under it. Foot: `byline` (monogram + name, ink) → `sub` (the car: a part's source car, an update's vehicle) → `meta` (a build's activity line). Two spacing steps: tight binds a line to the one above, group opens a new one (4/6px on phone cells, 6/16px from a 232px content box; the phone wall's 2×1 wide cell keeps the phone scale). |
| `OfferCard` | Product pattern | `@/components/commerce` | A live offer as a card — eyebrow, amount, note, and a slot for the decision buttons. — `.offercard` | Visual shell for OfferDecision, in a conversation and on the offer page. |
| `OfferRound` | Product pattern | `@/components/commerce` | One move in an offer's history: who acted (You, Your agent, Buyer, Buyer's agent), the amount and time, a muted "· via agent" on agent turns, and the viewer's own agent's reason. Stacked on phones, a row from 640px. — `.oround / .viaagent` | Inside a .rowlist on the offer page's History tile, fed by offerHistoryFromRounds. *Not for:* Live decisions (OfferCard) and conversation events (ThreadEvent). |
| `OrderPipeline` | Product pattern | `@/components/commerce` | The order lifecycle as a `.pipe` stage rail, terminal states included. — `.pipe` | Order rows and order detail. |
| `PaymentModeNotice` | Product pattern | `@/components/ui` | Test-mode payments banner. | Payment surfaces while Stripe runs in test mode. |
| `ProfileHeader` | Product pattern | `@/components/ui` | Profile head — a full-width banner band (a car's cover, borrowed; a plain tile when there is none), the avatar plate overlapping its foot, then name, handle, tagline, location and website on paper, with a stats list (a zero steps back to dim) and an action cluster: Follow (compact) · Store · Share, per PRD P-2. — `.profhead / .profhead__banner / .profhead__body / .profhead__avatar / .profhead__stats` | The top of a member's profile — public (`/u/[username]`) and the owner's own (`/profile`). Pass `stats` as already-formatted label/value pairs and every action (Follow, Store, share, Edit) through `action`. *Not for:* Typesetting anything on the banner photo — the identity row sits below it so no photo can make a name unreadable. Not for car pages: the garage's focused car has its own cover recipe. |
| `SellingNav` | Product pattern | `@/components/ui` | The Selling family's own navigation where the rail isn't: on phones it scrolls with the page (never pinned under the bar); at desktop widths the rail lists the same five members and the plate stands down. | Marketplace-family pages. |
| `StatusChip` | Product pattern | `@/components/commerce` | Order/offer lifecycle state as a toned chip (ok / live / spent). — `.chip--ok/--live/--spent` | Orders, offers, and anywhere an order-family status appears. *Not for:* Non-lifecycle chips — use `.chip` variants directly. |
| `VehicleCard` | Product pattern | `@/components/ui` | A vehicle as a dashboard row — 3:2 media, identity (name; vehicle line only when it adds to the name), pulse stats, whole-row link. — `.vehicle--row` | Home garage tile; a listing's source car (pass `href` to carry the way back). (The Garage's management card is the feature-level GarageSheetCard.) |
| `VehicleGallery` | Product pattern | `@/components/ui` | Asymmetric hero + supporting plates for a build's photos. | Car sheets. |

### Features (16)

| Component | Layer | Import from | What it is | Use it for |
| --- | --- | --- | --- | --- |
| `ActivityBlocksView` | Feature | `@/features/activity/blocks-view` | The one renderer for DRVN's activity document model (V0–V2): text, images, embeds, divider, mod change, before/after, performance result, mileage. — `.modline / .perfcard / .milestone` | Anywhere a post body renders — feed it normalizeBlocks output. |
| `BuildStoryComposer` | Feature | `@/features/composer/composer` | The one build-update editor (Tiptap runtime, DRVN-owned document): immediate writing surface, optional starter chips, / and + insert menus, draggable automotive blocks, quiet autosave, explicit publish. — `.bsc / .cblock / .cgal` | Creating and editing build updates — pass the route's server actions as props. `parts` (+ `initialTagged` when editing) adds the quick box's "Tag a part" picker; `discardAction` adds "Discard draft" once a draft exists. *Not for:* Anything that isn't an activity post. Message threads use MessageComposer. |
| `CardEngagement` | Feature | `@/features/social/card-actions` | Like · comment · share · save strip on cards; optimistic with rollback; guest → AuthIntentDialog. On a post the like IS its 🔥 reaction: the count and lit state read 🔥 only, and the tap sets the state asked for (on/off), never a toggle. — `.cardeng` | Via the mosaic card family's engagement slot, and under each Home feed card (FeedList `engagement`). |
| `CheckoutSteps` | Feature | `@/app/(discover)/checkout/checkout-steps` | The checkout workflow (shipping → payment), shared by cart and order checkout. | Feature-owned; the Stepper and field primitives inside it are the reusable parts. |
| `ConversationComposer` | Feature | `@/features/commerce/conversation-composer` | ChatComposer wired to sendThreadMessage — About (deal) picker, private photo upload, idempotent retries. | Feature-owned; replying in /messages. |
| `FollowButton` | Feature | `@/features/social/buttons` | Follow toggle with configurable labels. | Profiles and car sheets. |
| `GarageSheetCard` | Feature | `@/app/(product)/garage/garage-sheet` | The Garage management sheet card (`.gsheet`) — dims, notes, latest update, orders. | Garage only. The public vehicle row is VehicleCard. |
| `ImportFlow` | Feature | `@/app/(product)/sell/import/import-flow` | The Existing Listing Importer flow (0047): URL/paste source input, honest state-driven progress, paste fallback on the same import, multi-item picker — hands off to SellForm for review. | Feature-owned at /sell/import; it composes Alert/Stepper/TextField/TextArea/Button — extend those, don't fork this. *Not for:* Any other prefill path — Garage → Sell goes through SellFormInitialValues directly. |
| `ListingCartButton` | Feature | `@/features/commerce/quick-commerce` | One 32px live cart square at the end of a listing card's engagement strip — adds to cart in place, links to the cart once it's in. — `.cartbtn` | The discovery wall's listing card, via CardEngagement's `trailing` slot. |
| `ListingQuickCommerce` | Feature | `@/features/commerce/quick-commerce` | Card-level quick buy/offer actions. | Commerce mosaic walls. |
| `OfferDecision` | Feature | `@/features/commerce/offer-decision` | Accept · Counter · Pass / Accept counter · Withdraw for a live offer, by side and status. A seller never sees Accept on their own counter. | The offer page and the conversation — the same decision wherever the offer is discussed. |
| `ProfileBody` | Feature | `@/components/profile/profile-body` | The public profile's tabbed body (vehicles, activity, listings, reviews). The Updates tab counts every published post (including posts about a part with no car) and pages with "Show more updates" (`?view=updates&updatesPage=`). | Profile routes. |
| `ReportButton` | Feature | `@/features/moderation/report-button` | A quiet "Report …" link that opens the report dialog (reason + detail) and files to the admin review queue. Subjects: listing, user, post, comment — the wording follows the subject ("Report this post", "Report" on a reply). Guests get the sign-in explanation instead. | Listing pages, profiles, post pages, each reply (engagement.tsx) and a conversation header. Never on the viewer's own content. |
| `SaveButton` | Feature | `@/features/social/buttons` | Save toggle. Full-size (label) on detail pages; `variant="icon"` is the bookmark-only form for card floors. | PDP / car sheet headers (full); marketplace and store cards (icon). |
| `SellForm` | Feature | `@/app/(product)/sell/sell-form` | The listing create/edit workflow (also used by Edit Listing). | Feature-owned; compose FormSection/ValidationSummary/fields from it, don't fork it. |
| `ThreadView` | Feature | `@/app/(product)/messages/[id]/thread-view` | One person's conversation: runs, events and day breaks in the reader's timezone, live offer decisions, the composer, live updates. | Feature-owned; its grammar is MessageRun/MessageBubble/ThreadEvent/ChatComposer. |

<!-- END GENERATED: component-registry -->

## 11 Further CSS families (src/app/styles)

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
| `.tabstrip` | Real panel-switching tabs (car sheet, profile, garage): Plex Sans 15 (14 on phones) on a ruled baseline, the current tab inked with a 2px accent underline; counts are quiet tabular `.n`. Five tabs with counts fit a phone; the strip goes one line with a sideways scroll at ≤760px only as the overflow fallback |
| `.star-pick` | Interactive star rating — a radiogroup of buttons, not a select |
| `.jobrow` | Seller job row inside `.rowlist` (orders register) |
| `.filterchips` | Active-filter readout between the finder and results (removable `.chip--x` chips) |
| `.barbadge` | Count badge on cart/notifications — a legitimately live number in the signal colour |
| `.authswap` | Mono link row swapping between login and signup on auth pages |
| `.spec-note` | Catalog-page furniture: dim Sans 13 footnote under spec tables (sentences are never mono) |
| `.toc` | Table-of-contents link column for legal/long-form pages |
| `.prose` | Legal / long-form prose styling |
| `.shell` | The register rail layout: signed-in desktop rail + content ("the drawing's left margin") |
| `.cat-ico` | 40px category icon plate, r10 |
| `.indexlight` | The lighting (theme) switch spelled out inside the index sheet — the bar's version is icon-only |
| `.railtoggle` | Collapse/expand control for the register rail |
| `.console-nav` / `.console-main` | Admin console layer: console nav (a `.filters` compound, hidden ≤640px for the index button) and the console content column with its calmer display/stat scale |
| `.dialogbox` / `.dialogbox__close` | `Dialog`'s panel wrapper and its quiet Close in the top-right corner (the first child of the sheet keeps 56px clear for it) |
| `.carfocus--photo` / `.featbuild--photo` | The garage hero and a profile's featured build when they have a photo: a dark fade under the caption only (`--photo-scrim`, `--on-photo`, `--on-photo-dim`) — never a cream paper wash over the car |
| `.pagehead--item` | An object page's title (the listing PDP): 24–32px, 40ch measure, so the gallery starts right under it |
| `.feedcards` / `.feedcard` | Home's photo-first feed column (`FeedList variant="cards"`): photo, kind, title, body, byline |
| `.marketplace-card__fit` / `__meta--ship` | Card lines that appear only with fitment evidence / drop out at phone-width cells |
| `.finder__actions` | `FinderRefineSheet`'s one footer row — quiet Reset left, Apply right |
| `.filters--fit` | `FilterGroup fit`: a short fixed segment set sharing one phone row, icon over word |
| `.profhead__stats .is-zero` | A zero profile stat steps back to dim at regular weight |
| `.notfound__actions` / `.notfound__search` | The 404's recovery row — search, then the two doors |
| `.landing-hero` / `.landing-close` | The landing hero capped at 56vh, and the closing "two ways in" block |
| `.storenote` | A seller's pinned store note above the store grid |

## 12 Taxonomy — which component do I use?

Layers: **CSS recipes** (`src/app/styles/`, imported in order by `globals.css`) define the visual foundations ·
**primitives** (`@/components/ui`) are the generic React contracts ·
**product patterns** (`@/components/ui` cards + `@/components/commerce`) represent
DRVN objects · **features** (routes, `src/features`) own business logic and
compose the rest. Registry: `src/components/registry.ts`.

### Cards (browsing an object)

One family, built on `MosaicCell` (`.mcell`):

- **`ListingCard`** — a listing anywhere it is browsed. `variant="shopping"` (Marketplace, the store): photo, title, price, condition · place, seller, 'Off my {car}', icon Save + cart. The default feed variant delegates to `ListingMosaicCell` (Home recs, PDP rails, Saved grid).
- **`MasonryFeed` → `FeedMosaicCell`** — mixed feed items (part / build / update) on Explore-style walls.
- **`VehicleCard`** — a vehicle as a dashboard row (Home). The Garage management card is the feature-level `GarageSheetCard` (`.gsheet`) — deliberately not shared.
- The old `FeedCard` tile deck is **gone** (no call sites); the landing page's `.mkt` tiles are an intentional marketing-surface exception.

### Rows (dense collections)

- **`ObjectRow`** (primitive, `.order`/`.rowlist`) — any object in a dense list: saved items, cart/checkout lines, task rows, payment methods. (The Messages inbox is `ConversationRow` — one row per person.)
- **`ListingRow`** (`@/components/commerce`) — a seller's listing in a seller-scoped list (profile shopfront, car sheet parts).
- **`FeedList`** — Home's feed: `variant="cards"` (photo-first, the main column) or `rows`.
- **`.ledger`** — the seller register's sortable table; genuinely tabular, stays feature-local. `TimelineRow` for dated activity.

### Messages

Two grammars, by audience:

- **A conversation between two people** (/messages — one conversation per person since 20260928): **`MessageRun`** (consecutive messages from one side, one meta line, optional *about* tag naming the part) → **`MessageBubble`** (text and/or up to four photos) · **`ThreadEvent`** (a lifecycle fact: offer made/countered, shipped, dispute note — `messages.kind = 'event'`) · **`ThreadDivider`** (day) · **`ChatComposer`** (reply). In the inbox, **`ConversationRow`** is one person, with the deals between you as **`DealChip`**s (`move` = your turn); the conversation header shows **`DealCard`**s; a live offer is an **`OfferCard`** (wired as the feature `OfferDecision`, shared with the offer page). Run grouping, timezones, uploads, send and live refresh stay feature-local (`ThreadView`, `ConversationComposer`, `src/features/commerce/conversation-timeline.ts`).
- **Public discussion** (listing Q&A, activity comments): **`MessageThread` / `Message` / `MessageComposer`** — the annotation idiom, a sender line over a ruled body. `me` = the seller in Q&A. Never use it for a private conversation, and never use bubbles for public Q&A.
- **`ResultNote`** — the ok-chip/error outcome line beside any action form.
- **`UnconfirmedOutcome`** — a lost Server Action response on money or destructive work (`useRecoverableAction` with a distinct failure message): replaces the action with "reload to check" so it is never offered again blindly. Safe-to-retry actions keep their button and show the error instead.

### Status & chips

- **`Badge` / `KindBadge`** — the one card badge system: *kind* (Build · Update · For sale) is a neutral outline with an icon; *state* (Used · Grade B · Sold · Reserved) is a tint, with colour only for a real state. Never paint a kind green.
- **`.chip` variants** (raw or `MetadataTags`) — generic labels; `ActiveFilterChip` for removable filters. `ListingRow` shows a chip only for a non-live state.
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

Five vitest gates enforce this (`npm test`):

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
5. **Stylesheet ratchet** — `globals.css` must import every file in
   `src/app/styles/` in filename order (import order IS the cascade), and a
   selector defined twice in the same context (same `@layer`/`@media`/
   `@container` chain) may not appear or grow: extend the first definition
   instead (`src/app/styles/styles-ratchet.test.ts`, baseline
   `styles-baseline.json`; lower it with `UPDATE_STYLES_BASELINE=1`).
