-- 0046 — the operations case layer (brief §K1).
--
-- Disputes and reports become claimable units of WORK, not just rows in
-- queues: a case aggregates status, priority, assignment and labels over the
-- underlying object. Cases are CREATED AND RESOLVED BY TRIGGERS on the
-- domain events themselves (dispute opened/resolved, report filed/closed) so
-- the case ledger stays true no matter which path acted — admin console,
-- SLA sweep, buyer acceptance. Admin mutations (claim, labels, priority) go
-- through auditedAction like everything else.
--
-- Deliberately NOT a CRM: no contacts, no macros-engine, no pipelines — the
-- case is a work wrapper around DRVN's existing objects.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.ops_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dispute', 'report')),
  status text not null default 'open' check (status in ('open', 'claimed', 'resolved')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  assigned_to uuid,
  order_id uuid references public.orders (id) on delete cascade,
  report_id uuid references public.reports (id) on delete cascade,
  summary text not null default '',
  labels text[] not null default '{}',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (kind = 'dispute' and order_id is not null and report_id is null) or
    (kind = 'report' and report_id is not null and order_id is null)
  )
);
create unique index if not exists ops_cases_order_key on public.ops_cases (order_id) where order_id is not null;
create unique index if not exists ops_cases_report_key on public.ops_cases (report_id) where report_id is not null;
create index if not exists ops_cases_queue_idx on public.ops_cases (status, priority, opened_at);

-- Console members read through RLS (same posture as orders' admin policy);
-- writes are service-role only via audited actions.
alter table public.ops_cases enable row level security;
revoke all on public.ops_cases from anon, authenticated;
grant select on public.ops_cases to authenticated;
drop policy if exists "admins read cases" on public.ops_cases;
create policy "admins read cases" on public.ops_cases
  for select using (public.is_admin());

-- ---------- lifecycle triggers ----------
create or replace function public.ops_case_on_dispute()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.disputed_at is not null and (old.disputed_at is distinct from new.disputed_at) then
    insert into public.ops_cases (kind, order_id, summary, priority)
    values (
      'dispute', new.id,
      coalesce(new.dispute_category::text, 'dispute'),
      case when new.total_cents >= 50000 then 'high' else 'normal' end
    )
    on conflict (order_id) where order_id is not null do update
      set status = case when public.ops_cases.status = 'resolved' then 'open' else public.ops_cases.status end,
          resolved_at = null,
          updated_at = now();
  end if;
  if new.dispute_resolved_at is not null and (old.dispute_resolved_at is distinct from new.dispute_resolved_at) then
    update public.ops_cases
    set status = 'resolved', resolved_at = new.dispute_resolved_at, updated_at = now()
    where order_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists ops_case_dispute_sync on public.orders;
create trigger ops_case_dispute_sync
  after update on public.orders
  for each row execute function public.ops_case_on_dispute();

create or replace function public.ops_case_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ops_cases (kind, report_id, summary)
    values ('report', new.id, coalesce(new.reason::text, 'report'))
    on conflict (report_id) where report_id is not null do nothing;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('actioned', 'dismissed') then
      update public.ops_cases
      set status = 'resolved', resolved_at = now(), updated_at = now()
      where report_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists ops_case_report_sync on public.reports;
create trigger ops_case_report_sync
  after insert or update on public.reports
  for each row execute function public.ops_case_on_report();

-- ---------- backfill ----------
insert into public.ops_cases (kind, order_id, summary, opened_at, status, resolved_at, priority)
select 'dispute', o.id, coalesce(o.dispute_category::text, 'dispute'), o.disputed_at,
       case when o.dispute_resolved_at is not null then 'resolved' else 'open' end,
       o.dispute_resolved_at,
       case when o.total_cents >= 50000 then 'high' else 'normal' end
from public.orders o
where o.disputed_at is not null
on conflict (order_id) where order_id is not null do nothing;

insert into public.ops_cases (kind, report_id, summary, opened_at, status, resolved_at)
select 'report', r.id, coalesce(r.reason::text, 'report'), r.created_at,
       case when r.status in ('actioned', 'dismissed') then 'resolved' else 'open' end,
       case when r.status in ('actioned', 'dismissed') then r.created_at else null end
from public.reports r
on conflict (report_id) where report_id is not null do nothing;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.ops_cases') is null then
    raise exception '0046: ops_cases missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'ops_case_dispute_sync' and tgrelid = 'public.orders'::regclass
  ) then
    raise exception '0046: dispute sync trigger missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'ops_case_report_sync' and tgrelid = 'public.reports'::regclass
  ) then
    raise exception '0046: report sync trigger missing';
  end if;
  raise notice 'PASS: 0046 self-checks';
end $$;

commit;
