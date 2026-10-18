-- Row security asks "who is this?" once per query (20261017140000): no
-- policy in public calls auth.uid(), auth.jwt(), auth.role() or
-- public.is_admin() bare, where Postgres would run it for every row. Wrap
-- the call in a scalar subquery: `(select auth.uid())`.
begin;

do $$
declare
  bad text;
begin
  perform set_config('search_path', '', true);
  select string_agg(format('%s: %s', c.relname, p.polname), '; ' order by c.relname, p.polname) into bad
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral (
    select regexp_replace(
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
             '\( SELECT (auth\.(uid|jwt|role)\(\)|public\.is_admin\(\)) AS \w+\)', '', 'g') as bare
  ) e
  where n.nspname = 'public'
    and e.bare ~ '(auth\.(uid|jwt|role)\(\)|public\.is_admin\(\))';
  if bad is not null then
    raise exception 'FAIL 1: policies that run an auth or admin check per row (wrap it in a select): %', bad;
  end if;

  raise notice 'all rls initplan checks passed';
end $$;

rollback;
