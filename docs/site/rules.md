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
- Jumprow ("ON THIS SHEET") instead of tabs.

**Don't**

- No pills. No shadows. No gradients. No glass.
- No borders as edges (the `.mail` frame is the sole exception — it depicts
  an external artifact; `dimline` is for dimension/leader lines only).
- One *signal* accent only (`live`). `ok`/`warn`/`info` are status tones,
  never navigation or CTAs.
- No spinners — ghost rows with the drawing sweep.
- No fake data, fake liveness or decorative pulsing.
- No tile-in-tile; never nest decks.
- Provenance never leads the marketing story; the product does.

## Accessibility

- Every text/ground pair clears WCAG AA 4.5:1 in **both** lightings; re-check
  contrast whenever a token moves.
- Touch targets ≥ 44px for primary controls (filter chips and bar icons were
  specifically fixed to meet this).
- `:focus-visible`: 2px live outline, offset 3px, border-radius 4px — never
  removed.
- `prefers-reduced-motion`: draws render settled, pulses stop, count-ups
  print final values; countdowns keep running (information, not decoration).
- Dialogs and sheets trap focus, close on Escape, and lock body scroll.
- Toasts render as `<output>`, which carries an implicit `status` role;
  icon-only controls carry `aria-label`;
  pressed states use `aria-pressed`.
- Inline validation appears after blur and is announced next to the control.

## Content rules

- Microlabels: 2–6 words, uppercase mono, regions not sentences.
- Copy is factual and quiet — annotations on a drawing. State what happened
  and what fills the space next; no exclamation marks, no apology.
- Money is exact and mono. Fees and payouts show their math (`.spec`).
- Dates and countdowns are server-authoritative; never fake a tick.

## Engineering conventions

- **Tokens only.** Never hardcode a hex/radius/duration that has a token.
  New values require a new token in `src/app/globals.css` *and* an update to
  the Livesheet contract (`design-mockups/livesheet/design.md`).
- NIGHT is a token remap — never write a dark-specific component rule beyond
  the photo filter.
- Theme is the `ls-theme` cookie stamped pre-paint by the root layout script;
  don't read cookies in layouts that could otherwise stay static.
- Reusable UI goes in `src/components/ui` and is exported from its
  `index.ts`; product pages and this microsite import the same source.
  (Current exceptions: `feed-list.tsx` and `skeleton.tsx` live in `ui/` but
  are not in the barrel — import them from their files directly.)
- Server actions re-verify auth/membership themselves; layouts are
  convenience gates only. Admin (and this microsite) 404 — never 403 — to
  non-members.
- Rules added inside `@layer components` get tree-shaken by the Tailwind
  build if unreferenced; declare app-global component classes unlayered in
  `globals.css` (see `.plate-undrawn`).
- If Turbopack dev serves stale CSS after a `globals.css` edit: `rm -rf
  .next` and restart.
- Keep the 540px/1200px layout primitives (`NarrowColumn`, `.wrap`) — no
  magic numbers per page.
- New components: add the class to `globals.css`, document it in
  `docs/site/components.md`, and render a specimen on `/docs/components`.
