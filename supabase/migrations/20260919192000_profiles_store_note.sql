-- 20260919192000 — a store note (PRD 2026-09 P-8).
--
-- One short line pinned above a member's parts grid: "everything off the S15
-- build", "posting Mon/Thu", "message before you buy the wheels". It is the
-- one piece of seller voice in a grid that is otherwise all product, and it
-- answers the questions that would otherwise arrive as five messages.
--
-- Short on purpose: 180 characters is a line, not a shop policy. Policies
-- live in the returns and shipping settings where they are enforceable.
--
-- Column-level grants, per the 0017 pattern — a new profiles column is
-- invisible and unwritable until granted.
--
-- Idempotent.

begin;

alter table public.profiles
  add column if not exists store_note text;

comment on column public.profiles.store_note is
  'One short line above the member''s parts grid (P-8). Voice, not policy — max 180 chars, enforced below.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_store_note_length') then
    alter table public.profiles
      add constraint profiles_store_note_length
      check (store_note is null or length(store_note) <= 180);
  end if;
end;
$$;

grant select (store_note) on public.profiles to anon, authenticated;
grant update (store_note) on public.profiles to authenticated;

commit;
