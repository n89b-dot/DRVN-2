-- 20261022100000 — the seller agent's notifications (A3a).
--
-- Three notices, in the Marketplace group with no agent badge
-- (docs/design/agent-a3 06). Each kind starts with offer_, so the member's
-- "Offers and sales" preference governs them like every other offer notice.
--
-- - offer_agent_recommends_accept: the agent filed an approval (an offer
--   reached the seller's target, or the buyer's final offer clears the
--   minimum). Opens the offer.
-- - offer_agent_deal_reached: the buyer accepted a counter the seller's
--   agent made. This replaces offer_counter_accepted for that case and
--   opens the offer, where Cancel before checkout lives.
-- - offer_agent_out_of_rounds: the agent stopped because the buyer has no
--   offers left. The body states the gap to the seller's own minimum, which
--   only the seller receives.
--
-- notify_on_offer_response is the live 20261017160000 body with the
-- accepted-counter branch split; nothing else changes. Idempotent.

begin;

CREATE OR REPLACE FUNCTION public.notify_on_offer_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seller uuid;
  v_listing_title text;
  v_order uuid;
  v_agent_counter boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  select l.seller_id, l.title into v_seller, v_listing_title
  from public.listings l where l.id = new.listing_id;

  -- Buyer-facing outcomes. A seller's acceptance is announced by the app,
  -- with the checkout link the buyer needs.
  if new.status in ('declined', 'countered') then
    perform public.notify(
      new.buyer_id, 'offer_' || new.status, 'marketplace',
      case new.status
        when 'declined' then 'Your offer was declined'
        else 'The seller countered your offer'
      end,
      v_listing_title, '/offers/' || new.id, v_seller
    );
  end if;

  -- Seller-facing: the buyer took the seller's counter. When the counter
  -- was the seller's agent's (A3a), it is a deal the agent reached: the
  -- notice opens the offer, where Cancel before checkout lives.
  if new.status = 'accepted' and new.counter_amount_cents is not null then
    select o.id into v_order from public.orders o where o.origin_offer_id = new.id;
    select r.actor_task_id is not null into v_agent_counter
    from public.offer_rounds r
    where r.offer_id = new.id and r.actor_role = 'seller' and r.kind = 'counter'
    order by r.round_no desc limit 1;
    if coalesce(v_agent_counter, false) then
      perform public.notify(
        v_seller, 'offer_agent_deal_reached', 'marketplace',
        'Deal reached: the buyer accepted your agent''s counter', v_listing_title,
        '/offers/' || new.id, new.buyer_id
      );
    else
      perform public.notify(
        v_seller, 'offer_counter_accepted', 'marketplace',
        'Your counter was accepted', v_listing_title,
        coalesce('/orders/' || v_order, '/offers/' || new.id), new.buyer_id
      );
    end if;
  end if;

  -- Seller-facing: the buyer countered back (negotiation v2).
  if new.status = 'open' and old.status = 'countered' then
    perform public.notify(
      v_seller, 'offer_countered_back', 'marketplace',
      'The buyer countered your offer', v_listing_title, '/offers/' || new.id, new.buyer_id
    );
  end if;

  -- Both sides: the turn ran out (20261017160000).
  if new.status = 'expired' then
    perform public.notify(
      new.buyer_id, 'offer_expired', 'marketplace',
      'Your offer expired', v_listing_title, '/offers/' || new.id, null
    );
    perform public.notify(
      v_seller, 'offer_expired', 'marketplace',
      'An offer expired', v_listing_title, '/offers/' || new.id, null
    );
  end if;

  -- Seller-facing: the buyer walked away.
  if new.status = 'withdrawn' then
    perform public.notify(
      v_seller, 'offer_withdrawn', 'marketplace',
      'An offer was withdrawn', v_listing_title, '/offers/' || new.id, new.buyer_id
    );
  end if;

  return new;
end;
$function$;

create or replace function public.notify_on_agent_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_task public.agent_tasks;
  v_title text;
begin
  if new.kind <> 'accept_offer' or new.status <> 'pending' then return new; end if;
  select * into v_task from public.agent_tasks where id = new.task_id;
  select l.title into v_title from public.listings l where l.id = v_task.listing_id;
  perform public.notify(
    new.owner_id,
    'offer_agent_recommends_accept',
    'marketplace',
    case when v_task.scope = 'seller' and new.amount_cents is not null
      then 'Your agent recommends accepting $' || to_char(new.amount_cents / 100.0, 'FM999,999,990.00')
      else 'Your agent needs your answer' end,
    v_title,
    '/offers/' || new.offer_id,
    null
  );
  return new;
end;
$function$;

drop trigger if exists agent_approvals_notify on public.agent_approvals;
create trigger agent_approvals_notify
  after insert on public.agent_approvals
  for each row execute function public.notify_on_agent_approval();

create or replace function public.notify_on_agent_out_of_rounds()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_task public.agent_tasks;
  v_offer public.offers;
  v_mandate public.agent_mandates;
  v_title text;
  v_body text;
  v_href text;
begin
  if new.kind <> 'decision' or coalesce(new.result->>'reason', '') <> 'no_offers_left' then return new; end if;
  select * into v_task from public.agent_tasks where id = new.task_id;
  if v_task.id is null or v_task.scope <> 'seller' or v_task.offer_id is null then return new; end if;
  v_href := '/offers/' || v_task.offer_id;
  -- Once per offer: the agent may record the same hold more than once.
  if exists (select 1 from public.notifications n
             where n.user_id = new.owner_id and n.kind = 'offer_agent_out_of_rounds' and n.href = v_href) then
    return new;
  end if;
  select * into v_offer from public.offers where id = v_task.offer_id;
  select * into v_mandate from public.agent_mandates where id = v_task.mandate_id;
  select l.title into v_title from public.listings l where l.id = v_task.listing_id;
  v_body := v_title;
  if v_offer.amount_cents is not null and v_mandate.minimum_cents is not null and v_mandate.minimum_cents > v_offer.amount_cents then
    v_body := v_title || ' · $' || to_char((v_mandate.minimum_cents - v_offer.amount_cents) / 100.0, 'FM999,999,990.00')
      || ' between the buyer''s $' || to_char(v_offer.amount_cents / 100.0, 'FM999,999,990.00')
      || ' and your $' || to_char(v_mandate.minimum_cents / 100.0, 'FM999,999,990.00') || ' minimum';
  end if;
  perform public.notify(new.owner_id, 'offer_agent_out_of_rounds', 'marketplace',
    'Out of rounds: the buyer has no offers left', v_body, v_href, null);
  return new;
end;
$function$;

drop trigger if exists agent_events_notify_out_of_rounds on public.agent_events;
create trigger agent_events_notify_out_of_rounds
  after insert on public.agent_events
  for each row execute function public.notify_on_agent_out_of_rounds();

revoke all on function public.notify_on_agent_approval() from public, anon, authenticated;
revoke all on function public.notify_on_agent_out_of_rounds() from public, anon, authenticated;

commit;
