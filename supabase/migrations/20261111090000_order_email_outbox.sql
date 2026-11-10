-- ============================================================================
-- 20261111090000 — order emails through an outbox (report five #116, OS-W41)
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
--     skipped; so is anything past 20 emails to one recipient in an hour
--     (sent in the hour, or being sent). A deletion held for money owed
--     (temporary_financial_hold, not scrubbed) still gets order emails.
--     A member needs a confirmed address; an unconfirmed one (a guest) is
--     sent only the buyer's emails of their own order.
--   * A deletion request skips the member's pending rows at once.
--   * raise_payout_setup_reminders(): one in-app notice (and so one email) a
--     day to a seller with payouts still off when any unpaid sale is 3, 7 or
--     12 days old, covering all of them; recorded in payout_setup_reminders.
--     Run by the payoutDeadlines family.
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
    'order_disputed', 'dispute_resolved', 'admin_action', 'order_refunded', 'payout_setup_reminder',
    'order_cancelled', 'order_partially_refunded', 'dispatch_reminder')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  skip_reason text check (skip_reason is null or skip_reason in (
    'email_off', 'stale', 'account_closed', 'no_address', 'not_a_party', 'muted', 'rejected')),
  -- Set while the row waits because our own account with the provider is at
  -- fault (a rotated key, a lapsed domain): such a row is not counted as an
  -- attempt and is kept 72 hours, not 24 (work review #147).
  provider_held_at timestamptz,
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
-- What an operator looks at, and what the prune removes.
create index if not exists order_email_outbox_settled_idx on public.order_email_outbox (updated_at) where status in ('sent', 'skipped', 'failed');

alter table public.order_email_outbox enable row level security;
revoke all on table public.order_email_outbox from public, anon, authenticated;
grant all on table public.order_email_outbox to service_role;

comment on table public.order_email_outbox is
  'Order emails waiting to be sent (20261111090000, #116): user id and order id only; the address is read at send. Service role only.';

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
                      'order_disputed', 'dispute_resolved', 'admin_action', 'order_refunded', 'payout_setup_reminder',
                      'order_cancelled', 'order_partially_refunded', 'dispatch_reminder') then
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
  -- A held deletion (temporary_financial_hold) leaves the member settling
  -- orders with their account: they still need these emails.
  if new.user_id is not null and (new.outcome <> 'temporary_financial_hold' or new.scrubbed_at is not null) then
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
  after insert or update of outcome, scrubbed_at on public.account_deletion_requests
  for each row execute function private.order_emails_account_closed();

