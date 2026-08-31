-- 0054 — Local pickup confirmation (brief §20-21) + snapshot shipping-mode fix.
--
-- Collection was an honor system: the buyer clicked "mark received" (or
-- didn't), and nothing proved a handoff happened. Now a pickup order gets a
-- provable handshake:
--
--   1. Seller marks the order Ready for pickup (orders.pickup_ready_at).
--   2. Buyer shows a Pickup Pass — QR + six-digit fallback code. The pass is
--      minted on demand and ROTATES on every show: only salted SHA-256
--      hashes are ever stored (no reusable plaintext secrets), each pass is
--      single-use and short-lived.
--   3. At handoff the seller scans/enters it; pickup_redeem() validates
--      atomically (single-use via a redeemed_at compare-and-set), records
--      who confirmed and when, and moves the order into the same
--      delivered/clearing path a shipped order uses.
--
-- Brute-force posture: a 6-digit code has 10^6 space, so redemption attempts
-- are counted per pass and the pass dies after 10 misses; TTL is one hour.
-- No GPS/location collection (§21).
--
-- Also here: listing_commercial_snapshot (0049) recorded shipping_mode as a
-- constant 'seller_arranged' — 0053 gave listings a real mode, so the
-- snapshot now freezes the actual one ('flat' → seller_arranged,
-- 'drvn' → drvn_shipping, 'pickup_only'). Restated in full.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.orders
  add column if not exists pickup_ready_at timestamptz;

comment on column public.orders.pickup_ready_at is
  'Seller marked this collection order ready for handoff (0054). Null for shipped orders.';

create table if not exists public.pickup_confirmations (
  order_id uuid primary key references public.orders (id) on delete cascade,
  token_hash text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.pickup_confirmations is
  'Single-use pickup pass per order (0054). Hashes only — plaintext exists solely in the buyer''s current view.';

-- Server-only: even participants never read hashes. The buyer''s pass and the
-- seller''s redemption both go through service-role actions/RPC.
alter table public.pickup_confirmations enable row level security;
revoke all on public.pickup_confirmations from anon, authenticated;

-- ============================================================
-- pickup_redeem — atomic, single-use, attempt-limited
-- ============================================================
create or replace function public.pickup_redeem(
  p_order_id uuid,
  p_seller_id uuid,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_pass record;
begin
  select o.id, o.seller_id, o.status, o.is_collection
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found or v_order.seller_id is distinct from p_seller_id then
    return jsonb_build_object('ok', false, 'reason', 'not_your_order');
  end if;
  if not v_order.is_collection then
    return jsonb_build_object('ok', false, 'reason', 'not_pickup');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_redeemable');
  end if;

  select * into v_pass
    from public.pickup_confirmations
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pass');
  end if;
  if v_pass.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;
  if v_pass.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_pass.attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_pass.token_hash <> p_hash and v_pass.code_hash <> p_hash then
    update public.pickup_confirmations
       set attempts = attempts + 1
     where order_id = p_order_id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  -- Handoff proven: single-use stamp + the same delivered/clearing entry a
  -- shipped order gets from the buyer''s confirm.
  update public.pickup_confirmations
     set redeemed_at = now(), redeemed_by = p_seller_id
   where order_id = p_order_id
     and redeemed_at is null;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         completed_at = now()
   where id = p_order_id
     and status = 'paid';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.pickup_redeem(uuid, uuid, text)
  from public, anon, authenticated;

-- ============================================================
-- listing_commercial_snapshot — freeze the real shipping mode
-- ============================================================
create or replace function public.listing_commercial_snapshot(
  p_listing_id uuid,
  p_price_cents int,
  p_shipping_cents int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_fitment jsonb;
  v_alt_numbers jsonb;
  v_car jsonb;
  v_seller jsonb;
begin
  select l.id, l.seller_id, l.source_car_id, l.title, l.description,
         l.category, l.subcategory, l.condition, l.grade,
         l.condition_checklist, l.compatibility_notes, l.part_number,
         l.price_cents, l.currency, l.shipping_cents, l.allows_collection,
         l.shipping_mode
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'make', f.make, 'model', f.model,
             'year_start', f.year_start, 'year_end', f.year_end
           ) order by f.make, f.model, f.year_start
         ), '[]'::jsonb)
    into v_fitment
    from public.listing_fitments f
   where f.listing_id = p_listing_id;

  select coalesce(jsonb_agg(pn.number order by pn.created_at), '[]'::jsonb)
    into v_alt_numbers
    from public.listing_part_numbers pn
   where pn.listing_id = p_listing_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'year', c.year, 'make', c.make, 'model', c.model
         ))
    into v_car
    from public.cars c
   where c.id = v_listing.source_car_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', p.id,
           'username', p.username,
           'display_name', p.display_name,
           'profile_type', p.profile_type
         ))
    into v_seller
    from public.profiles p
   where p.id = v_listing.seller_id;

  return jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'captured_at', now(),
    'listing', jsonb_build_object(
      'id', v_listing.id,
      'title', v_listing.title,
      'description', v_listing.description,
      'category', v_listing.category,
      'subcategory', v_listing.subcategory
    ),
    'part', jsonb_build_object(
      'part_number', v_listing.part_number,
      'alt_part_numbers', v_alt_numbers
    ),
    'condition', jsonb_build_object(
      'condition', v_listing.condition,
      'grade', v_listing.grade,
      'checklist', v_listing.condition_checklist,
      'compatibility_notes', v_listing.compatibility_notes
    ),
    'fitment', v_fitment,
    'source_car', v_car,
    'commercial', jsonb_build_object(
      'price_cents', p_price_cents,
      'listing_price_cents', v_listing.price_cents,
      'currency', v_listing.currency,
      'shipping_cents', p_shipping_cents,
      -- The listing''s declared mode at purchase (0053/0054): how this sale
      -- was represented to ship.
      'shipping_mode', case v_listing.shipping_mode
                         when 'drvn' then 'drvn_shipping'
                         when 'pickup_only' then 'pickup_only'
                         else 'seller_arranged'
                       end,
      'allows_collection', v_listing.allows_collection,
      'return_policy', null
    ),
    'seller', v_seller
  ));
end;
$$;

revoke all on function public.listing_commercial_snapshot(uuid, int, int)
  from public, anon, authenticated;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.pickup_confirmations') is null then
    raise exception '0054: pickup_confirmations missing';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pickup_confirmations'
  ) then
    raise exception '0054: pickup_confirmations has a policy; it must have none';
  end if;

  if to_regprocedure('public.pickup_redeem(uuid, uuid, text)') is null then
    raise exception '0054: pickup_redeem missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'pickup_ready_at'
  ) then
    raise exception '0054: orders.pickup_ready_at missing';
  end if;

  if position('shipping_mode' in pg_get_functiondef(
       'public.listing_commercial_snapshot(uuid, int, int)'::regprocedure
     )) = 0 then
    raise exception '0054: snapshot does not freeze shipping_mode';
  end if;

  raise notice 'PASS: 0054 self-checks';
end $$;

commit;
