-- 20260919201000 — security repairs from the direction-build review.
--
-- Nothing here adds a feature. Each block closes a hole the review found in
-- 20260919170000–200000, in the order a stranger could have used them.
--
-- Idempotent.

begin;

-- ============================================================
-- 1. A seller's lowest offer is theirs alone (P-9)
-- ============================================================
-- 196000 granted select on `default_offer_floor_pct` to anon and
-- authenticated beside country and region. The profiles select policy is
-- `using (true)`, and a column grant cannot be narrowed to "your own row",
-- so every buyer could read the number they needed to bid. The column
-- leaves the client grant entirely (the 0017 pattern) and the owner reads
-- it through a function that can only ever answer about themselves.
revoke select (default_offer_floor_pct) on public.profiles from anon, authenticated;

create or replace function public.my_default_offer_floor()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.default_offer_floor_pct::integer
    from public.profiles p
   where p.id = auth.uid();
$$;

comment on function public.my_default_offer_floor() is
  'The caller''s own default lowest offer (P-9). The column has no client select grant: a floor a buyer can read is not a floor.';

revoke all on function public.my_default_offer_floor() from public, anon;
grant execute on function public.my_default_offer_floor() to authenticated, service_role;

-- ============================================================
-- 2. Execute grants lost when functions were re-created
-- ============================================================
-- 194000 dropped the 8-argument writer — which carried its revoke — and
-- neither it nor 199000 restored one on the 9-argument replacement.
revoke all on function public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text, uuid[])
  from public, anon;
grant execute on function public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text, uuid[])
  to authenticated, service_role;

-- `post_href` is security definer and answers for ANY post id, so it named
-- the slug of a private car to whoever asked. Only the notification
-- triggers need it, and they run as their owner; the app has postHref().
revoke all on function public.post_href(uuid) from public, anon, authenticated;
grant execute on function public.post_href(uuid) to service_role;

-- Local is a signed-in Home tab. Nothing signed-out asks for it.
revoke all on function public.local_feed_rows(text, text) from public, anon;
grant execute on function public.local_feed_rows(text, text) to authenticated, service_role;

