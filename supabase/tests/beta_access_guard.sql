-- R01 invited-beta security guard. Disposable local database only.
begin;

create or replace function pg_temp.impersonate(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.back_to_admin()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

do $$
declare
  invited uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  invite_id uuid;
  seller_invite uuid;
  buyer_invite uuid;
  claim_id uuid;
  listing_id uuid;
  second_listing_id uuid;
  order_id uuid;
  purchase jsonb;
begin
  -- Enabling is deliberate. Missing config remains fail-closed.
  update public.beta_access_config set enforced = true where singleton;
  if not private.beta_access_enforced() then
    raise exception 'FAIL: explicit beta enable did not take effect';
  end if;
  delete from public.beta_access_config;
  if not private.beta_access_enforced() then
    raise exception 'FAIL: missing beta config failed open';
  end if;
  insert into public.beta_access_config(singleton, enforced) values(true, true);
  raise notice 'PASS: explicit and missing configuration enforce the beta gate';

  -- A valid one-time claim is bound to normalized Auth email.
  insert into public.beta_invitations(email_normalized, roles, token_hash, expires_at)
  values('invited@example.test', array['buyer','seller'], repeat('a',64), now()+interval '1 day')
  returning id into invite_id;
  claim_id := public.prepare_beta_signup(repeat('a',64), ' Invited@Example.Test ');
  insert into auth.users(id,email,raw_user_meta_data)
  values(invited,'invited@example.test',jsonb_build_object('beta_claim_id',claim_id::text));
  if not exists(select 1 from public.beta_memberships where user_id=invited and revoked_at is null)
     or not exists(select 1 from public.profiles where id=invited)
     or not exists(select 1 from public.beta_invitations where id=invite_id and consumed_by=invited) then
    raise exception 'FAIL: valid invitation did not atomically create membership/profile';
  end if;
  begin
    perform public.prepare_beta_signup(repeat('a',64), 'invited@example.test');
    raise exception 'FAIL: consumed invitation was reusable';
  exception when raise_exception then
    if sqlerrm <> 'Invitation is unavailable' then raise; end if;
  end;
  raise notice 'PASS: valid normalized email consumes an invitation once';

  delete from auth.users where id=invited;
  if not exists(
    select 1 from public.beta_invitations
    where id=invite_id and consumed_at is not null and consumed_by is null
  ) then
    raise exception 'FAIL: deleting a joined Auth user lost or invalidated invitation history';
  end if;
  raise notice 'PASS: account deletion retains consumed invitation history';

  -- All rejection variants return the same database error and create nothing.
  insert into public.beta_invitations(email_normalized,roles,token_hash,expires_at)
  values
    ('match@example.test',array['buyer'],repeat('b',64),now()+interval '1 day'),
    ('expired@example.test',array['buyer'],repeat('c',64),now()-interval '1 second'),
    ('revoked@example.test',array['seller'],repeat('d',64),now()+interval '1 day');
  update public.beta_invitations
    set revoked_at=now(), revoke_reason='guard'
    where token_hash=repeat('d',64);
  begin
    perform public.prepare_beta_signup(repeat('b',64),'wrong@example.test');
    raise exception 'FAIL: mismatched email received a claim';
  exception when raise_exception then
    if sqlerrm <> 'Invitation is unavailable' then raise; end if;
  end;
  begin
    perform public.prepare_beta_signup(repeat('c',64),'expired@example.test');
    raise exception 'FAIL: expired invitation received a claim';
  exception when raise_exception then
    if sqlerrm <> 'Invitation is unavailable' then raise; end if;
  end;
  begin
    perform public.prepare_beta_signup(repeat('d',64),'revoked@example.test');
    raise exception 'FAIL: revoked invitation received a claim';
  exception when raise_exception then
    if sqlerrm <> 'Invitation is unavailable' then raise; end if;
  end;
  raise notice 'PASS: mismatched, expired, and revoked invitations are refused';

  -- User-controlled metadata cannot manufacture the server-side claim.
  insert into auth.users(id,email,raw_user_meta_data)
  values(outsider,'outsider@example.test','{"beta_claim_id":"00000000-0000-0000-0000-000000000001","roles":["buyer","seller"]}');
  if exists(select 1 from public.profiles where id=outsider)
     or exists(select 1 from public.beta_memberships where user_id=outsider) then
    raise exception 'FAIL: direct Auth metadata created beta access';
  end if;
  raise notice 'PASS: direct Auth signup metadata creates no profile or membership';

  -- Durable eligible fixtures; these are transaction-local and roll back.
  insert into auth.users(id,email) values
    (seller,'seller@example.test'),(buyer,'buyer@example.test'),(guest,'guest@example.test');
  insert into public.profiles(id,username) values
    (seller,'beta_guard_seller'),(buyer,'beta_guard_buyer'),
    (outsider,'beta_guard_outsider'),(guest,'beta_guard_guest');
  insert into public.beta_invitations(email_normalized,roles,token_hash,expires_at,consumed_at,consumed_by)
  values
    ('seller@example.test',array['seller'],repeat('e',64),now()+interval '1 day',now(),seller),
    ('buyer@example.test',array['buyer'],repeat('f',64),now()+interval '1 day',now(),buyer);
  select id into seller_invite from public.beta_invitations where consumed_by=seller;
  select id into buyer_invite from public.beta_invitations where consumed_by=buyer;
  insert into public.beta_memberships(user_id,invitation_id,email_normalized,roles)
  values
    (seller,seller_invite,'seller@example.test',array['seller']),
    (buyer,buyer_invite,'buyer@example.test',array['buyer']);

  insert into public.listings(seller_id,title,category,price_cents,status,currency)
  values(seller,'Beta guard listing','engine',1000,'active','USD') returning id into listing_id;
  insert into public.listings(seller_id,title,category,price_cents,status,currency)
  values(seller,'Beta guard second listing','engine',1200,'active','USD') returning id into second_listing_id;

  -- Direct client writes are stopped by RLS/trigger, and client RPC execution
  -- stays revoked even for an eligible member.
  perform pg_temp.impersonate(outsider);
  begin
    insert into public.listings(seller_id,title,category,price_cents,status,currency)
    values(outsider,'Bypass listing','engine',1000,'active','USD');
    raise exception 'FAIL: uninvited user inserted a listing';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.impersonate(buyer);
  begin
    perform public.purchase_begin(buyer,array[listing_id],'client-rpc-bypass');
    raise exception 'FAIL: authenticated client executed purchase_begin directly';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.back_to_admin();
  raise notice 'PASS: direct RLS and RPC bypasses are blocked';

  -- Service-role-equivalent calls are still constrained by database triggers.
  begin
    perform public.purchase_begin(outsider,array[listing_id],'service-rpc-bypass');
    raise exception 'FAIL: service purchase accepted an uninvited buyer';
  exception when insufficient_privilege then null;
  end;
  if not exists(select 1 from public.listings where id=listing_id and status='active') then
    raise exception 'FAIL: refused purchase left the listing reserved';
  end if;
  begin
    insert into public.orders(buyer_id,seller_id,status,subtotal_cents,total_cents,currency)
    values(guest,seller,'pending',1000,1000,'USD');
    raise exception 'FAIL: guest order bypassed beta membership';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: service/RPC and guest checkout paths remain membership-gated';

  -- Create an existing obligation, then revoke. It remains readable/actionable
  -- while new commerce stops and live stock is paused.
  purchase := public.purchase_begin(buyer,array[listing_id],'eligible-purchase');
  order_id := (purchase->'orders'->0->>'order_id')::uuid;
  if order_id is null then raise exception 'FAIL: eligible buyer could not purchase'; end if;
  update public.beta_invitations
  set revoked_at=now(), revoked_by=null, revoke_reason='guard revocation'
  where id=buyer_invite;
  if not exists(select 1 from public.beta_memberships where user_id=buyer and revoked_at is not null) then
    raise exception 'FAIL: invitation revocation did not revoke membership';
  end if;
  begin
    insert into public.offers(listing_id,buyer_id,amount_cents,status)
    values(second_listing_id,buyer,900,'open');
    raise exception 'FAIL: revoked buyer created new commerce';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.impersonate(buyer);
  if not exists(select 1 from public.orders where id=order_id) then
    raise exception 'FAIL: revoked buyer lost an existing order obligation';
  end if;
  perform pg_temp.back_to_admin();
  raise notice 'PASS: revocation blocks new commerce and preserves existing obligations';

  update public.beta_memberships
  set revoked_at=now(), revoke_reason='seller revoked'
  where user_id=seller;
  -- The already-reserved listing is an existing obligation and is not paused.
  begin
    insert into public.listings(seller_id,title,category,price_cents,status,currency)
    values(seller,'Post revoke','engine',1000,'active','USD');
    raise exception 'FAIL: revoked seller inserted a listing';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: revoked seller cannot start a new listing';

  raise notice 'all beta access checks passed';
end;
$$;

rollback;
