# Page-load performance investigation

Date: September 13, 2026

## Implementation and verification update

The fixes below are now implemented in the working tree. The investigation that follows records the original state.

- Browsing layouts and Home, Garage, Saved, Explore, Marketplace, public profiles, car/activity pages, and listing detail now reuse a request-scoped client and verified JWT identity. Account mutations, checkout and administration retain their existing fresh authorization checks. There is no shared cache of user identities.
- Navigation renders while badge counts stream independently. Legal-page content also no longer waits for badge queries.
- Marketplace shares its garage and vehicle reads between controls and retrieval, starts those reads alongside the SQL query, streams results separately from controls/category counts, and starts social queries before fitment finishes. The new completion timer includes card enrichment.
- Home streams recommendations, Discovery and secondary widgets. Car-page secondary lookups now run together.
- Page headings render visibly before hydration. The leading Marketplace/Explore image loads eagerly; shopping links prefetch on hover/focus. Other card images remain lazy.
- Public vehicle-catalog reads use the anonymous client and Next's data cache, with five-minute revalidation and the `vehicle-catalog` tag. User-specific data, inventory and purchase authorization remain uncached by this change.
- `DRVN_NEXT_DIST_DIR` supports isolated production builds without replacing the active development server's output.

Validation: **681 tests passed in 105 files**, including new verified-identity, query-concurrency and shell-streaming tests. TypeScript, targeted ESLint, production builds and whitespace checks passed. A real signed-in fixture on the isolated local Supabase stack passed Home/Garage/Saved/Marketplace/Explore/Terms loads, client navigation from Home to Marketplace, streamed Discovery, mobile Home and sign-out gating. The fixture was deleted afterward. Production Marketplace was visually checked at 1440 px and 390 px; there was no horizontal overflow. The public catalog endpoint returned the same 392 makes before and after.

Production browser measurements below use separate builds on localhost, identical remote data configuration, Chromium at 1440 × 1000 without throttling, fresh browser contexts and three samples per route. Values are medians in milliseconds:

| Route | HTML complete before → after | LCP before → after |
|---|---:|---:|
| Marketplace | 300 → 267 | 428 → 376 |
| Marketplace with `vehicle=1` | 244 → 94 | 368 → 368 |
| Explore | 1,172 → 273 | 1,280 → 488 |
| Terms | 18 → 10 | 76 → 52 |

These small samples show direction, not a production SLA or a defensible universal speedup percentage. Explore's baseline included a 5.4-second HTML outlier; backend/network variation confounds precise attribution. The vehicle-filter sample returned zero listings, so it demonstrates filter/catalog overhead rather than full card hydration. Decoded production scripts remained approximately 0.81 MB; no bundle-size reduction is claimed. Raw samples are in [browser-timings.json](remediation-evidence/page-performance-2026-09-13/browser-timings.json).

The first production startup correctly refused live-money mode because local configuration lacks `SENTRY_DSN`. Benchmarks used the existing explicit sandbox payment setting, bound to localhost, and exercised browsing without purchases. That production safeguard was not weakened. Temporary benchmark servers were stopped after verification. No deployment was performed. The normal preview still uses `next dev`, so first-visit compilation overhead remains a development-only consideration. The isolated signed-in test server had substantial database/development latency and is functional coverage, not evidence of signed-in production speed. Existing nonce-attribute hydration warnings also remain in development logs.

## Original investigation

The local app has two overlapping sources of delay: development-mode first-visit overhead, and page rendering that waits through multiple authentication and database stages. The latter remains relevant to production. This investigation made no application or database changes.

## Measurements

Tested the running app at `http://localhost:3005`. Its process is `next dev -p 3005`, Next.js 16.2.12, in this repository. These are anonymous local measurements, not deployed-site or signed-in benchmarks. Existing uncommitted work was included in the inspected working tree and left untouched.

Three sequential HTTP GETs per route; seconds until the full HTML stream completed:

| Route | First measured request | Repeat 1 | Repeat 2 |
|---|---:|---:|---:|
| `/` | 1.00 | 0.78 | 0.60 |
| `/marketplace` | 3.47 | 1.26 | 0.86 |
| `/explore` | 1.42 | 0.48 | 0.68 |
| `/login` | 0.40 | 0.057 | 0.080 |
| `/terms` | 8.18 | 0.42 | 0.12 |

All returned HTTP 200. “First” means first in this test, not a proven cold process/cache. The large first-request penalty is consistent with development compilation/cache warmup; its exact attribution was not instrumented.

A subsequent headless Chromium pass, desktop, no throttling, fresh anonymous browser:

| Route | First byte | HTML complete | Largest contentful paint | Decoded script bytes |
|---|---:|---:|---:|---:|
| Marketplace | 0.45 s | 1.82 s | 1.99 s | 5.62 MB |
| Explore | 0.25 s | 1.72 s | 1.81 s | 5.60 MB |

The browser and HTTP passes are different samples. These script sizes include development tooling and are not production bundle sizes. Several Explore image requests took 0.64–1.14 seconds. No uncaught page errors were captured in this pass; existing development logs do contain nonce attribute hydration warnings and an above-fold image lazy-loading warning.

## Findings, in priority order

### 1. Development mode explains a substantial first-visit penalty

The active process is a development server, with compilation and development JavaScript overhead. Terms falling from 8.18 seconds to 0.12 seconds is the strongest measured example. Do not use these values as production latency estimates.

Next action: benchmark a fresh production build on a separate port against the same backend and representative account. Do not overwrite the active development server's output during that comparison. No production build was run in this investigation.

