-- OS-W21 N53: builds can be reported, and an admin can hide one.
--
-- Reports covered listings, members, posts and replies but not cars, so a
-- build's name, description or photos could only be dealt with by suspending
-- the whole account (docs/production-readiness-2026-11-03.md §2.3).
--
-- 1. 'car' is a report subject.
-- 2. An admin can hide a build: moderation_hidden_at / _reason are set, the
--    car is made private, and while it is hidden its owner can't make it
--    public again or clear the hold. Making it private means every existing
--    "public builds only" read (pages, search documents, sitemaps, feeds)
--    drops it with no new filter to remember. The owner still sees it, as a
--    private build, and is told why.
-- 3. Lifting the hold clears the columns; the build stays private until its
--    owner republishes it, like a restored listing comes back paused.
--
-- Only the service role (the admin console's audited actions) or a
-- signed-in admin can change the hold.

begin;

alter table public.reports drop constraint if exists reports_subject_type_check;
alter table public.reports add constraint reports_subject_type_check
  check (subject_type in ('listing', 'user', 'post', 'comment', 'car'));

alter table public.cars
  add column if not exists moderation_hidden_at timestamptz,
  add column if not exists moderation_hidden_reason text;

alter table public.cars drop constraint if exists cars_moderation_hidden_reason_check;
alter table public.cars add constraint cars_moderation_hidden_reason_check
  check (
    (moderation_hidden_at is null and moderation_hidden_reason is null)
    or (moderation_hidden_at is not null and char_length(btrim(coalesce(moderation_hidden_reason, ''))) between 1 and 500)
  );

comment on column public.cars.moderation_hidden_at is
  'N53: set by an admin takedown. While set the build is private and its owner cannot republish it.';

create or replace function private.guard_car_moderation_hold()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member boolean := (select auth.uid()) is not null and not public.is_admin();
begin
  if tg_op = 'INSERT' then
    if v_member and (new.moderation_hidden_at is not null or new.moderation_hidden_reason is not null) then
      raise exception 'Only DRVN can hide a build' using errcode = '42501';
    end if;
  else
    if v_member and (new.moderation_hidden_at is distinct from old.moderation_hidden_at
                     or new.moderation_hidden_reason is distinct from old.moderation_hidden_reason) then
      raise exception 'Only DRVN can hide or restore a build' using errcode = '42501';
    end if;
  end if;
  -- A hidden build is never public, whoever writes it.
  if new.moderation_hidden_at is not null then
    new.is_public := false;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_car_moderation_hold() from public, anon, authenticated;

drop trigger if exists cars_moderation_hold on public.cars;
create trigger cars_moderation_hold
  before insert or update on public.cars
  for each row execute function private.guard_car_moderation_hold();

commit;
