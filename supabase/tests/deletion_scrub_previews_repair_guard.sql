-- 20261110150000 (Codex's review of #181): a deleted member's words leave
-- other members' feeds, for every case.
--   O  the scrub clears an offer notice's body (the listing title the seller
--      wrote), and keeps DRVN's own title and the link
--   R  the one-time repair rewrites notifications a member scrubbed before
--      20261108180000 is still the actor of, clears links to retired handles,
--      and clears offer bodies already left without an actor; a second run
--      changes nothing
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  leaver uuid := gen_random_uuid();   -- scrubbed now, by the restated scrub
  old_leaver uuid := gen_random_uuid(); -- scrubbed before 20261108180000
  buyer uuid := gen_random_uuid();
  fan uuid := gen_random_uuid();
  part uuid; old_part uuid;
  offer uuid; old_offer uuid;
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

  -- ---------- O ----------
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id)
    values (buyer, 'offer_declined', 'marketplace', 'Your offer was declined', 'Alice''s turbo, call 07123 456789', '/offers/' || offer, leaver);
  insert into public.remediation_jobs (kind, dedup_key, payload, status, lease_id, locked_until)
    values ('delete_account', 'delete:' || leaver, jsonb_build_object('user_id', leaver), 'processing', lease, now() + interval '5 minutes')
    returning id into job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
    values (leaver, job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  perform public.scrub_deleted_account(leaver, null, null);
  if exists (select 1 from public.notifications where user_id = buyer and kind = 'offer_declined' and href = '/offers/' || offer and body is not null) then
    fails := fails || 'FAIL O1: an offer notice kept the listing title the deleted seller wrote (Codex #181)'::text;
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
  if exists (select 1 from public.notifications where user_id = buyer and href = '/offers/' || old_offer and body is not null) then
    fails := fails || 'FAIL R3: an actor-less offer notice kept a scrubbed seller''s listing title (Codex #181)'::text;
  end if;
  if (r->>'actor_rows')::int < 2 or (r->>'retired_links')::int < 1 or (r->>'offer_bodies')::int < 1 then
    fails := fails || format('FAIL R4: the repair didn''t count what it changed (%s) (Codex #181)', r);
  end if;
  r := private.repair_scrubbed_previews();
  if (r->>'actor_rows')::int <> 0 or (r->>'retired_links')::int <> 0 or (r->>'offer_bodies')::int <> 0 then
    fails := fails || format('FAIL R5: a second repair changed more rows (%s) (Codex #181)', r);
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all deletion scrub preview repair checks passed';
end $$;

rollback;
