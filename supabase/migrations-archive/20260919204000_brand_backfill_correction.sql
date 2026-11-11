-- 20260919204000 — undo what the brand backfill could get wrong (M-6).
--
-- The backfill in 190000 matched a title against a list that also held the
-- build sheet's CATEGORY words, with `ilike name || '%'` and no word
-- boundary. On a real catalogue that tags "Exhaust manifold, 2JZ" as brand
-- "exhaust", "Stiffer springs" as "STI" and "April service kit" as "APR".
-- Re-running the backfill can't repair it: it only touches `brand is null`.
--
-- Three corrections, each safe to repeat:
--   1. a brand that is really a category word is cleared;
--   2. a brand the title doesn't contain as a WHOLE WORD is cleared — but
--      only where the row hasn't been edited since it was backfilled, so a
--      brand a seller typed themselves is never second-guessed;
--   3. two spellings of one maker are folded together, so the filter offers
--      one Öhlins and one GReddy rather than two of each.
--
-- Idempotent.

begin;

update public.listings
   set brand = null
 where lower(brand) in (
   'suspension', 'exhaust', 'wheels', 'interior', 'drivetrain', 'ecu-tune', 'aero-exterior'
 );

update public.listings
   set brand = null
 where brand is not null
   and updated_at <= '2026-09-19 23:59:59+00'
   and title !~* ('\m' || regexp_replace(brand, '([\\.^$*+?()\[\]{}|-])', '\\\1', 'g') || '\M');

update public.listings set brand = 'Öhlins' where lower(brand) in ('ohlins', 'öhlins') and brand <> 'Öhlins';
update public.listings set brand = 'GReddy' where lower(brand) = 'greddy' and brand <> 'GReddy';

commit;
