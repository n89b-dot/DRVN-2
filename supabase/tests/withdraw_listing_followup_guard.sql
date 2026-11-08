-- OS-W33 follow-up (20261108110100), from the GPT review of PR #122:
--   1. withdrawing can't undo moderation (a removed listing is refused);
--   2. the buyer keeps the archived listing's context, by the link in their
--      notification, and nobody else gains it;
--   3. an already-archived listing's live offers still end, with notices,
--      and a member can't archive one that has live offers directly.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer_a uuid := gen_random_uuid();
  buyer_b uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  pulled uuid := gen_random_uuid();
  shelved uuid := gen_random_uuid();
  direct uuid := gen_random_uuid();
  part_offer uuid := gen_random_uuid();
  pulled_offer uuid := gen_random_uuid();
  shelved_offer uuid := gen_random_uuid();
  direct_offer uuid := gen_random_uuid();
  img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/';
  result jsonb;
  refused text;
  link text;
  linked_offer uuid;
  linked_listing uuid;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'w33f-seller@drvn.test', '{}'), (buyer_a, 'w33f-a@drvn.test', '{}'),
    (buyer_b, 'w33f-b@drvn.test', '{}'), (stranger, 'w33f-stranger@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (part, seller, 'W33F part', 'performance', 10000, 'active'),
    (pulled, seller, 'W33F removed', 'performance', 10000, 'active'),
    (shelved, seller, 'W33F archived before withdrawal', 'performance', 10000, 'active'),
    (direct, seller, 'W33F direct archive', 'performance', 10000, 'active');
  insert into public.listing_images(listing_id, url, position) values (part, img || 'w33f-part.webp', 0);
  insert into public.offers(id, listing_id, buyer_id, amount_cents, status) values
    (part_offer, part, buyer_a, 8000, 'open'),
    (pulled_offer, pulled, buyer_a, 8000, 'open'),
    (shelved_offer, shelved, buyer_b, 7000, 'open'),
    (direct_offer, direct, buyer_b, 7000, 'open');
  -- Moderation removes one; another was archived the old way, by a status
  -- change that left its offer live (here as a trusted writer, since the
  -- member path is now refused — check 4).
  update public.listings set status = 'removed', removed_at = now(), removed_reason = 'W33F moderation' where id = pulled;
  update public.listings set status = 'archived' where id = shelved;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);

  -- 1. A removed listing is moderation's: withdrawing it is refused, and it
  --    stays removed with its offer untouched.
  refused := null;
  begin perform public.withdraw_listing(pulled); exception when sqlstate 'LW403' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 1: a seller withdrew a listing moderation removed, taking it out of moderation''s hands'; end if;
  if (select status from public.listings where id = pulled) <> 'removed' then raise exception 'FAIL 2: the removed listing changed state'; end if;
  if (select status from public.offers where id = pulled_offer) <> 'open' then raise exception 'FAIL 3: refusing the withdrawal still changed an offer'; end if;

  -- 3. A member can't archive a listing with live offers directly…
  refused := null;
  begin update public.listings set status = 'archived' where id = direct; exception when sqlstate 'LW409' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 4: a listing with live offers was archived without ending them'; end if;

  -- …and withdrawing one already archived ends its live offers and tells
  -- the buyer: no replay until that work is done.
  result := public.withdraw_listing(shelved);
  if (result->>'offers_ended')::int <> 1 or (result->>'replayed')::boolean then
    raise exception 'FAIL 5: an archived listing''s live offer was left open (%)', result;
  end if;
  if (public.withdraw_listing(shelved))->>'replayed' <> 'true' then raise exception 'FAIL 6: a finished withdrawal was not a replay'; end if;

  result := public.withdraw_listing(part);
  if (result->>'offers_ended')::int <> 1 then raise exception 'FAIL 7: the live offer did not end'; end if;

  perform set_config('role', 'none', true);
  if (select status from public.listings where id = shelved) <> 'archived' then raise exception 'FAIL 8: the archived listing changed state'; end if;
  if (select status || '/' || coalesce(ended_reason, '') from public.offers where id = shelved_offer) <> 'withdrawn/listing_withdrawn' then
    raise exception 'FAIL 9: the archived listing''s offer did not end with the listing-withdrawal reason';
  end if;
  if not exists (select 1 from public.offer_rounds where offer_id = shelved_offer and kind = 'withdraw' and actor_role = 'system') then
    raise exception 'FAIL 10: the archived listing''s offer history does not record the withdrawal';
  end if;
  if (select count(*) from public.notifications where kind = 'offer_listing_withdrawn' and user_id = buyer_b) <> 1 then
    raise exception 'FAIL 11: the archived listing''s buyer was not told';
  end if;

  -- 2. The buyer follows their notification to /offers/{id}: the page reads
  --    the offer, then its listing and photo, as the buyer.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer_a, 'role', 'authenticated')::text, true);
  select n.href into link from public.notifications n
   where n.user_id = buyer_a and n.kind = 'offer_listing_withdrawn' order by n.created_at desc limit 1;
  if link is null or link not like '/offers/%' then raise exception 'FAIL 12: the buyer has no link to their ended offer'; end if;
  linked_offer := substring(link from '^/offers/(.+)$')::uuid;
  select o.listing_id into linked_listing from public.offers o where o.id = linked_offer;
  if linked_listing is distinct from part then raise exception 'FAIL 13: the buyer can''t read the offer their notification links to'; end if;
  if not exists (select 1 from public.listings l where l.id = linked_listing and l.status = 'archived') then
    raise exception 'FAIL 14: the buyer can''t read the withdrawn listing their offer was on (the offer page 404s)';
  end if;
  if not exists (select 1 from public.listing_images li where li.listing_id = linked_listing) then
    raise exception 'FAIL 15: the buyer can''t see the withdrawn listing''s photo';
  end if;
  -- The offers-with-listing embed Messages uses (listings!inner) finds it too.
  if not exists (select 1 from public.offers o join public.listings l on l.id = o.listing_id where o.id = linked_offer) then
    raise exception 'FAIL 16: the ended offer drops out of the buyer''s Messages';
  end if;
  -- Scoped to their own deals: not another buyer's archived listing, and
  -- not a removed one.
  if exists (select 1 from public.listings where id in (shelved, pulled)) then
    raise exception 'FAIL 17: a buyer reads an archived or removed listing they have no deal on';
  end if;

  -- Nobody else gains it.
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.listings where id = part) or exists (select 1 from public.listing_images where listing_id = part) then
    raise exception 'FAIL 18: a member with no deal on it reads a withdrawn listing';
  end if;
  if exists (select 1 from public.my_deal_listing_ids()) then raise exception 'FAIL 19: deal listing ids leak to a member with no deals'; end if;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if exists (select 1 from public.listings where id = part) then raise exception 'FAIL 20: a visitor reads a withdrawn listing'; end if;
  perform set_config('role', 'none', true);
  if has_function_privilege('anon', 'public.my_deal_listing_ids()', 'execute') then
    raise exception 'FAIL 21: visitors can call my_deal_listing_ids';
  end if;

  raise notice 'all withdraw listing followup checks passed';
end $$;

rollback;
