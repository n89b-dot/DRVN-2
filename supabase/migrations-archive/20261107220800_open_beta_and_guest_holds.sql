-- OS-W31 (Neil's ruling, 7 November 2026, N89 + beta: "Guest caps approved;
-- remove the invite-only beta").
--
-- 1. The invite-only beta is removed: its config, signup claims, the three
--    commerce guards (listings, offers, orders), the status and signup
--    functions, and the gated handle_new_user. Every account gets a profile
--    again, and accounts the beta left without one are repaired. Invitation
--    and membership rows stay as restricted history (admins read them; no
--    member does; nothing writes them any more). The agent rollout switches
--    (AGENTS_BETA, agent_beta_steps) are agent safety controls and stay.
--    private.beta_member_eligible stays as an always-true stub so the
--    functions that still call it (become_shop, claim_listing_creation,
--    owned by the listing-boundary work) needn't be redefined here; their
--    next redefinition can drop the call.
-- 2. Guest holds are capped atomically: a guest checkout is admitted by
--    guest_hold_admit before anything is reserved, under locks on the
--    device, the network and each listing — at most 2 live guest holds per
--    device and per network, and 1 live guest hold per listing. A hold is
--    live while its order awaits payment, or, before its order exists, for
--    15 minutes. Opening guest checkout (no beta gate) ships in the same
--    migration, so there is never a moment of uncapped guest holds.

begin;

-- ------------------------------------------------------------
-- 1. Remove the invite-only beta
-- ------------------------------------------------------------
drop trigger if exists listings_beta_commerce_guard on public.listings;
drop trigger if exists offers_beta_commerce_guard on public.offers;
drop trigger if exists orders_beta_commerce_guard on public.orders;
drop trigger if exists beta_membership_revocation_effects on public.beta_memberships;
drop trigger if exists beta_invitation_revocation_effects on public.beta_invitations;

drop function if exists private.guard_beta_listing_commerce();
drop function if exists private.guard_beta_offer_commerce();
drop function if exists private.guard_beta_order_commerce();
drop function if exists private.apply_beta_membership_revocation();
drop function if exists private.apply_beta_invitation_revocation();
drop function if exists public.prepare_beta_signup(text, text);
drop function if exists public.beta_access_status(uuid, text);

-- Every account gets its profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Kept for become_shop / claim_listing_creation: everyone signed in may sell
-- and buy now.
create or replace function private.beta_member_eligible(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null;
$$;

drop function if exists private.beta_access_enforced();
drop table if exists private.beta_signup_claims;
drop table if exists public.beta_access_config;

-- History stays, restricted: no member writes or reads it.
revoke insert, update, delete, truncate on public.beta_invitations, public.beta_memberships from anon, authenticated;
comment on table public.beta_invitations is 'History of the removed invite-only beta (OS-W31). Admin read only; nothing writes it.';
comment on table public.beta_memberships is 'History of the removed invite-only beta (OS-W31). Admin read only; nothing writes it.';

-- Accounts the gated handle_new_user left without a profile.
insert into public.profiles (id, display_name, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       u.raw_user_meta_data ->> 'avatar_url'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. Guest hold caps (N89)
-- ------------------------------------------------------------
create table if not exists public.guest_holds (
  id uuid primary key default gen_random_uuid(),
  -- One-way digests of the guest's device cookie and network, from the app.
  device_key text not null check (char_length(device_key) between 16 and 128),
  network_key text not null check (char_length(network_key) between 16 and 128),
  listing_id uuid not null references public.listings(id) on delete cascade,
  buyer_id uuid references public.profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  admitted_until timestamptz not null default now() + interval '15 minutes',
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists guest_holds_device_idx on public.guest_holds (device_key) where released_at is null;
create index if not exists guest_holds_network_idx on public.guest_holds (network_key) where released_at is null;
create index if not exists guest_holds_listing_idx on public.guest_holds (listing_id);
create index if not exists guest_holds_buyer_id_idx on public.guest_holds (buyer_id);
create index if not exists guest_holds_order_id_idx on public.guest_holds (order_id);

comment on table public.guest_holds is
  'N89: guest checkout holds, capped at 2 live per device and per network and 1 live per listing (guest_hold_admit). Service role only.';

alter table public.guest_holds enable row level security;
revoke all on public.guest_holds from anon, authenticated;

-- A hold is live while its order awaits payment, or — before the order
-- exists — until admitted_until.
create or replace function private.guest_hold_live(h public.guest_holds)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.released_at is null and (
    (h.order_id is null and h.admitted_until > now())
    or exists (select 1 from public.orders o where o.id = h.order_id and o.status in ('pending', 'requires_action'))
  );
$$;

revoke all on function private.guest_hold_live(public.guest_holds) from public, anon, authenticated;

create or replace function public.guest_hold_admit(p_device text, p_network text, p_listing_ids uuid[], p_buyer uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[] := '{}';
  v_listing uuid;
  v_existing uuid;
  v_new integer;
  v_device integer;
  v_network integer;
begin
  if p_device is null or p_network is null or p_listing_ids is null or cardinality(p_listing_ids) = 0 then
    raise exception 'A guest hold needs a device, a network and listings' using errcode = '22023';
  end if;
  -- One order of locks for everyone: device, network, then listings sorted.
  perform pg_advisory_xact_lock(hashtextextended('guest-device:' || p_device, 0));
  perform pg_advisory_xact_lock(hashtextextended('guest-network:' || p_network, 0));
  for v_listing in select distinct x from unnest(p_listing_ids) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('guest-listing:' || v_listing::text, 0));
  end loop;

  -- A replay of the same guest's checkout reuses its holds.
  select count(*) into v_new
    from (select distinct x from unnest(p_listing_ids) x) l
   where not exists (
     select 1 from public.guest_holds h
      where h.listing_id = l.x and h.device_key = p_device and private.guest_hold_live(h)
   );

  -- 1 live guest hold per listing: another guest's live hold refuses it.
  if exists (
    select 1 from public.guest_holds h
     where h.listing_id = any (p_listing_ids) and h.device_key <> p_device and private.guest_hold_live(h)
  ) then
    raise exception 'Another guest is checking out this part right now.' using errcode = 'GH409';
  end if;

  select count(*) into v_device from public.guest_holds h where h.device_key = p_device and private.guest_hold_live(h);
  select count(*) into v_network from public.guest_holds h where h.network_key = p_network and private.guest_hold_live(h);
  if v_device + v_new > 2 or v_network + v_new > 2 then
    raise exception 'Guest checkout holds up to 2 parts at a time. Sign in to buy more, or finish paying first.'
      using errcode = 'GH429';
  end if;

  for v_listing in select distinct x from unnest(p_listing_ids) x order by x loop
    select h.id into v_existing from public.guest_holds h
     where h.listing_id = v_listing and h.device_key = p_device and private.guest_hold_live(h)
     limit 1;
    if v_existing is null then
      insert into public.guest_holds (device_key, network_key, listing_id, buyer_id)
      values (p_device, p_network, v_listing, p_buyer)
      returning id into v_existing;
    end if;
    v_ids := v_ids || v_existing;
    v_existing := null;
  end loop;
  return v_ids;
end;
$$;

-- After purchase_begin: each hold points at the order that holds its listing.
create or replace function public.guest_hold_bind(p_hold_ids uuid[], p_buyer uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with bound as (
    update public.guest_holds h
       set order_id = (
         select o.id from public.order_items oi join public.orders o on o.id = oi.order_id
          where oi.listing_id = h.listing_id and o.buyer_id = p_buyer
          order by o.created_at desc limit 1)
     where h.id = any (p_hold_ids) and h.released_at is null
    returning 1
  )
  select count(*)::integer from bound;
$$;

-- A checkout that reserved nothing gives its admission back at once.
create or replace function public.guest_hold_release(p_hold_ids uuid[])
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with released as (
    update public.guest_holds set released_at = now()
     where id = any (p_hold_ids) and order_id is null and released_at is null
    returning 1
  )
  select count(*)::integer from released;
$$;

revoke all on function public.guest_hold_admit(text, text, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.guest_hold_bind(uuid[], uuid) from public, anon, authenticated;
revoke all on function public.guest_hold_release(uuid[]) from public, anon, authenticated;
grant execute on function public.guest_hold_admit(text, text, uuid[], uuid) to service_role;
grant execute on function public.guest_hold_bind(uuid[], uuid) to service_role;
grant execute on function public.guest_hold_release(uuid[]) to service_role;

notify pgrst, 'reload schema';
commit;
