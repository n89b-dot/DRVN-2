# Build plan — September 2026 direction

> Delivers [`../DRVN-PRD-2026-09.md`](../DRVN-PRD-2026-09.md). The full version — reasoning, user-visible change, every file and database object, steps, checks and risks per workstream — is the "DRVN Build Plan" artifact: https://claude.ai/artifact/1tSqTJ2YTC5nTDGv1EApqY. This file is the repo-side summary so a session without the artifact still knows the shape of the work. File references were read on 2026-09-19; re-check before relying on line numbers.

## Ground rules

**Before starting:** the working tree had 114+ uncommitted files on 2026-09-19, many in routes this plan touches. Commit or shelve first. Read the relevant guide in `node_modules/next/dist/docs/` before writing route code (`AGENTS.md`).

**Components — reuse before create.** Look in `src/components/registry.ts` first. Extend an existing component (a prop, a variant) before making a new one. A new component is justified only when it is clearly better than composing what exists, and is reusable (2+ contexts or real interaction / a11y behaviour). CSS-only needs become a named recipe in `globals.css` (tokens only), not a wrapper component. One-off layout stays plain JSX in the route. Typeface stays IBM Plex Sans / Mono.

Decisions already made on that basis:

| Need | Decision |
|---|---|
| Main + aside layout (Home, Profile, Marketplace sidebar) | New **recipe** in the `.deck` family. No component |
| Rail tiles | Existing tile recipe + `TileHead` |
| Twitter-like Home feed | A single-column **variant of `Mosaic`** with the existing `FeedMosaicCell`. A new card only if that fails in the browser |
| Uniform Explore cards | A `uniform` option on `Mosaic` / `mosaicSize` |
| Explore breakers | One CSS rule + plain JSX; chips via `FilterLink`; people rows via `ObjectRow` |
| `AccountRowList` (Explore route) | **Promote** to shared components — Home needs it too and routes can't import each other |
| Mod row with thumbnail + link | **`ObjectRow`** (already has media, title, meta, actions). No `DataRow` change |
| Tagged part in a post | Existing commerce **`ListingRow`** + `ListingCartButton` |
| Part picker | Composition of `Dialog`/`BottomSheet` + `SearchField` + `ObjectRow as="label"`; feature-level, registered (2 contexts) |
| Quick post | Feature-level composition in `src/features/composer`; registered |
| Share button | **Extract** the existing inline share logic from `features/social/card-actions.tsx`; registered |
| Create menu | **Dropped.** A `Post` button opens the quick post; "List a part" stays in the rail |
| Desktop filter sidebar | New `inlineFrom` breakpoint on `BottomSheet` — one set of fields, two presentations |
| Garage switcher | `FilterGroup scroll` + `FilterLink` with `Media` children; route-local |
| Garage stat strip | Existing `LiveDim` |
| Cover scrim | New **recipe** |
| Profile header (banner, counts, several actions) | Extend `ProfileHeader` props |

**Every database change:** timestamped file in `supabase/migrations/`; apply with `node scripts/apply-migration.mjs <file>` (never `supabase db push`); record in `supabase/MIGRATIONS.md`; extend a guard in `supabase/tests/` and run `scripts/test-sql-guards.sh`; `npm run db:types` then `db:types:check`; hand-edit `src/lib/database.types.ts`. New `profiles` columns need explicit column grants (pattern: `0017_lock_payment_columns.sql:39–75`, `0047:168`).

**Every data-shape change:** `src/lib/account-export-contract.ts` (+ bump `ACCOUNT_EXPORT_CONTRACT_VERSION`); `account-deletion-worker.ts:77`; preview fixtures in `preview/adapters/data.ts.template` then `npm run preview:build`.

**Documentation is part of done.** For each workstream update whichever apply:

