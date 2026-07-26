# Livesheet — Component & Page Inventory (Phase 1 contract)

Derived 2026-07-26 from `design-mockups/livesheet/` — shipped CSS (`livesheet.css`)
treated as source of truth, cross-checked against `design.md` (frontmatter matches CSS)
and `design.html`. Full-page captures of all 26 pages × day/night × desktop/mobile in
scratchpad `shots-livesheet/`.

## Token layer (→ Tailwind v4 `@theme` + `:root` alpha tokens)

Scale tokens via `@theme` (become utilities): paper, paper-deep, tile, tile-2, ink, dim
(**darken DAY dim to `#6B6E78`** per design.md accessibility note), live `#F03A20`
(night `#FF4530`), ok, on-ink, img-fallback; fonts IBM Plex Sans/Mono; radii 16/10/6/3;
`--ease-spring: cubic-bezier(0.32,0.72,0,1)`; durations 160/380/650ms.

Alpha + state tokens stay plain custom properties on `:root` and are remapped under
`[data-theme="dark"]`: dimline, grid-line, live-tint, ok-tint, scrim, ink-hover,
live-hover, ghost-hover, rule-soft, rule-mid, photo-filter, ghost, ghost-strong.
Night is a token remap only — the sole dark-specific rules are the img/video
`--photo-filter` and the theme-pip fill. Theme = cookie (`ls-theme`), set on `<html
data-theme>` server-side; `prefers-color-scheme` only as initial default.

Body: 16px Plex Sans on `--paper` with 40px graticule (two repeating-linear-gradients of
`--grid-line`). `::selection` live/on-ink. `:focus-visible` 2px live outline offset 3.

## Component inventory (class → shape → notes)

