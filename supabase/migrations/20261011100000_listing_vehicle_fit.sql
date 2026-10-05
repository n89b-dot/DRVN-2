-- The vehicle filter and "fits my garage", answered from the vehicle.
--
-- WHAT A SHOPPER SEES DOES NOT CHANGE. marketplace_match_evidence stays the
-- definition of which part fits which car; supabase/tests/vehicle_fit_guard.sql
-- holds the new path to it, part for part.
--
-- What changes is the direction of the question. Until now the filter asked,
-- for every part for sale, "does this part fit the chosen car?" — several
-- lookups a part, before the first page could be shown and again to count
-- them. At 200,000 parts that already timed out for every car
-- (docs/performance/query-plans.md). Now each part for sale carries a few
-- rows saying which makes and models it fits, kept up to date by triggers,
-- and the filter reads the rows for the chosen car straight off an index,
-- newest (or cheapest) first.
--
-- One row per (part, make, model, how we know):
--   stated  the seller listed this make and model as a fitment. years holds
--           every year range they gave (unbounded where they gave none);
--           all_years says one of them named no years at all.
--   car     the part came off a car of this make and model. stated_also
--           says the seller ALSO stated this make and model — then their
--           statement decides and the source car does not count.
-- Each part also gets make-level rows (model_key = '') for a filter that
-- names a make and no model. Only parts for sale have rows.
--
-- Who may read the rows: the same people who may read the part and its
-- stated fitments. A "car" row for a private car is visible only to that
-- car's owner, so the table never says what a private car is. Clients read
-- it, they never write it: the trigger functions are the only writers.

create table if not exists public.listing_vehicle_fit (
  listing_id uuid not null references public.listings(id) on delete cascade,
  make_key text not null,
  model_key text not null,
  via text not null check (via in ('stated', 'car')),
  years int4multirange,
  all_years boolean not null default false,
  stated_also boolean not null default false,
  car_public boolean not null default true,
  car_owner_id uuid,
  seller_id uuid not null,
  created_at timestamptz not null,
  price_cents integer not null,
  primary key (listing_id, make_key, model_key, via)
);

-- Newest first, cheapest first, dearest first — each a range read for one car.
-- The newest index carries every column the match rule reads, so a page or
-- a count for one car is read from the index alone (at 2M parts, a count
-- for the commonest car read the table from disk: half a second).
create index if not exists listing_vehicle_fit_newest_idx
  on public.listing_vehicle_fit (make_key, model_key, created_at desc, listing_id desc)
  include (via, years, all_years, stated_also, car_public, car_owner_id, seller_id);
create index if not exists listing_vehicle_fit_price_idx
  on public.listing_vehicle_fit (make_key, model_key, price_cents, listing_id);

-- Rows change with every price change and sale: vacuum and re-analyse it
-- after 5% / 2% of it changes rather than the default 20% / 10%.
alter table public.listing_vehicle_fit set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

alter table public.listing_vehicle_fit enable row level security;
revoke all on table public.listing_vehicle_fit from public, anon, authenticated;
grant select on table public.listing_vehicle_fit to anon, authenticated;
grant all on table public.listing_vehicle_fit to service_role;

drop policy if exists "vehicle fit follows the part" on public.listing_vehicle_fit;
create policy "vehicle fit follows the part" on public.listing_vehicle_fit
  for select to anon, authenticated
  using ((via = 'stated' or car_public or car_owner_id = (select auth.uid()))
         and (seller_id = (select auth.uid())
              or seller_id not in (select public.suspended_profile_ids())));

