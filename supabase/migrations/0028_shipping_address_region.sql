-- ============================================================================
-- 0028 — Shipping address region (P0)
--
-- Checkout's address form had no state/province/region field, so a US, CA
-- or AU delivery address was structurally incomplete (city + postcode alone
-- doesn't route a parcel in those countries). This adds the column; the
-- checkout form (src/app/(product)/checkout/checkout-steps.tsx) requires it
-- client-side only for US/CA/AU, everywhere else it stays optional — the
-- column itself is nullable so existing orders and non-US/CA/AU addresses
-- are unaffected.
--
-- `ship_country` also moves from free-text to ISO 3166-1 alpha-2 codes going
-- forward (src/lib/geo/countries.ts); this migration does not touch that
-- column's existing values — display code (`countryLabel`) handles both the
-- old free-text rows and new coded rows.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.orders
  add column if not exists ship_state text;

comment on column public.orders.ship_state is
  'State / province / region — optional at the DB level; required client-side in checkout when ship_country is US/CA/AU.';

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'ship_state'
  ) then
    raise exception 'SELF-CHECK FAILED: orders.ship_state missing';
  end if;

  raise notice 'PASS: 0028 self-checks';
end $$;

commit;
