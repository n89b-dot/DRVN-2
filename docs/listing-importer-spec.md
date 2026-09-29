# Existing Listing Importer — Specification (as built)

Bring a for-sale post from anywhere else — Facebook Marketplace, a forum
thread, a classifieds page — into a DRVN listing: paste the URL (or the post's
text), DRVN reads it, organizes it into the structured listing shape, the
seller reviews it in the normal sell form, and publishes through the normal
gates.

Status: **implemented** (migration 0047, August 2026). This document is the
product/architecture spec kept true to the code; the operational reference
(state machine tables, error codes, troubleshooting, env) is
`docs/site/listing-import.md`.

> Code: `src/lib/listing-import/*` (pipeline), `src/app/(product)/sell/import/*`
> (flow UI + actions), `src/app/(product)/sell/sell-form.tsx`
> (`SellFormInitialValues` review integration), `supabase/migrations/0047_listing_imports.sql`.

---

## 1. The product promise

> Already posted it somewhere? Bring it over without rewriting it.

The seller gives DRVN what already exists — a URL or the post text. DRVN does
the conversion. The importer's job ends at *a prefilled draft the seller
reviews*: it never writes a listing row, never publishes, and never invents a
seller claim. Everything downstream (validation, payout gate, grading
attestation, fitment picker, search indexing) is the sell flow we already have.

No infrastructure jargon reaches the seller: no "scraping", no "LLM", no
confidence percentages. The product vocabulary is *Reading your listing*,
*Organizing the details*, *Check these details*.

## 2. Sources and the policy registry

All source behavior lives in one registry (`src/lib/listing-import/policy.ts`).
Three modes:

| Mode | Meaning |
|---|---|
| `public_url` | One anonymous fetch of exactly the page the seller pasted |
| `paste_only` | The site's terms/access posture make fetching wrong or useless — the seller pastes the post they wrote; the URL rides along as provenance |
| `unsupported` | Not a fetchable listing URL |

Current policy:

- **Facebook Marketplace — first-class `public_url`.** The attempt is
  user-directed, single-page, logged-out. App-copied links (`m.`/`web.`
  hosts, the link shim, share params) are normalized to the one
  `www.facebook.com/marketplace/item/<id>/` page first. Retrieval ladder:
  plain HTTP → the listing's own embedded data, read only from objects
  carrying the item's id (the page also embeds ~20 recommended listings) →
  OpenGraph when that data is missing → (when the deployment enables it)
  ordinary Chromium rendering of the same public page → same extraction. A
  login wall, challenge or empty shell **stops the attempt** and the *same
  import* falls forward to paste — the seller loses nothing. A removed
  listing says so (`source_listing_gone`) and also offers paste.
  Hard boundaries, enforced in the adapter: no accounts, no cookies or
  sessions, no credential collection, no CAPTCHA solving, no proxy/fingerprint
  rotation or stealth, no search/enumeration, no profile/comment/related
  traversal. The aggregate analytics (`listing_import_facebook_outcome`) tell
  us whether anonymous retrieval is viable at scale.
- **Discourse** — public topic JSON (`<topic>.json`), first post only.
- **XenForo / vBulletin / phpBB** — deterministic first-post extraction,
  detected from document markers (unknown domains still hit the right engine).
- **Generic public page** — JSON-LD Product → OpenGraph → Readability ladder.
- **Craigslist / Instagram / Discord** — `paste_only` (terms / login walls /
  no public documents, respectively).
- **Paste** — a first-class adapter, not a fallback hack: any text, any
  format; photos come through the normal browser uploader on review.

## 3. Pipeline (deterministic first, AI last)

```
user URL ──► policy ──► hardened fetch (SSRF-pinned, §6)
                          │
                          ▼
              engine adapters / JSON-LD / OpenGraph / Readability
                          │
                          ▼
              NormalizedImportSource  (one DRVN-owned shape; schema.ts)
   paste ────────────────►│
                          ▼
              AI normalization (extract/ai.ts — schema-forced, no tools)
                          ▼
              server validation (extract/validate.ts — taxonomy, money,
                                 evidence checks, review issues)
                          ▼
              fitment resolution (fitment.ts → 0041 vehicle catalog)
                          ▼
              image import (media/import-images.ts → seller's storage,
                            staged-media ledger 0029)
                          ▼
              ready → prefilled sell form → Save draft / Publish
```

Structured facts a page already declares (JSON-LD price, currency, MPN)
outrank anything the model infers from prose — the AI resolves ambiguity, it
does not replace deterministic parsing.

## 4. AI contract and non-invention

One schema-forced call (`record_listing_extraction` tool), temperature 0, no
tools, no browsing, no system access. The source post is delimited untrusted
data; instructions inside it are ignored by explicit system-prompt rule *and*
contained by architecture (worst case: a wrong draft the seller reviews).

The model may: normalize a title from stated facts, interpret sale shorthand
(OBO / shipped / BNIB / pickup only), classify into the real taxonomy, clean
platform noise from the description (bumps, "PM me", contact info) while
preserving damage disclosures and fitment caveats, and surface raw fitment
mentions.

