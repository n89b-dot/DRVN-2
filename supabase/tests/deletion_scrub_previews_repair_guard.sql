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
--   S  (N1069, work review #153) a saved-search notice that named the leaver's listing
--      to another member loses that title, whole and in its place, and keeps
--      the other titles; one that names none of theirs is untouched
--   E  (N1069, work review #153) saved-search emails: one not yet sent loses the
--      leaver's items, and is not sent when none is left; one already sent
--      keeps its shape with a neutral title
--   U  (N1069, work review #153) every kind says whose words it carries: a kind the
--      classification does not know is scrubbed as the actor's words, DRVN's
--      own text stays, every kind a function writes by name is classified,
--      and with drvn.strict_notification_kinds on an unclassified kind is refused
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
  search uuid; d_trim uuid; d_skip uuid; d_sent uuid; d_old uuid; d_gone uuid;
  refused boolean;
  unknown text;
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
  -- ---------- S, E, U fixtures ----------
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (fan, 'saved_search', 'marketplace', 'New match for JDM turbos: Alice''s turbo, call 07123 456789', 'Alice''s turbo, call 07123 456789', '/marketplace?q=turbo', null),
    (fan, 'saved_search', 'marketplace', '3 new parts match JDM turbos', 'Fan''s exhaust · Alice''s turbo, call 07123 456789 · Someone''s intake', '/marketplace?q=turbo', null),
    (fan, 'saved_search', 'marketplace', 'New match for exhausts: Fan''s exhaust', 'Fan''s exhaust', '/marketplace?q=exhaust', null),
    -- DRVN's own words, with the leaver as the actor: they stay.
    (fan, 'refund_offered', 'marketplace', 'The seller offered a refund', '$20.00: review it on the order.', '/orders/' || bought, leaver);
  -- A kind nobody classified, as production (strict mode off) would take it.
  perform set_config('drvn.strict_notification_kinds', 'off', true);
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (fan, 'n153_new_kind', 'engagement', 'Alice did a new thing', 'Alice wrote this, 07123 456789', null, leaver);
  insert into public.saved_searches (user_id, name, alert) values (fan, 'JDM turbos', true) returning id into search;
  insert into public.saved_search_email_digests (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status)
    values (search, current_date, now() - interval '1 day', now(), 'JDM turbos', '/marketplace?q=turbo', 5,
            jsonb_build_array(jsonb_build_object('id', part, 'title', 'Alice''s turbo, call 07123 456789', 'price_cents', 50000),
                              jsonb_build_object('id', fan_part, 'title', 'Fan''s exhaust', 'price_cents', 30000)), 'pending')
    returning id into d_trim;
  insert into public.saved_search_email_digests (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status)
    values (search, current_date - 1, now() - interval '2 days', now() - interval '1 day', 'JDM turbos', '/marketplace?q=turbo', 1,
            jsonb_build_array(jsonb_build_object('id', part, 'title', 'Alice''s turbo, call 07123 456789', 'price_cents', 50000)), 'pending')
    returning id into d_skip;
  insert into public.saved_search_email_digests (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status, sent_at)
    values (search, current_date - 2, now() - interval '3 days', now() - interval '2 days', 'JDM turbos', '/marketplace?q=turbo', 2,
            jsonb_build_array(jsonb_build_object('id', fan_part, 'title', 'Fan''s exhaust', 'price_cents', 30000),
                              jsonb_build_object('id', part, 'title', 'Alice''s turbo, call 07123 456789', 'price_cents', 50000)), 'sent', now() - interval '2 days')
    returning id into d_sent;

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
  -- (The offer's own trigger also notified fan; only the fixtures' bodies are checked.)
  if not exists (select 1 from public.notifications where user_id = fan and kind = 'offer_new' and body = '$200.00')
     or exists (select 1 from public.notifications where user_id = fan and kind in ('offer_new', 'offer_withdrawn') and body like '%has since left DRVN%')
     or not exists (select 1 from public.notifications where user_id = fan and kind = 'offer_withdrawn' and body = 'Fan''s exhaust')
     or not exists (select 1 from public.notifications where user_id = fan and kind = 'order_cancelled' and body = 'checkout abandoned') then
    fails := fails || 'FAIL K1: a body with none of the leaver''s words was cleared (Codex #181)'::text;
  end if;
  if not exists (select 1 from public.notifications where user_id = fan and kind = 'order_disputed' and body like 'The description of the problem was removed%')
     or not exists (select 1 from public.notifications where user_id = fan and kind = 'order_refunded' and body like 'The reason was removed%') then
    fails := fails || 'FAIL D1: a leaving buyer''s dispute text or reason was not replaced by a line pointing to the order (Codex #181)'::text;
  end if;
  -- ---------- S ----------
  if exists (select 1 from public.notifications where user_id = fan and kind = 'saved_search' and (title ~ '07123|Alice' or coalesce(body, '') ~ '07123|Alice')) then
    fails := fails || 'FAIL S1: a saved-search notice still names the deleted member''s listing (N1069, work review #153)'::text;
  end if;
  if not exists (select 1 from public.notifications where user_id = fan and title = 'New match for JDM turbos: A listing by a member who has since left DRVN' and body = 'A listing by a member who has since left DRVN')
     or not exists (select 1 from public.notifications where user_id = fan and title = '3 new parts match JDM turbos' and body = 'Fan''s exhaust · A listing by a member who has since left DRVN · Someone''s intake')
     or not exists (select 1 from public.notifications where user_id = fan and title = 'New match for exhausts: Fan''s exhaust' and body = 'Fan''s exhaust') then
    fails := fails || format('FAIL S2: a saved-search notice lost more than the leaver''s title, or its place: %s (N1069, work review #153)',
      (select string_agg(title || ' / ' || coalesce(body, ''), ' | ') from public.notifications where user_id = fan and kind = 'saved_search'));
  end if;

  -- ---------- E ----------
  if exists (select 1 from public.saved_search_email_digests where saved_search_id = search and items::text ~ '07123|Alice') then
    fails := fails || 'FAIL E1: a saved-search email still holds the deleted member''s listing title (N1069, work review #153)'::text;
  end if;
  if not exists (select 1 from public.saved_search_email_digests where id = d_trim and status = 'pending' and skip_reason is null and match_count = 4
                    and jsonb_array_length(items) = 1 and items->0->>'title' = 'Fan''s exhaust') then
    fails := fails || format('FAIL E2: an unsent email did not lose only the leaver''s item: %s (N1069, work review #153)', (select to_jsonb(d) - 'id' from public.saved_search_email_digests d where id = d_trim));
  end if;
  if not exists (select 1 from public.saved_search_email_digests where id = d_skip and status = 'skipped' and skip_reason = 'listings_removed'
                    and items->0->>'title' = 'A listing by a member who has since left DRVN') then
    fails := fails || 'FAIL E3: an unsent email with nothing left to show would still be sent (N1069, work review #153)'::text;
  end if;
  if not exists (select 1 from public.saved_search_email_digests where id = d_sent and status = 'sent' and match_count = 2 and jsonb_array_length(items) = 2
                    and items->0->>'title' = 'Fan''s exhaust' and items->1->>'title' = 'A listing by a member who has since left DRVN' and (items->1->>'price_cents')::int = 50000) then
    fails := fails || 'FAIL E4: a sent email''s record changed shape, or kept the title (N1069, work review #153)'::text;
  end if;

  -- ---------- U ----------
  if not exists (select 1 from public.notifications where user_id = fan and kind = 'n153_new_kind' and title = 'A member who has since left DRVN' and body = '(removed)' and actor_id is null) then
    fails := fails || 'FAIL U1: a kind nobody classified kept the leaver''s name or words (N1069, work review #153)'::text;
  end if;
  if not exists (select 1 from public.notifications where user_id = fan and kind = 'refund_offered' and title = 'The seller offered a refund' and body = '$20.00: review it on the order.' and actor_id is null) then
    fails := fails || 'FAIL U2: DRVN''s own words were removed from a kind that carries no member text (N1069, work review #153)'::text;
  end if;
  -- Every kind a function writes by name, next to its section, is classified.
  select string_agg(distinct k.kind, ', ') into unknown
    from (
      select (regexp_matches(p.prosrc, '''([a-z][a-z_]+)''\s*,\s*''(?:engagement|marketplace)''', 'g'))[1] as kind
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prokind = 'f'
         and (p.prosrc ~* 'notify\s*\(' or p.prosrc ~* 'into\s+(public\.)?notifications')
    ) k
   where private.notification_member_text(k.kind) is null;
  if unknown is not null then
    fails := fails || format('FAIL U3: a function writes a notification kind nobody classified: %s (N1069, work review #153)', unknown);
  end if;
  -- The computed families: every order status and every offer status.
  select string_agg(k, ', ') into unknown
    from unnest(array['order_pending', 'order_requires_action', 'order_payment_failed', 'order_paid', 'order_shipped', 'order_delivered',
                      'order_completed', 'order_cancelled', 'order_refunded', 'order_disputed',
                      'offer_countered', 'offer_accepted', 'offer_declined', 'offer_withdrawn', 'offer_expired']) k
   where private.notification_member_text(k) is null;
  if unknown is not null then
    fails := fails || format('FAIL U3: a status has no classified notification kind: %s (N1069, work review #153)', unknown);
  end if;
  -- Strict mode, as the test databases run: an unclassified kind is refused, a classified one is not.
  perform set_config('drvn.strict_notification_kinds', 'on', true);
  refused := false;
  begin
    insert into public.notifications (user_id, kind, section, title) values (fan, 'n153_another_new_kind', 'engagement', 'x');
  exception when check_violation then refused := true;
  end;
  if not refused then
    fails := fails || 'FAIL U4: with strict kinds on, an unclassified notification kind was accepted (N1069, work review #153)'::text;
  end if;
  insert into public.notifications (user_id, kind, section, title) values (fan, 'policy_updated', 'marketplace', 'Our terms changed');

  if not exists (select 1 from public.notifications where user_id = buyer and kind = 'offer_declined' and title = 'Your offer was declined' and href = '/offers/' || offer and actor_id is null) then
    fails := fails || 'FAIL O2: the offer notice lost DRVN''s own title or its link (Codex #181)'::text;
  end if;

  -- ---------- R: a member scrubbed before 20261108180000 ----------
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (fan, 'comment', 'engagement', 'Bob Old commented on your update', 'great car, text me on 07999 111222', '/posts/x', old_leaver),
    (fan, 'follow', 'engagement', 'Bob Old followed you', null, '/u/n181oldhandle', old_leaver),
    (buyer, 'offer_countered', 'marketplace', 'The seller countered', 'Bob''s wheels, text 07999 111222', '/offers/' || old_offer, null);
  insert into private.username_tombstones (username) values ('n181oldhandle') on conflict do nothing;
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (fan, 'saved_search', 'marketplace', '2 new parts match wheels', 'Bob''s wheels, text 07999 111222 · Fan''s exhaust', '/marketplace?q=wheels', null);
  insert into public.saved_search_email_digests (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status, sent_at)
    values (search, current_date - 3, now() - interval '4 days', now() - interval '3 days', 'JDM turbos', '/marketplace?q=turbo', 1,
            jsonb_build_array(jsonb_build_object('id', old_part, 'title', 'Bob''s wheels, text 07999 111222', 'price_cents', 50000)), 'sent', now() - interval '3 days')
    returning id into d_old;
  -- A listing that is gone altogether (its seller's profile was hard-deleted).
  insert into public.saved_search_email_digests (saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status, sent_at)
    values (search, current_date - 4, now() - interval '5 days', now() - interval '4 days', 'JDM turbos', '/marketplace?q=turbo', 1,
            jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'title', 'Carol''s seats 07555 000111', 'price_cents', 9000)), 'sent', now() - interval '4 days')
    returning id into d_gone;
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
  if exists (select 1 from public.notifications where user_id = fan and kind = 'saved_search' and coalesce(body, '') ~ '07999|Bob')
     or exists (select 1 from public.saved_search_email_digests where id in (d_old, d_gone) and items::text ~ '07999|Bob|07555|Carol')
     or (r->>'saved_search_notices')::int < 1 or (r->>'saved_search_digests')::int < 2 then
    fails := fails || format('FAIL R6: the repair left a scrubbed member''s listing title in a saved-search notice or email, or did not count it (%s) (N1069, work review #153)', r);
  end if;
  if (r->>'actor_rows')::int < 2 or (r->>'retired_links')::int < 1 or (r->>'offer_bodies')::int < 1 then
    fails := fails || format('FAIL R4: the repair didn''t count what it changed (%s) (Codex #181)', r);
  end if;
  r := private.repair_scrubbed_previews();
  if (r->>'actor_rows')::int <> 0 or (r->>'retired_links')::int <> 0 or (r->>'offer_bodies')::int <> 0 or (r->>'order_bodies')::int <> 0
     or (r->>'saved_search_notices')::int <> 0 or (r->>'saved_search_digests')::int <> 0 then
    fails := fails || format('FAIL R5: a second repair changed more rows (%s) (Codex #181)', r);
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all deletion scrub preview repair checks passed';
end $$;

rollback;
