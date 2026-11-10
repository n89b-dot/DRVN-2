-- Architecture remediation plan 2, item A3 (20261111100000): a function
-- created with no grant or revoke statement of its own is not callable by a
-- signed-out visitor, a signed-in member, the agent's worker, or anyone
-- through PUBLIC, in either of our schemas, whatever kind of function it is.
-- The server role can still call one made in `public`. A function a migration
-- deliberately opens is still open, and the functions that existed before are
-- untouched.
--
-- The rule reaches every function the creating role makes from then on, in
-- any schema. Two consequences, each proven here on a table made for it:
--   6. A new function used in a row policy or a column default must be
--      granted to the roles that run the query. A forgotten grant fails
--      closed: the member's query is refused, it does not return rows.
--   7. A new trigger function needs no grant: it still fires on a member's
--      write, because that privilege is checked when the trigger is created,
--      not when it fires.
-- Disposable database only; everything rolls back.
begin;

-- Exactly what a careless migration would write: no revoke, no grant.
create function public.a3_plain() returns integer language sql as $$ select 1 $$;
create function public.a3_definer() returns integer language sql security definer set search_path = public, pg_temp as $$ select 1 $$;
create function public.a3_plpgsql(p integer) returns integer language plpgsql as $$ begin return p; end $$;
create procedure public.a3_procedure() language sql as $$ select 1 $$;
create function private.a3_private() returns integer language sql as $$ select 1 $$;
-- And one a migration opens on purpose.
create function public.a3_opened() returns integer language sql as $$ select 1 $$;
grant execute on function public.a3_opened() to authenticated;

-- For 6 and 7: a table with a row policy, a trigger and (later) a column
-- default, each calling a function made with no grant.
create table public.a3_notes (id integer primary key, owner uuid not null, body text, stamped boolean not null default false, code integer);
alter table public.a3_notes enable row level security;
revoke all on table public.a3_notes from anon, authenticated;
grant select, insert on table public.a3_notes to authenticated;
create function public.a3_can_see(p_owner uuid) returns boolean language plpgsql stable as $$ begin return p_owner is not null; end $$;
create policy a3_read on public.a3_notes for select to authenticated using (public.a3_can_see(owner));
create policy a3_write on public.a3_notes for insert to authenticated with check (true);
create function public.a3_stamp() returns trigger language plpgsql as $$ begin new.stamped := true; return new; end $$;
create trigger a3_stamp before insert on public.a3_notes for each row execute function public.a3_stamp();
create function public.a3_code() returns integer language plpgsql as $$ begin return 42; end $$;

do $$
declare
  fn text;
  seen integer;
  note public.a3_notes;
  role_name text;
  refused boolean;
  before_count integer;
