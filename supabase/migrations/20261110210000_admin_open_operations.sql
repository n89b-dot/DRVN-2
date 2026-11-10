-- 20261110210000: the console's open operations are one query (N718, work
-- review #155).
--
-- An admin action that calls a provider (a refund, a transfer) writes an
-- audit row with phase "requested" before it calls out; a later "completed"
-- or "reconciled" row closes it. The audit page lists the ones still open.
-- The app found them by reading the requests newest first, 200 at a time,
-- and for each page reading every later row of those operations: it walked
-- the audit log until it had fifty open ones, which with few open and a long
-- history is the whole log, in the app, on every load of the page. Before
-- that it read only the newest 200 requests and hid any open one older.
--
-- public.admin_open_operations(p_limit) answers it in the database: the
-- newest requests with no closing row, each with the phases recorded after
-- it and the newest audit id of the operation (the version an operator's
-- answer is recorded against). Service role only, like admin_audit_page.
--
-- The index makes "requests, newest first" an index scan; the closing-row
-- check uses admin_audit_log_operation_idx (20261003130000).
--
-- Its cost grows with the log: with fewer open operations than the limit it
-- probes every requested row through the index before it can stop. That is
-- fine for an admin page read by a few operators; it is not a query to put
-- on a member's page.

begin;

create index if not exists admin_audit_log_requested_idx
  on public.admin_audit_log (id desc)
  where (metadata->>'phase') = 'requested';

create or replace function public.admin_open_operations(p_limit integer default 50)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id desc), '[]'::jsonb)
  from (
    select r.id, r.action, r.subject_type, r.subject_id, r.order_id, r.reason, r.created_at, r.actor_id,
           r.metadata->>'operationId' as operation_id,
           coalesce(l.phases, '{}'::text[]) as phases,
           greatest(r.id, coalesce(l.newest, 0)) as seen_through
    from public.admin_audit_log r
    left join lateral (
      select array_agg(distinct a.metadata->>'phase') as phases, max(a.id) as newest
      from public.admin_audit_log a
      where a.metadata->>'operationId' = r.metadata->>'operationId'
        and a.metadata->>'phase' <> 'requested'
    ) l on true
    where r.metadata->>'phase' = 'requested'
      and r.metadata->>'operationId' is not null
      and not exists (
        select 1 from public.admin_audit_log c
        where c.metadata->>'operationId' = r.metadata->>'operationId'
          and c.metadata->>'phase' in ('completed', 'reconciled')
      )
    order by r.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) o;
$$;

comment on function public.admin_open_operations(integer) is
  'The newest admin operations still awaiting an outcome (a "requested" audit row with no "completed" or "reconciled" row), with the phases recorded since and the operation''s newest audit id (N718). With fewer open operations than the limit it probes every requested row through the index, so its cost grows with the log: for the admin audit page only. Service role only.';

revoke all on function public.admin_open_operations(integer) from public, anon, authenticated;
grant execute on function public.admin_open_operations(integer) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_open_operations(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_open_operations(integer)', 'execute') then
    raise exception '20261110210000: admin_open_operations is callable by a member (N718)';
  end if;
  if not has_function_privilege('service_role', 'public.admin_open_operations(integer)', 'execute') then
    raise exception '20261110210000: the service role cannot call admin_open_operations (N718)';
  end if;
  if to_regclass('public.admin_audit_log_requested_idx') is null then
    raise exception '20261110210000: admin_audit_log_requested_idx is missing (N718)';
  end if;
  raise notice 'PASS: 20261110210000 self-checks';
end $$;

notify pgrst, 'reload schema';

commit;
