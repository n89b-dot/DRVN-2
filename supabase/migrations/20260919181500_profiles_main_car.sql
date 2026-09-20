-- 20260919181500 — the main car (PRD 2026-09 P-5).
--
-- A member with four cars has one they actually mean. Today every surface
-- guesses: the garage sorts by creation date, the profile shows whichever
-- car was added first, the sell form defaults to the newest. The answer is
-- the same question asked four times, and the member never gets to answer it.
--
-- `profiles.main_car_id` is that answer, and it drives: the featured car on a
-- profile, the default banner, car order everywhere (main first, then
-- newest), the Garage's focused view, and the FIRST one-tap suggestion in the
-- marketplace vehicle picker — offered, never applied.
--
-- Two things this is NOT:
--   * not required — null is the ordinary state, and every reader falls back
--     to "newest first" exactly as it does today;
--   * not a filter — the marketplace offers the main car as a choice and an
--     explicit or URL-supplied vehicle always wins. A cleared filter stays
--     cleared.
--
-- New `profiles` columns are invisible and unwritable until explicitly
-- granted (the 0017 pattern), so the grants below are the whole point of
-- this file being more than one ALTER.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.profiles
  add column if not exists main_car_id uuid
    references public.cars (id) on delete set null;

comment on column public.profiles.main_car_id is
  'The car this member actually means. Drives featured car, default banner, car order, Garage focus and the first marketplace vehicle suggestion. Null is ordinary — readers fall back to newest-first.';

-- Readable by anyone (it decides what a public profile leads with) and
-- writable by the member. Column-level grants only: a table-wide grant would
-- re-expose the Stripe pointers 0017 deliberately hid.
grant select (main_car_id) on public.profiles to anon, authenticated;
grant update (main_car_id) on public.profiles to authenticated;

-- ============================================================
-- Ownership guard
-- ============================================================
-- RLS says who may update the row; it says nothing about whether the VALUE
-- is theirs. Without this, a member could point main_car_id at somebody
-- else's car and publish a profile that features it.
create or replace function public.guard_profile_main_car()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.main_car_id is not null
     and (old.main_car_id is distinct from new.main_car_id) then
    if not exists (
      select 1 from public.cars c
      where c.id = new.main_car_id and c.owner_id = new.id
    ) then
      raise exception 'A main car must be one of your own cars.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_main_car on public.profiles;
create trigger guard_profile_main_car
  before update on public.profiles
  for each row execute function public.guard_profile_main_car();

commit;
