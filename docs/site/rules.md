# Rules

The contract. When a change violates one of these, the change is wrong.

## Design rules

**Do**

- Separate surfaces by tone (paper / paper-deep / tile / tile-2), never by
  borders or shadows.
- Rule every list inside a tile (`.rowlist` — 1px rule-soft tops).
- Reserve `live` red for what is happening right now, plus at most one
  primary CTA per surface and one `.live-word` per page.
- `ok` for terminal good states; `warn` for held money and due work.
- Radius descends with size: 16 / 10 / 6 / 3. Circles only for live dots,
  pips and thumb-remove badges.
- `tabular-nums` on every number that ticks or aligns.
- Empty states keep the geometry of the content they replace (`.undrawn`).
- `—` for empty values; `$0.00` for empty money.
- Spent/expired desaturates, it never disappears.
- Panels switch with underline tabs (`SheetTabs`); in-page references use the
  jumprow ("ON THIS SHEET"). Every tab in a strip fits a phone column; the
  strip's sideways scroll (≤760px) is only a fallback for overflow.

**Don't**

- No pills. No shadows. No gradients. No glass — except where a thing
  genuinely floats or sits on a photo: soft `--scrim` shadows on popovers
  and dragged items, the frosted top bar, the dark caption fade and small
  chips on photos, and the round count badge (`.barbadge`). `box-shadow`
  is also how two *rings* are drawn without layout shift — the 1.5px live
  inset on `.btn--destructive` and the 2px ink focus ring on
  `.search:focus-within` — those are outlines, not shadows.
- No borders as edges. Exceptions: the `.mail` frame (it depicts an external
  artifact), the marketplace card's 1px `rule-mid` edge, and hairline
  outlines on controls and chips that sit on a raised surface. `dimline` is
  for dimension/leader lines only.
- One *signal* accent only (`live`), and one red fill per surface: the
  primary action, the only button with `[ ]` brackets. `ok`/`warn`/`info` are
  status tones, never navigation, CTAs or prices.
- No spinners — ghost rows with the drawing sweep.
- No fake data, fake liveness or decorative pulsing.
- No tile-in-tile; never nest decks.
- Provenance never leads the marketing story; the product does.

## Accessibility

- Every text/ground pair clears WCAG AA 4.5:1 in **both** lightings; re-check
  contrast whenever a token moves.
- Touch targets ≥ 40px (`--touch`) for primary controls — filter chips, card
  Save/cart squares, dialog Close and bar icons included.
- `:focus-visible`: 2px live outline, offset 3px, border-radius 4px — never
  removed. The one exception is the search pill (`.search`), which draws a
  2px ink ring on the whole pill (`:focus-within`) instead of a box inside it.
- `prefers-reduced-motion`: draws render settled, pulses stop, ticks never
  start; countdowns keep running (information, not decoration).
- Dialogs and sheets trap focus, close on Escape, and lock body scroll.
- Toasts render as `<output>`, which carries an implicit `status` role;
  icon-only controls carry `aria-label`;
  pressed states use `aria-pressed`.
- Inline validation appears after blur and is announced next to the control.

## Content rules

- Microlabels: 2–6 words, uppercase mono, regions not sentences. Mono is for
  labels and data at 12px and under; anything read or typed at reading size
  (inputs, names, figures, notes, sentences) is Plex Sans — see
  [typography](typography.md).
- Copy is factual and quiet — annotations on a drawing. State what happened
  and what fills the space next; no exclamation marks, no apology.
- Money is exact and tabular. Prices read in Plex Sans 600, ink; fee and
  payout math shows its working in `.spec` tables.
- Dates and countdowns are server-authoritative; never fake a tick.

## Engineering conventions

- **Tokens only.** Never hardcode a hex/radius/duration that has a token.
  New values require a new token in `src/app/styles/00-tokens-base.css` *and* an update to
  the Livesheet contract (`design-mockups/livesheet/design.md`).
- NIGHT is a token remap — never write a dark-specific component rule beyond
  the four that exist (photo filter, theme-pip fill, `select.ctl` chevron,
  selected category-row / filter-chip plate — see
  [design-system §3](design-system.md#3-theming-day-and-night)).
- Theme is the `ls-theme` cookie stamped pre-paint by the root layout script;
  don't read cookies in layouts that could otherwise stay static.
- Reusable UI goes in `src/components/ui` and is exported from its
  `index.ts`; product pages and this microsite import the same source.
  (Current exceptions: `feed-list.tsx`, `intent-link.tsx` and
  `streamed-shell-counts.tsx` live in `ui/` but are not in the barrel —
  import them from their files directly. `patterns.tsx` and `primitives.tsx`
  are re-exported name by name, so a new export there also needs a line in
  `index.ts`.)
- Server actions re-verify auth/membership themselves; layouts are
  convenience gates only. Admin (and this microsite) 404 — never 403 — to
  non-members.
- CSS lives in `src/app/styles/` by recipe family; `globals.css` only
  imports the files, and import order is the cascade. Add a rule to its
  family's file and extend a selector's first definition rather than
  redefining it (`styles-ratchet.test.ts` blocks new duplicates).
- Rules added inside `@layer components` get tree-shaken by the Tailwind
  build if unreferenced; declare app-global component classes in the
  unlayered files (`10-`–`12-`, see `.plate-undrawn`).
- Declare `-webkit-` prefixed properties BEFORE the unprefixed one: the build
  keeps only the last of a pair (the top bar's blur was silently lost this
  way).
- If Turbopack dev serves stale CSS after a stylesheet edit: `rm -rf
  .next/dev/cache` and restart.
- Keep the layout primitives — `.wrap` (1200px) and its width steps
  `.wrap--narrow` 720 / `.wrap--medium` 900 / `.wrap--wide` 1060, which
  `NarrowColumn width="narrow|medium|wide"` renders — no magic numbers per
  page.
- New components: look it up first (`src/components/registry.ts`,
  [components §12](components.md)); compose from `@/components/ui` and
  `@/components/commerce`. Only if nothing covers it: build it from existing
  primitives and recipes (new CSS as a named recipe in its family file under
  `src/app/styles/`), export it from the barrel, add a `registry.ts` entry,
  run `npm run docs:components` (components.md §10 is generated from the
  registry — never hand-edit it), and add a specimen to
  `src/app/(docs)/docs/components/page.tsx` if it is visual.