-- ---------------------------------------------------------------------------
-- Claim and complete
-- ---------------------------------------------------------------------------
-- Claims up to p_limit rows to send. Rows that can never be sent (stale, a
-- closed account, no address) are marked skipped on the way and do not count
-- towards p_limit: a skipped row at the head of the queue used to end the
-- pass with nothing sent (work review #147). A member at the hourly cap is
-- passed over and tried again later, not dropped.
drop function if exists public.claim_order_emails(integer);
create or replace function public.claim_order_emails(p_limit integer)
returns table (id uuid, attempt integer, recipient_id uuid, order_id uuid, kind text, email text, guest boolean, buyer boolean, notification_prefs jsonb)
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
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_claimed integer := 0;
begin
  for v_row in
    select q.id, q.recipient_id, q.order_id, q.kind, q.attempts, q.created_at, q.provider_held_at
      from public.order_email_outbox q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.lease_expires_at < now())
     order by q.next_attempt_at, q.id
     limit 500
     for update of q skip locked
  loop
    exit when v_claimed >= v_limit;
    select nullif(btrim(u.email), ''), u.confirmed_at is not null into v_email, v_confirmed
      from auth.users u where u.id = v_row.recipient_id;
    select v_row.recipient_id = o.buyer_id into v_buyer from public.orders o where o.id = v_row.order_id;

    v_reason := case
      when v_row.created_at < now() - case when v_row.provider_held_at is not null then interval '72 hours' else interval '24 hours' end then 'stale'
      when exists (select 1 from public.profiles p where p.id = v_row.recipient_id and p.suspended_at is not null)
        or exists (select 1 from public.account_deletion_requests r where r.user_id = v_row.recipient_id
                    and (r.outcome <> 'temporary_financial_hold' or r.scrubbed_at is not null)) then 'account_closed'
      when v_buyer is null then 'not_a_party'
      when v_email is null then 'no_address'
      -- An unconfirmed address is a guest's: only the buyer's own emails.
      when not v_confirmed and not (v_buyer and v_row.kind in ('order_paid', 'order_shipped', 'receipt_auto_confirmed', 'order_refunded', 'order_partially_refunded', 'order_cancelled', 'dispute_resolved', 'admin_action')) then 'no_address'
    end;

    if v_reason is not null then
      update public.order_email_outbox
         set status = 'skipped', skip_reason = v_reason, lease_id = null, lease_expires_at = null, updated_at = now()
       where order_email_outbox.id = v_row.id;
      continue;
    end if;

    -- Twenty an hour to one person: the rest wait half an hour, in order.
    if (select count(*) from public.order_email_outbox s
         where s.recipient_id = v_row.recipient_id
           and ((s.status = 'sent' and s.sent_at > now() - interval '1 hour') or s.status = 'sending')) >= 20 then
      update public.order_email_outbox
         set status = 'pending', next_attempt_at = now() + interval '30 minutes', lease_id = null, lease_expires_at = null, updated_at = now()
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
    buyer := v_buyer;
    select coalesce(p.notification_prefs, '{}'::jsonb) into notification_prefs from public.profiles p where p.id = v_row.recipient_id;
    v_claimed := v_claimed + 1;
    return next;
  end loop;
end;
$$;
revoke all on function public.claim_order_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_order_emails(integer) to service_role;

