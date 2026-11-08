-- N418 (OS-W34 follow-up, Codex post-merge review of #149): account deletion
-- keeps personal data. Four defects, each ruled by Neil.
--
-- 1. A late hold after the scrub (P1-1). A return or chargeback can open
--    after scrub_deleted_account has committed. The worker then lifted the
--    Auth ban and paused the deletion "so the member can settle", but their
--    email and phone sign-in were already erased, so nobody could. Ruling: a
--    scrubbed member is never reinstated. A hold on a case whose scrubbed_at
--    is set becomes outcome operator_attention, blocker_code
--    'late_hold_after_scrub', with a next step for the operator; the account
--    stays disabled and the money resolves through the normal rules without
--    the member (buyer refunds through the refund path, a seller-side
--    chargeback from held funds or a write-off, as today). Every place that
--    pauses or requeues:
--      - pause_account_deletion_hold (the worker's pause after the gate and
--        after finalise) records the operator step for a scrubbed case; the
--        job keeps its one-hour recheck, so once the hold settles the next
--        pass finishes the case (the gate puts it back to cleaning up);
--      - account_deletion_hold_gate and account_deletion_finalise also say
--        whether the case is scrubbed, so the worker never lifts the ban;
--      - private.requeue_account_deletion_for_hold (the deferred trigger
--        account_deletion_hold_watch, through private.account_deletion_hold_appeared)
--        marks a scrubbed, finished case for the operator and does not put it
--        back in the queue for a reinstating pass.
-- 2. Other members' notifications keep a deleted member's words (P1-2). The
--    scrub removed only notifications the member received. The follow, save,
--    comment, reaction, review, question and (legacy) message triggers copy
--    the actor's name, and comments, reviews, questions and messages the first
--    140 characters of what they wrote, into the RECIPIENT's notification.
--    The scrub now rewrites every notification the member is the actor of:
--    neutral title, body '(removed)', actor_id null, and no link to their own
--    (retired) profile handle. The row stays, with every other link. The
--    order, offer, dispute, receipt and refund kinds carry only text DRVN
--    writes (order and listing references, amounts), so they keep it and
--    lose only the actor.
-- 3. The tombstone race (P2-3). The scrub inserts the tombstone and clears
--    the handle in one transaction; a concurrent claim saw no tombstone yet,
--    waited on the unique index and won once the scrub committed. Both now
--    take one per-handle transaction advisory lock (private.username_lock_key)
--    and the claim reads tombstones only after taking it.
-- 4. Deletions retained before #149 were never scrubbed (P2-4). Cases parked
--    as retained (operator_attention, scrubbed_at null) have finished jobs,
--    and the worker claims only pending or expired ones. Applying this file
--    requeues each of them ONCE through the normal path (a pending
--    delete_account job, the case back to cleaning up), so the worker's hold
--    checks run before anything is erased. A held one pauses as today, which
--    is right: it isn't scrubbed yet. Idempotent: a requeued case is no
--    longer operator_attention, and a scrubbed one is never picked.
--
-- Restated, each from its latest definition with only the change above:
--   private.guard_username_choice          from 20261107220500_username_rules.sql
--   public.scrub_deleted_account           from 20261107220510_account_deletion_scrub.sql
--   public.account_deletion_hold_gate      from 20261108130400_deletion_hold_before_ban.sql
--   public.account_deletion_finalise       from 20261108130400_deletion_hold_before_ban.sql
--   public.pause_account_deletion_hold     from 20261108140000_chargeback_holds_deletion.sql
--   private.requeue_account_deletion_for_hold from 20261108140000_chargeback_holds_deletion.sql
-- New: private.username_lock_key, private.account_deletion_late_hold_note,
-- private.record_account_deletion_late_hold,
-- private.requeue_unscrubbed_retained_deletions.
--
-- Money rules are untouched: what holds a deletion (account_deletion_blockers)
-- is unchanged. Transactional and idempotent (create or replace; the requeue
-- touches only unscrubbed retained cases).

begin;

-- ---------------------------------------------------------------------------
-- 3. One lock per handle, for retiring it and for claiming it.
-- ---------------------------------------------------------------------------
create or replace function private.username_lock_key(p_username text)
returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select hashtextextended('drvn:username:' || lower(p_username), 0);
$$;

revoke all on function private.username_lock_key(text) from public, anon, authenticated;

-- From 20261107220500. N418: the per-handle lock comes first, and the
-- reserved and tombstone checks read after it, so a retirement in flight is
-- either committed (and seen) or waits for this claim to finish.
create or replace function private.guard_username_choice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.username is null or (tg_op = 'UPDATE' and new.username is not distinct from old.username) then
    return new;
  end if;
  perform pg_advisory_xact_lock(private.username_lock_key(new.username));
  if exists (select 1 from private.reserved_usernames r where r.username = new.username) then
    raise exception 'That username is taken.' using errcode = '23505', hint = 'username_reserved';
  end if;
  if exists (select 1 from private.username_tombstones t where t.username = new.username) then
    raise exception 'That username is taken.' using errcode = '23505', hint = 'username_retired';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_username_choice() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2 and 3. The scrub. From 20261107220510, with the handle lock taken before
-- the tombstone, and the member's words rewritten in other members'
-- notifications.
-- ---------------------------------------------------------------------------
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
  left_drvn constant text := 'A member who has since left DRVN';
begin
  if p_user is null then
    raise exception 'A deletion scrub needs an account' using errcode = '22023';
  end if;
  -- The deletion lock the hold gate, finalise and the hold requeue take
  -- (20261108130400), so a hold can't commit halfway through a scrub.
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));

  select * into v_request from public.account_deletion_requests where user_id = p_user for update;
  -- A case resumed after a hold still reads temporary_financial_hold until
  -- its outcome is recorded, so the live blocker check below decides.
  if not found
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
    -- N418: the claim's lock (guard_username_choice), so a claim of this
    -- handle can't slip in between the tombstone and the commit.
    perform pg_advisory_xact_lock(private.username_lock_key(v_username));
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

  -- N418: what they wrote, as other members' notifications copied it. The
  -- social and message triggers put the actor's name in the title and the
  -- first 140 characters of a comment, review, question or message in the
  -- body. The row and its link stay, except a link to the member's own
  -- profile, which names their retired handle. Order, offer, dispute,
  -- receipt and refund notifications carry only text DRVN writes, and lose
  -- only the actor.
  update public.notifications nt
     set title = case
           when nt.kind ~ '^(order|offer|dispute|receipt|refund)_' then nt.title
           when nt.kind = 'follow' then left_drvn || ' followed you'
           when nt.kind = 'car_follow' then left_drvn || ' is following your build'
           when nt.kind in ('save', 'listing_save') then left_drvn || ' saved this'
           when nt.kind = 'comment' then left_drvn || ' commented on your update'
           when nt.kind = 'reaction' then left_drvn || ' reacted to your update'
           when nt.kind = 'review' then left_drvn || ' left you a review'
           when nt.kind = 'question' then left_drvn || ' wrote about your part'
           when nt.kind = 'message' then 'Message from a member who has since left DRVN'
           else left_drvn
         end,
         body = case
           when nt.kind ~ '^(order|offer|dispute|receipt|refund)_' then nt.body
           when nt.body is null then null
           else '(removed)'
         end,
         href = case
           when nt.target_id = p_user or (v_username is not null and nt.href = '/u/' || v_username) then null
           else nt.href
         end,
         actor_id = null
   where nt.actor_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('notifications_sent', n);

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