- `src/components/registry.ts` → `npm run docs:components` → `docs/site/components.md`; specimen in `src/app/(docs)/docs/components/page.tsx`.
- `src/lib/docs/implementation-registry.ts` → `npm run docs:implementation` → `docs/site/implementation.md`. `npm run docs:systems` for system docs.
- `docs/site/design-system.md` and `docs/site/brand.md` + the brand page swatches (dark tokens); `docs/site/patterns.md` (route map, layouts, flows); `docs/site/search.md` (brand in listing search; parts public on Explore); `docs/site/activity-schema.md` (listing block, optional title, required photo); `docs/site/listing-import.md` (brand extraction; part-link reuse); `docs/site/domain-states.md` (mod installed / removed); `docs/site/notifications.md` (WS14b). `docs/site/typography.md` does **not** change.
- `docs/site/index.md` and `docs/product-overview.md` (product framing — WS1); `docs/livesheet-inventory.md` route map; `README.md`; `e2e/README.md`; `CHANGELOG.md` entry per workstream.
- This plan and the PRD when a ruling changes.

**Done means:** `npm test`, `npm run typecheck`, `npm run lint`, relevant `e2e` specs, docs regenerated, and the change verified in the running app in both themes and at phone width.

## Order

| Milestone | Workstreams |
|---|---|
| M1 · Says what it is | WS1 Front door · WS7 Cooler dark |
| Design proof (alongside M2) | Marketplace/Store card two-across on a phone with worst-case content, and the Explore card family, in the docs component board. No production code |
| M2 · One product | WS2 Change a part + WS6 Parts by link (one migration, one `save_mod_items` rewrite) · WS3 Listings → followers · WS5 Main car · WS4 Bought → my car |
| M3 · The shop | WS9 Marketplace and card → WS10 Profile & Store |
| M4 · Daily use | WS8 Shell → WS11 Home → WS14a Quick post, photo rule, tag a part |
| M5 · Garage & Explore | WS12 Garage · WS13 Explore |
| M6 · Later | WS14b Posting without a car · WS15 Local · P-9 offer-floor default |

**Status, 2026-09-19.** All fifteen workstreams and P-9 are implemented,
against both the shared dev project and the isolated local test database.
Migrations `20260919170000`–`20260919200000`. Documentation regenerated
(`docs:components`, `docs:implementation`, `docs:systems`); the six
acceptance journeys below exist as `e2e/direction-journeys.spec.ts`.

Known gaps, stated rather than hidden:

- **M-3's sidebar is inline, not a left column.** The desktop filter panel
  renders inline from 1024px through `BottomSheet inlineFrom="lg"`, but the
  panel and the results live in different subtrees, so placing it as a
  genuine left column needs `page-content` restructured around a sidebar
  slot. Deferred deliberately rather than bodged with position rules.
- **The mods editor was never visually confirmed at phone width** this
  session. It was checked at desktop width only.
- **C-1's double-tap is proven by construction, not by a SQL guard with real
  order fixtures** — the unique `source_order_item_id` and the action's
  "already on this car" answer are both exercised by journey 6, which builds
  its order with the service role.

## Workstreams

**WS1 Front door** (F-1, F-2, N-1, E-5; no schema). `src/app/page.tsx:68–217` copy and order; lockup `components/ui/livesheet-bar.tsx:183–185`; metadata `src/app/layout.tsx:24–44` and add metadata to marketplace category routes; nav order `components/ui/nav-routes.ts:95–109`. Lift the signed-out parts gate — it came from retired PRD v3.1 §8.2: `lib/feed.ts:107–112` (`loggedInOnly`), `:470` (`kindsForTab`), `:565` (legacy fallback path), `lib/explore/search/query.ts:255–257`, `api/explore/suggest/route.ts`. Done = signed-out parts in Explore All, the Parts segment, search and suggestions together; a private source car is named but never linked. Tests: `nav-routes.test.ts`, `feed-tabs.test.ts`, `e2e/explore-search`, landing snapshots in `e2e/responsive.spec.ts-snapshots/`.

