-- 20261110150000 (Codex's review of #181): a deleted member's words leave
-- other members' feeds, for every case.
--   O  the scrub replaces the leaving seller's listing title in every offer
--      notice their buyers got, with an actor or without (declined, expired,
--      agent recommends, out of rounds keeping its amount, deal reached on
--      /orders/<id>/checkout, listing withdrawn) by a line that still reads,
--      and keeps DRVN's own title and the link
--   K  bodies with none of the leaver's words stay: offer_new's amount, the
--      recipient's own title in offer_withdrawn, DRVN's own cancel reasons
--   D  a leaving buyer's dispute text and cancel reason, as the seller got
--      them, become a line pointing to the order
--   R  the one-time repair applies the same rules to a member scrubbed before
--      20261108180000, clears links to retired handles; a second run changes
--      nothing
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  leaver uuid := gen_random_uuid();   -- scrubbed now, by the restated scrub
  old_leaver uuid := gen_random_uuid(); -- scrubbed before 20261108180000
  buyer uuid := gen_random_uuid();
  fan uuid := gen_random_uuid();
  part uuid; old_part uuid; fan_part uuid;
  offer uuid; old_offer uuid; fan_offer uuid;
  deal uuid := gen_random_uuid();
  bought uuid := gen_random_uuid();
  job uuid; lease uuid := gen_random_uuid();
  r jsonb;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (leaver, 'n181-leaver@drvn.test', '{}'), (old_leaver, 'n181-old@drvn.test', '{}'),
    (buyer, 'n181-buyer@drvn.test', '{}'), (fan, 'n181-fan@drvn.test', '{}');
  update public.profiles set username = 'n181leaver' where id = leaver;

  insert into public.listings (seller_id, title, category, price_cents, status)
    values (leaver, 'Alice''s turbo, call 07123 456789', 'performance', 50000, 'active') returning id into part;
  insert into public.listings (seller_id, title, category, price_cents, status)
    values (old_leaver, 'Bob''s wheels, text 07999 111222', 'performance', 50000, 'active') returning id into old_part;
  insert into public.offers (listing_id, buyer_id, amount_cents, status) values (part, buyer, 40000, 'open') returning id into offer;
  insert into public.offers (listing_id, buyer_id, amount_cents, status) values (old_part, buyer, 40000, 'open') returning id into old_offer;
  -- The leaver as a buyer, from fan.
  insert into public.listings (seller_id, title, category, price_cents, status)
    values (fan, 'Fan''s exhaust', 'performance', 30000, 'active') returning id into fan_part;
  insert into public.offers (listing_id, buyer_id, amount_cents, status) values (fan_part, leaver, 20000, 'open') returning id into fan_offer;
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, origin_offer_id) values
    (deal, buyer, leaver, 'cancelled', 40000, 0, 4000, 40000, 'USD', offer);
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (bought, leaver, fan, 'completed', 30000, 0, 3000, 30000, 'USD', now() - interval '200 days');
  -- Settled long ago: nothing here holds the deletion.

  -- ---------- O ----------
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (buyer, 'offer_declined', 'marketplace', 'Your offer was declined', 'Alice''s turbo, call 07123 456789', '/offers/' || offer, leaver),
    (buyer, 'offer_expired', 'marketplace', 'Your offer expired', 'Alice''s turbo, call 07123 456789', '/offers/' || offer, null),
    (buyer, 'offer_agent_recommends_accept', 'marketplace', 'Your agent recommends accepting $450.00', 'Alice''s turbo, call 07123 456789', '/offers/' || offer, null),
    (buyer, 'offer_agent_out_of_rounds', 'marketplace', 'Out of rounds', 'Alice''s turbo, call 07123 456789 · $50.00 over your max', '/offers/' || offer, null),
    (buyer, 'offer_agent_deal_reached', 'marketplace', 'Deal reached', 'Alice''s turbo, call 07123 456789', '/orders/' || deal || '/checkout', null),
    (buyer, 'offer_listing_withdrawn', 'marketplace', 'The seller withdrew this listing', 'Your offer on "Alice''s turbo, call 07123 456789" has ended. Nothing was charged.', '/offers/' || offer, null),
    -- K: none of the leaver's words.
    (fan, 'offer_new', 'marketplace', 'New offer', '$200.00', '/offers/' || fan_offer, leaver),
    (fan, 'offer_withdrawn', 'marketplace', 'An offer was withdrawn', 'Fan''s exhaust', '/offers/' || fan_offer, leaver),
    (fan, 'order_cancelled', 'marketplace', 'Order cancelled', 'checkout abandoned', '/orders/' || bought, null),
    -- D: the leaver's own words, as the seller got them.
    (fan, 'order_disputed', 'marketplace', 'A buyer opened a dispute', 'It leaks. Call me on 07123 456789', '/orders/' || bought, leaver),
    (fan, 'order_refunded', 'marketplace', 'Order refunded', 'Wrong part, ring 07123 456789', '/orders/' || bought, null);
  insert into public.remediation_jobs (kind, dedup_key, payload, status, lease_id, locked_until)
    values ('delete_account', 'delete:' || leaver, jsonb_build_object('user_id', leaver), 'processing', lease, now() + interval '5 minutes')
    returning id into job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
    values (leaver, job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  perform public.scrub_deleted_account(leaver, null, null);
  if exists (select 1 from public.notifications where user_id in (buyer, fan) and coalesce(body, '') ~ '07123|Alice') then
    fails := fails || format('FAIL O1: a notice kept the deleted member''s words: %s (Codex #181)',
      (select string_agg(kind, ', ') from public.notifications where user_id in (buyer, fan) and coalesce(body, '') ~ '07123|Alice'));
  end if;
  if exists (select 1 from public.notifications where user_id = buyer and kind ~ '^offer_' and (body is null or body = ''))
     or (select body from public.notifications where user_id = buyer and kind = 'offer_agent_out_of_rounds') is distinct from 'A listing by a member who has since left DRVN · $50.00 over your max'
     or (select body from public.notifications where user_id = buyer and kind = 'offer_listing_withdrawn') is distinct from 'Your offer on a listing by a member who has since left DRVN has ended. Nothing was charged.'
     or (select body from public.notifications where user_id = buyer and kind = 'offer_agent_deal_reached') is distinct from 'A listing by a member who has since left DRVN' then
    fails := fails || 'FAIL O3: an offer notice was left with no subject, or lost its amount (Codex #181)'::text;
  end if;
  if (select body from public.notifications where user_id = fan and kind = 'offer_new') is distinct from '$200.00'
     or (select body from public.notifications where user_id = fan and kind = 'offer_withdrawn') is distinct from 'Fan''s exhaust'
     or (select body from public.notifications where user_id = fan and kind = 'order_cancelled') is distinct from 'checkout abandoned' then
    fails := fails || 'FAIL K1: a body with none of the leaver''s words was cleared (Codex #181)'::text;
  end if;
  if (select body from public.notifications where user_id = fan and kind = 'order_disputed') not like 'The description of the problem was removed%'
     or (select body from public.notifications where user_id = fan and kind = 'order_refunded') not like 'The reason was removed%' then
    fails := fails || 'FAIL D1: a leaving buyer''s dispute text or reason was not replaced by a line pointing to the order (Codex #181)'::text;
  end if;
  if not exists (select 1 from public.notifications where user_id = buyer and kind = 'offer_declined' and title = 'Your offer was declined' and href = '/offers/' || offer and actor_id is null) then
    fails := fails || 'FAIL O2: the offer notice lost DRVN''s own title or its link (Codex #181)'::text;
  end if;

  -- ---------- R: a member scrubbed before 20261108180000 ----------
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (fan, 'comment', 'engagement', 'Bob Old commented on your update', 'great car, text me on 07999 111222', '/posts/x', old_leaver),
    (fan, 'follow', 'engagement', 'Bob Old followed you', null, '/u/n181oldhandle', old_leaver),
    (buyer, 'offer_countered', 'marketplace', 'The seller countered', 'Bob''s wheels, text 07999 111222', '/offers/' || old_offer, null);
  insert into private.username_tombstones (username) values ('n181oldhandle') on conflict do nothing;
  insert into public.account_deletion_requests (user_id, outcome, next_action, responsible_owner, scrubbed_at)
    values (old_leaver, 'operator_attention', 'Personal data is removed.', 'operations and policy owner', now() - interval '2 days');

  r := private.repair_scrubbed_previews();
  if exists (select 1 from public.notifications where actor_id = old_leaver)
     or exists (select 1 from public.notifications where user_id = fan and (title ~* 'bob' or coalesce(body, '') ~ '07999')) then
    fails := fails || format('FAIL R1: an already-scrubbed member still names themselves or their words in another member''s feed (%s) (Codex #181)', r);
  end if;
  if exists (select 1 from public.notifications where href = '/u/n181oldhandle') then
    fails := fails || 'FAIL R2: a link to a retired handle survived the repair (Codex #181)'::text;
  end if;
  if (select body from public.notifications where user_id = buyer and href = '/offers/' || old_offer) is distinct from 'A listing by a member who has since left DRVN' then
    fails := fails || 'FAIL R3: an actor-less offer notice kept a scrubbed seller''s listing title, or lost its subject (Codex #181)'::text;
  end if;
  if (r->>'actor_rows')::int < 2 or (r->>'retired_links')::int < 1 or (r->>'offer_bodies')::int < 1 then
    fails := fails || format('FAIL R4: the repair didn''t count what it changed (%s) (Codex #181)', r);
  end if;
  r := private.repair_scrubbed_previews();
  if (r->>'actor_rows')::int <> 0 or (r->>'retired_links')::int <> 0 or (r->>'offer_bodies')::int <> 0 or (r->>'order_bodies')::int <> 0 then
    fails := fails || format('FAIL R5: a second repair changed more rows (%s) (Codex #181)', r);
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all deletion scrub preview repair checks passed';
end $$;

rollback;
