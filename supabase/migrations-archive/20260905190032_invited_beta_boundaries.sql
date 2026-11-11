-- R01 — invited beta membership and database commerce boundaries.
--
-- The rollout switch is data, not a JWT/user-metadata claim. It is inserted
-- disabled so applying this migration cannot silently change a hosted site's
-- signup behavior. Once an operator explicitly enables it, deleting the row
-- or otherwise losing the setting fails closed: beta_access_enforced() treats
-- a missing value as true.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.beta_access_config (
  singleton boolean primary key default true check (singleton),
  enforced boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.beta_access_config (singleton, enforced)
values (true, false)
on conflict (singleton) do nothing;

create table public.beta_invitations (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  roles text[] not null default array['buyer', 'seller']::text[],
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  constraint beta_invitations_email_normalized check (
    email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 320
    and position('@' in email_normalized) > 1
  ),
  constraint beta_invitations_roles check (
    cardinality(roles) between 1 and 2
    and roles <@ array['buyer', 'seller']::text[]
  ),
  constraint beta_invitations_token_hash check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint beta_invitations_consumption_pair check (
    (consumed_at is null) = (consumed_by is null)
  ),
  constraint beta_invitations_revocation_pair check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null)
  )
);

create index beta_invitations_email_idx on public.beta_invitations (email_normalized);
create index beta_invitations_open_idx on public.beta_invitations (expires_at)
  where consumed_at is null and revoked_at is null;

create table public.beta_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invitation_id uuid not null unique references public.beta_invitations (id),
  email_normalized text not null,
  roles text[] not null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  constraint beta_memberships_email_normalized check (
    email_normalized = lower(btrim(email_normalized))
  ),
  constraint beta_memberships_roles check (
    cardinality(roles) between 1 and 2
    and roles <@ array['buyer', 'seller']::text[]
  ),
  constraint beta_memberships_revocation_pair check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null)
  )
);

-- Short-lived server-issued capabilities bridge the invitation check and the
-- Auth user insert. raw_user_meta_data only carries the random claim id; it
-- grants nothing unless this private row exists and matches the Auth email.
create table private.beta_signup_claims (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.beta_invitations (id) on delete cascade,
  email_normalized text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);

alter table public.beta_access_config enable row level security;
alter table public.beta_invitations enable row level security;
alter table public.beta_memberships enable row level security;
alter table private.beta_signup_claims enable row level security;

revoke all on public.beta_access_config from anon, authenticated;
revoke all on public.beta_invitations from anon, authenticated;
revoke all on public.beta_memberships from anon, authenticated;
revoke all on private.beta_signup_claims from public, anon, authenticated;

grant select on public.beta_access_config, public.beta_invitations, public.beta_memberships
  to authenticated;

create policy "admins read beta config" on public.beta_access_config
  for select to authenticated using ((select public.is_admin()));
create policy "admins read beta invitations" on public.beta_invitations
  for select to authenticated using ((select public.is_admin()));
create policy "admins read beta memberships" on public.beta_memberships
  for select to authenticated using ((select public.is_admin()));

create or replace function private.beta_access_enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select enforced from public.beta_access_config where singleton = true),
    true
  );
$$;

