-- 0051 — Seller fulfillment profiles (transaction-completion brief §9).
--
-- DRVN Shipping needs a ship-from address to rate and buy labels, and the
-- marketplace needs it for every seller — individuals and shops alike. This
-- is PRIVATE fulfilment data: a person selling parts from their home must
-- never have that address exposed because they sell. It is deliberately a
-- separate table from profiles (whose rows are public-readable by column
-- grant) so no future profiles column-grant mistake can leak it.
--
-- One row per seller. The return address is optional and falls back to the
-- ship-from address when null. easypost_end_shipper_id preserves the
-- EasyPost EndShipper identity a platform account needs for USPS postage
-- (brief §10) — stored as an opaque provider reference, nullable so the
-- account-model decision (EndShipper vs Forge) stays open.
--
-- Access model, consistent with orders' shipping columns: reads via RLS
-- (owner or admin only — not even order counterparties), all writes via
-- service-role server actions which own validation. There is no client
-- INSERT/UPDATE/DELETE policy at all.
--
-- Deliberately NOT built (brief §3/§38): multi-warehouse, per-listing
-- ship-from overrides, team members.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.seller_fulfillment_profiles (
  seller_id uuid primary key references public.profiles (id) on delete cascade,
  ship_from_name text not null,
  company text,
  street1 text not null,
  street2 text,
  city text not null,
  state text,
  postal_code text not null,
  country text not null default 'US',
  phone text,
  -- Return address, only when different from ship-from.
  return_name text,
  return_street1 text,
  return_street2 text,
  return_city text,
  return_state text,
  return_postal_code text,
  return_country text,
  default_handling_days int not null default 2,
  easypost_end_shipper_id text,
  address_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.seller_fulfillment_profiles is
  'Private ship-from/return address + handling config per seller. Never public; never shown to buyers. Writes are service-role only.';

alter table public.seller_fulfillment_profiles
  drop constraint if exists sfp_handling_days_check;
alter table public.seller_fulfillment_profiles
  add constraint sfp_handling_days_check
  check (default_handling_days between 1 and 10);

-- Bounded free text — the server action validates content, the DB refuses
-- absurdity even from a bugged service-role write.
alter table public.seller_fulfillment_profiles
  drop constraint if exists sfp_field_lengths_check;
alter table public.seller_fulfillment_profiles
  add constraint sfp_field_lengths_check check (
    char_length(ship_from_name) between 1 and 80
    and (company is null or char_length(company) <= 80)
    and char_length(street1) between 1 and 120
    and (street2 is null or char_length(street2) <= 120)
    and char_length(city) between 1 and 80
    and (state is null or char_length(state) <= 40)
    and char_length(postal_code) between 1 and 20
    and char_length(country) = 2
    and (phone is null or char_length(phone) <= 30)
    and (return_country is null or char_length(return_country) = 2)
  );

-- A return address is all-or-nothing: a half-filled one would silently ship
-- returns to a mix of two addresses.
alter table public.seller_fulfillment_profiles
  drop constraint if exists sfp_return_address_complete_check;
alter table public.seller_fulfillment_profiles
  add constraint sfp_return_address_complete_check check (
    (return_street1 is null and return_city is null
      and return_postal_code is null and return_country is null)
    or (return_street1 is not null and return_city is not null
      and return_postal_code is not null and return_country is not null)
  );

drop trigger if exists seller_fulfillment_profiles_touch_updated_at
  on public.seller_fulfillment_profiles;
create trigger seller_fulfillment_profiles_touch_updated_at
  before update on public.seller_fulfillment_profiles
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS — owner/admin read; zero client write policies
-- ============================================================
alter table public.seller_fulfillment_profiles enable row level security;
revoke all on public.seller_fulfillment_profiles from anon, authenticated;
grant select on public.seller_fulfillment_profiles to authenticated;

drop policy if exists "owner reads fulfillment profile" on public.seller_fulfillment_profiles;
create policy "owner reads fulfillment profile" on public.seller_fulfillment_profiles for select
  using (seller_id = auth.uid() or public.is_admin());

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.seller_fulfillment_profiles') is null then
    raise exception '0051: seller_fulfillment_profiles missing';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seller_fulfillment_profiles'
      and policyname = 'owner reads fulfillment profile'
  ) then
    raise exception '0051: read policy missing';
  end if;

  -- No write policy may exist — writes are service-role only.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'seller_fulfillment_profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception '0051: unexpected client write policy on seller_fulfillment_profiles';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'seller_fulfillment_profiles_touch_updated_at'
      and tgrelid = 'public.seller_fulfillment_profiles'::regclass
  ) then
    raise exception '0051: touch trigger missing';
  end if;

  raise notice 'PASS: 0051 self-checks';
end $$;

commit;
