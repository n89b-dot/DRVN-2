-- Every SECURITY DEFINER function pins its search_path, and the only
-- functions that don't are the reviewed, caller's-rights SQL functions below
-- (A0 advisor follow-up, 17 Oct 2026).
--
-- Supabase's advisor flags these 10 as "function_search_path_mutable". They
-- stay unpinned on purpose: each is a SECURITY INVOKER `language sql`
-- function the planner inlines into the calling query, and a `SET` clause on
-- a SQL function stops it being inlined (the 2M-scale search plans in
-- docs/performance/query-plans.md depend on it). A mutable search_path only
-- matters for privilege when a function runs with its owner's rights; these
-- run with the caller's, and they name their tables with `public.`.
-- A new function must pin search_path, or be added here with that reason.
begin;

do $$
declare
  reviewed text[] := array[
    'car_search_doc', 'explore_build_rows', 'explore_update_rows', 'explore_update_search_rows',
    'listing_search_doc', 'marketplace_browse_rows', 'marketplace_search_browse_rows',
    'marketplace_search_rows', 'mod_search_doc', 'post_search_doc'];
  bad text;
begin
  -- 1. Owner's-rights functions always pin search_path.
  select string_agg(n.nspname || '.' || p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then
    raise exception 'FAIL 1: SECURITY DEFINER functions without a pinned search_path: %', bad;
  end if;

  -- 2. Caller's-rights functions without one are exactly the reviewed set.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
    and l.lanname in ('sql', 'plpgsql')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    and p.proname <> all (reviewed);
  if bad is not null then
    raise exception 'FAIL 2: functions with a mutable search_path outside the reviewed set (pin it, or review and add it here): %', bad;
  end if;

  -- 3. Every reviewed function is still caller's-rights SQL, so it stays inlinable.
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace and p.proname = any (reviewed)
    and (p.prosecdef or l.lanname <> 'sql');
  if bad is not null then
    raise exception 'FAIL 3: a reviewed function is no longer caller''s-rights SQL; pin its search_path: %', bad;
  end if;

  raise notice 'all function search path checks passed';
end $$;

rollback;
