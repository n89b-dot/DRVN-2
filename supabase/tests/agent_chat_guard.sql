-- The agent chat's storage (20261025100000). Disposable local DB only.
--   1. Members can read their own chat but can't write it, and can't call
--      agent_chat_append; the service role can.
--   2. agent_chat_append keeps one conversation per member and stores both
--      sides; the redaction trigger still runs.
--   3. Cards are listing ids only: extra keys, other kinds, non-uuids, more
--      than five, or cards on a member's own message are refused.
--   4. A drafted build change (20261025110000) keeps to its fields: no price
--      or other key, a known category, http(s) links only.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.code(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  card text := gen_random_uuid()::text;
  c text;
begin
  insert into auth.users(id, email) values (member, 'agent-chat-member@drvn.test'), (other, 'agent-chat-other@drvn.test');

  -- 1. Who may write.
  if has_function_privilege('authenticated', 'public.agent_chat_append(uuid,text,text,jsonb)', 'execute') then raise exception 'FAIL 1: members can call agent_chat_append'; end if;
  if has_function_privilege('anon', 'public.agent_chat_append(uuid,text,text,jsonb)', 'execute') then raise exception 'FAIL 1b: visitors can call agent_chat_append'; end if;
  if not has_function_privilege('service_role', 'public.agent_chat_append(uuid,text,text,jsonb)', 'execute') then raise exception 'FAIL 1c: the server cannot store chat'; end if;
  if has_table_privilege('service_role', 'public.agent_messages', 'insert') then raise exception 'FAIL 1d: the service role writes agent_messages directly'; end if;

  -- 2. Both sides, one conversation.
  perform public.agent_chat_append(member, 'member', 'Will this fit my car? My card is 4242 4242 4242 4242');
  perform public.agent_chat_append(member, 'agent', 'Here is one.', jsonb_build_array(jsonb_build_object('kind', 'listing', 'id', card)));
  if (select count(*) from public.agent_conversations where owner_id = member) <> 1 then raise exception 'FAIL 2: not one conversation'; end if;
  if (select count(*) from public.agent_messages where owner_id = member) <> 2 then raise exception 'FAIL 2b: both sides not stored'; end if;
  if exists (select 1 from public.agent_messages where owner_id = member and body like '%4242 4242%') then raise exception 'FAIL 2c: a card number was stored'; end if;
  if (select cards->0->>'id' from public.agent_messages where owner_id = member and role = 'agent') <> card then raise exception 'FAIL 2d: the card was not kept'; end if;

  perform pg_temp.act(member);
  if (select count(*) from public.agent_messages) <> 2 then raise exception 'FAIL 1e: a member cannot read their own chat'; end if;
  c := pg_temp.code(format('insert into public.agent_messages(conversation_id, owner_id, role, body) select id, %L, %L, %L from public.agent_conversations', member, 'agent', 'forged'));
  if c = 'ok' then raise exception 'FAIL 1f: a member wrote their own chat'; end if;
  perform pg_temp.reset();
  perform pg_temp.act(other);
  if exists (select 1 from public.agent_messages) then raise exception 'FAIL 1g: a member read someone else''s chat'; end if;
  perform pg_temp.reset();

  -- 3. Cards.
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object('kind', 'listing', 'id', card, 'price', 100))));
  if c <> '22023' then raise exception 'FAIL 3: a card with extra keys was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object('kind', 'offer', 'id', card))));
  if c <> '22023' then raise exception 'FAIL 3b: another kind of card was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object('kind', 'listing', 'id', 'not-a-uuid'))));
  if c <> '22023' then raise exception 'FAIL 3c: a card without a uuid was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x',
    (select jsonb_agg(jsonb_build_object('kind', 'listing', 'id', gen_random_uuid())) from generate_series(1, 6))));
  if c <> '22023' then raise exception 'FAIL 3d: six cards were stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'member', 'x', jsonb_build_array(jsonb_build_object('kind', 'listing', 'id', card))));
  if c <> '22023' then raise exception 'FAIL 3e: a member message carried cards (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L)', member, 'system', 'x'));
  if c <> '22023' then raise exception 'FAIL 3f: a third role was stored (%)', c; end if;

  -- 4. Build-change cards.
  perform public.agent_chat_append(member, 'agent', 'Confirm to add it.', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', gen_random_uuid(), 'replaces', null, 'brand', 'KW', 'product', 'V3 coilovers',
    'part_number', '35210012', 'category', 'suspension', 'product_url', 'https://example.com/kw-v3', 'image_url', null)));
  if (select count(*) from public.agent_messages where owner_id = member and cards->0->>'kind' = 'build_change') <> 1 then raise exception 'FAIL 4: a build change card was not stored'; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', gen_random_uuid(), 'product', 'V3', 'price_cents', 100))));
  if c <> '22023' then raise exception 'FAIL 4b: a build change carried a price (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', gen_random_uuid(), 'product', 'V3', 'category', 'rockets'))));
  if c <> '22023' then raise exception 'FAIL 4c: an unknown category was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', gen_random_uuid(), 'product', 'V3', 'product_url', 'javascript:alert(1)'))));
  if c <> '22023' then raise exception 'FAIL 4d: a non-http link was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', 'not-a-car', 'product', 'V3'))));
  if c <> '22023' then raise exception 'FAIL 4e: a build change without a car id was stored (%)', c; end if;
  c := pg_temp.code(format('select public.agent_chat_append(%L, %L, %L, %L::jsonb)', member, 'agent', 'x', jsonb_build_array(jsonb_build_object(
    'kind', 'build_change', 'id', gen_random_uuid(), 'car', gen_random_uuid(), 'product', ''))));
  if c <> '22023' then raise exception 'FAIL 4f: a build change without a product was stored (%)', c; end if;

  raise notice 'all agent chat checks passed';
end $$;

rollback;
