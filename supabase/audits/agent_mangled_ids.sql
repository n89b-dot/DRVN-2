-- Report five #107 (OS id N943): rows whose stored text holds an id that the
-- pre-#158 card redactor mangled ("70e95888-a[card number removed]b5e67f70ec").
-- Read-only: run it in the SQL editor, or in a `begin read only` transaction.
-- Before PR #158 (8 Nov 2026) the card rule removed any 13-19 Luhn-valid digits
-- across dash-joined groups, which about 0.3% of random UUIDs contain.
-- Shared dev, 9 Nov 2026: 0 rows in every table (agent_events held no rows).
-- A non-zero count on a database that matters means a backfill decision; the
-- original id is not recoverable from the row alone.
-- Every agent table, the whole row as text; a marker with a hex
-- digit or dash on both sides cannot be a real redacted card number.
with hits as (
  select 'agent_events' t, count(*) n from public.agent_events x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_messages', count(*) from public.agent_messages x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_approvals', count(*) from public.agent_approvals x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_tasks', count(*) from public.agent_tasks x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_jobs', count(*) from public.agent_jobs x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_conversations', count(*) from public.agent_conversations x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_telemetry', count(*) from public.agent_telemetry x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_mandate_versions', count(*) from public.agent_mandate_versions x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
  union all select 'agent_chat_requests', count(*) from public.agent_chat_requests x where x::text ~ '[0-9a-f-]\[card number removed\][0-9a-f-]'
),
totals as (
  select 'agent_events' t, count(*) n from public.agent_events
  union all select 'agent_messages', count(*) from public.agent_messages
  union all select 'any marker in agent_events', count(*) from public.agent_events x where x::text like '%[card number removed]%'
)
select 'mangled' kind, t, n from hits union all select 'rows', t, n from totals order by 1, 2;