| Component | Markup shape | Key rules |
|---|---|---|
| `.bar` | sticky top; `.bar__inner` (maxw 1200, flex) > `.bar__logo` (DRVN + live dot em + microlabel) + `nav.bar__nav` > `.bar__link` (mono 12.5 uppercase; `.is-active` ink bg; `.dot` pulsing live) + `.bar__theme` toggle (sw pip) | 86% paper + blur(14px); ≤640px nav becomes one scrollable row |
| `.pagehead` | microlabel line → `h1` (clamp 28–44, one `.live-word` with draw-in underline) → `.sub` | live-word once per page, h1 only |
| `.deck` | grid gap 14, pb clamp(48,7vw,80); `--kpi` 4col / `--two` 1.35fr 1fr / `--three` 3col | children min-width:0; never nest decks |
| `.tile` | plate: tile bg, r16, p18; `.tile--deep`, `.tile--hover`/`a.tile` lift; `.tile__head`, `.tile__img` (r10, img-fallback) | no borders/shadows; never tile-in-tile |
| `.livedim` | pl18 + 1px spine ::before + 7px ticks; `.microlabel` + `.val` (mono 13 tabular) | `--live` (red val + pulsing dot), `--blank` (dashed spine) — THE signature |
| `.dimline-h` | 1px rule, end ticks, scaleX draw-in on `.is-in` | 650ms spring, 120ms delay |
| `.num-giant` | sans 650, clamp 40–64, tabular | KPI numeral above a livedim |
| `.microlabel` | mono 11.5 up 0.14em dim; `--ink`, `--live` | connective tissue; 2–6 words |
| `.btn` | mono 12 up, 13×20 pad, r10, ink bg; `[ ]` brackets via pseudos; press scale(.97) | `--live` (one per surface), `--ghost`; no spinner variant — replaced by chip--ok |
| `.chip` | mono 11 up, 4×10, r6, paper-deep/dim | `--live`, `--ok`, `--ink`, `--spent`; status never nav |
| `.capsule` | ink band r10 10×16 mono; `.dot` pulse + `.cd` countdown | `--paper` (+1px baseline shadow-rule), `--quiet` |
| `.order` | flex row: `.order__img` 56×44 + name/meta + `.order__actions` (Accept live / Counter / Pass ghost) | `.is-done` ok-tint, `.is-gone` slide-out 420ms; in `.rowlist` de-boxes to ruled row |
| `.rowlist` | strips row bg/radius; rows get 1px rule-soft top | ruled-row principle for every list in a tile |
| `.bline` | grid 190px/1fr/auto baseline; label/val/note/chip | `--ctl` (control in value col), `--own` (+ `.relbtn` col 4); ≤720 stacks |
| `.spec` | 2-col table, mono label left / mono value right, ruled | spec tables |
| `.feed` | `li` time (mono 74px) + text + `.amt` right (`--live`) | ruled |
| `.week` | 7-col; `.week__day` paper-deep r10; `--hot` live bg + tag | calendar strip |
| `.pipe` | 9px pips + 14px dimline connectors + mono lbl | `.is-on` live; show empty pipeline at reduced opacity |
| `.mkt` | 3-col grid of `a.tile`: `.tile__img` 3/2 + `__name` + `__price` + `__meta` chips | market card |
| `.search` | label.tile r10 12×18 mono + borderless input | |
| `.filters`/`.fbtn` | mono 11 pills r10 paper-deep; `.is-on` ink; `[aria-pressed=true]` live (fit switch) | |
| `.jumprow`/`.jumplink` | "ON THIS SHEET" microlabel + underlined mono ref-links | THE tab replacement — no pill tabs/segmented controls |
| `.callout` + `.callout__leader` | absolute mono tag on hero + JS-drawn 1px live leader to `data-anchor="x,y"` % point | ≤720px: static chip row under image, leaders hidden |
| `.hero-media` | r16 media frame 16/8.5 | 980px → 4/3 |
| `.sheetwrap`/`.sheet` | fixed scrim + bottom sheet min(480px); 2-step (`data-step1/2`); `.stamp` rotated live frame | buy sheet, release sheet |
| `.field`/`.ctl` | grid gap7: microlabel + ctl (mono, paper-deep, r10) + hint/err/ok | fix `.ctl` to `border:1px solid transparent` so invalid/ok border paints; `.field--row` 2-col |
| `.ctl__prefix`, `input.sq` | framed prefix input; 16px square checkbox accent live | |
| `.drop`/`.thumbs`/`.thumb` | dashed r16 dropzone (live tint on hover/over); thumb grid 84px, `__x`, `__tag`, `--ghost` | |
| `.steps`/`.step` | counter 01/02… grid 34/1fr/auto ruled | `.is-now` live number, `.is-done` dim |
| `.alert` | r10 tinted ground + icon color; grid auto/1fr | `--live`, `--ok`; never a side bar stroke |
| `.msg`/`.thread`/`.composer` | 2px left spine; `--me` live spine, `--sys` dashed; mono who/meta; `.msg__attach` | annotations, not chat bubbles |
| `.mail` | 1px rule-mid frame (only framed component), bar/body/foot | depicts external artifact |
| `.toast` | fixed bottom ink pill r10 mono up; `window.lsToast()` / `[data-toast]`; role=status 2600ms | |
| `.undrawn` | dashed r16 ghost plate + `__mark` + h3 + p; `--hero` | empty = same geometry as real content |
| `.ghostrow`/`.gbar`/`.gbox` | grid 56/1fr/76 ruled skeleton bars r3 | `.is-loading` gradient sweep 1.5s; no spinners |
| `.guide` | 6px track r3 + ok-tint band + 2px live "you" marker + mono scale | price guidance |
| `.band` | ink-inverted stat plate r16 + 3-col num-giants | public home |
| `.monogram` | 64px (44 sm) ink plate r10 mono initials | |
| `.review` | ruled entry: head + mono live stars right + p | |
| `.savebar` | sticky bottom tile r16 + baseline shadow-rule; fixed full-width ≤720 | settings |
| `.prose`/`.toc` | 68ch legal prose + ruled toc links | |
| `.foot` | rule-mid top, mono microlabels both ends | every page |

## Motion & behaviour (JS → production hooks per design.md §3)

reveals `.rv`+`data-stagger` (IO 0.15, 70ms steps) → `useReveal`; `[data-count]` 900ms
ease-out → `useCountUp`; `[data-tick]` 4.2s random +1 with 900ms live flash →
`useLiveCount` (Supabase Realtime); `[data-seconds]` H:MM:SS countdown →
`useCountdown(expiresAt)` server-authoritative; order accept/counter/pass → server
actions + optimistic; buy-sheet 2-step; release-sheet prefilled modal; dispatch form
advances pipe; settings dirty-flag + save toast; theme select syncs with bar toggle;
market filter/search/fitswitch → URL params; leader-line drawing on load/resize.
`prefers-reduced-motion`: reveals/draws render settled, pulses/sweeps stop, count-ups
print final, ticks never start — countdowns keep running (information, not decoration).