The model must never invent prices, shipping, part numbers, condition facts,
usage history, location, year ranges, included accessories or any seller
claim. That is enforced twice:

1. prompt rules, and
2. **server evidence checks** (`extract/validate.ts`): a price, shipping
   amount, part number or location that leaves no trace in the source material
   is dropped, not stored. A price in any currency other than US dollars is
   dropped too, with a review issue naming the original — DRVN never stores
   A$1,850 as $1,850 and never converts. Category/subcategory are validated against the real
   taxonomy. Money is normalized server-side.

Missing/ambiguous fields become **specific review issues** ("The post says
'$450 shipped.' Confirm your shipping settings."), never user-facing
confidence scores. Internal `fieldSources` provenance exists for debugging
only. The model id is configuration (`LISTING_IMPORT_MODEL`), not code; with
no API key, non-production runs a deterministic heuristic extractor with the
same output contract (also what CI uses).

## 5. Fitment

Raw enthusiast phrases ("mk7 R", "8V S3") are extracted verbatim. Candidates
the model is confident about resolve through the DRVN vehicle catalog
(`matchCatalogByName`, 0041); confirmed ones seed the normal fitment picker
(years only ever from the post's own words), unresolved ones survive verbatim
in the compatibility notes. Fitment always carries a review issue — exact
fitment is deterministic resolution or seller confirmation, never a model
guess. There is no static chassis-code table as authority.

## 6. Safety

One hardened fetcher for pages and images (`fetch/safe-fetch.ts` + `guard.ts`):
http/https only, no credentials, ports 80/443, DNS resolved through a pinned
connect-time lookup that refuses loopback/RFC1918/link-local/cloud-metadata/
CGN and their IPv6 equivalents (rebinding-safe), per-hop redirect
re-validation, connect/total timeouts, decompressed-byte caps, honest
`DRVNImporter/1.0` user agent, no DRVN cookies or auth outbound. Images are
additionally validated by decoded bytes (never headers), pixel-count capped
(decompression bombs), SVG/GIF refused, re-encoded to JPEG with EXIF/GPS
stripped. The optional Playwright renderer applies the same per-request
address rules through route interception.

Prompt injection: contained by the schema-forced, tool-less call plus server
validation plus human review. Rate limit: 10 imports/hour/user
(`RATE_LIMITS.importListing`). Content rights: a one-time account-level
attestation ("my own listing, or content I have permission to use") on first
import — `profiles.import_attested_at`.

## 7. Durable state machine

`listing_imports` (0047) is the job: `pending → fetching → extracting →
importing_media → ready → consumed`, with `failed` (retryable), `expired`
(48h, matching staged media), and `ready → extracting` for multi-item
re-selection. Transitions are DB-guarded (trigger) and mirrored in
`src/lib/domain/states.ts`. Each UI poll runs ONE bounded, idempotent,
lease-claimed step server-side — a crashed request is reclaimed, a retried
media pass skips photos already imported, and nothing can double-create work.
Same-URL re-pastes resume the live import (partial unique index).

## 8. Media

Fetched photos are downloaded through the hardened fetcher, validated and
re-encoded, uploaded into `listing-images/{userId}/imported/{importId}/…`
(so `isOwnedStorageUrl` holds), and recorded in the **existing** staged-media
ledger (0029) — an abandoned import's photos are swept by the same 48h GC as
any hand-upload. No listing ever references a Facebook CDN or forum URL.
Max 12 photos (Facebook: the listing's full gallery, not the OpenGraph
crop), source order preserved, cover = first, all normal gallery
controls on review.

## 9. Review = the sell form

There is one sell form. `SellFormInitialValues` is the normalized
initialization contract (blank / Garage → Sell / import / edit via `listing`).
An import adds: a restrained banner ("Imported from golfmk7.com — check the
details before publishing"), specific review issues rendered beside the fields
they name, a collapsed original-post panel, and a hidden `import_id`. Grading
and the condition checklist are never imported — they are the seller's own
attestation. `createListing` consumes the import on save (draft or publish)
and records which imported fields the seller edited (names/counts only) — the
honest extraction-quality metric.

## 10. Multi-item ("part-out") posts

Detected as `multipleItems` with an items list ("We found 6 parts in this
post. Which one are you listing?"). The seller picks one; extraction re-runs
focused on that item through the same pipeline. The schema keeps the full item
list so a future "create all as drafts" is additive, not a rewrite.

## 11. What is deliberately NOT built

Screenshot import/OCR · autonomous browsing agents · Facebook credential or
session collection · CAPTCHA solving · proxy/fingerprint rotation · stealth ·
Marketplace crawling or search scraping · seller-profile crawling · automatic
publishing · a second sell form · user-facing confidence scores · listing
trust scores · a separate imported-media lifecycle · Redis/queue
infrastructure. A future officially-authorized Facebook connector would slot
in as one more adapter behind the policy registry without touching the
pipeline.

## 12. Success metrics

`listing_import_*` analytics (typed, content-free): started / fetch outcomes /
fallback-to-paste / extraction / review opened / consumed (with
`fields_edited`), plus the Facebook viability aggregate. Watch
import → consumed conversion and per-field edit rates; a field sellers keep
correcting is the next extraction fix.
