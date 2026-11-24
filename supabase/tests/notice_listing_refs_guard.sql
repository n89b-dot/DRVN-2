-- 20261124210000_notice_listing_refs.sql. Disposable database only; everything
-- is rolled back.
--
-- A notice and a digest item that record which listing and seller they name
-- are cleaned by the seller's id when that member leaves:
--   1. A saved-search notice: the leaver's title is replaced in its place,
--      even when it contains the separator and even when the listing is
--      already gone; another seller's title is kept; the record is cleared of
--      the leaver; a notice that names only others is untouched.
--   2. A single-match notice: the title's tail is replaced too.
--   3. A digest item: only the leaver's is blanked. An item whose listing is
--      gone but which names another seller is left alone (it used to be
--      blanked whoever had sold it), and a blanked item drops the seller.
--   4. An item with no seller recorded keeps the old rule.
begin;

do $$
declare
  leaver uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  fan uuid := gen_random_uuid();
  theirs uuid;
  others uuid;
  gone uuid := gen_random_uuid();
  n_both uuid;
  n_one uuid;
  n_other uuid;
  search uuid;
  d uuid;
  a_listing constant text := 'A listing by a member who has since left DRVN';
  r jsonb;
  v_items jsonb;
begin
  insert into auth.users(id, email) values
    (leaver, 'refs-guard-leaver@example.test'), (seller, 'refs-guard-seller@example.test'), (fan, 'refs-guard-fan@example.test');
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (leaver, 'Alice 07123 · turbo', 'engine', 50000, 0, 'active', 'USD') returning id into theirs;
  insert into public.listings(seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (seller, 'Someone''s intake', 'engine', 30000, 0, 'active', 'USD') returning id into others;

  insert into public.notifications(user_id, kind, section, title, body, href, listing_refs) values
    (fan, 'saved_search', 'marketplace', '2 new parts match turbos', 'Alice 07123 · turbo · Someone''s intake', '/marketplace?q=turbo',
     jsonb_build_array(
       jsonb_build_object('id', theirs, 'seller_id', leaver, 'title', 'Alice 07123 · turbo'),
       jsonb_build_object('id', others, 'seller_id', seller, 'title', 'Someone''s intake')))
    returning id into n_both;
  insert into public.notifications(user_id, kind, section, title, body, href, listing_refs) values
    (fan, 'saved_search', 'marketplace', 'New match for turbos: Alice 07123 · turbo', 'Alice 07123 · turbo', '/marketplace?q=turbo',
     jsonb_build_array(jsonb_build_object('id', theirs, 'seller_id', leaver, 'title', 'Alice 07123 · turbo')))
    returning id into n_one;
  insert into public.notifications(user_id, kind, section, title, body, href, listing_refs) values
    (fan, 'saved_search', 'marketplace', 'New match for intakes: Someone''s intake', 'Someone''s intake', '/marketplace?q=intake',
     jsonb_build_array(jsonb_build_object('id', others, 'seller_id', seller, 'title', 'Someone''s intake')))
    returning id into n_other;

  insert into public.saved_searches(user_id, name, alert) values (fan, 'turbos', true) returning id into search;
  insert into public.saved_search_email_digests(saved_search_id, digest_day, window_start, window_end, search_name, href, match_count, items, status, sent_at)
  values (search, current_date - 2, now() - interval '3 days', now() - interval '2 days', 'turbos', '/marketplace?q=turbo', 3,
    jsonb_build_array(
      jsonb_build_object('id', theirs, 'seller_id', leaver, 'title', 'Alice 07123 · turbo', 'price_cents', 50000),
      -- Removed by its own seller long ago: gone, and not the leaver's.
      jsonb_build_object('id', gone, 'seller_id', seller, 'title', 'Someone''s old seats', 'price_cents', 9000),
      -- Written before sellers were recorded, and gone: the old rule applies.
      jsonb_build_object('id', gen_random_uuid(), 'title', 'An older gone part', 'price_cents', 100)),
    'sent', now() - interval '2 days')
  returning id into d;

  -- The listing is gone before the scrub runs: the record does not need it.
  delete from public.listings where id = theirs;

  r := private.scrub_member_notices(leaver, null);

  if (select body from public.notifications where id = n_both) is distinct from a_listing || ' · Someone''s intake' then
    raise exception 'FAIL 1a: the leaver''s title was not replaced in its place (body: %)', (select body from public.notifications where id = n_both);
  end if;
  if (select listing_refs from public.notifications where id = n_both)
       is distinct from jsonb_build_array(jsonb_build_object('title', a_listing),
                                           jsonb_build_object('id', others, 'seller_id', seller, 'title', 'Someone''s intake')) then
    raise exception 'FAIL 1b: the record still names the leaver, or lost the other seller (%)', (select listing_refs from public.notifications where id = n_both);
  end if;
  if (select title from public.notifications where id = n_both) <> '2 new parts match turbos' then
    raise exception 'FAIL 1c: a title that names no listing was changed';
  end if;
  if (select (title, body) from public.notifications where id = n_one)
       is distinct from ('New match for turbos: ' || a_listing, a_listing) then
    raise exception 'FAIL 2: the single-match notice still carries the title (%)', (select title || ' / ' || body from public.notifications where id = n_one);
  end if;
  if (select (title, body, listing_refs->0->>'seller_id') from public.notifications where id = n_other)
       is distinct from ('New match for intakes: Someone''s intake'::text, 'Someone''s intake'::text, seller::text) then
    raise exception 'FAIL 1d: a notice that names only another seller was changed';
  end if;
  if exists (select 1 from public.notifications where position(leaver::text in coalesce(listing_refs::text, '')) > 0) then
    raise exception 'FAIL 1e: a notice record still holds the leaver''s id';
  end if;
  if (r->>'saved_search_notices')::int <> 2 then
    raise exception 'FAIL 1f: the scrub reported % notices, expected 2', r->>'saved_search_notices';
  end if;
  raise notice 'PASS 1-2: notices are cut by seller, in place, with the listing already gone';

  perform private.scrub_member_digest_items(leaver);
  select items into v_items from public.saved_search_email_digests where id = d;
  if v_items->0->>'title' <> a_listing or v_items->0 ? 'seller_id' then
    raise exception 'FAIL 3a: the leaver''s digest item was not blanked, or still names them (%)', v_items->0;
  end if;
  if v_items->1->>'title' <> 'Someone''s old seats' or v_items->1->>'seller_id' <> seller::text then
    raise exception 'FAIL 3b: another seller''s removed part was blanked when someone else left (%)', v_items->1;
  end if;
  if v_items->2->>'title' <> a_listing then
    raise exception 'FAIL 4: an item with no seller recorded lost the old rule (%)', v_items->2;
  end if;
  -- The repair pass (no member named) blanks nothing that names a seller.
  perform private.scrub_member_digest_items(null);
  if (select items->1->>'title' from public.saved_search_email_digests where id = d) <> 'Someone''s old seats' then
    raise exception 'FAIL 3c: the repair pass blanked an item that names its seller';
  end if;
  raise notice 'PASS 3-4: only the leaver''s digest item is blanked; an unrecorded one keeps the old rule';

  raise notice 'all notice listing record checks passed';
end $$;

rollback;
