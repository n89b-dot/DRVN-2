-- 0044 — saved searches & alerts (brief §C).
--
-- A buyer who built a marketplace state (query, category, price band,
-- condition, location, fitment) can keep it. Saving and alerting are
-- SEPARATE: `alert` defaults false — saving is silent, alerts are an explicit
-- opt-in, and disabling is one update. Matching runs on a worker pass
-- (/api/jobs/saved-searches) that stamps last_checked_at and notifies through
-- the existing notifications system (kind 'saved_search', gated by the
-- 'saved_searches' preference on top of the per-search opt-in).
--
-- `params` stores the marketplace filter state as jsonb — the same shape as
-- the /marketplace query string (q, category, subcategory, condition, min,
-- max, location, fit) so a saved search IS a marketplace URL.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  params jsonb not null default '{}'::jsonb,
  alert boolean not null default false,
  last_checked_at timestamptz,
  last_matched_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists saved_searches_user_idx on public.saved_searches (user_id, created_at desc);
create index if not exists saved_searches_alert_idx on public.saved_searches (alert) where alert;

-- Bounded per user: the 51st save asks the user to prune, not the database
-- to suffer. Enforced with a trigger (a CHECK can't count rows).
create or replace function public.guard_saved_search_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 50 then
    raise exception 'saved search limit reached (50)';
  end if;
  return new;
end;
$$;
drop trigger if exists saved_searches_count_guard on public.saved_searches;
create trigger saved_searches_count_guard
  before insert on public.saved_searches
  for each row execute function public.guard_saved_search_count();

alter table public.saved_searches enable row level security;
drop policy if exists "own saved searches" on public.saved_searches;
create policy "own saved searches" on public.saved_searches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if to_regclass('public.saved_searches') is null then
    raise exception '0044: saved_searches missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'saved_searches_count_guard'
      and tgrelid = 'public.saved_searches'::regclass
  ) then
    raise exception '0044: count guard missing';
  end if;
  raise notice 'PASS: 0044 self-checks';
end $$;

commit;
