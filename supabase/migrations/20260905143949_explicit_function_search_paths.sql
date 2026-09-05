begin;
-- Pin application-owned functions to trusted schemas. Extension-owned routines
-- are managed by their extension and are deliberately excluded.
do $$
declare routine record;
begin
 for routine in
  select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not exists(select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 loop
  execute format('alter function %s set search_path=public,extensions,pg_temp',routine.signature);
 end loop;
end $$;
commit;
