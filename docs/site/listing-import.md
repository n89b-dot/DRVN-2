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
`source_not_sale_post` · `source_parse_failed` · `ai_unavailable` ·
`ai_failed` · `ai_invalid_output` · `media_fetch_failed` · `media_invalid` ·
`import_expired` · `import_not_found`

`PASTE_FALLBACK_CODES` drive the "paste the post instead" UX on the same
import; `RETRYABLE_CODES` drive the retry button. Sellers only ever see the
sentence from `messageForImportError` — never `error_detail`.

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
run daily alongside `media-gc`):

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
(`fetch_attempted/fetch_succeeded/render_attempted/render_succeeded/fallback_to_paste`)
— the aggregate answering "does anonymous Facebook retrieval actually work at
scale?". No event ever carries listing text, URLs beyond the domain, or
personal data.

## Rate limits & abuse posture

`RATE_LIMITS.importListing` — 10/hour/user (fetch + AI + media is the most
expensive user-triggerable action). DB-side: 20 in-progress imports per user
(trigger), one live import per canonical URL per user (partial unique index).
One-time content-rights attestation: `profiles.import_attested_at`.

## Troubleshooting

- **Import stuck in a `*_ing` state** — a poll crashed mid-step; the lease
  (3 min) lapses and the next poll from the seller's open page resumes it. A
  closed tab leaves the row until it expires; harmless.
- **Facebook URLs always falling to paste** — check the
  `listing_import_facebook_outcome` aggregate; if `fetch_succeeded` ≈ 0 in a
  region, enable `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` where the deployment
  can run Chromium, or accept paste-first for that geography.
- **`ai_invalid_output` spikes** — the model/schema drifted; the extraction is
  re-validated server-side, so bad outputs fail safe. Check
  `LISTING_IMPORT_MODEL`.
- **Photos missing after import** — see `media_*` failures in `error_detail`
  (Sentry `[listing-import]` breadcrumbs); sellers are prompted to add
  original photos on review, so this degrades, not blocks.
- **SQL invariants** — `supabase/tests/import_guard.sql` (8 assertions: RLS
  isolation, transition guard, consumed-requires-listing, dedupe, cap) runs in
  CI's `sql-guard` job.
