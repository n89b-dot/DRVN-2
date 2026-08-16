# Livesheet Component System — implementation plan

Goal: promote Livesheet's CSS recipes into first-class React components with
semantic APIs, defined states, accessibility, and adaptive behavior — using
Material 3 as a *behavioral* reference only. Material determines what a
component does; Livesheet determines what it looks like; DRVN determines when
it is used.

## Inventory (from inspection, 2026-08-16)

**Already first-class and correct — retain untouched:** LivesheetBar, Register
Rail, Index, MarketplaceNav/family nav, SheetTabs (full tablist semantics,
roving tabindex, URL state), Dialog (trap/Esc/restore/scroll-lock),
ConfirmDialog, AuthIntentDialog, Toast, Skeleton family, CountedField,
DropZone, Media/Avatar/NarrowColumn, ListingCard, VehicleCard, FeedCard/
MasonryFeed, Gallery/GalleryLightbox, patterns.tsx.

**CSS recipes with no React contract (the gap):** `.btn` family, `.field`/
`.ctl`/`.sq`, `.fbtn`/`.filters[--stack|--sub|--scroll]`, `.search`/`.finder`,
`.saverow`, `.buybar--wide`, pagination nav idiom, `.chip--x` active filters.

**Duplicated page patterns:** finder markup (saved, messages), filter axes
(notifications ×2, explore, saved), `withParams` helper (×3), pagination nav
(×4), `initialsOf` (×2), saverow composition (mods-editor, settings ×2).

## Adaptive model (maps onto existing breakpoints — no renumbering)

- **Compact** ≤ 640px — phones. Full-width controls, stacked saverows,
  scrolling filter rails, buybar present, modrow record recomposition.
- **Medium** 641–1080px — tablets / narrow windows. Top bar (no rail),
  tabstrip/filters scroll ≤760, ledger linearizes ≤860, buybar--wide ≤1023.
- **Expanded** ≥ 1081px — rail exists, list-detail and supporting panes.

## Slices (each: implement → migrate representative usage → document → test)

1. **Actions** — `Button` (variant: default | live | ghost | destructive;
   size; loading; href), `ButtonLink`, `Pagination`. Emits `.btn` classes.
2. **Inputs** — `FormField` (label/hint/error/success + aria wiring),
   `TextField`, `TextArea`, `Select`, `Checkbox` (`.sq`). Emits `.field`/`.ctl`.
3. **Search** — `SearchField` (`.search`), `Finder` (`.finder` composition).
   Migrate Saved + Messages. Shared `withParams` → `src/lib/url-params.ts`.
4. **Selection** — `FilterChip`, `FilterGroup` (`.filters` axes, link- and
   button-mode), `ActiveFilterChip` (`.chip--x`). Migrate Notifications,
   Explore, Saved.
5. **Composition** — `ActionFooter` (`.saverow`), `MobileActionBar`
   (`.buybar--wide` + body clearance). Migrate mods-editor, settings, Cart.
6. **Overlays** — `BottomSheet` (compact filter/action surface on Dialog
   semantics, Livesheet visual), first legitimate consumer.
7. **Docs** — specimens per slice in `/docs/components` + `docs/site/
   components.md`; new docs page "Material 3 as a behavioral reference"
   (incl. adaptive model + concept→contract→implementation comparisons).
8. **Validation** — typecheck, lint, vitest, responsive/mobile e2e, build,
   holistic DAY/NIGHT visual review.

## Rules

- Components emit the existing class contracts — zero intended visual change.
- No @material/web, no Roboto, no pills, no Material styling.
- Docs advance with each slice, never afterward.
- Preserve all uncommitted work; surgical edits only.
