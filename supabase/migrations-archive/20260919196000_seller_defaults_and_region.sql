-- 20260919196000 — a seller's offer floor, and where a member is
-- (PRD 2026-09 P-9, H-2; build plan M6).
--
-- P-9, `default_offer_floor_pct`: a seller who will not go below 80% says so
-- once instead of doing the arithmetic on every listing. It is a DEFAULT —
-- it fills the field on the sell form and every listing keeps its own
-- `offer_floor_cents`, because a floor that moved when somebody edited a
-- setting would silently change what a live listing accepts.
--
-- H-2, `country` + `region`: Local is a Home tab, shown once a member has
-- said where they are. Deliberately coarse — country plus a region, not a
-- town and never a coordinate. "Parts near me" wants the right ballpark;
-- anything finer is a location-sharing feature, which this is not, and the
-- PRD rules location tags out.
--
-- Column-level grants, per the 0017 pattern.
--
-- Idempotent.

begin;

alter table public.profiles
  add column if not exists default_offer_floor_pct smallint,
  add column if not exists country text,
  add column if not exists region text;

comment on column public.profiles.default_offer_floor_pct is
  'Seller default (P-9): the lowest share of the asking price they will consider, as a percentage. Prefills the sell form; never changes a live listing.';
comment on column public.profiles.country is
  'ISO-3166-1 alpha-2. Coarse on purpose — Local needs the right ballpark, not a town.';
comment on column public.profiles.region is
  'A region within the country (state, county, prefecture). Free text against src/lib/geo/regions.ts.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_offer_floor_pct_check') then
    alter table public.profiles
      add constraint profiles_offer_floor_pct_check
      check (default_offer_floor_pct is null
             or default_offer_floor_pct between 10 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_check') then
    alter table public.profiles
      add constraint profiles_country_check
      check (country is null or country ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_region_length') then
    alter table public.profiles
      add constraint profiles_region_length
      check (region is null or length(region) <= 80);
  end if;
  -- A region without a country is not an answer.
  if not exists (select 1 from pg_constraint where conname = 'profiles_region_needs_country') then
    alter table public.profiles
      add constraint profiles_region_needs_country
      check (region is null or country is not null);
  end if;
end;
$$;

grant select (default_offer_floor_pct, country, region) on public.profiles to anon, authenticated;
grant update (default_offer_floor_pct, country, region) on public.profiles to authenticated;

-- ============================================================
-- H-2 — Local
-- ============================================================
-- The feed view carries no owner, so "near me" can't be asked of it. One
-- more column on the projection rather than a second view: Local is the
-- same feed with one more filter, and two views would drift.
create or replace function public.local_feed_rows(p_country text, p_region text default null)
returns table(kind text, id uuid, happened_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select 'car'::text, c.id, c.created_at
    from public.cars c
    join public.profiles p on p.id = c.owner_id
   where c.is_public
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  union all
  select 'update'::text, a.id, a.published_at
    from public.activity_posts a
    join public.cars c on c.id = a.car_id and c.is_public
    join public.profiles p on p.id = a.author_id
   where a.published_at is not null
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  union all
  select 'part'::text, l.id, l.created_at
    from public.listings l
    join public.profiles p on p.id = l.seller_id
   where l.status = 'active'
     and p.country = p_country
     and (p_region is null or p.region = p_region)
  order by 3 desc, 2 desc;
$$;

revoke all on function public.local_feed_rows(text, text) from public;
grant execute on function public.local_feed_rows(text, text) to anon, authenticated, service_role;

commit;