## Page → app route map

| Mockup | App route | Notes |
|---|---|---|
| `home.html` (public landing) | `/` | band stats, hero callouts, steps 01–03, sheets/parts strips |
| `index.html` (Sheet 01) | `/home` | greeting head, KPI deck + livedims, work orders, garage tile, feed, week strip |
| `dashboard.html` (Sheet 02 workbench) | `/home` (seller ops section) + `/orders` seller | listings-by-heat rowlist, jobs in motion + pipe, payout ledger |
| `explore.html` | `/explore` | mixed car/part/fresh-entry tiles, filters |
| `market.html` | `/marketplace` (+ `[category]`) | search + fits-switch + drop capsule + fbtn row + mkt grid |
| `listing.html` | `/listings/[id]` | measured spec table, buy box (capsule + buy/offer), off-this-car, keeper livedims, Q&A |
| `car.html` (public sheet) | `/cars/[slug]` | hero callouts + leaders, jumprow, KPI tiles, for-sale rowlist, build blines by section, activity feed |
| `garage.html` (owner desk) | `/garage` | owner hero callouts, release-a-part flow, blines `--own` + relbtn, documents, second-sheet upsell |
| `add-car.html` | `/garage` add-car | steps, identify fields, photos drop, build seed entries, publish radios |
| `sell.html` | `/sell` | draft autosave head, photos→part→provenance→condition→price→review; live preview card + completeness rail |
| `orders.html` (job card) | `/orders` (seller job detail) | pipe + dispatch form + payout math + past jobs |
| `buyer-orders.html` | `/orders` (buyer side) | KPI, transit pipe + countdown, tracking spec, inspection alert, past purchases |
| `buyer-offers.html` | `/orders` offers section (or `/offers`) | live/countered/won/lapsed rowlists, negotiation thread |
| `watchlist.html` | `/saved` | watched part tiles + saved searches + followed sheets |
| `notifications.html` | `/notifications` | actionable rows, policy blines, mail previews, prefs pointer |
| `messages.html` | — (Phase 2) | thread list + msg spine thread + composer + safety alert |
| `profile.html` (keeper sheet) | `/u/[username]` + `/profile` | keeper record, grade blines, cars, live listings, reviews, activity |
| `settings.html` | `/settings` | config blines by section, signals matrix (sq checks), savebar, theme select |
| `auth.html` | `/login`, `/signup`, reset, verify | authwrap 420px, field states, OAuth ghosts, verify listening capsule |
| `first-run.html` | `/home` empty + `/onboarding` | blank-sheet hero (undrawn), KPI blanks ("—", $0), how-it-fills steps, ghost work orders |
| `empty-states.html` | all routes | 14 numbered rules: dashed plates, `—` values, factual $0.00, waiting copy, ghost loading, reconnect freeze, error tile, expired/sold desaturation |
| `edge-cases.html` | all routes | truncation (clamp2/trunc), free/zero money, 0-photo tiles, long counts, RTL-ish stress |
| `form-states.html` | all forms | rest/filled/disabled/required/hint-counter/inline-error-after-blur/summary/async-check/cross-field/server-reject/pending/fail/two-step-confirm/undo/unsaved/draft-restore/optimistic-rollback |
| `safety.html` | — (Phase 2) | report/dispute/refund/blocked/verification |
| `legal.html` | — (Phase 2 or static) | prose + toc + fees spec + cookies |
| `design.html` + `design.md` | `/design-system` + docs | living reference; update as the contract when new components appear |

## Do/Don't distillation for the port

Tone separation, ruled rows, one accent (live = happening now only), `—` for empty but
`$0.00` for money, spent desaturates not disappears, tabular-nums on tickers, jumprow not
tabs, no pills/shadows/gradients/glass/borders-as-edges/second-accent/spinners/fake data;
provenance never leads. Radius descends with size; circles only for live dots/pips/thumb-x.
