-- OS-W28 OS-R-arrival: a counted listing view records where it came from.
--
-- PRD §6 measures "listing views arriving from a car, profile or post" and
-- store visits, but a view was only `listings.view_count + 1`
-- (bump_listing_view, 0012): nothing said what the viewer had been looking
-- at. record_listing_view counts the view under exactly the same rules —
-- members only, never the seller's own, one per member per listing per
-- hour, active or sold listings — and adds it to a daily count per arrival
-- surface. The count holds no viewer id, so it measures surfaces, not
-- people. The app classifies the arrival (src/lib/marketplace/arrival.ts);
-- the check below is the same list.
--
-- bump_listing_view is left as it is (not redefined); the listing page
-- calls record_listing_view instead.

begin;

create table if not exists public.listing_view_arrivals (
  listing_id uuid not null references public.listings(id) on delete cascade,
  day date not null,
  arrival text not null check (arrival in (
    'car', 'post', 'profile', 'store', 'marketplace', 'explore', 'home', 'front',
    'saved', 'listing', 'agent', 'other', 'external', 'direct'
  )),
  views integer not null default 0 check (views >= 0),
  primary key (listing_id, day, arrival)
);

create index if not exists listing_view_arrivals_day_idx on public.listing_view_arrivals (day, arrival);

comment on table public.listing_view_arrivals is
  'OS-R-arrival: counted listing views per listing, day and arrival surface. No viewer ids. Written only by record_listing_view.';

alter table public.listing_view_arrivals enable row level security;
revoke all on public.listing_view_arrivals from anon, authenticated;

create or replace function public.record_listing_view(p_listing uuid, p_arrival text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_counted int;
  v_arrival text := case
    when p_arrival in ('car', 'post', 'profile', 'store', 'marketplace', 'explore', 'home', 'front',
                       'saved', 'listing', 'agent', 'other', 'external', 'direct') then p_arrival
    else 'other'
  end;
begin
  if (select auth.uid()) is null or p_listing is null then
    return false;
  end if;

  -- Same rule as bump_listing_view: one counted view per member per
  -- listing per hour, and the same key, so the two never double count.
  if not public.consume_rate_limit(
       'view:' || p_listing::text || ':' || (select auth.uid())::text, 1, interval '1 hour'
     ) then
    return false;
  end if;

  update public.listings
     set view_count = coalesce(view_count, 0) + 1
   where id = p_listing and status in ('active', 'sold') and seller_id <> (select auth.uid());
  get diagnostics v_counted = row_count;
  if v_counted = 0 then
    return false;
  end if;

  insert into public.listing_view_arrivals as a (listing_id, day, arrival, views)
  values (p_listing, (now() at time zone 'utc')::date, v_arrival, 1)
  on conflict (listing_id, day, arrival) do update set views = a.views + 1;
  return true;
end;
$$;

revoke all on function public.record_listing_view(uuid, text) from public, anon;
grant execute on function public.record_listing_view(uuid, text) to authenticated;

comment on function public.record_listing_view(uuid, text) is
  'OS-R-arrival: counts a member''s view of a listing (bump_listing_view''s rules) and the surface it arrived from.';

commit;
