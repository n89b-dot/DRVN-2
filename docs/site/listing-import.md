# Listing import system

> Source of truth: `src/lib/listing-import/` (policy, fetch, adapters,
> extraction, engine), `src/app/(product)/sell/import/` (flow UI + actions),
> `supabase/migrations/0047_listing_imports.sql`, and
> `src/lib/domain/states.ts` (`IMPORT_TRANSITIONS`, rendered in
> [domain-states](domain-states.md)). Product spec:
> [listing-importer-spec](../listing-importer-spec.md).

The importer turns a seller's existing external post (URL or pasted text) into
a reviewable, prefilled sell form. This page is the operational reference.

## State machine (0047)

`listing_imports.status` — enforced by the `guard_listing_import_status`
trigger, mirrored in `IMPORT_TRANSITIONS`:

| From | May move to | Meaning |
|---|---|---|
| `pending` | fetching, extracting, failed, expired | created; paste rows skip straight to extracting |
| `fetching` | extracting, failed, expired | retrieving + normalizing the source page |
| `extracting` | importing_media, ready, failed, expired | AI/stub normalization + validation + fitment |
| `importing_media` | ready, failed, expired | downloading + re-hosting photos (4 per poll) |
| `ready` | consumed, extracting, expired | reviewable; `→ extracting` = multi-item re-selection |
| `failed` | fetching, extracting, expired | retryable; resumes at the step that broke |
| `consumed` | — | became a listing (requires `listing_id`) |
| `expired` | — | swept at `expires_at` (48 h) |

Processing model: the client polls `pollImport` (~1.6 s); each poll claims the
row's **step lease** (`lease_expires_at`, 3 min) and runs ONE bounded,
idempotent step. Concurrent polls lose the claim and just report state; a
crashed request's lease lapses and the next poll resumes. Media import
dedupes on source URL, so retries never duplicate photos.

## Error codes

`error_code` on failed rows (`src/lib/listing-import/errors.ts`):

`source_invalid` · `source_unsupported` · `source_private_address` ·
`source_fetch_timeout` · `source_fetch_failed` · `source_access_denied` ·
`source_login_required` · `source_challenge` · `source_too_large` ·
`source_not_sale_post` · `source_listing_gone` · `source_parse_failed` · `ai_unavailable` ·
`ai_failed` · `ai_invalid_output` · `media_fetch_failed` · `media_invalid` ·
`import_expired` · `import_not_found`