**WS2 Change a part** (A-1…A-3). Migration: `mod_items.status`, `removed_at`; re-create `save_mod_items` (`20260905224929_…:83–118` column lists) — the delete statement at `:75–81` is unchanged because the editor keeps sending removed rows with `status:"removed"`. Code: `garage/actions.ts:270–334`; `garage/[id]/edit/mods-editor.tsx:36–51, :229–353, :391–415`; `garage/[id]/update/new/page.tsx:71–81` (seed mod ids); `features/composer/node-views.tsx:287–298` (replaced); composer publish → mark removed; `cars/[slug]/page.tsx:119`, `car-tabs.tsx:19–26, :112–142`. Readers that must ignore removed mods: `cars/[slug]/opengraph-image.tsx:25`, `garage/garage-data.ts:57`, `lib/explore/search/indexing.ts:57`, car search text (`0057:85`, `20260905135050…:40`). Guard: `supabase/tests/mod_sheet_atomic_guard.sql`. Record contract: **Remove** keeps the id and marks removed; **Replace** (new editor action — none exists today, people type over rows) removes the old row and inserts a new id in the same position; **edit in place** is for typos (hint towards Replace when the row has a linked listing); **Delete** only on rows with no linked listing. Save the sheet, then navigate to sell; List it on a row with a linked listing (drafts link too, `…listing_creation_request.sql:239–241`) opens that listing. E2E: `mod-sheet-recovery`, `garage-sell-lifecycle`. Registry entry `remove-to-sell` (`implementation-registry.ts:419–436`).

**WS3 Listings → followers** (B-1). Migration: `create index listings_seller_status_created_idx on listings (seller_id, status, created_at desc)` — no composite exists today; also serves the Store tab and seller counts. Code: third query in `lib/feed.ts:640–708` `fetchFollowedFeed` (seller in followed profiles or `source_car_id` in followed cars); pure merge helper (dedupe by kind + id; newest first, id tie-break; per-seller cap of three), unit-tested including follow-both → one card and a shared-timestamp page boundary; remove TODO `:636–639`. Preview fixture `:13`.

**WS4 Bought → my car** (C-1). `mod_items.source_order_item_id` (unique where not null) in WS2's migration. Build the mod from `order_items.commercial_snapshot` (0049), never the live listing; per item; server checks buyer, car owner, order delivered/completed (`orders/[id]/page.tsx:235`); idempotent. The existing policy "owners manage mods" is `for all`, so the server action does a plain insert — no new database function. `orders/[id]/page.tsx` action + `Dialog` car picker; reverse map in `lib/mods/category-map.ts`; provenance line in mods editor and `car-tabs.tsx`.

**WS5 Main car** (P-5). Migration: `profiles.main_car_id` + grants + ownership guard. `src/lib/cars/order.ts` helper replacing four sorts: `lib/profile-data.ts:98`, `home/page.tsx:93–98`, `garage/garage-data.ts:44`, `sell/page.tsx:134–138`. `setMainCar` in `garage/actions.ts`. Banner fallback: main car's cover if public with a photo → another public car's cover → plain header. In the Marketplace the main car is **offered** as the first one-tap choice in `vehicle-control.tsx`, never auto-applied; explicit or URL vehicle wins; cleared stays cleared.

**WS6 Parts by link** (L-1…L-4). Columns in WS2's migration. Reuse `lib/listing-import/fetch/safe-fetch.ts`, `fetch/guard.ts`, `extract/html.ts` (add `brand` to the JSON-LD reader, `:65–117`), `adapters/images.ts`; parameterise bucket/path in `media/import-images.ts:109–129`; `lib/mods/parse.ts` for brand confirmation and category. New action `fetchPartLink` in `garage/actions.ts`, throttled with a new `RATE_LIMITS.fetchPartLink` (30 per hour) in `src/lib/rate-limit.ts` — the importer's own limit is 10 per hour because it is far heavier. Mods editor link-first flow; public mod rows via `ObjectRow`. Store `ref_price_currency` beside `ref_price_cents` (the reader already returns currency); no currency → no price. Never carry the shop image into a listing (`sell/page.tsx:185–211`). Check: thumbnail persists; abandoned fetch is swept by the 48 h clean-up; failed save + retry leaves one copy.