create or replace function private.beta_member_eligible(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.beta_access_enforced()
    or exists (
      select 1
      from public.beta_memberships m
      where m.user_id = p_user_id
        and m.revoked_at is null
        and p_role = any (m.roles)
    );
$$;

revoke all on function private.beta_access_enforced() from public, anon, authenticated;
revoke all on function private.beta_member_eligible(uuid, text) from public, anon, authenticated;

-- Server-only status API. Query errors are handled fail-closed by the app too.
create or replace function public.beta_access_status(p_user_id uuid default null, p_role text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enforced', private.beta_access_enforced(),
    'eligible', case
      when not private.beta_access_enforced() then true
      when p_user_id is null or p_role not in ('buyer', 'seller') then false
      else private.beta_member_eligible(p_user_id, p_role)
    end
  );
$$;

revoke all on function public.beta_access_status(uuid, text) from public, anon, authenticated;
grant execute on function public.beta_access_status(uuid, text) to service_role;

-- Validate the token hash and normalized email before the Auth call. The
-- generic error deliberately does not reveal which invitation attribute was
-- wrong. Only the service role can mint a claim.
create or replace function public.prepare_beta_signup(p_token_hash text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_invitation public.beta_invitations%rowtype;
  v_claim uuid;
begin
  if not private.beta_access_enforced() then
    return null;
  end if;

  delete from private.beta_signup_claims where expires_at <= now();

  select * into v_invitation
  from public.beta_invitations
  where token_hash = lower(coalesce(p_token_hash, ''))
  for update;

  if not found
     or v_invitation.email_normalized <> v_email
     or v_invitation.expires_at <= now()
     or v_invitation.revoked_at is not null
     or v_invitation.consumed_at is not null then
    raise exception 'Invitation is unavailable'
      using errcode = 'P0001';
  end if;

  delete from private.beta_signup_claims where invitation_id = v_invitation.id;
  insert into private.beta_signup_claims (invitation_id, email_normalized)
  values (v_invitation.id, v_email)
  returning id into v_claim;
  return v_claim;
end;
$$;

revoke all on function public.prepare_beta_signup(text, text) from public, anon, authenticated;
grant execute on function public.prepare_beta_signup(text, text) to service_role;

-- Preserve normal open signup while the rollout setting is explicitly off.
-- With the beta on, only a server-issued claim matching this exact Auth email
-- creates the profile/membership. Direct Auth signups may create auth.users,
-- but they cannot join or publish a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_id uuid;
  v_claim private.beta_signup_claims%rowtype;
  v_invitation public.beta_invitations%rowtype;
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  if not private.beta_access_enforced() then
    insert into public.profiles (id, display_name, avatar_url)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      new.raw_user_meta_data ->> 'avatar_url'
    );
    return new;
  end if;

  begin
    v_claim_id := nullif(new.raw_user_meta_data ->> 'beta_claim_id', '')::uuid;
  exception when invalid_text_representation then
    return new;
  end;
  if v_claim_id is null then return new; end if;

  select * into v_claim
  from private.beta_signup_claims
  where id = v_claim_id and expires_at > now()
  for update;
  if not found or v_claim.email_normalized <> v_email then return new; end if;

  select * into v_invitation
  from public.beta_invitations
  where id = v_claim.invitation_id
    and email_normalized = v_email
    and expires_at > now()
    and revoked_at is null
    and consumed_at is null
  for update;
  if not found then return new; end if;

  update public.beta_invitations
  set consumed_at = now(), consumed_by = new.id
  where id = v_invitation.id and consumed_at is null and revoked_at is null;
  if not found then return new; end if;

  insert into public.beta_memberships (user_id, invitation_id, email_normalized, roles)
  values (new.id, v_invitation.id, v_email, v_invitation.roles);

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  delete from private.beta_signup_claims where id = v_claim.id;
  return new;
end;
$$;

-- Database backstops for direct PostgREST writes and service-role/RPC paths.
-- Updates required to finish or support an existing order remain untouched.
create or replace function private.guard_beta_listing_commerce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.beta_access_enforced()
     and (
       tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and new.status = 'active' and old.status is distinct from 'active')
     )
     and not private.beta_member_eligible(new.seller_id, 'seller') then
    raise exception 'Beta seller access required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_beta_offer_commerce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid;
begin
  select seller_id into v_seller from public.listings where id = new.listing_id;
  if private.beta_access_enforced()
     and (
       tg_op = 'INSERT'
       or (tg_op = 'UPDATE' and new.status in ('countered', 'accepted') and new.status is distinct from old.status)
     )
     and (
       not private.beta_member_eligible(new.buyer_id, 'buyer')
       or not private.beta_member_eligible(v_seller, 'seller')
     ) then
    raise exception 'Beta commerce access required' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_beta_order_commerce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.beta_access_enforced()
     and (
       not private.beta_member_eligible(new.buyer_id, 'buyer')
       or not private.beta_member_eligible(new.seller_id, 'seller')
     ) then
    raise exception 'Beta commerce access required' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_beta_listing_commerce() from public, anon, authenticated;
revoke all on function private.guard_beta_offer_commerce() from public, anon, authenticated;
revoke all on function private.guard_beta_order_commerce() from public, anon, authenticated;

drop trigger if exists listings_beta_commerce_guard on public.listings;
create trigger listings_beta_commerce_guard
  before insert or update on public.listings
  for each row execute function private.guard_beta_listing_commerce();

drop trigger if exists offers_beta_commerce_guard on public.offers;
create trigger offers_beta_commerce_guard
  before insert or update on public.offers
  for each row execute function private.guard_beta_offer_commerce();

drop trigger if exists orders_beta_commerce_guard on public.orders;
create trigger orders_beta_commerce_guard
  before insert on public.orders
  for each row execute function private.guard_beta_order_commerce();

-- Revocation closes only future commerce. Active stock is paused so buyers do
-- not reach a checkout that will be rejected; orders, messages, disputes,
-- fulfillment, refunds, and retained history are not removed or hidden.
create or replace function private.apply_beta_membership_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.listings set status = 'paused'
    where seller_id = new.user_id and status = 'active';
  end if;
  return new;
end;
$$;

create or replace function private.apply_beta_invitation_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.beta_memberships
    set revoked_at = new.revoked_at,
        revoked_by = new.revoked_by,
        revoke_reason = new.revoke_reason
    where invitation_id = new.id and revoked_at is null;
    delete from private.beta_signup_claims where invitation_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_beta_membership_revocation() from public, anon, authenticated;
revoke all on function private.apply_beta_invitation_revocation() from public, anon, authenticated;

create trigger beta_membership_revocation_effects
  after update of revoked_at on public.beta_memberships
  for each row execute function private.apply_beta_membership_revocation();
create trigger beta_invitation_revocation_effects
  after update of revoked_at on public.beta_invitations
  for each row execute function private.apply_beta_invitation_revocation();

-- Migration invariants.
do $$
begin
  if not private.beta_access_enforced() = false then
    raise exception 'R01: beta rollout must start explicitly disabled';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema in ('public', 'private')
      and table_name in ('beta_invitations', 'beta_memberships', 'beta_signup_claims')
      and grantee = 'anon'
  ) then
    raise exception 'R01: anon received beta data privileges';
  end if;
end;
$$;

commit;
