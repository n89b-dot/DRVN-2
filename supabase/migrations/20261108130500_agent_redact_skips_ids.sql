-- Card-number redaction never corrupts ids.
--
-- agent_redact_cards (20261021100000) removes any run of digit groups joined
-- by spaces or dashes that totals 13–19 digits and passes Luhn. A UUID's
-- digit groups can do that: in 70e95888-a964-4164-9858-10b5e67f70ec the run
-- "964-4164-9858-10" is 13 digits and passes, so the stored id became
-- "70e95888-a[card number removed]b5e67f70ec". About 0.3% of random UUIDs
-- match. agent_redact_event runs it over every agent_events row's inputs and
-- result, so an approval_id, listing_id or any other id there could be
-- mangled (and agent_approval_outcomes_guard FAIL 5 flaked on one). #94
-- (20261107210200) exempted a tool call's validated ids only.
--
-- Now UUID-shaped text (8-4-4-4-12 hex, either case, also inside a longer
-- string) is never scanned: the text is split around each UUID, the card
-- rule runs on the pieces between them, and the UUIDs are put back as they
-- were. This covers every caller at once (events, chat, objectives,
-- reasons). Card numbers are still removed, with spaces or dashes, including
-- one written right next to an id. The rule itself is unchanged; it moves to
-- private.agent_redact_card_runs. src/lib/ai/redact.ts does the same.

begin;

-- 20261021100000's rule, unchanged: a run of digit groups is tried group by
-- group, and any 13–19 digits starting and ending on a group boundary that
-- pass Luhn are removed.
create or replace function private.agent_redact_card_runs(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_out text := p_text;
  v_run text;
  v_groups text[];
  v_seps text[];
  v_digits text;
  v_span text;
  n integer;
  i integer;
  j integer;
  v_hit integer;
begin
  if p_text is null then return null; end if;
  for v_run in select (regexp_matches(p_text, '[0-9]+(?:[ -][0-9]+)*', 'g'))[1] loop
    v_groups := regexp_split_to_array(v_run, '[ -]');
    v_seps := array(select (regexp_matches(v_run, '[ -]', 'g'))[1]);
    n := coalesce(array_length(v_groups, 1), 0);
    i := 1;
    while i <= n loop
      v_digits := '';
      v_hit := null;
      for j in i..n loop
        v_digits := v_digits || v_groups[j];
        exit when length(v_digits) > 19;
        if length(v_digits) >= 13 and public.agent_luhn(v_digits) then v_hit := j; end if;
      end loop;
      if v_hit is not null then
        v_span := v_groups[i];
        for j in i + 1..v_hit loop v_span := v_span || v_seps[j - 1] || v_groups[j]; end loop;
        v_out := replace(v_out, v_span, '[card number removed]');
        i := v_hit + 1;
      else
        i := i + 1;
      end if;
    end loop;
  end loop;
  return v_out;
end;
$function$;

revoke all on function private.agent_redact_card_runs(text) from public, anon, authenticated, service_role;

-- The card rule everywhere except inside a UUID.
create or replace function public.agent_redact_cards(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  v_out text := '';
  v_rest text := p_text;
  v_id text;
  v_at integer;
begin
  if p_text is null then return null; end if;
  loop
    -- The leftmost UUID-shaped text left; no earlier copy of it exists, so
    -- position() finds that same match.
    v_id := substring(v_rest from '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}');
    exit when v_id is null;
    v_at := position(v_id in v_rest);
    v_out := v_out || private.agent_redact_card_runs(left(v_rest, v_at - 1)) || v_id;
    v_rest := substr(v_rest, v_at + length(v_id));
  end loop;
  return v_out || private.agent_redact_card_runs(v_rest);
end;
$function$;

revoke all on function public.agent_redact_cards(text) from public, anon, authenticated, service_role;

commit;