**WS7 Cooler dark.** `globals.css:180–227` including the `--color-*` mirrors; brand swatches `(docs)/docs/brand/page.tsx:19–28, :41`; card-form fallbacks `(discover)/cart/payment-confirm.tsx:17–24`. Re-measure contrast; check `--photo-filter`. Docs: `design-system.md`, `brand.md`.

**WS8 Shell** (N-2, N-3, N-5). `livesheet-bar.tsx:186` mount `SuggestingSearchField`; `Post` button; unread messages in `lib/shell-counts.ts:19–42` → `streamed-shell-counts.tsx` → `app-shell.tsx` → rail and menu badges.

**WS9 Marketplace** (M-1…M-7). Migration: `listings.brand`, `part_miles`, `part_miles_unit`; re-create `save_listing_creation` (`20260905233517_…:180–221` — three column lists); add brand to listing search text; backfill script from `KNOWN_BRANDS`. Sell: `sell/actions.ts:37–186, :295–306`, `sell-form.tsx:60–93`, `sell/page.tsx:35–102, :185–211`, `lib/listing-import/schema.ts`. Write the card's data shape first (seller id/name/username/avatar/active count; source car name/slug/public; brand; part miles; one-line description; no rating on this card), loaded in one batch. No `seller` key on the marketplace — the store has its own query. Item page: only brand/miles in the record block here. Filters: `lib/marketplace/state.ts` (`brand`), `query.ts:190–195`, new `marketplace_brand_counts`, `active-filters.tsx`, `saved-search-list.tsx:22`, and **`lib/marketplace/saved-search.ts` `SAVED_SEARCH_KEYS` must gain `brand`** or saved searches silently drop it and alerts over-match (the alert job uses the same query, so nothing else is needed). Layout: `page-content.tsx:53–92`, `filter-bar.tsx:87–145`, `bottom-sheet.tsx:52–53`, `finder-refine-sheet.tsx:61`. Card: `listing-card.tsx:25–113`, `hydrateListingCards` `query.ts:84–163` (+ avatar, username, `seller_active_counts`), `ListingCartButton` via the `actions` slot. E2E: `marketplace-browsing` asserts sheet copy that no longer shows at desktop width; marketplace snapshots.

**WS10 Profile & Store** (P-1…P-9). Migration: `profiles.store_note`. `u/[username]/page.tsx:50` tab keys (keep old keys as aliases; only `profile-body.tsx:84, :128` use them — none in SQL), header `:116–160`, `components/ui/patterns.tsx:54–99`, `components/profile/profile-body.tsx` (remove About `:160–190`; store grid replaces `ListingRows` `:67–92`), `lib/profile-data.ts`. The store runs its own rows query (it needs sold items) and shares `hydrateListingCards` + `ListingCard`. Allowed statuses come from who is viewing, decided server-side (public: active + sold; owner adds draft/paused/reserved), never from the URL; seller + status filter before count and paging. Trust strip: rating · sold · member since. No dispatch time.

**WS11 Home** (H-1, H-4…H-6). `home/page.tsx` restructure; delete `attention.tsx`, `seller-kpis.tsx` (update `recipe-baseline.json`); move unique KPIs to `selling/page.tsx:81–131`; `suggested_builders` RPC; scroll-to-load from `explore/explore-wall.tsx`. Needs WS8's Messages badge first. Sparse rules: <3 posts → first rail card after the last post; empty tiles don't render; no car → "Add your car" tile. H-3 (quick box) is delivered by WS14a; Home ships with today's prompt until then.

**WS12 Garage** (G-1…G-5). `garage/page.tsx` `?car=`; route-local switcher and focused view; `garage-data.ts` adds trim/engine/drivetrain; existing editors mounted in `SheetTabs`; keep `/garage/[id]/edit`.