begin
  -- ==========================================================
  -- 1. Closed to every client role, and to PUBLIC
  -- ==========================================================
  foreach fn in array array[
    'public.a3_plain()', 'public.a3_definer()', 'public.a3_plpgsql(integer)', 'public.a3_procedure()', 'private.a3_private()'
  ] loop
    foreach role_name in array array['anon', 'authenticated', 'agent_worker'] loop
      if has_function_privilege(role_name, fn, 'execute') then
        raise exception 'FAIL 1a: % can execute %, a function created with no grant', role_name, fn;
      end if;
    end loop;
    if exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where oid = fn::regprocedure),
                                                 acldefault('f', (select proowner from pg_proc where oid = fn::regprocedure)))) a
               where a.grantee = 0) then
      raise exception 'FAIL 1b: % is executable through PUBLIC', fn;
    end if;
  end loop;
  raise notice 'PASS 1: a function created with no grant is closed to visitors, members, the agent worker and PUBLIC';

  -- ==========================================================
  -- 2. A signed-in member is really refused, not only on paper
  -- ==========================================================
  perform set_config('role', 'authenticated', true);
  refused := false;
  begin perform public.a3_plain(); exception when insufficient_privilege then refused := true; end;
  if not refused then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 2a: a signed-in member called a function nobody opened'; end if;
  refused := false;
  begin perform public.a3_definer(); exception when insufficient_privilege then refused := true; end;
  if not refused then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 2b: a signed-in member called a definer function nobody opened'; end if;
  -- The one a migration opened still answers.
  if public.a3_opened() <> 1 then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 2c: a function granted to members did not answer'; end if;
  perform set_config('role', 'anon', true);
  refused := false;
  begin perform public.a3_plain(); exception when insufficient_privilege then refused := true; end;
  if not refused then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 2d: a signed-out visitor called a function nobody opened'; end if;
  refused := false;
  begin perform public.a3_opened(); exception when insufficient_privilege then refused := true; end;
  if not refused then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 2e: a function granted to members only answered a visitor'; end if;
  perform set_config('role', 'supabase_admin', true);
  raise notice 'PASS 2: members and visitors are refused at the call, and a function a migration opens is open to exactly whom it names';

  -- ==========================================================
  -- 3. The server keeps its access in public
  -- ==========================================================
  foreach fn in array array['public.a3_plain()', 'public.a3_definer()', 'public.a3_plpgsql(integer)', 'public.a3_procedure()'] loop
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAIL 3a: the server role cannot call %, a new function in public', fn;
    end if;
  end loop;
  perform set_config('role', 'service_role', true);
  if public.a3_plain() <> 1 then perform set_config('role', 'supabase_admin', true); raise exception 'FAIL 3b: the server role''s call did not answer'; end if;
  perform set_config('role', 'supabase_admin', true);
  raise notice 'PASS 3: the server role can still call a new function in public';

  -- ==========================================================
  -- 4. The rule is the one the migration wrote, for the role that creates
  -- ==========================================================
  if not exists (select 1 from pg_default_acl d where d.defaclrole = current_user::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f') then
    raise exception 'FAIL 4a: % has no global default for functions; the migration''s first statement is missing', current_user;
  end if;
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
             where d.defaclrole = current_user::regrole and d.defaclobjtype = 'f'
               -- Ours: the global default and our two schemas. The platform keeps its own
               -- defaults for its own schemas (graphql, storage), where no migration creates functions.
               and (d.defaclnamespace = 0 or d.defaclnamespace in ('public'::regnamespace, 'private'::regnamespace))
               and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))
               and a.privilege_type = 'EXECUTE') then
    raise exception 'FAIL 4b: a default privilege still gives new functions in public or private to PUBLIC, anon or authenticated';
  end if;
  raise notice 'PASS 4: no default privilege of the creating role gives a new function in our schemas to PUBLIC, anon or authenticated';

  -- ==========================================================
  -- 5. Nothing that existed was changed
  -- ==========================================================
  -- Functions members can call today are still callable: the rule is about new ones.
  select count(*) into before_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname not like 'a3\_%' and has_function_privilege('authenticated', p.oid, 'execute');
  if before_count = 0 then
    raise exception 'FAIL 5a: no existing function in public is callable by a member; the default was applied to what already existed';
  end if;
  if not has_function_privilege('anon', 'public.username_available(text)', 'execute') then
    raise exception 'FAIL 5b: username_available, a function visitors are meant to call, was closed';
  end if;
  raise notice 'PASS 5: functions that were already open to members and visitors still are (% in public)', before_count;

  -- ==========================================================
  -- 7. A trigger function with no grant still fires on a member's write
  -- ==========================================================
  if has_function_privilege('authenticated', 'public.a3_stamp()', 'execute') then
    raise exception 'FAIL 7a: the trigger function is callable by a member; this case would prove nothing';
  end if;
  perform set_config('role', 'authenticated', true);
  refused := false;
  begin insert into public.a3_notes (id, owner, body) values (1, gen_random_uuid(), 'written by a member');
  exception when insufficient_privilege then refused := true; end;
  perform set_config('role', 'supabase_admin', true);
  if refused then
    raise exception 'FAIL 7b: a member''s write was refused because its trigger function has no grant. If this is true on this PostgreSQL, every new trigger function needs a grant and the migration must say so';
  end if;
  select * into note from public.a3_notes where id = 1;
  if note.stamped is not true then raise exception 'FAIL 7c: the trigger did not fire on the member''s write'; end if;
  raise notice 'PASS 7: a new trigger function with no grant still fires on a member''s write';

  -- ==========================================================
  -- 6. A function in a row policy or a column default: a forgotten grant fails closed
  -- ==========================================================
  perform set_config('role', 'authenticated', true);
  refused := false;
  begin select count(*) into seen from public.a3_notes;
  exception when insufficient_privilege then refused := true; end;
  perform set_config('role', 'supabase_admin', true);
  if not refused then
    raise exception 'FAIL 6a: a member read a table whose policy calls a function nobody granted (% row(s)); a forgotten grant must refuse the query', seen;
  end if;
  grant execute on function public.a3_can_see(uuid) to authenticated;
  perform set_config('role', 'authenticated', true);
  select count(*) into seen from public.a3_notes;
  perform set_config('role', 'supabase_admin', true);
  if seen <> 1 then raise exception 'FAIL 6b: with the policy function granted the member saw % row(s), not the 1 there is', seen; end if;

  alter table public.a3_notes alter column code set default public.a3_code();
  perform set_config('role', 'authenticated', true);
  refused := false;
  begin insert into public.a3_notes (id, owner, body) values (2, gen_random_uuid(), 'needs the default');
  exception when insufficient_privilege then refused := true; end;
  perform set_config('role', 'supabase_admin', true);
  if not refused then raise exception 'FAIL 6c: a member''s insert used a column default whose function nobody granted'; end if;
  if exists (select 1 from public.a3_notes where id = 2) then raise exception 'FAIL 6d: the refused insert left a row'; end if;
  grant execute on function public.a3_code() to authenticated;
  perform set_config('role', 'authenticated', true);
  insert into public.a3_notes (id, owner, body) values (2, gen_random_uuid(), 'needs the default');
  perform set_config('role', 'supabase_admin', true);
  select * into note from public.a3_notes where id = 2;
  if note.code is distinct from 42 then raise exception 'FAIL 6e: with the default''s function granted the member''s insert did not get its value'; end if;
  raise notice 'PASS 6: a policy function and a default function with no grant refuse the member''s query, and work once granted';

  raise notice 'all functions-closed-by-default checks passed';
end $$;

rollback;
