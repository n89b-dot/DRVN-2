-- 20261111140000 (Codex's final review, P1 on 20261110220000): a deleted
-- member's listing title that itself contains the separator " · " left
-- other members' saved-search notices. The scrub split the body on " · " and
-- compared each piece with the whole title, so "Alice 07123 · turbo" was
-- never equal to any piece and stayed.
--   T1  a body carrying such a title, among other titles, keeps none of it:
--       a title that cannot be cut out cleanly takes the whole body with it
--   T2  a title ending in " ·" (no full separator inside) is caught the same way
--   T3  a body with only an ordinary title of theirs is still cut in place,
--       the other titles kept
--   T4  a saved-search notice that names none of their titles is untouched
--   T5  (20261111160000, Codex fix-check) a second leaver owning both
--       "Carol 07555 · turbo" and "turbo": the cut replaced the piece
--       "turbo", so neither title was left whole and "Carol 07555" stayed
--   T6  the same leaver's "turbo" alone in a body is still cut in place
--   R1  the repair neutralises a notice an earlier scrub left with a
--       scrubbed member's title in it, and nothing else
--   R2  a second repair changes nothing
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  leaver uuid := gen_random_uuid();
  old_leaver uuid := gen_random_uuid();
  carol uuid := gen_random_uuid();
  fan uuid := gen_random_uuid();
  neutral constant text := 'Listings matched your saved search, including one by a member who has since left DRVN.';
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid; n6 uuid; n7 uuid; n8 uuid;
  n integer;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (leaver, 'sep-leaver@drvn.test', '{}'), (old_leaver, 'sep-old@drvn.test', '{}'), (carol, 'sep-carol@drvn.test', '{}'), (fan, 'sep-fan@drvn.test', '{}');
  insert into public.listings (seller_id, title, category, price_cents, status) values
    (leaver, 'Alice 07123 · turbo', 'performance', 50000, 'active'),
    (leaver, 'Alice 07123 ·', 'performance', 50000, 'active'),
    (leaver, 'Alice plain 07123', 'performance', 50000, 'active'),
    (old_leaver, 'Bob 07999 · wheels', 'performance', 50000, 'active'),
    (carol, 'Carol 07555 · turbo', 'performance', 50000, 'active'),
    (carol, 'turbo', 'performance', 50000, 'active'),
    (fan, 'Fan''s exhaust', 'performance', 30000, 'active');

  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '3 new parts match turbos', 'Fan''s exhaust · Alice 07123 · turbo · Someone''s intake', '/marketplace?q=turbo')
    returning id into n1;
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '2 new parts match turbos', 'Alice 07123 · · Someone''s intake', '/marketplace?q=turbo')
    returning id into n2;
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '2 new parts match intakes', 'Alice plain 07123 · Someone''s intake', '/marketplace?q=intake')
    returning id into n3;
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', 'New match for exhausts: Fan''s exhaust', 'Fan''s exhaust', '/marketplace?q=exhaust')
    returning id into n4;
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '3 new parts match turbos', 'Fan''s exhaust · Carol 07555 · turbo · Someone''s intake', '/marketplace?q=turbo')
    returning id into n7;
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '2 new parts match turbos', 'turbo · Someone''s intake', '/marketplace?q=turbo')
    returning id into n8;

  -- ---------- T ----------
  perform private.scrub_member_notices(leaver, null);
  if (select body from public.notifications where id = n1) ~ '07123' then
    fails := fails || format('FAIL T1: a title containing " · " stayed in a saved-search notice: %s (Codex final review)', (select body from public.notifications where id = n1));
  end if;
  if (select body from public.notifications where id = n2) ~ '07123' then
    fails := fails || format('FAIL T2: a title ending in " ·" stayed in a saved-search notice: %s (Codex final review)', (select body from public.notifications where id = n2));
  end if;
  if (select body from public.notifications where id = n3) is distinct from 'A listing by a member who has since left DRVN · Someone''s intake' then
    fails := fails || format('FAIL T3: an ordinary title was not cut in place: %s (Codex final review)', (select body from public.notifications where id = n3));
  end if;
  if (select title || '|' || body from public.notifications where id = n4) is distinct from 'New match for exhausts: Fan''s exhaust|Fan''s exhaust' then
    fails := fails || 'FAIL T4: a notice naming none of their titles changed (Codex final review)'::text;
  end if;
  perform private.scrub_member_notices(carol, null);
  if (select body from public.notifications where id = n7) ~ '07555' then
    fails := fails || format('FAIL T5: with an overlapping shorter title cut first, a title containing " · " stayed: %s (Codex fix-check)', (select body from public.notifications where id = n7));
  end if;
  if (select body from public.notifications where id = n8) is distinct from 'A listing by a member who has since left DRVN · Someone''s intake' then
    fails := fails || format('FAIL T6: an ordinary title of a leaver who also owns an overlapping title was not cut in place: %s (Codex fix-check)', (select body from public.notifications where id = n8));
  end if;

  -- ---------- R ----------
  -- A member scrubbed before the fix: their notice still carries the title.
  insert into public.account_deletion_requests (user_id, outcome, next_action, responsible_owner, scrubbed_at)
    values (old_leaver, 'operator_attention', 'Personal data is removed.', 'operations and policy owner', now() - interval '2 days');
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'saved_search', 'marketplace', '2 new parts match wheels', 'Bob 07999 · wheels · Fan''s exhaust', '/marketplace?q=wheels')
    returning id into n5;
  -- Not a saved-search notice: the repair leaves it alone.
  insert into public.notifications (user_id, kind, section, title, body, href) values
    (fan, 'policy_updated', 'marketplace', 'Policy', 'Bob 07999 · wheels', null)
    returning id into n6;
  if to_regprocedure('private.repair_ambiguous_matched_titles()') is null then
    fails := fails || 'FAIL R1: there is no repair for notices an earlier scrub left (Codex final review)'::text;
  else
    execute 'select private.repair_ambiguous_matched_titles()' into n;
    if (select body from public.notifications where id = n5) is distinct from neutral then
      fails := fails || format('FAIL R1: the repair left a scrubbed member''s title: %s (Codex final review)', (select body from public.notifications where id = n5));
    end if;
    if (select body from public.notifications where id = n6) is distinct from 'Bob 07999 · wheels'
       or (select body from public.notifications where id = n3) is distinct from 'A listing by a member who has since left DRVN · Someone''s intake'
       or (select body from public.notifications where id = n4) is distinct from 'Fan''s exhaust' then
      fails := fails || 'FAIL R1: the repair touched a notice that carries no scrubbed member''s title (Codex final review)'::text;
    end if;
    if n <> 1 then
      fails := fails || format('FAIL R1: the repair counted %s rows, expected 1 (Codex final review)', n);
    end if;
    execute 'select private.repair_ambiguous_matched_titles()' into n;
    if n <> 0 then
      fails := fails || format('FAIL R2: a second repair changed %s rows (Codex final review)', n);
    end if;
  end if;

  if cardinality(fails) > 0 then
    raise exception 'A deleted member''s title with a separator was left in another member''s notice: %', E'\n' || array_to_string(fails, E'\n');
  end if;
  raise notice 'all deletion scrub separator checks passed';
end $$;

rollback;
