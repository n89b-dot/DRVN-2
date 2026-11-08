-- OS-W21 N53: builds can be reported, and an admin can hide one.
--
-- Reports covered listings, members, posts and replies but not cars, so a
-- build's name, description or photos could only be dealt with by suspending
-- the whole account (docs/production-readiness-2026-11-03.md §2.3).
--
-- 1. 'car' is a report subject.
-- 2. An admin can hide a build: a row in car_moderation_holds makes the car
--    private, and while the row exists the car can't be made public again, by
--    its owner or anyone else. Making it private means every existing
--    "public builds only" read (pages, search documents, sitemaps, feeds)
--    drops it with no new filter to remember. The owner still sees it, as a
--    private build, and can read the hold's reason.
-- 3. Lifting the hold deletes the row; the build stays private until its
--    owner republishes it, like a restored listing comes back paused.
--
-- The hold is its own table rather than columns on cars: several read
-- functions return `setof public.cars` from an explicit column list
-- (explore_build_rows), and cars' client-readable columns are a reviewed set
-- (car_vin_privacy_guard). Only the service role — the admin console's
-- audited actions — writes holds; members have no write grant or policy.

begin;

alter table public.reports drop constraint if exists reports_subject_type_check;
alter table public.reports add constraint reports_subject_type_check
  check (subject_type in ('listing', 'user', 'post', 'comment', 'car'));

create table if not exists public.car_moderation_holds (
  car_id uuid primary key references public.cars(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  hidden_by uuid references public.profiles(id) on delete set null,
  report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists car_moderation_holds_hidden_by_idx on public.car_moderation_holds (hidden_by);
create index if not exists car_moderation_holds_report_id_idx on public.car_moderation_holds (report_id);

comment on table public.car_moderation_holds is
  'N53: an admin takedown of a build. While a row exists the car is private and cannot be made public. Written only by the service role.';

alter table public.car_moderation_holds enable row level security;

revoke all on public.car_moderation_holds from anon, authenticated;
grant select on public.car_moderation_holds to authenticated;

drop policy if exists "owners read their build's hold" on public.car_moderation_holds;
create policy "owners read their build's hold" on public.car_moderation_holds
  for select to authenticated
  using (
    exists (select 1 from public.cars c where c.id = car_id and c.owner_id = (select auth.uid()))
    or (select public.is_admin())
  );

-- A held build is never public, whoever writes it.
create or replace function private.car_moderation_hold_keeps_private()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_public and exists (select 1 from public.car_moderation_holds h where h.car_id = new.id) then
    new.is_public := false;
  end if;
  return new;
end;
$$;

revoke all on function private.car_moderation_hold_keeps_private() from public, anon, authenticated;

drop trigger if exists cars_moderation_hold on public.cars;
create trigger cars_moderation_hold
  before insert or update of is_public on public.cars
  for each row execute function private.car_moderation_hold_keeps_private();

-- Placing a hold takes the build private at once.
create or replace function private.car_moderation_hold_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.cars set is_public = false where id = new.car_id and is_public;
  return new;
end;
$$;

revoke all on function private.car_moderation_hold_apply() from public, anon, authenticated;

drop trigger if exists car_moderation_holds_apply on public.car_moderation_holds;
create trigger car_moderation_holds_apply
  after insert on public.car_moderation_holds
  for each row execute function private.car_moderation_hold_apply();

commit;
