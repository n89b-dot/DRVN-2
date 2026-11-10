-- ============================================================================
-- 20261110140000 — order emails through an outbox (report five #116, OS-W41)
--
-- DRVN sent no email of its own: a seller wasn't told by email that a part
-- sold, a buyer got no receipt, and the dispatch deadline and the day-14
-- payout-setup refund ran on in-app notices alone. This is the outbox the
-- money worker drains (src/lib/order-emails.ts), sending through the
-- configured provider (src/lib/email/send.ts); with no provider, every row is
-- skipped as 'email_off', so turning one on later never sends a backlog.
--
--   * public.order_email_outbox: one row per in-app notice that has an email.
--     It holds the recipient's user id and the order id only: no address, no
--     text. The address is read from auth.users when the row is claimed.
--   * The notice is the trigger: an AFTER INSERT on public.notifications for
--     the order kinds below, with an href that is exactly /orders/<uuid>, and
--     only when the notice's own recipient is a party to that order. Every
--     place that raises the in-app notice (a trigger or the app) queues the
--     email in the same transaction; the send happens later, so a send
--     failure can never fail an order.
--   * claim_order_emails / complete_order_email: leased sends, outcomes fenced
--     by attempt, backoff 10, 20, 40, 80 minutes, failed after five attempts.
--     A row older than 24 hours is skipped as stale. A recipient whose
--     account is suspended, has a deletion request, or has no address is
--     skipped; so is anything past 20 emails to one recipient in an hour.
--     A member needs a confirmed address; an unconfirmed one (a guest) is
--     sent only the buyer's emails of their own order.
--   * A deletion request skips the member's pending rows at once.
--   * raise_payout_setup_reminders(): an in-app notice (and so an email) to a
--     seller whose sale is 3, 7 or 12 days old with payouts still off, once
--     per sale per day; run by the payoutDeadlines family.
--   * The money pass gains the family orderEmails (drvn-transfer-worker).
--
-- Restated: private.scheduled_job_inventory() from
-- 20261108100000_payout_setup_started.sql, with 'orderEmails' added to
-- drvn-transfer-worker. Idempotent.
-- ============================================================================

begin;

create table if not exists public.order_email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid not null,
  kind text not null check (kind in (
    'order_sold', 'order_paid', 'order_shipped', 'order_delivered', 'receipt_auto_confirmed',
    'order_disputed', 'dispute_resolved', 'admin_action', 'order_refunded', 'payout_setup_reminder')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  skip_reason text check (skip_reason is null or skip_reason in (
    'email_off', 'stale', 'account_closed', 'no_address', 'not_a_party', 'muted', 'rate_capped', 'rejected')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_expires_at timestamptz,
  -- The provider's status and code only, never a message body or an address.
  last_error text check (last_error is null or length(last_error) <= 200),
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists order_email_outbox_due_idx on public.order_email_outbox (next_attempt_at) where status in ('pending', 'sending');
create index if not exists order_email_outbox_recipient_idx on public.order_email_outbox (recipient_id, sent_at);

alter table public.order_email_outbox enable row level security;
revoke all on table public.order_email_outbox from public, anon, authenticated;
grant all on table public.order_email_outbox to service_role;

comment on table public.order_email_outbox is
  'Order emails waiting to be sent (20261110140000, #116): user id and order id only; the address is read at send. Service role only.';

-- ---------------------------------------------------------------------------
-- The notice is the trigger
-- ---------------------------------------------------------------------------
create or replace function private.queue_order_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  if new.kind not in ('order_sold', 'order_paid', 'order_shipped', 'order_delivered', 'receipt_auto_confirmed',
                      'order_disputed', 'dispute_resolved', 'admin_action', 'order_refunded', 'payout_setup_reminder') then
    return new;
  end if;
  -- Exactly /orders/<uuid>: anything else (a fragment, a query, another
  -- path) queues nothing.
  if new.href is null or new.href !~ '^/orders/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_order := substr(new.href, 9)::uuid;
  -- The notice's own recipient, and only when they are a party to the order:
  -- a notice can never widen who is emailed.
  if not exists (select 1 from public.orders o where o.id = v_order and new.user_id in (o.buyer_id, o.seller_id)) then
    return new;
  end if;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind)
  values (new.id, new.user_id, v_order, new.kind)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;
revoke all on function private.queue_order_email() from public, anon, authenticated;

drop trigger if exists notifications_queue_order_email on public.notifications;
create trigger notifications_queue_order_email
  after insert on public.notifications
  for each row execute function private.queue_order_email();

-- A deletion request: nothing more is sent to that member.
create or replace function private.order_emails_account_closed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is not null then
    update public.order_email_outbox
       set status = 'skipped', skip_reason = 'account_closed', lease_id = null, lease_expires_at = null, updated_at = now()
     where recipient_id = new.user_id and status in ('pending', 'sending');
  end if;
  return new;
end;
$$;
revoke all on function private.order_emails_account_closed() from public, anon, authenticated;

drop trigger if exists order_emails_account_closed on public.account_deletion_requests;
create trigger order_emails_account_closed
  after insert or update of scrubbed_at on public.account_deletion_requests
  for each row execute function private.order_emails_account_closed();

-- ---------------------------------------------------------------------------
-- Claim and complete
-- ---------------------------------------------------------------------------
create or replace function public.claim_order_emails(p_limit integer)
returns table (id uuid, attempt integer, recipient_id uuid, order_id uuid, kind text, email text, guest boolean, notification_prefs jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_row record;
  v_email text;
  v_confirmed boolean;
  v_buyer boolean;
  v_reason text;
  v_lease uuid;
begin
  for v_row in
    select q.id, q.recipient_id, q.order_id, q.kind, q.attempts, q.created_at
      from public.order_email_outbox q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.lease_expires_at < now())
     order by q.next_attempt_at, q.id
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
     for update of q skip locked
  loop
    select nullif(btrim(u.email), ''), u.confirmed_at is not null into v_email, v_confirmed
      from auth.users u where u.id = v_row.recipient_id;
    select v_row.recipient_id = o.buyer_id into v_buyer from public.orders o where o.id = v_row.order_id;

    v_reason := case
      when v_row.created_at < now() - interval '24 hours' then 'stale'
      when exists (select 1 from public.profiles p where p.id = v_row.recipient_id and p.suspended_at is not null)
        or exists (select 1 from public.account_deletion_requests r where r.user_id = v_row.recipient_id) then 'account_closed'
      when v_buyer is null then 'not_a_party'
      when v_email is null then 'no_address'
      -- An unconfirmed address is a guest's: only the buyer's own emails.
      when not v_confirmed and not (v_buyer and v_row.kind in ('order_paid', 'order_shipped', 'receipt_auto_confirmed', 'order_refunded', 'dispute_resolved', 'admin_action')) then 'no_address'
      when (select count(*) from public.order_email_outbox s
             where s.recipient_id = v_row.recipient_id and s.status = 'sent' and s.sent_at > now() - interval '1 hour') >= 20 then 'rate_capped'
    end;

    if v_reason is not null then
      update public.order_email_outbox
         set status = 'skipped', skip_reason = v_reason, lease_id = null, lease_expires_at = null, updated_at = now()
       where order_email_outbox.id = v_row.id;
      continue;
    end if;

    v_lease := gen_random_uuid();
    update public.order_email_outbox
       set status = 'sending', attempts = order_email_outbox.attempts + 1, lease_id = v_lease,
           lease_expires_at = now() + interval '5 minutes', updated_at = now()
     where order_email_outbox.id = v_row.id;

    id := v_row.id;
    attempt := v_row.attempts + 1;
    recipient_id := v_row.recipient_id;
    order_id := v_row.order_id;
    kind := v_row.kind;
    email := v_email;
    guest := not v_confirmed;
    select coalesce(p.notification_prefs, '{}'::jsonb) into notification_prefs from public.profiles p where p.id = v_row.recipient_id;
    return next;
  end loop;
end;
$$;
revoke all on function public.claim_order_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_order_emails(integer) to service_role;

-- p_outcome: sent, retry, rejected (the provider will never take it), or
-- skipped (p_reason: muted, email_off). Fenced by attempt: a late answer for
-- an earlier attempt changes nothing.
create or replace function public.complete_order_email(
  p_id uuid, p_attempt integer, p_outcome text, p_provider_message_id text default null,
  p_error text default null, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.order_email_outbox%rowtype;
begin
  select * into v_row from public.order_email_outbox where id = p_id for update;
  if not found then return 'gone'; end if;
  if p_outcome <> 'skipped' and (v_row.status <> 'sending' or v_row.attempts <> p_attempt) then return 'stale'; end if;
  if p_outcome = 'sent' then
    update public.order_email_outbox
       set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_message_id, 200),
           last_error = null, lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_id;
    return 'sent';
  elsif p_outcome = 'retry' then
    if v_row.attempts >= 5 then
      update public.order_email_outbox
         set status = 'failed', last_error = left(p_error, 200), lease_id = null, lease_expires_at = null, updated_at = now()
       where id = p_id;
      return 'failed';
    end if;
    update public.order_email_outbox
       set status = 'pending', last_error = left(p_error, 200), lease_id = null, lease_expires_at = null,
           next_attempt_at = now() + (interval '10 minutes' * power(2, greatest(v_row.attempts - 1, 0))), updated_at = now()
     where id = p_id;
    return 'pending';
  elsif p_outcome = 'rejected' then
    update public.order_email_outbox
       set status = 'skipped', skip_reason = 'rejected', last_error = left(p_error, 200), lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_id;
    return 'skipped';
  elsif p_outcome = 'skipped' then
    if p_reason not in ('muted', 'email_off') then raise exception 'Unknown skip reason' using errcode = '22023'; end if;
    update public.order_email_outbox
       set status = 'skipped', skip_reason = p_reason, lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_id and status in ('pending', 'sending');
    return 'skipped';
  end if;
  raise exception 'Unknown outcome %', p_outcome using errcode = '22023';
end;
$$;
revoke all on function public.complete_order_email(uuid, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_order_email(uuid, integer, text, text, text, text) to service_role;

-- No provider: everything waiting is skipped, so a provider turned on later
-- sends only what happens after.
create or replace function public.skip_order_emails_email_off()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.order_email_outbox
     set status = 'skipped', skip_reason = 'email_off', lease_id = null, lease_expires_at = null, updated_at = now()
   where status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.skip_order_emails_email_off() from public, anon, authenticated;
grant execute on function public.skip_order_emails_email_off() to service_role;

-- ---------------------------------------------------------------------------
-- Payout-setup reminders: days 3, 7 and 12 of a sale with payouts still off
-- ---------------------------------------------------------------------------
create or replace function public.raise_payout_setup_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_n integer := 0;
begin
  for v_row in
    select distinct on (o.id) o.id as order_id, o.seller_id,
           (current_date - ti.created_at::date) as day
      from public.transfer_intents ti
      join public.orders o on o.id = ti.order_id
      join public.profiles p on p.id = o.seller_id
     where ti.status in ('holding', 'ready', 'blocked_unpayable', 'failed')
       and o.status not in ('refunded', 'cancelled')
       and not p.payouts_enabled
       and (current_date - ti.created_at::date) in (3, 7, 12)
       and not exists (
         select 1 from public.notifications n
          where n.user_id = o.seller_id and n.kind = 'payout_setup_reminder'
            and n.href = '/orders/' || o.id and n.created_at::date = current_date)
     order by o.id
     limit 200
  loop
    insert into public.notifications (user_id, kind, section, title, body, href)
    values (v_row.seller_id, 'payout_setup_reminder', 'marketplace',
            'Set up payouts to be paid for your sale',
            case v_row.day
              when 12 then 'Two days left: finish your payout setup, or the sale is refunded on day 14.'
              else 'Finish your payout setup within 14 days of the sale, or it is refunded.'
            end,
            '/orders/' || v_row.order_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.raise_payout_setup_reminders() from public, anon, authenticated;
grant execute on function public.raise_payout_setup_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Job inventory: orderEmails joins the money pass. From 20261108100000.
-- ---------------------------------------------------------------------------
create or replace function private.scheduled_job_inventory()
returns table(job text, schedule text, command text, families text[], budget interval)
language sql
immutable
set search_path = public, pg_temp
as $$
  values
    ('drvn-agent-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''agent'');', array['agent'], interval '30 minutes'),
    ('drvn-cron-history-prune', '27 4 * * *', 'select private.prune_cron_history();', array[]::text[], interval '26 hours'),
    ('drvn-deletion-worker', '*/5 * * * *', 'select public.invoke_remediation_worker(''account-deletions'');', array['deletions'], interval '30 minutes'),
    ('drvn-delivery-auto-confirm', '23 * * * *', 'select public.auto_confirm_untracked_deliveries();', array['deliveryAutoConfirm'], interval '3 hours'),
    ('drvn-dispute-sla', '5 8 * * *', 'select public.escalate_stale_disputes();', array[]::text[], interval '26 hours'),
    ('drvn-explore-builders', '*/10 * * * *', 'select public.refresh_explore_builders();', array[]::text[], interval '30 minutes'),
    ('drvn-explore-trending', '*/2 * * * *', 'select public.refresh_explore_trending();', array[]::text[], interval '30 minutes'),
    ('drvn-grow-products', '17 * * * *', 'select public.grow_products()', array[]::text[], interval '3 hours'),
    ('drvn-grow-products-full', '47 4 * * *', 'select public.grow_products(true)', array[]::text[], interval '26 hours'),
    ('drvn-ledger-reconciliation', '50 5 * * *', 'select public.invoke_remediation_worker(''ledger-reconciliation'');', array['ledgerReconciliation'], interval '26 hours'),
    ('drvn-listing-edit-sweep', '45 3 * * *', 'select public.prune_listing_edit_requests();', array[]::text[], interval '26 hours'),
    ('drvn-listing-import-sweep', '37 3 * * *', 'select public.invoke_remediation_worker(''listing-imports'');', array['listingImports'], interval '26 hours'),
    ('drvn-marketplace-counts', '30 seconds', 'select public.refresh_marketplace_facet_counts();', array[]::text[], interval '10 minutes'),
    ('drvn-media-gc', '17 3 * * *', 'select public.invoke_remediation_worker(''media-gc'');', array['media'], interval '26 hours'),
    ('drvn-prune-rate-limits', '15 3 * * *', 'select public.prune_rate_limits();', array[]::text[], interval '26 hours'),
    ('drvn-release-reservations', '*/5 * * * *', 'select public.release_expired_reservations();', array[]::text[], interval '30 minutes'),
    ('drvn-saved-search-digests', '41 * * * *', 'select public.invoke_remediation_worker(''saved-search-digests'');', array['savedSearchDigests'], interval '3 hours'),
    ('drvn-saved-search-worker', '*/30 * * * *', 'select public.invoke_remediation_worker(''saved-searches'');', array['savedSearches'], interval '90 minutes'),
    ('drvn-search-words', '23 * * * *', 'select public.refresh_search_words();', array[]::text[], interval '3 hours'),
    ('drvn-search-worker', '*/2 * * * *', 'select public.invoke_remediation_worker(''search'');', array['search'], interval '30 minutes'),
    ('drvn-transfer-worker', '*/10 * * * *', 'select public.mark_due_transfer_intents(); select public.invoke_transfer_worker();',
      array['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','payoutDeadlines','alerts','receipts','analytics','orderEmails'],
      interval '30 minutes')
$$;
revoke all on function private.scheduled_job_inventory() from public, anon, authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.order_email_outbox', 'select')
     or has_function_privilege('authenticated', 'public.claim_order_emails(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_order_emails(integer)', 'execute') then
    raise exception '20261110140000: the order email outbox is reachable by a member';
  end if;
  raise notice 'PASS: 20261110140000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