-- ============================================================
-- 3. Builders to follow never rendered
-- ============================================================
-- The function is security invoker and filtered `p.suspended_at`, a column
-- no client role may read, so every call failed and both callers swallowed
-- the error. `profile_is_visible()` is the definer helper 20260913012911
-- added for exactly this.
create or replace function public.suggested_builders(p_viewer uuid default null, p_limit int default 6)
returns table(
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  headline text,
  car_count bigint,
  update_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.headline,
    count(distinct c.id) as car_count,
    count(distinct a.id) as update_count
  from public.profiles p
  join public.cars c
    on c.owner_id = p.id and c.is_public and c.cover_image_url is not null
  left join public.activity_posts a
    on a.car_id = c.id and a.published_at is not null
  where p.username is not null
    and public.profile_is_visible(p.id)
    and (p_viewer is null or p.id <> p_viewer)
    -- A signed-out visitor follows nobody, so nothing is excluded.
    and not exists (
      select 1 from public.follows f
       where p_viewer is not null
         and f.follower_id = p_viewer
         and f.target_type = 'profile'
         and f.target_id = p.id
    )
  group by p.id, p.username, p.display_name, p.avatar_url, p.headline
  order by count(distinct c.id) desc, count(distinct a.id) desc, p.id
  limit greatest(1, least(p_limit, 24));
$$;

revoke all on function public.suggested_builders(uuid, int) from public;
grant execute on function public.suggested_builders(uuid, int) to anon, authenticated, service_role;

-- ============================================================
-- 4. Tagged parts: own, active, at most three, and never the last subject
-- ============================================================
-- Tags were world-readable whatever the post's visibility, so a draft's or
-- a private build's tags could be listed by anyone.
drop policy if exists "tagged parts are public" on public.activity_post_listings;
drop policy if exists "tagged parts follow the post" on public.activity_post_listings;
create policy "tagged parts follow the post" on public.activity_post_listings
  for select to anon, authenticated
  using (public.activity_post_visible(post_id));

-- The sync is callable directly, so everything the writer promises has to
-- hold here too: the cap of three lived only in the writer, and a sold or
-- reserved part could be tagged fresh. A part that was ALREADY tagged keeps
-- its tag whatever its status — that is how a post comes to say "Sold" —
-- and a carless post may not be left with nothing to be about.
create or replace function public.sync_activity_post_listings(
  p_post_id uuid,
  p_listing_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
  v_car uuid;
  v_published timestamptz;
  v_before uuid[];
  v_count int;
begin
  select author_id, car_id, published_at
    into v_author, v_car, v_published
    from public.activity_posts where id = p_post_id;
  if v_author is null or v_author is distinct from auth.uid() then
    return;
  end if;

  select coalesce(array_agg(listing_id), '{}') into v_before
    from public.activity_post_listings where post_id = p_post_id;

  delete from public.activity_post_listings where post_id = p_post_id;

  insert into public.activity_post_listings (post_id, listing_id, position)
  select p_post_id, picked.id, picked.ordinality - 1
    from (
      select l.id, tagged.ordinality
        from unnest(coalesce(p_listing_ids, '{}')) with ordinality as tagged(listing_id, ordinality)
        join public.listings l
          on l.id = tagged.listing_id
         and l.seller_id = v_author
         and (l.status = 'active' or l.id = any (v_before))
       order by tagged.ordinality
       limit 3
    ) picked
  on conflict do nothing;

  get diagnostics v_count = row_count;
  if v_count = 0 and v_car is null and v_published is not null then
    raise exception 'A post needs a car, a tagged part, or both.' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.sync_activity_post_listings(uuid, uuid[]) from public, anon;
grant execute on function public.sync_activity_post_listings(uuid, uuid[]) to authenticated, service_role;

-- ============================================================
-- 5. A purchase can only be claimed by the person who made it (C-1)
-- ============================================================
-- "owners manage mods" is `for all`, so any car owner could write any
-- order item id onto their own mod: a seller could pre-claim a sale and
-- lock the real buyer out behind the unique index, or forge "Bought on
-- DRVN". The rule the server action checks now also holds in the table.
create or replace function public.guard_mod_purchase_claim()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_order_item_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.source_order_item_id is not distinct from old.source_order_item_id then
    return new;
  end if;
  -- Workers and migrations act without a session.
  if auth.uid() is null then
    return new;
  end if;
  if not exists (
    select 1
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where i.id = new.source_order_item_id
       and o.buyer_id = auth.uid()
       and o.status in ('delivered', 'completed')
  ) then
    raise exception 'That purchase isn''t yours to add.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_mod_purchase_claim on public.mod_items;
create trigger guard_mod_purchase_claim
  before insert or update of source_order_item_id on public.mod_items
  for each row execute function public.guard_mod_purchase_claim();

-- The public build page shows "Bought on DRVN · off {car}", but
-- `order_items` is readable only by the buyer and seller, so everyone else
-- saw nothing. This answers one narrow question — which car did this
-- fitted part come off — and only for order items a mod actually points
-- at, so it is no window onto anybody's orders. Whether that car may be
-- NAMED is still decided by the caller's own read of `cars`.
create or replace function public.mod_purchase_sources(p_order_item_ids uuid[])
returns table(order_item_id uuid, source_car_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id,
         nullif(i.commercial_snapshot -> 'source_car' ->> 'id', '')::uuid
    from public.order_items i
   where i.id = any (p_order_item_ids)
     and exists (select 1 from public.mod_items m where m.source_order_item_id = i.id);
$$;

revoke all on function public.mod_purchase_sources(uuid[]) from public;
grant execute on function public.mod_purchase_sources(uuid[]) to anon, authenticated, service_role;

-- ============================================================
-- 6. What a pasted link may store (L-1…L-4)
-- ============================================================
-- These three columns render on a public page and were taken from the
-- client as typed. The action validates them; the table refuses the rest,
-- because the same policy lets an owner write them through the API.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mod_items_product_url_http') then
    alter table public.mod_items
      add constraint mod_items_product_url_http
      check (product_url is null or product_url ~* '^https?://[^[:space:]]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mod_items_image_url_https') then
    alter table public.mod_items
      add constraint mod_items_image_url_https
      check (image_url is null or image_url ~ '^https://[^[:space:]]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mod_items_source_domain_shape') then
    alter table public.mod_items
      add constraint mod_items_source_domain_shape
      check (source_domain is null or source_domain ~* '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$');
  end if;
end;
$$;

commit;