-- ---------------------------------------------------------------------------
-- 1. A late hold after the scrub: the operator's case, never a reinstatement.
-- ---------------------------------------------------------------------------
-- The operator's next step. The member can't sign in (their email and phone
-- are gone), so the money is settled without them by the normal rules.
create or replace function private.account_deletion_late_hold_note(p_order uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_order is null then
      'A payment opened after this member''s personal data was removed. The account stays disabled and is never restored: resolve it without them.'
    when private.order_has_unresolved_chargeback(p_order) then
      'Order ' || upper(left(p_order::text, 8)) || ' has a bank chargeback that opened after this member''s personal data was removed. The account stays disabled and is never restored: recover a seller-side loss from held funds or write it off, as for any chargeback.'
    else
      'Order ' || upper(left(p_order::text, 8)) || ' has a return, refund or payout that opened after this member''s personal data was removed. The account stays disabled and is never restored: settle it without them (a buyer is refunded through the refund queue; a seller-side loss comes from held funds or is written off).'
  end;
$$;

revoke all on function private.account_deletion_late_hold_note(uuid) from public, anon, authenticated;

-- Records the operator step on a scrubbed case. Changes nothing else: the
-- job, the ban and the retention clock stay as they are.
create or replace function private.record_account_deletion_late_hold(p_user uuid, p_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.account_deletion_requests
     set outcome = 'operator_attention', blocker_code = 'late_hold_after_scrub',
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts', 'chargebacks'],
         hold_order_id = p_order,
         next_action = private.account_deletion_late_hold_note(p_order),
         responsible_owner = 'operations', completed_at = null, updated_at = now()
   where user_id = p_user and scrubbed_at is not null and outcome <> 'completed';
end $$;

revoke all on function private.record_account_deletion_late_hold(uuid, uuid) from public, anon, authenticated;

-- From 20261108130400. N418: says whether the case is scrubbed (the worker
-- then never lifts the ban), and a clear gate resumes a late-hold case as
-- cleaning up, as it does a paused one.
create or replace function public.account_deletion_hold_gate(p_job uuid, p_lease uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers jsonb;
  v_scrubbed boolean;
begin
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));
  if not private.account_deletion_lease_held(p_job, p_lease, p_user) then
    raise exception 'Deletion lease lost';
  end if;

  v_scrubbed := exists (select 1 from public.account_deletion_requests where user_id = p_user and scrubbed_at is not null);
  v_blockers := public.account_deletion_blockers(p_user);
  -- An unreadable answer holds: never ban or delete on a guess.
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    return v_blockers || jsonb_build_object('held', true, 'hold_order_id', private.account_deletion_hold_order(p_user), 'scrubbed', v_scrubbed);
  end if;

  update public.account_deletion_requests
     set outcome = 'cleanup_pending', blocker_code = null, hold_order_id = null,
         affected_data_classes = array['profile', 'owned content', 'uploads', 'provider customer'],
         next_action = 'Automated cleanup is in progress.', responsible_owner = 'privacy worker',
         updated_at = now()
   where user_id = p_user
     and (outcome = 'temporary_financial_hold'
          or (outcome = 'operator_attention' and blocker_code = 'late_hold_after_scrub'));
  return v_blockers || jsonb_build_object('held', false, 'hold_order_id', null, 'scrubbed', v_scrubbed);
end $$;

revoke all on function public.account_deletion_hold_gate(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_hold_gate(uuid, uuid, uuid) to service_role;

-- From 20261108130400. N418: a held answer says whether the case is scrubbed.
create or replace function public.account_deletion_finalise(p_job uuid, p_lease uuid, p_user uuid, p_retained jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_blockers jsonb;
begin
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));
  if not private.account_deletion_lease_held(p_job, p_lease, p_user) then
    raise exception 'Deletion lease lost';
  end if;

  v_blockers := public.account_deletion_blockers(p_user);
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    return v_blockers || jsonb_build_object('held', true, 'hold_order_id', private.account_deletion_hold_order(p_user),
      'scrubbed', exists (select 1 from public.account_deletion_requests where user_id = p_user and scrubbed_at is not null));
  end if;

  if coalesce((v_blockers->>'retained_identity')::boolean, true) then
    if p_retained is null or jsonb_typeof(p_retained) <> 'object' or coalesce(p_retained->>'next_action', '') = '' then
      raise exception 'The retained-identity record is required' using errcode = '22023';
    end if;
    update public.account_deletion_requests
       set outcome = 'operator_attention',
           blocker_code = p_retained->>'blocker_code',
           affected_data_classes = array(select jsonb_array_elements_text(coalesce(p_retained->'affected_data_classes', '[]'::jsonb))),
           next_action = p_retained->>'next_action',
           responsible_owner = p_retained->>'responsible_owner',
           review_at = null,
           policy_decisions_pending = array(select jsonb_array_elements_text(coalesce(p_retained->'policy_decisions_pending', '[]'::jsonb))),
           hold_order_id = null,
           updated_at = now()
     where user_id = p_user;
    if not found then raise exception 'Deletion request record is missing'; end if;
    perform public.finish_remediation_job(p_job, p_lease, null);
    return v_blockers || jsonb_build_object('held', false, 'outcome', 'operator_attention');
  end if;

  return v_blockers || jsonb_build_object('held', false, 'outcome', 'hard_delete_eligible');
end $$;

revoke all on function public.account_deletion_finalise(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_deletion_finalise(uuid, uuid, uuid, jsonb) to service_role;

-- From 20261108140000. N418: a scrubbed case is recorded for the operator
-- (late_hold_after_scrub) instead of telling the member to settle; the job
-- keeps its one-hour recheck so the case finishes once the hold settles.
create or replace function public.pause_account_deletion_hold(p_job uuid, p_lease uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  update public.remediation_jobs
     set status = 'pending', next_attempt_at = now() + interval '1 hour', locked_until = null, lease_id = null,
         attempts = greatest(attempts - 1, 0), last_error = null
   where id = p_job and kind = 'delete_account' and status = 'processing' and lease_id = p_lease and locked_until > now();
  if not found then raise exception 'Deletion lease lost'; end if;
  v_order := private.account_deletion_hold_order(p_user);
  if exists (select 1 from public.account_deletion_requests where user_id = p_user and scrubbed_at is not null) then
    perform private.record_account_deletion_late_hold(p_user, v_order);
    return;
  end if;
  update public.account_deletion_requests
     set outcome = 'temporary_financial_hold', blocker_code = private.account_deletion_hold_code(v_order),
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts', 'chargebacks'],
         hold_order_id = v_order,
         next_action = private.account_deletion_hold_note(v_order),
         responsible_owner = 'account owner', updated_at = now()
   where user_id = p_user;
end $$;

revoke all on function public.pause_account_deletion_hold(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pause_account_deletion_hold(uuid, uuid, uuid) to service_role;

-- From 20261108140000. N418: a hold that appears after a scrubbed case
-- finished marks it for the operator and leaves the job finished: no pass
-- runs that could give sign-in back. Unscrubbed cases are requeued as before.
create or replace function private.requeue_account_deletion_for_hold(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  if not exists (
    select 1 from public.remediation_jobs
     where dedup_key = 'delete:' || p_user::text and kind = 'delete_account'
       and status not in ('pending', 'processing')
  ) then
    return;
  end if;
  if not exists (select 1 from public.account_deletion_requests where user_id = p_user and outcome <> 'completed') then
    return;
  end if;
  if not coalesce((public.account_deletion_blockers(p_user)->>'financial_hold')::boolean, false) then
    return;
  end if;

  v_order := private.account_deletion_hold_order(p_user);
  if exists (select 1 from public.account_deletion_requests where user_id = p_user and scrubbed_at is not null) then
    perform private.record_account_deletion_late_hold(p_user, v_order);
    return;
  end if;
  update public.remediation_jobs
     set status = 'pending', next_attempt_at = now(), locked_until = null, lease_id = null,
         attempts = 0, last_error = null, completed_at = null
   where dedup_key = 'delete:' || p_user::text and kind = 'delete_account'
     and status not in ('pending', 'processing');
  update public.account_deletion_requests
     set outcome = 'temporary_financial_hold', blocker_code = private.account_deletion_hold_code(v_order),
         affected_data_classes = array['orders', 'returns', 'refunds', 'payouts', 'chargebacks'],
         hold_order_id = v_order,
         next_action = private.account_deletion_hold_note(v_order),
         responsible_owner = 'account owner', completed_at = null, updated_at = now()
   where user_id = p_user and outcome <> 'completed';
end $$;

revoke all on function private.requeue_account_deletion_for_hold(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deletions retained before the scrub existed go through it once.
-- ---------------------------------------------------------------------------
-- Every case parked as retained without a scrub, whose account still exists:
-- its delete_account job goes back to pending (or is created, if it is
-- missing), and the case reads as cleaning up. The worker's next pass asks
-- the hold gate before anything is erased. Returns how many cases it
-- requeued; a second run finds none.
create or replace function private.requeue_unscrubbed_retained_deletions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case record;
  v_job uuid;
  v_count integer := 0;
begin
  for v_case in
    select r.id, r.user_id
      from public.account_deletion_requests r
      join auth.users u on u.id = r.user_id
     where r.outcome = 'operator_attention' and r.scrubbed_at is null
     order by r.requested_at, r.id
     for update of r
  loop
    update public.remediation_jobs
       set status = 'pending', next_attempt_at = now(), locked_until = null, lease_id = null,
           attempts = 0, last_error = null, completed_at = null
     where dedup_key = 'delete:' || v_case.user_id::text and kind = 'delete_account'
       and status not in ('pending', 'processing')
    returning id into v_job;
    if v_job is null then
      insert into public.remediation_jobs (kind, dedup_key, payload)
      values ('delete_account', 'delete:' || v_case.user_id::text, jsonb_build_object('user_id', v_case.user_id))
      on conflict (dedup_key) do nothing
      returning id into v_job;
    end if;
    if v_job is null then
      select id into v_job from public.remediation_jobs where dedup_key = 'delete:' || v_case.user_id::text;
    end if;
    update public.account_deletion_requests
       set outcome = 'cleanup_pending', blocker_code = null, hold_order_id = null,
           job_id = coalesce(v_job, job_id),
           affected_data_classes = array['profile', 'owned content', 'uploads', 'provider customer'],
           next_action = 'Automated cleanup is in progress.', responsible_owner = 'privacy worker',
           completed_at = null, updated_at = now()
     where id = v_case.id;
    v_count := v_count + 1;
    v_job := null;
  end loop;
  return v_count;
end $$;

revoke all on function private.requeue_unscrubbed_retained_deletions() from public, anon, authenticated;

select private.requeue_unscrubbed_retained_deletions();

notify pgrst, 'reload schema';
commit;
