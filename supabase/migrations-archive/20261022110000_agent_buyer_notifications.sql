-- 20261022110000 — the buyer agent's notifications (A3b).
--
-- docs/design/agent-a3 06, the buyer's rows, still offer_-prefixed so the
-- Offers preference governs them:
-- - offer_agent_deal_reached, to the buyer: their agent accepted the
--   seller's counter, within their max. Opens checkout (pay within 24 h).
--   notify() skips a member's own moves, and an agent's accept is recorded
--   as the buyer's, so this is sent from the round with no actor.
-- - offer_agent_out_of_rounds, to the buyer: the seller's counter is over
--   their max and they have no offers left. Says the gap; they may still
--   accept by hand.
-- - The buyer's other approval (a counter over the max with offers left)
--   keeps offer_agent_recommends_accept's slot, worded as a question.
--
-- notify_on_agent_approval is 20261022100000's body with the buyer branches
-- added. Idempotent.

begin;

create or replace function public.notify_on_agent_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_task public.agent_tasks;
  v_mandate public.agent_mandates;
  v_offer public.offers;
  v_title text;
  v_gap integer;
begin
  if new.kind <> 'accept_offer' or new.status <> 'pending' then return new; end if;
  select * into v_task from public.agent_tasks where id = new.task_id;
  select l.title into v_title from public.listings l where l.id = v_task.listing_id;

  if v_task.scope = 'buyer' then
    select * into v_offer from public.offers where id = new.offer_id;
    select * into v_mandate from public.agent_mandates where id = v_task.mandate_id;
    v_gap := coalesce(v_offer.counter_amount_cents, 0) - coalesce(v_mandate.ceiling_cents, 0);
    if new.reason = 'over_ceiling_no_offers_left' then
      perform public.notify(new.owner_id, 'offer_agent_out_of_rounds', 'marketplace',
        'Out of rounds: the seller''s counter is $' || to_char(coalesce(v_offer.counter_amount_cents, 0) / 100.0, 'FM999,999,990.00'),
        v_title || case when v_gap > 0 then ' · $' || to_char(v_gap / 100.0, 'FM999,999,990.00') || ' over your max' else '' end,
        '/offers/' || new.offer_id, null);
    else
      perform public.notify(new.owner_id, 'offer_agent_recommends_accept', 'marketplace',
        'Your agent needs you: the seller''s counter is over your max', v_title, '/offers/' || new.offer_id, null);
    end if;
    return new;
  end if;

  perform public.notify(
    new.owner_id,
    'offer_agent_recommends_accept',
    'marketplace',
    case when new.amount_cents is not null
      then 'Your agent recommends accepting $' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00')
      else 'Your agent needs your answer' end,
    v_title,
    '/offers/' || new.offer_id,
    null
  );
  return new;
end;
$function$;

create or replace function public.notify_on_buyer_agent_accept()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_title text;
  v_order uuid;
  v_amount integer;
begin
  if new.kind <> 'accept' or new.actor_role <> 'buyer' or new.actor_task_id is null then return new; end if;
  select l.title into v_title from public.listings l where l.id = new.listing_id;
  select o.id into v_order from public.orders o where o.origin_offer_id = new.offer_id;
  select counter_amount_cents into v_amount from public.offers where id = new.offer_id;
  perform public.notify(new.buyer_id, 'offer_agent_deal_reached', 'marketplace',
    'Deal reached: your agent accepted ' || coalesce('$' || to_char(v_amount / 100.0, 'FM999,999,990.00'), 'the counter') || ' — pay within 24 hours',
    v_title,
    coalesce('/orders/' || v_order || '/checkout', '/offers/' || new.offer_id),
    null);
  return new;
end;
$function$;

drop trigger if exists offer_rounds_notify_buyer_agent_accept on public.offer_rounds;
create trigger offer_rounds_notify_buyer_agent_accept
  after insert on public.offer_rounds
  for each row execute function public.notify_on_buyer_agent_accept();

revoke all on function public.notify_on_agent_approval() from public, anon, authenticated;
revoke all on function public.notify_on_buyer_agent_accept() from public, anon, authenticated;

commit;
