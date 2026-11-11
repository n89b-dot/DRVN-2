-- 0056 — Lightweight shop profiles (brief §34-§37).
--
-- Shops EXTEND profiles: same account, same community identity, same
-- marketplace plumbing. profiles.profile_type = 'user' | 'shop' has existed
-- since 0001 and is protected from self-escalation by guard_profile_columns
-- (0017) — conversion happens through a controlled server path (service
-- role), never a client write.
--
--   shop_profiles — one-to-one with profiles: verification state (admin-
--   granted; self-declared shops are NEVER rendered verified), and the small
--   return policy (§37): accepted yes/no + a window from a predefined set.
--
-- The policy that applied when a buyer purchased is frozen into the 0049
-- commercial snapshot — listing_commercial_snapshot is restated below to
-- read it — so changing a shop's policy tomorrow cannot rewrite yesterday's
-- sale.
--
-- Deliberately NOT built (§38): employees/roles, inventory, POS, CRM,
-- wholesale, fulfillment routing. A shop is a credible high-volume seller,
-- not an ERP tenant.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.shop_profiles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  verification_status text not null default 'unverified',
  returns_accepted boolean not null default false,
  return_window_days int not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shop_profiles drop constraint if exists shop_profiles_verification_check;
alter table public.shop_profiles add constraint shop_profiles_verification_check
  check (verification_status in ('unverified', 'verified'));

-- Predefined windows only (§37) — policy stays small, not a policy builder.
alter table public.shop_profiles drop constraint if exists shop_profiles_window_check;
alter table public.shop_profiles add constraint shop_profiles_window_check
  check (return_window_days in (14, 30, 60));

drop trigger if exists shop_profiles_touch_updated_at on public.shop_profiles;
create trigger shop_profiles_touch_updated_at
  before update on public.shop_profiles
  for each row execute function public.touch_updated_at();

-- Reads are public (the storefront shows the policy and the badge); writes
-- are service-role only. Verification changes additionally go through the
-- audited admin action layer in app code.
alter table public.shop_profiles enable row level security;
revoke all on public.shop_profiles from anon, authenticated;
grant select on public.shop_profiles to anon, authenticated;

drop policy if exists "shop profiles readable" on public.shop_profiles;
create policy "shop profiles readable" on public.shop_profiles for select
  using (true);

-- ============================================================
-- listing_commercial_snapshot — freeze the shop return policy (§37)
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
  v_shop record;
  v_return_policy jsonb;
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

  -- Shop context (0056): the seller's verification state and — when they
  -- accept preference returns — the policy the buyer purchased under.
  select sp.verification_status, sp.returns_accepted, sp.return_window_days
    into v_shop
    from public.shop_profiles sp
   where sp.profile_id = v_listing.seller_id;

  if found then
    v_seller := v_seller || jsonb_build_object(
      'verified_shop', v_shop.verification_status = 'verified'
    );
    if v_shop.returns_accepted then
      v_return_policy := jsonb_build_object(
        'returns_accepted', true,
        'window_days', v_shop.return_window_days
      );
    end if;
  end if;

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
      'shipping_mode', case v_listing.shipping_mode
                         when 'drvn' then 'drvn_shipping'
                         when 'pickup_only' then 'pickup_only'
                         else 'seller_arranged'
                       end,
      'allows_collection', v_listing.allows_collection,
      'return_policy', v_return_policy
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
  if to_regclass('public.shop_profiles') is null then
    raise exception '0056: shop_profiles missing';
  end if;

  -- No client write policy may exist.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'shop_profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '0056: unexpected client write policy on shop_profiles';
  end if;

  if position('return_policy' in pg_get_functiondef(
       'public.listing_commercial_snapshot(uuid, int, int)'::regprocedure
     )) = 0
     or position('shop_profiles' in pg_get_functiondef(
       'public.listing_commercial_snapshot(uuid, int, int)'::regprocedure
     )) = 0 then
    raise exception '0056: snapshot does not freeze the shop return policy';
  end if;

  -- profiles.profile_type must still be guarded from self-escalation (0017).
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname like '%guard%'
  ) then
    raise exception '0056: profiles column guard trigger missing';
  end if;

  raise notice 'PASS: 0056 self-checks';
end $$;

commit;
