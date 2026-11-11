-- ============================================================================
-- 20261111150000 — an order email the provider may have taken is never sent
-- again past the provider's idempotency window (Codex's final review, P1 on
-- 20261111090000_order_email_outbox.sql)
--
-- A row held for a provider fault stays retryable for 72 hours, but the
-- provider (Resend) keeps an idempotency key for 24. If the provider accepted
-- a send and the worker died before recording it (the lease runs out), or a
-- send timed out after the provider took it (a retry), a claim more than a
-- day later sent the email again under a key the provider had forgotten.
--
--   * public.order_email_outbox.handed_to_provider_at: when the first
--     attempt the provider may have accepted began. Set by the claim when it
--     takes back a row whose lease ran out, and by complete_order_email on a
--     retry, unless the worker says it never called the provider
--     (p_reason 'not_sent', an order it could not read). A refusal of our
--     account ('provider'), a rate limit, a rejection or a send does not set
--     it.
--   * public.claim_order_emails: a row with that time more than 20 hours ago
--     (four hours under the provider's 24) is not claimed. It becomes
--     'failed' with a last_error saying why, and an order_email_failed alert
--     is queued in admin_alert_outbox (dedup 'order-email-failed:<row>', the
--     key the worker uses for an email that will not be sent). Rows never
--     handed to the provider keep their 24- and 72-hour windows.
--   * public.complete_order_email: the retry branch records the time; nothing
--     else changed.
--
-- No data is changed: no email provider is configured, so no row has been
-- handed to one; existing rows start with the new column null. There is no
-- call to the provider to reconcile a row.
--
-- Restated, from their latest definitions (supabase/schema/functions/, both
-- from 20261111090000):
--   public.claim_order_emails(integer)
--   public.complete_order_email(uuid, integer, text, text, text, text, integer)
-- Guard: supabase/tests/order_email_resend_window_guard.sql. Apply with the
-- app from the same PR (src/lib/order-emails.ts sends 'not_sent'); the old
-- app against the new database counts its unreadable-order retries as
-- possibly sent, which only ends a row sooner.
-- ============================================================================

begin;

alter table public.order_email_outbox add column if not exists handed_to_provider_at timestamptz;
comment on column public.order_email_outbox.handed_to_provider_at is
  'When the first attempt the email provider may have accepted began (20261111150000). Past 20 hours the row is never sent again.';

CREATE OR REPLACE FUNCTION public.claim_order_emails(p_limit integer)
 RETURNS TABLE(id uuid, attempt integer, recipient_id uuid, order_id uuid, kind text, email text, guest boolean, buyer boolean, notification_prefs jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_row record;
  v_email text;
  v_confirmed boolean;
  v_buyer_id uuid;
  v_seller_id uuid;
  v_party boolean;
  v_buyer boolean;
  v_reason text;
  v_handed timestamptz;
  v_lease uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_claimed integer := 0;
begin
  for v_row in
    select q.id, q.recipient_id, q.order_id, q.kind, q.attempts, q.created_at, q.provider_held_at,
           q.status, q.lease_expires_at, q.handed_to_provider_at
      from public.order_email_outbox q
     where (q.status = 'pending' and q.next_attempt_at <= now())
        or (q.status = 'sending' and q.lease_expires_at < now())
     order by q.next_attempt_at, q.created_at, q.id
     limit 500
     for update of q skip locked
  loop
    exit when v_claimed >= v_limit;
    select nullif(btrim(u.email), ''), u.confirmed_at is not null into v_email, v_confirmed
      from auth.users u where u.id = v_row.recipient_id;
    -- "Is a party" and "is the buyer" are two questions, and neither may be
    -- answered by a null: an order whose buyer's account is gone has a null
    -- buyer_id, and its seller is still a party (review of #204).
    v_buyer_id := null;
    v_seller_id := null;
    select o.buyer_id, o.seller_id into v_buyer_id, v_seller_id from public.orders o where o.id = v_row.order_id;
    v_buyer := v_row.recipient_id is not distinct from v_buyer_id;
    v_party := v_buyer or v_row.recipient_id is not distinct from v_seller_id;

    -- When the provider may first have taken this row (20261111150000): an
    -- attempt whose lease ran out may have been sent. A lease is five
    -- minutes, so the attempt began five minutes before it ran out.
    v_handed := v_row.handed_to_provider_at;
    if v_row.status = 'sending' and v_handed is null then
      v_handed := v_row.lease_expires_at - interval '5 minutes';
    end if;

    v_reason := case
      when v_row.created_at < now() - case when v_row.provider_held_at is not null then interval '72 hours' else interval '24 hours' end then 'stale'
      when exists (select 1 from public.profiles p where p.id = v_row.recipient_id and p.suspended_at is not null)
        or exists (select 1 from public.account_deletion_requests r where r.user_id = v_row.recipient_id
                    and (r.outcome <> 'temporary_financial_hold' or r.scrubbed_at is not null)) then 'account_closed'
      when not v_party then 'not_a_party'
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

    -- The provider keeps an idempotency key for 24 hours (Resend). Past 20,
    -- a row it may have taken is never sent again: it fails, and an
    -- operator is told, as for any order email that will not be sent.
    if v_handed is not null and v_handed < now() - interval '20 hours' then
      update public.order_email_outbox
         set status = 'failed', handed_to_provider_at = v_handed,
             last_error = 'may have been sent: past the provider''s idempotency window, not sent again',
             lease_id = null, lease_expires_at = null, updated_at = now()
       where order_email_outbox.id = v_row.id;
      insert into public.admin_alert_outbox (kind, title, detail, order_id, dedup_key, status)
      values ('order_email_failed', 'An order email may not have been sent',
              format('%s for order %s (outbox row %s): an attempt the provider may have accepted is past its 24-hour idempotency window, so it was not sent again. Check the provider''s log; the in-app notice stands.', v_row.kind, v_row.order_id, v_row.id),
              v_row.order_id, 'order-email-failed:' || v_row.id, 'pending')
      on conflict (dedup_key) do nothing;
      continue;
    end if;

    -- Twenty an hour to one person: the rest wait half an hour, in order.
    if (select count(*) from public.order_email_outbox s
         where s.recipient_id = v_row.recipient_id
           and ((s.status = 'sent' and s.sent_at > now() - interval '1 hour') or s.status = 'sending')) >= 20 then
      update public.order_email_outbox
         set status = 'pending', next_attempt_at = now() + interval '30 minutes', handed_to_provider_at = v_handed, lease_id = null, lease_expires_at = null, updated_at = now()
       where order_email_outbox.id = v_row.id;
      continue;
    end if;

    v_lease := gen_random_uuid();
    update public.order_email_outbox
       set status = 'sending', attempts = order_email_outbox.attempts + 1, handed_to_provider_at = v_handed, lease_id = v_lease,
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
$function$;

CREATE OR REPLACE FUNCTION public.complete_order_email(p_id uuid, p_attempt integer, p_outcome text, p_provider_message_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_retry_after integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.order_email_outbox%rowtype;
  v_until timestamptz;
begin
  select * into v_row from public.order_email_outbox where id = p_id for update;
  if not found then return 'gone'; end if;
  if p_outcome <> 'skipped' and (v_row.status <> 'sending' or v_row.attempts <> p_attempt) then return 'stale'; end if;
  if p_outcome = 'sent' then
    update public.order_email_outbox
       set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_message_id, 200),
           -- Null, except a note on how it came to be counted as sent (a repeated key the provider refused).
           last_error = left(p_error, 200), lease_id = null, lease_expires_at = null, updated_at = now()
     where id = p_id;
    return 'sent';
  elsif p_outcome = 'retry' then
    if v_row.attempts >= 5 then
      update public.order_email_outbox
         set status = 'failed', last_error = left(p_error, 200), lease_id = null, lease_expires_at = null, updated_at = now()
       where id = p_id;
      return 'failed';
    end if;
    -- A retry after a send may have been accepted (a timeout, a 5xx): from
    -- the attempt's start, the lease's less five minutes. 'not_sent': the
    -- worker never called the provider (20261111150000).
    update public.order_email_outbox
       set status = 'pending', last_error = left(p_error, 200), lease_id = null, lease_expires_at = null,
           handed_to_provider_at = case when p_reason is distinct from 'not_sent'
                                        then coalesce(v_row.handed_to_provider_at, v_row.lease_expires_at - interval '5 minutes')
                                        else v_row.handed_to_provider_at end,
           next_attempt_at = now() + (interval '10 minutes' * power(2, greatest(v_row.attempts - 1, 0))), updated_at = now()
     where id = p_id;
    return 'pending';
  elsif p_outcome = 'provider' then
    update public.order_email_outbox
       set status = 'pending', attempts = greatest(v_row.attempts - 1, 0), provider_held_at = coalesce(v_row.provider_held_at, now()),
           last_error = left(p_error, 200), lease_id = null, lease_expires_at = null,
           next_attempt_at = now() + interval '10 minutes', updated_at = now()
     where id = p_id;
    -- One window while the fault stands: the pass stops at the first row it
    -- tries, so every other waiting row is marked here, or it would go stale
    -- at 24 hours without ever having been tried (review of #204).
    update public.order_email_outbox
       set provider_held_at = now()
     where status = 'pending' and provider_held_at is null;
    return 'held';
  elsif p_outcome = 'rate_limited' then
    -- Not this message's fault and not ours: the attempt is not counted. The
    -- provider's own wait is honoured for the whole queue (nothing waiting is
    -- claimed before it), a minute when it names none, an hour at most.
    v_until := now() + make_interval(secs => least(greatest(coalesce(p_retry_after, 60), 1), 3600));
    update public.order_email_outbox
       set status = 'pending', attempts = greatest(v_row.attempts - 1, 0),
           last_error = left(p_error, 200), lease_id = null, lease_expires_at = null,
           next_attempt_at = v_until, updated_at = now()
     where id = p_id;
    update public.order_email_outbox
       set next_attempt_at = v_until
     where status = 'pending' and next_attempt_at < v_until;
    return 'limited';
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
$function$;

revoke all on function public.claim_order_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_order_emails(integer) to service_role;
revoke all on function public.complete_order_email(uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.complete_order_email(uuid, integer, text, text, text, text, integer) to service_role;

-- Self-check: the column is there, both functions use it, and only the
-- server key can call them.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_email_outbox' and column_name = 'handed_to_provider_at') then
    raise exception '20261111150000: order_email_outbox.handed_to_provider_at is missing';
  end if;
  if position('handed_to_provider_at' in pg_get_functiondef('public.claim_order_emails(integer)'::regprocedure)) = 0
     or position('20 hours' in pg_get_functiondef('public.claim_order_emails(integer)'::regprocedure)) = 0
     or position('not_sent' in pg_get_functiondef('public.complete_order_email(uuid, integer, text, text, text, text, integer)'::regprocedure)) = 0 then
    raise exception '20261111150000: claim_order_emails or complete_order_email was not restated';
  end if;
  if has_function_privilege('anon', 'public.claim_order_emails(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_order_emails(integer)', 'execute')
     or has_function_privilege('anon', 'public.complete_order_email(uuid, integer, text, text, text, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_order_email(uuid, integer, text, text, text, text, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.claim_order_emails(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.complete_order_email(uuid, integer, text, text, text, text, integer)', 'execute') then
    raise exception '20261111150000: the order email functions are not service-role only';
  end if;
end $$;

commit;