### 2. Authentication is repeated below the optimized proxy

`src/lib/supabase/proxy.ts` already uses `getClaims()`. However, both `src/app/(product)/layout.tsx:15` and `src/app/(discover)/layout.tsx:16` call `getUser()`. Home, Explore, Marketplace, and other page loaders call it again through independently created clients. `src/lib/supabase/server.ts` has no shared request-scoped client or identity cache.

For authenticated requests, `getUser()` fetches the user from the Auth server; verified claims can often be checked locally with asymmetric keys. See [Supabase getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser) and [getClaims documentation](https://supabase.com/docs/reference/javascript/auth-getclaims).

This creates repeated work when layout and page render together. Layout/page calls may overlap, and shared layouts can be reused during client navigation, so their costs should not simply be added or described as occurring on every click. Anonymous timings above do not measure the signed-in Auth-server cost.

Next action: deduplicate identity/client loading within each request. Use verified claims where only identity is required; retain fresh user/session checks where the authorization requirement needs them. Never substitute unverified cookie session data.

### 3. Secondary shell data blocks the layout

Both main layouts await `loadShellCounts()` before returning their shell. For signed-in users, `src/lib/shell-counts.ts:28` makes three parallel database count requests: unread notifications, received open offers, and countered offers made by the user. They follow authentication. Cart count is cookie-only, not a database request.

The route-group `loading.tsx` files exist, but a loading boundary below an async layout does not remove the layout's own wait. This matters most on direct loads and entering another route group, rather than every same-layout navigation.

Next action: render essential navigation promptly and load badge counts independently, with appropriate user-scoped freshness and update behavior.

### 4. Marketplace has avoidable sequential work and duplicate reads

`src/features/marketplace/page-content.tsx:34` currently follows this sequence:

1. Resolve user.
2. Resolve selected vehicle, when present.
3. Load the user's garage, when signed in.
4. Start listing retrieval and category counts in parallel.

Inside `src/lib/marketplace/query.ts:204`, listing retrieval loads the garage again for a signed-in viewer, resolves the selected vehicle again, then fetches listing rows. It subsequently fetches images, seller profiles/reviews, source cars, saves, likes, questions, and optional fitment data.

Many enrichment queries are already batched and parallel; this is not a simple per-card N+1 problem. However, the duplicate garage/catalog calls and stages preceding retrieval still extend the critical path. Engagement query builders are only awaited after fitment work in the filtered path, leaving another opportunity to start independent work earlier.

Next action: reuse garage/catalog results, start independent work together, and separate results from secondary controls/counts where useful. Measure full retrieval including enrichment: the existing `[marketplace:retrieval]` timer is logged before card hydration and engagement lookups, so it understates the complete loader duration.

### 5. Home and car pages have further waterfalls

`src/app/(product)/home/page.tsx:86` waits for its first query group, then discovery-feed retrieval, then garage statistics. Async `Attention` and `SellerKpis` children start afterward; seller KPIs can also request payment onboarding status. There are no local Suspense boundaries around those two widgets.

`src/app/(discover)/cars/[slug]/page.tsx` has multiple successive query stages before returning its UI. These are code-confirmed latency risks, but were not timed with a signed-in account or a specific car in this pass.

Next action: move independent sections into separate streaming boundaries and reduce unnecessary ordering between their loaders.

### 6. Site-wide rendering/cache policy limits cheap repeat responses

`src/app/layout.tsx:61` reads request headers for a nonce. `src/proxy.ts:32` applies `Cache-Control: private, no-store` broadly. The installed Next.js nonce/CSP guide explicitly requires dynamic rendering for per-request nonces.

Consequently, even public informational pages go through request-time rendering rather than using ordinary static HTML delivery. This does not mean every asset or database result is uncacheable: static chunks/images are excluded from the proxy matcher, and safe data-level caching is a separate choice.

Next action: consider bounded caching for genuinely public catalog/category data and review whether public informational routes need the same rendering policy. Preserve nonce integrity and never publicly cache personalized HTML.

### 7. Visible loading is amplified by images and reveal effects

Explore had image requests exceeding one second in the browser pass. Image optimization is already enabled in `next.config.ts`; the evidence does not support saying all images are being served unoptimized.

`src/components/livesheet.tsx:46` starts reveal content hidden until hydration/intersection detection. Its fallback only runs after hydration, after 900 ms plus stagger. This can postpone visibility even once the HTML has arrived. Marketplace's page heading already opts out of reveal.

Next action: keep essential above-fold content visible on initial render, prioritize the actual LCP image, and profile image cache misses. Marketplace listing links also explicitly disable prefetch (`src/components/ui/listing-card.tsx:93`); consider hover/focus prefetch for likely clicks instead of enabling every card indiscriminately.

## Recommended implementation order

1. Establish production-mode baselines, including signed-in direct loads and navigation within/across route groups.
2. Deduplicate request identity and repeated Marketplace garage/catalog reads.
3. Remove badge counts and secondary widgets from the essential content wait; parallelize remaining independent stages.
4. Tune above-fold images and reveal behavior.
5. Add safe public-data caching and profile SQL execution plans where residual timings justify it.

Record full loader duration, request counts, TTFB, LCP, and navigation-to-content time before and after. The current evidence identifies concrete application bottlenecks, but does not establish production database execution time, deployment region mismatch, capacity exhaustion, or real-user latency percentiles. Those should not be claimed without deployment traces and query plans.