**WS13 Explore** (E-1…E-4). `components/ui/mosaic.tsx:72–75, :187, :305–443`, `masonry-feed.tsx`, `globals.css:2843–2903`; `trending_models` RPC ships here; breakers render only with ≥3 results. Legacy photo-less posts are left off the photo walls (no borrowed car cover), kept everywhere else. Segments in `explore/page.tsx:136–148`. Design in the browser with iteration passes.

**WS14 Posting.** Release-blocking: `write_activity_post` publish mode converts the car's existing draft row into the published post (`…durable_activity_writes.sql:197–240`; one draft per car, `:30–32`), so quick posts use a new `quick` mode that skips the draft lookup and always inserts; guard test proves the draft survives. Handoff: no draft → save quick content as the draft; draft exists → "Continue your draft", never merged. Photo rule applies to new publishes only. 14a: `activity_posts.title` nullable; `activity_post_listings`; re-create `write_activity_post` (`20260905230238_…:71–257`) with optional title, photo required on publish, `p_listing_ids`; `lib/activity-blocks.ts`, `features/composer/*`, `features/activity/blocks-view.tsx`; quick post + part picker; title fallbacks across ~12 readers via one `postHeadline()` helper. 14b: `car_id` nullable, `/posts/[postId]`, `postHref()` replacing 13 hand-built links, `feed_events`, search RPC, notification triggers, OG image.

**WS15 Local** (H-2). `profiles.country`, `region`; `src/lib/geo/regions.ts`; settings and profile editor; `feed_events` + `owner_id`; `local_feed_rows` RPC; Home tab.

## Acceptance journeys (define done across workstreams)

1. **Replace a part and list the old one** — old part keeps its id under "Came off this car"; new part is a new record; abandoning the sell form loses nothing; List it again opens the same listing; an earlier update still names the old part. (WS2)
2. **That listing reaches followers once** — following seller and car gives one card; paging never repeats or skips it. (WS3)
3. **A stranger finds it signed out** — Explore, Parts segment, search, suggestions; private source car named but not linked; guest purchase works. (WS1, WS8, WS9)
4. **It sells and the store shows it** — under Sold and All, never Active; drafts unreachable by URL; a post that tagged it says Sold with no cart button. (WS10, WS14a)
5. **Quick post without losing a long draft** — draft untouched; "Continue your draft" opens it intact. (WS14a)
6. **The buyer finishes the loop** — bell → shipped order → confirm receipt; add the item to a car from the purchase record even if the listing changed; a second tap adds nothing. (WS4, WS8, WS11)

## Design proof (run 2026-09-19)

Two specimens on the docs component board (`/docs/components` → Commerce),
measured against the running app rather than eyeballed. Findings:

- **Marketplace/Store card, two across on a phone.** At 375px the columns land
  at exactly 163.5px and the cards come out **523–571px tall** — one and a half
  per screen, which scans worse than the single column the grid currently drops
  to under 480px. `.marketplace-card__title` has **no line-clamp**, so real
  titles run 3–6 lines and a worst case runs eight; the ragged bottoms follow
  from that. The Save target survives at 130×44. **WS9 conclusion:** two-across
  needs a 2-line title clamp and a shorter meta stack *before* brand, part
  miles and the one-line description are added — otherwise M-4's phone column
  should stay at one.
- **Explore card family.** The wall is already two columns on a phone, but the
  cells are **not one footprint** — a build cell sits shorter than the update
  beside it and the rows run ragged, which is what E-1 rules out. **WS13
  conclusion:** the caption block has to become a fixed height per kind rather
  than a natural one; that is the first job, before the breakers.

## Review log

- 2026-09-19 — GPT review against the public repo (it could not see this plan or the PRD; commit `a6c88a7` was local). Adopted: quick-post draft protection, Replace action + record contract, purchase-snapshot source for "add to my car", reference-price currency, main car offered not applied, fifth parts-gate location, legacy photo-less post policy, sparse-Home rules, acceptance journeys, early card proof. Dropped as unneeded: the marketplace `seller` URL key.
