-- OS-W34 N16 (Neil's ruling, 7 November 2026: "Deletion scrubs Auth email
-- and metadata, addresses, order party labels, message and comment bodies
-- and exports, using a keyed email digest. Transaction keys are kept for 6
-- years on a defined clock, and the process is resumable.")
--
-- Until now the deletion worker cleared a profile's own fields and deleted
-- what the member owned, but a member who had traded (whose orders must stay)
-- kept their sign-in email and metadata, the addresses on their orders and
-- their ship-from profile, their name on every order, and every message,
-- comment and question they wrote (B7).
--
-- scrub_deleted_account(user, email digest) does all of that in one
-- transaction, and does it the same way however many times it runs, so the
-- worker can call it on every pass: an interrupted deletion resumes. Exports
-- are purged by the worker (account-export-worker), as before, on every path.
--
-- What it keeps — the transaction keys — is the order, payment, refund and
-- payout rows (ids, amounts, statuses, provider references, dates), the
-- member's id they hang on, the order's country and collection flag, and a
-- "Deleted member" profile. The retention clock: the keys are kept until 6
-- years after the later of the scrub and the member's last order activity
-- (completed, refunded, cancelled or last updated). account_deletion_requests
-- records both ends. What happens when the clock runs out is not ruled yet,
-- so it is shown to operators and nothing deletes financial records.
--
-- The email: a keyed digest (HMAC-SHA256, computed by the worker with a
-- server secret, never in SQL) is kept instead, so DRVN can still tell that
-- an address belonged to a deleted account without holding the address.
--
-- Owner of: scrub_deleted_account (new); guard_accepted_checkout_shipping
-- (redefined from 20260905223236 to let only this scrub clear a delivery
-- address it froze).

begin;

alter table public.account_deletion_requests
  add column if not exists email_digest text,
  add column if not exists email_digest_key text,
  add column if not exists scrubbed_at timestamptz,
  add column if not exists retention_starts_at timestamptz,
  add column if not exists retain_until timestamptz;

alter table public.account_deletion_requests
  add constraint account_deletion_requests_email_digest_shape
    check (email_digest is null or email_digest ~ '^[0-9a-f]{64}$'),
  add constraint account_deletion_requests_digest_key_pair
    check ((email_digest is null) = (email_digest_key is null)),
  add constraint account_deletion_requests_retention_clock
    check (retain_until is null or (retention_starts_at is not null and retain_until = retention_starts_at + interval '6 years'));

create index if not exists account_deletion_requests_email_digest_idx
  on public.account_deletion_requests (email_digest) where email_digest is not null;

comment on column public.account_deletion_requests.email_digest is
  'N16: HMAC-SHA256 of the deleted account''s normalised email, keyed by a server secret (email_digest_key names which). The email itself is gone.';
comment on column public.account_deletion_requests.retain_until is
  'N16: transaction keys are kept until this moment: retention_starts_at (the later of the scrub and the member''s last order activity) + 6 years.';

-- ------------------------------------------------------------
-- An accepted-offer delivery address is frozen once checkout starts.
-- Only the deletion scrub, for that order's own buyer, may clear it.
-- ------------------------------------------------------------
create or replace function public.guard_accepted_checkout_shipping()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer()
     and current_setting('drvn.account_scrub', true) = old.buyer_id::text then
    return new;
  end if;
  if old.accepted_checkout_shipping is not null and (
    new.accepted_checkout_shipping is distinct from old.accepted_checkout_shipping
    or new.ship_name is distinct from old.ship_name
    or new.ship_line1 is distinct from old.ship_line1
    or new.ship_line2 is distinct from old.ship_line2
    or new.ship_city is distinct from old.ship_city
    or new.ship_postcode is distinct from old.ship_postcode
    or new.ship_country is distinct from old.ship_country
    or new.ship_state is distinct from old.ship_state
    or new.ship_phone is distinct from old.ship_phone
    or new.is_collection is distinct from old.is_collection
  ) then raise exception 'Accepted-offer delivery details are immutable after checkout starts'; end if;
  return new;
end $$;

-- ------------------------------------------------------------
-- The scrub
-- ------------------------------------------------------------
create or replace function public.scrub_deleted_account(p_user uuid, p_email_digest text, p_digest_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_last_activity timestamptz;
  v_username text;
  v_counts jsonb := '{}'::jsonb;
  n integer;
  removed constant text := 'Removed: this member deleted their account.';
begin
  if p_user is null then
    raise exception 'A deletion scrub needs an account' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || p_user::text, 0));

  select * into v_request from public.account_deletion_requests where user_id = p_user for update;
  if not found or v_request.outcome = 'temporary_financial_hold'
     or not exists (select 1 from public.remediation_jobs j where j.dedup_key = 'delete:' || p_user::text) then
    raise exception 'This account has no deletion under way' using errcode = '55000';
  end if;
  -- Never while money is still moving: the other party may need the address.
  v_blockers := public.account_deletion_blockers(p_user);
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    raise exception 'This account still has orders or payments in progress' using errcode = '55000';
  end if;
  if v_request.email_digest is null and p_email_digest is not null then
    if p_email_digest !~ '^[0-9a-f]{64}$' or nullif(btrim(p_digest_key), '') is null then
      raise exception 'The email digest is malformed' using errcode = '22023';
    end if;
  end if;

  perform set_config('drvn.account_scrub', p_user::text, true);

  -- Auth: the email, the phone, the sign-in metadata, and linked identities
  -- (a Google identity carries the email and name). Sessions were revoked
  -- by the ban before this runs.
  update auth.users
     set email = null,
         email_change = '',
         raw_user_meta_data = '{}'::jsonb
   where id = p_user;
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'phone') then
    update auth.users set phone = null, phone_change = '' where id = p_user;
  end if;
  if to_regclass('auth.identities') is not null then
    update auth.identities
       set identity_data = jsonb_strip_nulls(jsonb_build_object(
             'sub', identity_data->'sub', 'provider_id', identity_data->'provider_id'))
     where user_id = p_user;
  end if;
  delete from public.account_emails where user_id = p_user;
  update public.beta_memberships
     set email_normalized = 'deleted-' || p_user::text || '@deleted.invalid'
   where user_id = p_user;
  update public.beta_invitations
     set email_normalized = 'deleted-' || p_user::text || '@deleted.invalid'
   where consumed_by = p_user;

  -- The profile: the handle is retired (N38), never handed out again.
  select username into v_username from public.profiles where id = p_user;
  if v_username is not null and v_username ~ '^[a-z0-9_]{3,30}$' then
    insert into private.username_tombstones (username) values (v_username) on conflict (username) do nothing;
  end if;
  update public.profiles
     set avatar_url = null, display_name = 'Deleted member', username = null, bio = null,
         headline = null, location = null, country = null, region = null, store_note = null,
         main_car_id = null, default_offer_floor_pct = null, links = '[]'::jsonb
   where id = p_user;

  -- Addresses: their ship-from and return addresses, the delivery details
  -- on orders they bought (country and the collection flag stay, as keys),
  -- and the shipping snapshot a checkout journalled.
  delete from public.seller_fulfillment_profiles where seller_id = p_user;
  update public.orders
     set ship_name = null, ship_line1 = null, ship_line2 = null, ship_city = null,
         ship_postcode = null, ship_state = null, ship_phone = null,
         accepted_checkout_shipping = case when accepted_checkout_shipping is null then null
           else jsonb_strip_nulls(jsonb_build_object(
             'country', accepted_checkout_shipping->'country',
             'isCollection', accepted_checkout_shipping->'isCollection')) end,
         buyer_label = 'Deleted member'
   where buyer_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders_bought', n);
  update public.purchase_attempts
     set checkout_context = checkout_context - 'shipping' - 'destinationHash'
   where buyer_id = p_user and checkout_context is not null;

  -- Order party labels on the other side.
  update public.orders set seller_label = 'Deleted member' where seller_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders_sold', n);

  -- What they wrote. Message threads and question threads keep their shape
  -- (the other party's replies still make sense); comments go.
  update public.messages
     set body = removed, attachments = '{}'
   where sender_id = p_user and kind = 'message'
     and (body is distinct from removed or cardinality(attachments) > 0);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('messages', n);
  update public.conversations c
     set last_message_preview = removed
    from public.messages m
   where m.id = c.last_message_id and m.sender_id = p_user and m.kind = 'message'
     and c.last_message_preview is distinct from removed;
  update public.listing_questions
     set body = removed
   where author_id = p_user and body is distinct from removed;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('questions', n);
  delete from public.activity_comments where author_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('comments', n);

  -- Their own social record, none of it a transaction key.
  delete from public.notifications where user_id = p_user;
  delete from public.saved_searches where user_id = p_user;
  delete from public.follows where follower_id = p_user or (target_type = 'profile' and target_id = p_user);
  delete from public.listing_imports where user_id = p_user;

  -- The retention clock, fixed on the first scrub.
  select max(greatest(coalesce(o.completed_at, '-infinity'), coalesce(o.refunded_at, '-infinity'),
                      coalesce(o.cancelled_at, '-infinity'), o.updated_at))
    into v_last_activity
    from public.orders o
   where o.buyer_id = p_user or o.seller_id = p_user;

  update public.account_deletion_requests
     set email_digest = coalesce(email_digest, p_email_digest),
         email_digest_key = case when email_digest is null and p_email_digest is not null
                                 then btrim(p_digest_key) else email_digest_key end,
         scrubbed_at = coalesce(scrubbed_at, now()),
         retention_starts_at = coalesce(retention_starts_at, greatest(now(), coalesce(v_last_activity, now()))),
         retain_until = coalesce(retain_until, greatest(now(), coalesce(v_last_activity, now())) + interval '6 years'),
         -- Decided now: the retention period (6 years) and what the
         -- anonymization removes (this scrub).
         policy_decisions_pending = array_remove(array_remove(policy_decisions_pending,
           'financial record retention duration'), 'eventual identity anonymization'),
         updated_at = now()
   where id = v_request.id
  returning retain_until into v_request.retain_until;

  -- The address exception ends with the scrub, not with the transaction.
  perform set_config('drvn.account_scrub', '', true);
  return v_counts || jsonb_build_object('retain_until', v_request.retain_until);
end;
$$;

revoke all on function public.scrub_deleted_account(uuid, text, text) from public, anon, authenticated;
grant execute on function public.scrub_deleted_account(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
