-- OS-W34 N38 (Neil's ruling, 7 November 2026: "Usernames: audit collisions
-- first, then enforce lowercase a-z, 0-9 and _ at 3 to 30 characters, with
-- reserved names and tombstones. NULL is allowed for incomplete or deleted
-- profiles.")
--
-- Before this, the database's only rule was a case-sensitive `unique`, so
-- `Neil` could sit beside `neil`, a handle could be 1,000 characters or hold
-- spaces and lookalikes, `admin` or `drvn` could be taken, and a deleted
-- member's handle was free again the moment the deletion worker cleared it.
--
-- 1. Audit, then remediate, existing handles (private.username_audit keeps
--    every change): a handle that is valid once lowercased and trimmed, and
--    not already held that way or reserved, is lowercased; any other invalid
--    handle (a case collision or a bad format) is cleared, which sends its
--    member back to onboarding to choose again (NULL = not yet chosen).
--    Existing holders of a reserved name keep it (recorded as 'kept').
-- 2. Enforce the format with a check constraint. All handles are then
--    lowercase, so the existing unique constraint is case-insensitive.
-- 3. Reserved names and tombstones: a handle can't be newly taken if it is
--    reserved, or retired by a deleted account (the deletion scrub writes the
--    tombstone, 20261107220510). Refused as 23505 "taken", like a duplicate.
-- 4. username_available(text): the onboarding check, with the same rules.

begin;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------
create table if not exists private.reserved_usernames (
  username text primary key check (username ~ '^[a-z0-9_]{3,30}$'),
  reason text not null
);

create table if not exists private.username_tombstones (
  username text primary key check (username ~ '^[a-z0-9_]{3,30}$'),
  retired_at timestamptz not null default now(),
  reason text not null default 'account deleted'
);

-- No foreign key: the audit outlives the profiles it describes.
create table if not exists private.username_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  old_username text not null,
  problem text not null check (problem in ('format', 'case_collision', 'reserved')),
  action text not null check (action in ('lowercased', 'cleared', 'kept')),
  new_username text,
  audited_at timestamptz not null default now()
);

revoke all on private.reserved_usernames, private.username_tombstones, private.username_audit
  from public, anon, authenticated;

insert into private.reserved_usernames (username, reason) values
  ('drvn', 'brand'), ('drvnapp', 'brand'), ('drvn_team', 'brand'), ('drvnteam', 'brand'),
  ('official', 'brand'), ('team', 'staff'), ('staff', 'staff'),
  ('admin', 'staff'), ('administrator', 'staff'), ('admins', 'staff'),
  ('moderator', 'staff'), ('moderators', 'staff'), ('mod', 'staff'), ('mods', 'staff'),
  ('support', 'staff'), ('help', 'staff'), ('helpdesk', 'staff'), ('contact', 'staff'),
  ('security', 'staff'), ('trust', 'staff'), ('safety', 'staff'), ('abuse', 'staff'),
  ('legal', 'staff'), ('privacy', 'staff'), ('billing', 'staff'), ('payments', 'staff'),
  ('payouts', 'staff'), ('refunds', 'staff'), ('disputes', 'staff'), ('orders', 'staff'),
  ('system', 'system'), ('root', 'system'), ('null', 'system'), ('undefined', 'system'),
  ('anonymous', 'system'), ('deleted', 'system'), ('deleted_member', 'system'),
  ('everyone', 'system'), ('here', 'system'), ('you', 'system'),
  ('api', 'route'), ('www', 'route'), ('mail', 'route'), ('email', 'route'),
  ('settings', 'route'), ('account', 'route'), ('login', 'route'), ('logout', 'route'),
  ('signin', 'route'), ('signup', 'route'), ('register', 'route'), ('onboarding', 'route'),
  ('explore', 'route'), ('marketplace', 'route'), ('garage', 'route'), ('agent', 'route'),
  ('home', 'route'), ('sell', 'route'), ('listings', 'route'), ('messages', 'route'),
  ('notifications', 'route'), ('saved', 'route'), ('cart', 'route'), ('checkout', 'route'),
  ('offers', 'route'), ('docs', 'route'), ('terms', 'route'), ('protection', 'route')
on conflict (username) do nothing;

-- ------------------------------------------------------------
-- 1. Audit and remediate existing handles
-- ------------------------------------------------------------
-- A function, so the guard can run it against seeded bad handles too.
-- Each run's rows share a run_id; a run returns how many it recorded.
alter table private.username_audit add column if not exists run_id uuid not null default gen_random_uuid();

