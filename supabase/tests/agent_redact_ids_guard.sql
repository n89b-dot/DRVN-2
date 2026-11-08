-- Card-number redaction never corrupts ids (20261108130500).
--
-- agent_redact_cards removed any 13–19 digits across dash-joined groups that
-- passed Luhn, and about 0.3% of random UUIDs have such a run. Each UUID here
-- was mangled before the fix (the first became
-- "70e95888-a[card number removed]b5e67f70ec"), including inside the
-- agent_events JSON that agent_redact_event scrubs; an approval_id stored
-- that way flaked agent_approval_outcomes_guard FAIL 5. Real card numbers,
-- with spaces or dashes, are still removed. src/lib/ai/redact.test.ts has the
-- same fixtures. Transactional; disposable local or CI database only.
begin;

do $$
declare
  ids text[] := array[
    '70e95888-a964-4164-9858-10b5e67f70ec',
    '30b5080e-7219-4087-9468-3708206fed76',
    '32988505-6787-409e-84cf-dcffdaa1db68',
    '511c533c-70a7-4567-a0f7-840220032488'
  ];
  v_id text;
  owner uuid := gen_random_uuid();
  ev uuid;
  stored jsonb;
  stored_inputs jsonb;
begin
  -- 1. A UUID is never changed: alone, in upper case, inside a longer string.
  foreach v_id in array ids loop
    if public.agent_redact_cards(v_id) is distinct from v_id
       or public.agent_redact_cards(upper(v_id)) is distinct from upper(v_id)
       or public.agent_redact_cards('/listings/' || v_id || '?ref=agent') is distinct from '/listings/' || v_id || '?ref=agent' then
      raise exception 'FAIL 1: card redaction changed the id % (to %)', v_id, public.agent_redact_cards(v_id);
    end if;
  end loop;

  -- 2. Card numbers are still removed, with spaces or dashes, next to an id too.
  v_id := ids[1];
  if public.agent_redact_cards('card 4242 4242 4242 4242 12/28') <> 'card [card number removed] 12/28'
     or public.agent_redact_cards('4242-4242-4242-4242 1234 ok') <> '[card number removed] 1234 ok'
     or public.agent_redact_cards('pay 4111111111111111 now') <> 'pay [card number removed] now'
     or public.agent_redact_cards('order 4242 4242 4242 4241') <> 'order 4242 4242 4242 4241'
     or public.agent_redact_cards('order ' || v_id || ': card 4242 4242 4242 4242') <> 'order ' || v_id || ': card [card number removed]'
     or public.agent_redact_cards('4242-4242-4242-4242 ' || v_id) <> '[card number removed] ' || v_id then
    raise exception 'FAIL 2: card numbers are no longer removed as before';
  end if;
  if public.agent_redact_cards(null) is not null then
    raise exception 'FAIL 2b: a null text did not stay null';
  end if;

  -- 3. An agent event keeps its ids and loses its card numbers.
  insert into auth.users(id, email, raw_user_meta_data) values (owner, 'redact-ids@drvn.test', '{}');
  insert into public.agent_events(owner_id, kind, inputs, result)
    values (owner, 'approval',
            jsonb_build_object('listing_ids', to_jsonb(ids), 'note', 'buyer wrote 4242-4242-4242-4242'),
            jsonb_build_object('approval_id', ids[1], 'order_id', ids[2], 'href', '/orders/' || ids[3], 'thread_id', ids[4]))
    returning agent_events.id into ev;
  select e.result, e.inputs into stored, stored_inputs from public.agent_events e where e.id = ev;
  if stored is distinct from jsonb_build_object('approval_id', ids[1], 'order_id', ids[2], 'href', '/orders/' || ids[3], 'thread_id', ids[4]) then
    raise exception 'FAIL 3: an event''s stored ids were changed (%)', stored;
  end if;
  if stored_inputs is distinct from jsonb_build_object('listing_ids', to_jsonb(ids), 'note', 'buyer wrote [card number removed]') then
    raise exception 'FAIL 4: an event kept a card number or changed its ids (%)', stored_inputs;
  end if;

  raise notice 'all agent redaction id checks passed';
end $$;

rollback;