-- p_outcome: sent, retry, rejected (the provider will never take it), provider
-- (our own account with the provider is at fault: the row goes back to
-- waiting, this attempt is not counted, and it is kept 72 hours), or skipped
-- (p_reason: muted, email_off). Fenced by attempt: a late answer for an
-- earlier attempt changes nothing. Returns the row's new status, or 'held'.
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
  elsif p_outcome = 'provider' then
    update public.order_email_outbox
       set status = 'pending', attempts = greatest(v_row.attempts - 1, 0), provider_held_at = coalesce(v_row.provider_held_at, now()),
           last_error = left(p_error, 200), lease_id = null, lease_expires_at = null,
           next_attempt_at = now() + interval '10 minutes', updated_at = now()
     where id = p_id;
    return 'held';
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
-- Payout-setup reminders: one a day per seller, on days 3, 7 and 12 of a sale
-- with payouts still off. Recorded in its own row (seller, day), so the
-- dedupe never depends on the in-app notice surviving; one reminder covers
-- every unpaid sale and links to the most urgent (the oldest).
-- ---------------------------------------------------------------------------
create table if not exists public.payout_setup_reminders (
  seller_id uuid not null references auth.users (id) on delete cascade,
  reminded_on date not null,
  order_id uuid not null,
  sale_count integer not null check (sale_count >= 1),
  oldest_day integer not null,
  created_at timestamptz not null default now(),
  primary key (seller_id, reminded_on)
);
alter table public.payout_setup_reminders enable row level security;
revoke all on table public.payout_setup_reminders from public, anon, authenticated;
grant all on table public.payout_setup_reminders to service_role;
comment on table public.payout_setup_reminders is
  'One payout-setup reminder per seller per day (20261111090000, #116). Service role only.';

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
    with unpaid as (
      select o.id as order_id, o.seller_id, (current_date - min(ti.created_at)::date) as day
        from public.transfer_intents ti
        join public.orders o on o.id = ti.order_id
        join public.profiles p on p.id = o.seller_id
       where ti.status in ('holding', 'ready', 'blocked_unpayable', 'failed')
         and o.status not in ('refunded', 'cancelled')
         and not p.payouts_enabled
       group by o.id, o.seller_id
    )
    select u.seller_id,
           count(*)::integer as sale_count,
           max(u.day) as oldest_day,
           (array_agg(u.order_id order by u.day desc, u.order_id))[1] as order_id
      from unpaid u
     where u.day between 0 and 13
       -- Before the limit: with it after, sellers past the first 200 by id were never reached.
       and not exists (select 1 from public.payout_setup_reminders r where r.seller_id = u.seller_id and r.reminded_on = current_date)
     group by u.seller_id
    having bool_or(u.day in (3, 7, 12))
     order by u.seller_id
     limit 200
  loop
    insert into public.payout_setup_reminders (seller_id, reminded_on, order_id, sale_count, oldest_day)
    values (v_row.seller_id, current_date, v_row.order_id, v_row.sale_count, v_row.oldest_day)
    on conflict (seller_id, reminded_on) do nothing;
    if not found then
      continue;
    end if;
    insert into public.notifications (user_id, kind, section, title, body, href)
    values (v_row.seller_id, 'payout_setup_reminder', 'marketplace',
            case when v_row.sale_count > 1 then format('Set up payouts to be paid for your %s sales', v_row.sale_count)
                 else 'Set up payouts to be paid for your sale' end,
            case when v_row.oldest_day >= 12
                 then format('%s left: finish your payout setup, or the oldest sale is refunded on day 14.',
                             case when 14 - v_row.oldest_day = 1 then 'One day' else (14 - v_row.oldest_day)::text || ' days' end)
                 else 'Finish your payout setup within 14 days of each sale, or it is refunded.' end,
            '/orders/' || v_row.order_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.raise_payout_setup_reminders() from public, anon, authenticated;
grant execute on function public.raise_payout_setup_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- A partial refund has no notice of its own (work review #147): the order's
-- status does not change, so notify_on_order_status says nothing, and the
-- buyer learns of the money only from their bank. This raises one, to both
-- parties, when refunded_cents rises and the order is not fully refunded. A
-- full refund keeps its own notice (order_refunded). A chargeback the bank
-- decided is not a refund from DRVN and raises nothing here.
-- ---------------------------------------------------------------------------
create or replace function private.notify_on_partial_refund()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_amount text;
begin
  if new.refunded_cents <= old.refunded_cents or new.refunded_cents >= new.total_cents
     or new.status in ('refunded', 'cancelled')
     or coalesce(new.cancel_reason, '') like 'Card dispute lost (%' then
    return new;
  end if;
  v_amount := to_char((new.refunded_cents - old.refunded_cents) / 100.0, 'FM999G999G990D00') || ' ' || upper(new.currency);
  perform public.notify(new.buyer_id, 'order_partially_refunded', 'marketplace',
    'Part of your order was refunded', v_amount || ' was refunded to the card you paid with.', '/orders/' || new.id, null);
  perform public.notify(new.seller_id, 'order_partially_refunded', 'marketplace',
    'A partial refund was issued on a sale', v_amount || ' was refunded to the buyer.', '/orders/' || new.id, null);
  return new;
end;
$$;
revoke all on function private.notify_on_partial_refund() from public, anon, authenticated;

drop trigger if exists orders_notify_partial_refund on public.orders;
create trigger orders_notify_partial_refund
  after update of refunded_cents on public.orders
  for each row execute function private.notify_on_partial_refund();

-- ---------------------------------------------------------------------------
-- The dispatch deadline (work review #147): a seller is told once, a day
-- ahead, that a paid order must be dispatched by its date (orders.dispatch_by,
-- frozen when the order was paid; null for collection). One reminder per
-- order, recorded in its own row so the dedupe does not depend on the notice
-- surviving. Called by the money pass, after the payout reminders.
-- ---------------------------------------------------------------------------
create table if not exists public.dispatch_reminders (
  order_id uuid primary key,
  seller_id uuid not null references auth.users (id) on delete cascade,
  dispatch_by timestamptz not null,
  created_at timestamptz not null default now()
);
-- The foreign key's own index: deleting a member looks their rows up by it.
create index if not exists dispatch_reminders_seller_idx on public.dispatch_reminders (seller_id);
alter table public.dispatch_reminders enable row level security;
revoke all on table public.dispatch_reminders from public, anon, authenticated;
grant all on table public.dispatch_reminders to service_role;
comment on table public.dispatch_reminders is
  'One dispatch reminder per order (20261111090000, work review #147). Service role only.';

create or replace function public.raise_dispatch_reminders()
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
    select o.id, o.seller_id, o.dispatch_by
      from public.orders o
     where o.status = 'paid' and o.shipped_at is null
       and o.dispatch_by is not null and o.dispatch_by <= now() + interval '24 hours'
       -- Not for an order long past its date: that is the dispatch deadline's own handling.
       and o.dispatch_by > now() - interval '24 hours'
       and not exists (select 1 from public.dispatch_reminders r where r.order_id = o.id)
     order by o.dispatch_by
     limit 200
  loop
    insert into public.dispatch_reminders (order_id, seller_id, dispatch_by)
    values (v_row.id, v_row.seller_id, v_row.dispatch_by)
    on conflict (order_id) do nothing;
    if not found then
      continue;
    end if;
    perform public.notify(v_row.seller_id, 'dispatch_reminder', 'marketplace',
      'An order is due to be dispatched', 'Mark it dispatched with its tracking number once it is on its way.', '/orders/' || v_row.id, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.raise_dispatch_reminders() from public, anon, authenticated;
grant execute on function public.raise_dispatch_reminders() to service_role;

-- ---------------------------------------------------------------------------
-- Pruning (work review #147): nothing removed a settled row. Sent, skipped
-- and failed rows go after 90 days, as do the two reminder ledgers; the rate
-- cap only reads the last hour. Restated from 20261110190000 with these
-- three deletes added (the job is unchanged).
-- ---------------------------------------------------------------------------
create or replace function private.prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics removed = row_count;
  -- Rows an offer is writing right now are skipped, not waited for.
  delete from private.photo_signatures d
   where d.ctid in (select x.ctid from private.photo_signatures x
                     where x.created_at < now() - interval '2 hours'
                     for update skip locked);
  -- 20261110190000: quarantined photo references past their 90 days.
  delete from private.photo_refs_quarantined where expires_at < now();
  -- 20261111090000: settled order emails and reminder ledgers past 90 days.
  delete from public.order_email_outbox where status in ('sent', 'skipped', 'failed') and updated_at < now() - interval '90 days';
  delete from public.payout_setup_reminders where created_at < now() - interval '90 days';
  delete from public.dispatch_reminders where created_at < now() - interval '90 days';
  return removed;
end;
$$;
revoke all on function private.prune_cron_history() from public, anon, authenticated;

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
     or has_function_privilege('anon', 'public.claim_order_emails(integer)', 'execute')
     or has_table_privilege('authenticated', 'public.payout_setup_reminders', 'select')
     or has_table_privilege('authenticated', 'public.dispatch_reminders', 'select')
     or has_function_privilege('authenticated', 'public.skip_order_emails_email_off()', 'execute')
     or has_function_privilege('authenticated', 'public.raise_dispatch_reminders()', 'execute')
     or has_function_privilege('anon', 'public.raise_dispatch_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.complete_order_email(uuid, integer, text, text, text, text)', 'execute') then
    raise exception '20261111090000: the order email outbox is reachable by a member (N1063)';
  end if;
  -- A trigger function runs as the role that writes the row: every one here is SECURITY DEFINER.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname in ('queue_order_email', 'order_emails_account_closed', 'notify_on_partial_refund')
                and not p.prosecdef) then
    raise exception '20261111090000: an order email trigger function is not SECURITY DEFINER (N1063)';
  end if;
  raise notice 'PASS: 20261111090000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