create or replace function private.audit_and_fix_usernames()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_run uuid := gen_random_uuid();
  v_count integer;
begin
  insert into private.username_audit (run_id, user_id, old_username, problem, action, new_username)
  select v_run,
         c.id,
         c.username,
         case when c.candidate ~ '^[a-z0-9_]{3,30}$' and c.rank_in_name > 1 then 'case_collision' else 'format' end,
         case when c.fixable then 'lowercased' else 'cleared' end,
         case when c.fixable then c.candidate end
    from (
      select r.*,
             r.candidate ~ '^[a-z0-9_]{3,30}$' and r.rank_in_name = 1
               and not exists (select 1 from private.reserved_usernames x where x.username = r.candidate)
               and not exists (select 1 from private.username_tombstones t where t.username = r.candidate) as fixable
        from (
          select p.id, p.username, lower(btrim(p.username)) as candidate,
                 -- The handle already held exactly as lowercase keeps its
                 -- name; otherwise the oldest account does.
                 row_number() over (
                   partition by lower(btrim(p.username))
                   order by (p.username = lower(btrim(p.username))) desc, p.created_at, p.id
                 ) as rank_in_name
            from public.profiles p
           where p.username is not null
        ) r
    ) c
   where c.username !~ '^[a-z0-9_]{3,30}$';

  -- Clear first, so no lowercased handle meets one still to be cleared.
  update public.profiles p
     set username = null
    from private.username_audit a
   where a.run_id = v_run and a.user_id = p.id and a.action = 'cleared' and p.username = a.old_username;
  update public.profiles p
     set username = a.new_username
    from private.username_audit a
   where a.run_id = v_run and a.user_id = p.id and a.action = 'lowercased' and p.username = a.old_username;

  -- Reserved names already held stay with their holders, on the record.
  insert into private.username_audit (run_id, user_id, old_username, problem, action, new_username)
  select v_run, p.id, p.username, 'reserved', 'kept', p.username
    from public.profiles p
    join private.reserved_usernames r on r.username = p.username
   where not exists (select 1 from private.username_audit a
                      where a.user_id = p.id and a.problem = 'reserved' and a.old_username = p.username);

  select count(*) into v_count from private.username_audit where run_id = v_run;
  return v_count;
end;
$$;

revoke all on function private.audit_and_fix_usernames() from public, anon, authenticated;

select private.audit_and_fix_usernames();

-- ------------------------------------------------------------
-- 2. The format, enforced
-- ------------------------------------------------------------
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_]{3,30}$');

comment on column public.profiles.username is
  'N38 (OS-W34): lowercase a-z, 0-9 and _, 3 to 30 characters; NULL until onboarding chooses one, and again once an account is deleted. Not reserved, not retired (private.username_tombstones). Set once.';

-- ------------------------------------------------------------
-- 3. Reserved names and tombstones
-- ------------------------------------------------------------
create or replace function private.guard_username_choice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.username is null or (tg_op = 'UPDATE' and new.username is not distinct from old.username) then
    return new;
  end if;
  if exists (select 1 from private.reserved_usernames r where r.username = new.username) then
    raise exception 'That username is taken.' using errcode = '23505', hint = 'username_reserved';
  end if;
  if exists (select 1 from private.username_tombstones t where t.username = new.username) then
    raise exception 'That username is taken.' using errcode = '23505', hint = 'username_retired';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_username_choice() from public, anon, authenticated;

drop trigger if exists profiles_username_choice on public.profiles;
create trigger profiles_username_choice
  before insert or update of username on public.profiles
  for each row execute function private.guard_username_choice();

-- ------------------------------------------------------------
-- 4. The onboarding availability check
-- ------------------------------------------------------------
-- 'invalid' | 'taken' | 'available'. Taken, reserved and retired read the
-- same: nobody learns which handles belonged to deleted accounts.
create or replace function public.username_available(p_username text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_username is null or p_username !~ '^[a-z0-9_]{3,30}$' then 'invalid'
    when exists (select 1 from public.profiles p where p.username = p_username)
      or exists (select 1 from private.reserved_usernames r where r.username = p_username)
      or exists (select 1 from private.username_tombstones t where t.username = p_username)
      then 'taken'
    else 'available'
  end;
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
