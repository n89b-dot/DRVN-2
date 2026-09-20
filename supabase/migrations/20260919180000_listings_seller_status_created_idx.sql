-- 20260919180000 — a seller's listings, newest first (PRD 2026-09 B-1).
--
-- Three surfaces now ask the same question — "what is this seller selling,
-- in this state, newest first?" — and none of them had an index for it:
--
--   * the followed feed, which folds a followed seller's new listings in
--     beside their build updates (B-1);
--   * the Store tab on a profile, which is the marketplace grid filtered to
--     one seller (P-6);
--   * the "N for sale" count on every marketplace card (M-5).
--
-- Without it each is a seller-wide scan filtered in memory. `status` sits in
-- the middle because every caller filters on it and none of them range-scans
-- it; `created_at desc` matches the order all three read in.
--
-- Additive and idempotent.

begin;

create index if not exists listings_seller_status_created_idx
  on public.listings (seller_id, status, created_at desc);

commit;
