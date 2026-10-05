-- SECURITY DEFINER functions a signed-out caller can execute are a reviewed
-- list, not an accident of default privileges. Trigger functions are left
-- out: they can't be called except as triggers. Adding a public definer
-- function means adding it here, with a reason.
begin;

do $$
declare
  reviewed text[] := array[
    'activity_post_visible(uuid)',        -- visibility predicate used by RLS; answers only for the caller
    'actor_name(uuid)',                   -- public display name
    'admin_role()',                       -- the caller's own role, null for anyone else
    'identifier_matches_listing(uuid,text)', -- part-number match on a listing, boolean only
    'is_admin()',                         -- the caller's own admin state
    'is_suspended(uuid)',                 -- used by public read policies
    'listing_watch_counts(uuid[])',       -- counts only, for listings the caller can see (R2-09)
    'marketplace_search_ids(text)',       -- ids of active parts of visible sellers matching a search; callers re-read under RLS
    'mod_purchase_sources(uuid[])',       -- source car of purchased build lines, by unguessable item id
    'profile_follow_counts(uuid)',        -- public follower counts
    'profile_is_visible(uuid)',           -- used by public read policies
    'profile_sales_count(uuid)',          -- public sales count for visible profiles
    'search_car_ids(text)',               -- ids of public builds of visible owners; definer so text indexes apply (20261010100000)
    'search_listing_ids(text)',           -- ids of parts a signed-out visitor may see; same reason
    'search_update_ids(text)',            -- ids of published updates on visible public builds; same reason
    'suspended_profile_ids()'             -- the set the read policies test against, once per query; ids only (20261010095900)
  ];
  exposed text[];
  internal text;
begin
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into exposed
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and not (p.oid::regprocedure::text = any(reviewed));
  if cardinality(exposed) > 0 then
    raise exception 'Unreviewed SECURITY DEFINER functions executable by anon: %', exposed;
  end if;

  -- The internal ones stay closed to every client role.
  foreach internal in array array[
    'public.notify(uuid,text,text,text,text,text,uuid)',
    'public.invoke_transfer_worker()',
    'public.mark_due_transfer_intents()',
    'public.escalate_stale_disputes()',
    'public.prune_rate_limits()'
  ] loop
    if has_function_privilege('anon', internal, 'execute')
       or has_function_privilege('authenticated', internal, 'execute') then
      raise exception '% is callable by a client role', internal;
    end if;
  end loop;

  raise notice 'all definer exposure checks passed';
end $$;

rollback;