-- Recompute these parts' rows from each part, its stated fitments and its
-- source car, in one statement. Locks the parts first (in id order), so two
-- writers touching the same part — a fitment edit and a status change, say —
-- take turns, and the second computes from what the first committed.
create or replace function public.refresh_listing_vehicle_fit(p_listings uuid[], p_lock boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_lock then
    perform 1 from public.listings l where l.id = any(p_listings) order by l.id for update;
  end if;
  delete from public.listing_vehicle_fit where listing_id = any(p_listings);
  insert into public.listing_vehicle_fit
    (listing_id, make_key, model_key, via, years, all_years, stated_also, car_public, car_owner_id,
     seller_id, created_at, price_cents)
  with parts as (
    select l.id, l.seller_id, l.source_car_id, l.created_at, l.price_cents
    from public.listings l
    where l.id = any(p_listings) and l.status = 'active'
  ),
  stated as (
    select p.id, lower(f.make) as make_key, k.model_key,
           range_agg(int4range(f.year_start, f.year_end, '[]')) as years,
           bool_or(f.year_start is null and f.year_end is null) as all_years
    from parts p
    join public.listing_fitments f on f.listing_id = p.id
    cross join lateral (values (lower(f.model)), ('')) k(model_key)
    group by p.id, lower(f.make), k.model_key
  ),
  from_car as (
    select distinct p.id, lower(c.make) as make_key, k.model_key, c.is_public, c.owner_id
    from parts p
    join public.cars c on c.id = p.source_car_id
    cross join lateral (values (coalesce(lower(c.model), '')), ('')) k(model_key)
    where c.make is not null
  )
  select s.id, s.make_key, s.model_key, 'stated', s.years, s.all_years, false, true, null,
         p.seller_id, p.created_at, p.price_cents
  from stated s join parts p on p.id = s.id
  union all
  select c.id, c.make_key, c.model_key, 'car', null, false,
         s.id is not null,
         c.is_public, c.owner_id, p.seller_id, p.created_at, p.price_cents
  from from_car c
  join parts p on p.id = c.id
  -- A join, not a lookup per row: refreshing every part at once (the
  -- backfill) must stay linear.
  left join stated s on s.id = c.id and s.make_key = c.make_key and s.model_key = c.model_key;
end;
$function$;
revoke all on function public.refresh_listing_vehicle_fit(uuid[], boolean) from public, anon, authenticated;

create or replace function public.listing_vehicle_fit_from_listing()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- A new price, date or seller on a part still for sale off the same car:
  -- the rows stay, only those columns change (cheaper than recomputing).
  if tg_op = 'UPDATE' and old.status = new.status and old.source_car_id is not distinct from new.source_car_id then
    update public.listing_vehicle_fit
       set price_cents = new.price_cents, created_at = new.created_at, seller_id = new.seller_id
     where listing_id = new.id;
    return null;
  end if;
  perform public.refresh_listing_vehicle_fit(array[new.id]);
  return null;
end;
$function$;
revoke all on function public.listing_vehicle_fit_from_listing() from public, anon, authenticated;

-- Once per statement, over every part the statement touched: an edit that
-- replaces five fitments recomputes the part once, not five times.
create or replace function public.listing_vehicle_fit_from_fitment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_listing_vehicle_fit(array(select distinct listing_id from changed_new));
  elsif tg_op = 'DELETE' then
    perform public.refresh_listing_vehicle_fit(array(select distinct listing_id from changed_old));
  else
    perform public.refresh_listing_vehicle_fit(array(
      select listing_id from changed_old union select listing_id from changed_new));
  end if;
  return null;
end;
$function$;
revoke all on function public.listing_vehicle_fit_from_fitment() from public, anon, authenticated;

create or replace function public.listing_vehicle_fit_from_car()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.refresh_listing_vehicle_fit(array(
    select l.id from public.listings l where l.source_car_id = new.id and l.status = 'active'));
  return null;
end;
$function$;
revoke all on function public.listing_vehicle_fit_from_car() from public, anon, authenticated;

-- A part's rows change with its status, seller, source car, date or price;
-- an edit that leaves all five alone (most edits, and every view count) does
-- no work here. A deleted part's rows go with it (on delete cascade).
drop trigger if exists listing_vehicle_fit_listing on public.listings;
drop trigger if exists listing_vehicle_fit_listing_insert on public.listings;
create trigger listing_vehicle_fit_listing_insert
  after insert on public.listings
  for each row when (new.status = 'active')
  execute function public.listing_vehicle_fit_from_listing();
drop trigger if exists listing_vehicle_fit_listing_update on public.listings;
create trigger listing_vehicle_fit_listing_update
  after update of status, seller_id, source_car_id, created_at, price_cents on public.listings
  for each row
  when ((old.status = 'active' or new.status = 'active')
        and (old.status is distinct from new.status or old.seller_id is distinct from new.seller_id
             or old.source_car_id is distinct from new.source_car_id
             or old.created_at is distinct from new.created_at or old.price_cents is distinct from new.price_cents))
  execute function public.listing_vehicle_fit_from_listing();

drop trigger if exists listing_vehicle_fit_fitment on public.listing_fitments;
drop trigger if exists listing_vehicle_fit_fitment_insert on public.listing_fitments;
create trigger listing_vehicle_fit_fitment_insert
  after insert on public.listing_fitments referencing new table as changed_new
  for each statement execute function public.listing_vehicle_fit_from_fitment();
drop trigger if exists listing_vehicle_fit_fitment_update on public.listing_fitments;
create trigger listing_vehicle_fit_fitment_update
  after update on public.listing_fitments referencing old table as changed_old new table as changed_new
  for each statement execute function public.listing_vehicle_fit_from_fitment();
drop trigger if exists listing_vehicle_fit_fitment_delete on public.listing_fitments;
create trigger listing_vehicle_fit_fitment_delete
  after delete on public.listing_fitments referencing old table as changed_old
  for each statement execute function public.listing_vehicle_fit_from_fitment();

drop trigger if exists listing_vehicle_fit_car on public.cars;
create trigger listing_vehicle_fit_car
  after update of make, model, is_public, owner_id on public.cars
  for each row
  when (old.make is distinct from new.make or old.model is distinct from new.model
        or old.is_public is distinct from new.is_public or old.owner_id is distinct from new.owner_id)
  execute function public.listing_vehicle_fit_from_car();

-- ── Browse and search read the rows ─────────────────────────────────────
--
-- Restated from 20261010100000 with two clauses changed: the vehicle filter
-- and "fits my garage" ask listing_vehicle_fit instead of running
-- marketplace_match_evidence per part. The rule is the same, written over
-- the rows:
--   stated  matches when no year was asked, or the year is in a stated range
--           (the evidence function's seller_stated / year_needed); for a
--           garage car with no year, only a statement naming no years counts
--           (seller_stated without year_needed, as before).
--   car     matches only when the seller stated nothing for that make and
--           model (a statement outside the year rules the car out, as
--           outside_years did), and the car is public or the viewer's own,
--           and its owner is not suspended or is the viewer.
-- vehicle_fit_guard.sql holds both functions to the evidence function.

create or replace function public.marketplace_browse_rows(
  p_query text default ''::text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.listings l where l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(m.name) and v.model_key=coalesce(lower(mo.name),'')
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when v.via='stated' then p_vyear=0 or v.years @> p_vyear
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(g.make) and v.model_key=lower(g.model)
   where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when v.via='stated' then case when coalesce(g.year,0)=0 then v.all_years else v.years @> g.year end
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end))
 and (trim(p_query)='' or l.id in(select public.marketplace_search_ids(p_query)));
$function$;

create or replace function public.marketplace_search_browse_rows(
  p_query text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.marketplace_search_ids(p_query) s(id) join public.listings l on l.id=s.id
 where trim(p_query)<>'' and l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(m.name) and v.model_key=coalesce(lower(mo.name),'')
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when v.via='stated' then p_vyear=0 or v.years @> p_vyear
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g
   join public.listing_vehicle_fit v on v.listing_id=l.id and v.make_key=lower(g.make) and v.model_key=lower(g.model)
   where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when v.via='stated' then case when coalesce(g.year,0)=0 then v.all_years else v.years @> g.year end
     else not v.stated_also and (v.car_public or v.car_owner_id=p_viewer)
       and (v.car_owner_id=v.seller_id or v.car_owner_id=p_viewer or v.car_owner_id not in (select public.suspended_profile_ids())) end));
$function$;

-- The parts already for sale. The triggers above hold off every write to
-- parts, fitments and cars until this commits, so nothing changes under it;
-- at today's size it takes well under a second (a minute at 2M parts).
truncate public.listing_vehicle_fit;
select public.refresh_listing_vehicle_fit(array(select id from public.listings where status = 'active'), false);
analyze public.listing_vehicle_fit;