`PASTE_FALLBACK_CODES` drive the "paste the post instead" UX on the same
import (`source_not_sale_post` is one: its message says "paste just the sale
text below", so the paste box opens); `RETRYABLE_CODES` drive the retry button. Sellers only ever see the
sentence from `messageForImportError` — never `error_detail`.

## Facebook Marketplace

`adapters/facebook.ts`, one logged-out fetch of the item page.

- **Links are normalized first** (`normalizeImportUrl` in `policy.ts`, applied
  in `startUrlImport` and to every redirect hop the adapter follows). `m.`,
  `mbasic.`, `web.` and bare `facebook.com` hosts, the `l.facebook.com` link
  shim, city-scoped and `/commerce/listing/` paths and share/tracking params
  all become `https://www.facebook.com/marketplace/item/<id>/`, so mobile and
  desktop links dedupe as one import. `m.facebook.com` answers anonymous
  readers with HTTP 500, so an un-normalized mobile link used to fail.
- **Fields come only from the listing's own data.** The page embeds ~20
  recommended listings with the same keys, ahead of the linked one. The
  adapter parses the `<script type="application/json">` blobs and reads only
  objects whose `id` is the item id: `marketplace_listing_title`,
  `redacted_description`, `listing_price` (`formatted_amount_zeros_stripped` +
  `currency`), `location_text`, `attribute_data` (Condition), `is_sold` /
  `is_pending`, and `listing_photos` (the full gallery, up to 12). When that
  data is missing it falls back to OpenGraph alone (title, description, one
  photo, no price) — never to the first match on the page.
- **Currency.** DRVN prices are USD. A non-USD `listing_price.currency` (or a
  £ / € / A$ / C$ … price in pasted text) leaves the price unset with a
  review note naming the original ("The post's price is A$1,850 (AUD)…") —
  see `foreignPrice` in `extract/validate.ts`. Nothing is converted.
- **Removed listings** (HTTP 200, no OpenGraph, Facebook's `CometErrorRoot`)
  fail as `source_listing_gone`, not `source_login_required`, and record the
  `listing_gone` Facebook outcome so they don't count against anonymous
  retrieval.
- **Fixtures** (`adapters/fixtures.ts`) mirror the September 2026 page shape,
  neighbours first. If Facebook changes the shape, capture a live page and
  update `facebookMarketplacePage` before touching the adapter.

## Environment

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables real extraction. Absent: stub in dev/test, importer disabled in production. |
| `LISTING_IMPORT_MODEL` | Extraction model (default `claude-sonnet-5`). |
| `LISTING_IMPORT_AI_MODE` | Force `anthropic`/`stub`; stub in production needs `LISTING_IMPORT_ALLOW_STUB_IN_PRODUCTION=true`. |
| `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` | Enables the Playwright public-page render fallback (needs `playwright-core` + Chromium in the deployment). |
| `LISTING_IMPORT_ALLOW_PRIVATE_HOSTS` | Test-only; lets e2e fixture servers through the SSRF guard. Ignored in production. |

## Jobs & retention

`POST /api/jobs/listing-imports` (bearer `CRON_SECRET`, 404 unauthenticated;
run daily at 03:37 UTC by pg_cron's `drvn-listing-import-sweep` through
`invoke_remediation_worker('listing-imports')` — migration 20261004150000 —
and reported to worker health as the `listingImports` family):

1. moves overdue non-terminal rows to `expired`;
2. clears `normalized_source` / `extracted` / `imported_images` from terminal
   rows older than 7 days — imported posts can contain phone numbers/handles,
   and DRVN keeps operational metadata, not an archive of external pages.

Staged photos from unfinished imports are reclaimed by the existing 48 h
media GC (0029) — the importer writes the same `staged_uploads` ledger as
browser uploads. Raw source text is never sent to analytics.

## Analytics

Typed events (`src/lib/analytics.ts`): `listing_import_started`,
`listing_import_fetch_succeeded/_failed` (adapter + code),
`listing_import_fallback_to_paste`, `listing_import_extraction_succeeded`,
`listing_import_review_opened`, `listing_import_consumed` (published?,
`fields_edited` count + field names — the extraction-quality signal), and
`listing_import_facebook_outcome`
(`fetch_attempted/fetch_succeeded/render_attempted/render_succeeded/fallback_to_paste/listing_gone`)
— the aggregate answering "does anonymous Facebook retrieval actually work at
scale?". No event ever carries listing text, URLs beyond the domain, or
personal data.

## Rate limits & abuse posture

`RATE_LIMITS.importListing` — 10/hour/user (fetch + AI + media is the most
expensive user-triggerable action). DB-side: 20 in-progress imports per user
(trigger), one live import per canonical URL per user (partial unique index).
One-time content-rights attestation: `profiles.import_attested_at`.

`RATE_LIMITS.fetchPartLink` — 30/hour/user. Deliberately three times the
importer's allowance, because it does far less: one fetch, one HTML read, one
thumbnail. Sharing the importer's limit would have made "add a part by
pasting a link" feel rationed for no reason.

## Adding a part by pasting a link (L-1…L-4)

The build sheet's link flow reuses the importer's machinery rather than
growing its own: `fetch/safe-fetch.ts` and `fetch/guard.ts` (SSRF posture
unchanged), `extract/html.ts` (whose JSON-LD reader gained `brand`) and
`adapters/images.ts`.

Shop pages it reads: a schema.org `Product`, or a `ProductGroup` — how
Shopify describes a product with variants — whose name and brand are the
group's and whose price, part number and photo come from its first variant
when the group doesn't state them. A price only in meta tags is read from
`og:price:amount` / `product:price:amount`. An OpenGraph title loses its
" | Shop name" tail (`trimSiteName`) before it becomes the part's title. A
shop that refuses automated reads (access denied, a bot challenge, a login
wall) gets "This shop blocks automatic reading — add the part by hand or
paste its details" rather than "Couldn't reach that page", which is kept for
links that really didn't answer. `media/import-images.ts` takes the bucket and path as
parameters so the same code re-hosts a mod thumbnail and a listing photo.

What it writes is on `mod_items`, not `listings`: `product_url`,
`image_url`, `source_domain`, and `ref_price_cents` **with**
`ref_price_currency`. A price without a currency is refused by the database —
"1299" is not a price, and guessing the currency from the shop's domain is
how a €1,299 part becomes a $1,299 part on somebody's sheet.

**A shop's photo never becomes a listing photo.** The sell form prefills
everything else from the mod and deliberately leaves the images alone: the
thumbnail is there so the owner recognises the line on their own build sheet,
and republishing a manufacturer's product shot as the photo of a used part
for sale is both a misrepresentation and somebody else's copyright.

Brand extraction feeds the same curated list the marketplace filter uses
(`KNOWN_BRANDS`), so a mod added by link, a listing published from it, and a
listing backfilled from its title all agree on what the brand is called.

## Troubleshooting

- **Import stuck in a `*_ing` state** — a poll crashed mid-step; the lease
  (3 min) lapses and the next poll from the seller's open page resumes it. A
  closed tab leaves the row until it expires; harmless.
- **Facebook URLs always falling to paste** — check the
  `listing_import_facebook_outcome` aggregate; if `fetch_succeeded` ≈ 0 in a
  region, the logged-out page is being withheld from the deployment's IPs.
  The render fallback (`LISTING_IMPORT_PUBLIC_BROWSER_ENABLED`) is refused in
  production (`fetch/render.ts` — Chromium's DNS is not pinned), so the
  answer there is paste-first for that geography until rendering has isolated
  public-only egress. `listing_gone` outcomes are removed listings, not walls.
- **`ai_invalid_output` spikes** — the model/schema drifted; the extraction is
  re-validated server-side, so bad outputs fail safe. Check
  `LISTING_IMPORT_MODEL`.
- **Photos missing after import** — see `media_*` failures in `error_detail`
  (Sentry `[listing-import]` breadcrumbs); sellers are prompted to add
  original photos on review, so this degrades, not blocks.
- **SQL invariants** — `supabase/tests/import_guard.sql` (8 assertions: RLS
  isolation, transition guard, consumed-requires-listing, dedupe, cap) runs in
  CI's `sql-guard` job.
