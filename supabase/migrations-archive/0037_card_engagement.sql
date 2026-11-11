-- 0037: card engagement.
--
-- The Explore deck and marketplace grid grow an Instagram-style action row
-- (like · comment · share · save) on every card. Two schema gaps close here:
--
--   1. `likes` — a public "this is great" signal on listings and cars.
--      Distinct from `saves` (private watch/bookmark, counts visible only to
--      the target's owner per 0002) and from `activity_reactions` (posts
--      already have those; a post's card-like stays the 🔥 reaction so the
--      card and the activity page never disagree).
--
--   2. `saves.target_type` learns 'post', so a build update can be
--      bookmarked from its card and resurface on /saved.
--
-- Idempotent: re-running is safe.

begin;

-- 1. Public likes on listings and cars ------------------------------------

create table if not exists public.likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'car')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists likes_target_idx on public.likes (target_type, target_id);

alter table public.likes enable row level security;

-- Like counts are a public signal (unlike saves): anyone can read, each user
-- writes only their own rows.
drop policy if exists "likes public read" on public.likes;
create policy "likes public read" on public.likes for select using (true);

drop policy if exists "users manage own likes" on public.likes;
create policy "users manage own likes" on public.likes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Saves may bookmark posts too -----------------------------------------

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'saves'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%target_type%';
  if conname is not null then
    execute format('alter table public.saves drop constraint %I', conname);
  end if;
  alter table public.saves add constraint saves_target_type_check
    check (target_type in ('listing', 'car', 'profile', 'post'));
exception
  when duplicate_object then null;
end $$;

-- 3. Self-checks ----------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'likes'
  ) then
    raise exception 'likes table missing';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'likes') < 2 then
    raise exception 'likes policies missing';
  end if;

  -- The saves check must now admit ''post''.
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'saves'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%post%'
  ) then
    raise exception 'saves target_type check not extended to post';
  end if;

  raise notice '0037 self-checks pass';
end $$;

commit;
