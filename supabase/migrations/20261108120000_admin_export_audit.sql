-- 20261108120000 — N531: every console export is on the audit log.
--
-- The CSV exports (/admin/export: orders, open and resolved disputes, the
-- audit log itself) hand member data to whoever downloads them, and nothing
-- recorded who did. Now each export writes two append-only audit rows on
-- one export id: `export.started` before any row is read (who, which view,
-- which filters, their console role), then `export.completed` (how many rows)
-- or `export.failed` (why) before the response is sent. No record, no file:
-- the route refuses the export if either write fails.
--
-- Who may export does NOT change (the read-only viewer can still export;
-- whether it should is a policy decision, N135). Recording a viewer needed one
-- change: 0040's guard_audit_actor lets the audit log name only full admins,
-- so that a viewer can never be recorded as having ACTED. An export record is
-- a record of a read, so the guard now also accepts any console member, for
-- export rows only. Every other action keeps the full-admin rule.
--
-- record_admin_export is called with the admin's own session: the actor is
-- auth.uid() and is_admin() (AAL2, session raised with the confirmed factor)
-- must hold, so nobody can record an export in someone else's name. A
-- finishing row must name an export the same person started and that has no
-- finishing row yet.
--
-- Owns: guard_audit_actor (restated from 0040), record_admin_export (new),
-- admin_audit_log_subject_type_check (adds 'export', built from the
-- constraint as it stands, 20261020120000's method).

begin;

-- ---------- 1. 'export' as an audit subject ----------
do $$
declare
  v_values text[];
begin
  select array_agg(distinct v order by v) into v_values
  from (
    select (regexp_matches(pg_get_constraintdef(c.oid), '[''{,]([a-z_]+)(?=[''},])', 'g'))[1] as v
    from pg_constraint c
    where c.conrelid = 'public.admin_audit_log'::regclass and c.conname = 'admin_audit_log_subject_type_check'
    union select 'export'
  ) x;
  if not v_values @> array['order', 'listing', 'user', 'report', 'dispute', 'payment', 'product_review', 'copyright_notice', 'export'] then
    raise exception 'admin_audit_log subject types lost a value: %', v_values;
  end if;
  alter table public.admin_audit_log drop constraint if exists admin_audit_log_subject_type_check;
  execute format('alter table public.admin_audit_log add constraint admin_audit_log_subject_type_check check (subject_type in (%s))',
                 (select string_agg(quote_literal(v), ', ' order by v) from unnest(v_values) v));
end $$;

-- ---------- 2. The actor guard: exports may name any console member ----------
-- Restated from 0040 (its only definition). Export rows are reads, so a
-- viewer may be named on them; every other row still needs a full admin.
create or replace function public.guard_audit_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.subject_type = 'export' or new.action like 'export.%' then
    if new.subject_type <> 'export' or new.action not in ('export.started', 'export.completed', 'export.failed') then
      raise exception 'export records are export.started, export.completed or export.failed on an export subject'
        using errcode = '22023';
    end if;
    if new.actor_id is null or not exists (select 1 from public.admin_users au where au.user_id = new.actor_id) then
      raise exception 'export records can only name console members (got %)', new.actor_id
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.actor_id is null or not exists (
    select 1 from public.admin_users au
    where au.user_id = new.actor_id and au.role = 'admin'
  ) then
    raise exception 'audit rows can only name full admins as actors (got %)', new.actor_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- 3. record_admin_export ----------
-- p_phase 'started': p_view and p_filters; returns the new export id.
-- p_phase 'completed' (p_rows) or 'failed' (p_detail): p_export, the id the
-- same person's 'started' call returned; returns it.
create or replace function public.record_admin_export(
  p_phase text,
  p_view text default null,
  p_filters jsonb default '{}'::jsonb,
  p_export uuid default null,
  p_rows integer default null,
  p_detail text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_started public.admin_audit_log%rowtype;
  v_export uuid;
begin
  if v_actor is null or not public.is_admin() then
    raise exception 'An admin session is required to export' using errcode = '42501';
  end if;

  if p_phase = 'started' then
    if p_export is not null then
      raise exception 'A new export takes no id' using errcode = '22023';
    end if;
    if p_view is null or p_view not in ('orders', 'disputes_open', 'disputes_resolved', 'audit') then
      raise exception 'Unknown export view %', p_view using errcode = '22023';
    end if;
    if p_filters is null or jsonb_typeof(p_filters) <> 'object' or length(p_filters::text) > 4000 then
      raise exception 'Export filters must be an object of at most 4,000 characters' using errcode = '22023';
    end if;
    v_export := gen_random_uuid();
    insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
    values (v_actor, 'export.started', 'export', v_export,
            'CSV export: ' || replace(p_view, '_', ' '),
            jsonb_build_object('phase', 'started', 'view', p_view, 'filters', p_filters, 'role', public.admin_role()));
    return v_export;
  end if;

  if p_phase is null or p_phase not in ('completed', 'failed') then
    raise exception 'Unknown export phase %', p_phase using errcode = '22023';
  end if;
  if p_export is null then
    raise exception 'Which export finished?' using errcode = '22023';
  end if;
  if p_phase = 'completed' and (p_rows is null or p_rows < 0) then
    raise exception 'A completed export records its row count' using errcode = '22023';
  end if;

  -- One finishing row per export, however many callers race.
  perform pg_advisory_xact_lock(hashtextextended('drvn-export:' || p_export::text, 0));
  select * into v_started from public.admin_audit_log a
   where a.subject_type = 'export' and a.subject_id = p_export and a.action = 'export.started'
     and a.actor_id = v_actor
   limit 1;
  if not found then
    raise exception 'No export of yours with that id was started' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.admin_audit_log a
              where a.subject_type = 'export' and a.subject_id = p_export
                and a.action in ('export.completed', 'export.failed')) then
    raise exception 'That export is already recorded as finished' using errcode = '55000';
  end if;

  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'export.' || p_phase, 'export', p_export, v_started.reason,
          (v_started.metadata - 'phase') || jsonb_strip_nulls(jsonb_build_object(
            'phase', p_phase,
            'rows', p_rows,
            'detail', left(nullif(trim(coalesce(p_detail, '')), ''), 500),
            'startedAt', v_started.created_at)));
  return p_export;
end;
$$;

revoke all on function public.record_admin_export(text, text, jsonb, uuid, integer, text) from public, anon;
grant execute on function public.record_admin_export(text, text, jsonb, uuid, integer, text) to authenticated;

-- ---------- Self-checks ----------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'admin_audit_log_actor_guard' and tgrelid = 'public.admin_audit_log'::regclass
  ) then
    raise exception '20261108120000: admin_audit_log_actor_guard trigger missing';
  end if;
  if has_function_privilege('anon', 'public.record_admin_export(text,text,jsonb,uuid,integer,text)', 'execute') then
    raise exception '20261108120000: a signed-out caller can record an export';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
