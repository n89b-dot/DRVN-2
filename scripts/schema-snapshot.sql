-- Plan 2 item A1: one JSON document describing the database as it stands,
-- read by scripts/schema-snapshot.mjs, which writes it as supabase/schema/.
--
-- It is one SELECT and changes nothing: the generator runs it in a session
-- where every transaction is read-only. ACL(acl, 'kind', owner) and
-- COLUMN_ACL(acl) are not SQL: the generator replaces each with a subquery
-- (aclSql in scripts/schema-snapshot.mjs) before running the file, because a
-- helper function could not be created in a read-only session.
--
-- What is deliberately left out, because it differs by environment and not by
-- migration: object owners, who granted a privilege, grants to the two
-- platform administrator roles (postgres, supabase_admin), extension versions,
-- oids, and anything that belongs to an extension.

with
ns as (select oid, nspname from pg_namespace where nspname in ('public', 'private')),
ext as (select classid, objid from pg_depend where deptype = 'e'),
-- Roles the Supabase image creates. Anything else is a role a migration made.
platform_roles(rolname) as (values
  ('anon'), ('authenticated'), ('authenticator'), ('dashboard_user'), ('pgbouncer'), ('postgres'),
  ('service_role'), ('supabase_admin'), ('supabase_auth_admin'), ('supabase_etl_admin'),
  ('supabase_functions_admin'), ('supabase_privileged_role'), ('supabase_read_only_user'),
  ('supabase_realtime_admin'), ('supabase_replication_admin'), ('supabase_storage_admin')),
rel as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relacl, c.reloptions, c.relrowsecurity,
         c.relforcerowsecurity, c.relreplident, c.relpersistence, c.relispartition
  from pg_class c join ns n on n.oid = c.relnamespace
  where not exists (select 1 from ext where classid = 'pg_class'::regclass and objid = c.oid)
)
select jsonb_build_object(

'server', jsonb_build_object('major', current_setting('server_version_num')::int / 10000),

-- The generator refuses the document unless it was read as it requires.
'session', jsonb_build_object('search_path', current_setting('search_path'),
                              'read_only', current_setting('transaction_read_only')),

-- Kinds of object this script does not render. Each must stay at zero; the
-- generator refuses to write a snapshot that would silently omit one.
'unsupported', jsonb_build_object(
  'aggregates', (select count(*) from pg_proc p join ns n on n.oid = p.pronamespace where p.prokind = 'a'
                   and not exists (select 1 from ext where classid = 'pg_proc'::regclass and objid = p.oid)),
  'materialized views', (select count(*) from rel where relkind = 'm'),
  'partitioned tables', (select count(*) from rel where relkind = 'p' or relispartition),
  'foreign tables', (select count(*) from rel where relkind = 'f'),
  'inherited tables', (select count(*) from pg_inherits i join rel r on r.oid = i.inhrelid),
  'range types', (select count(*) from pg_type t join ns n on n.oid = t.typnamespace where t.typtype in ('r', 'm')),
  'rules', (select count(*) from pg_rewrite w join rel r on r.oid = w.ev_class where w.rulename <> '_RETURN'),
  'operators', (select count(*) from pg_operator o join ns n on n.oid = o.oprnamespace
                  where not exists (select 1 from ext where classid = 'pg_operator'::regclass and objid = o.oid)),
  'casts', (select count(*) from pg_cast c where c.oid >= 16384
              and not exists (select 1 from ext where classid = 'pg_cast'::regclass and objid = c.oid)),
  'text search configurations', (select count(*) from pg_ts_config t join ns n on n.oid = t.cfgnamespace
                                   where not exists (select 1 from ext where classid = 'pg_ts_config'::regclass and objid = t.oid)),
  'extended statistics', (select count(*) from pg_statistic_ext s join ns n on n.oid = s.stxnamespace),
  'event triggers on our functions', (select count(*) from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid join ns n on n.oid = p.pronamespace),
  'collations', (select count(*) from pg_collation c join ns n on n.oid = c.collnamespace),
  'foreign servers', (select count(*) from pg_foreign_server)
),

'schemas', (
  select jsonb_agg(jsonb_build_object('name', n.nspname, 'acl', ACL(n.nspacl, 'n', n.nspowner),
                                      'comment', obj_description(n.oid, 'pg_namespace')) order by n.nspname)
  from pg_namespace n where n.nspname in ('public', 'private')),

'extensions', (
  select jsonb_agg(jsonb_build_object('name', e.extname, 'schema', e.extnamespace::regnamespace::text) order by e.extname)
  from pg_extension e),

'roles', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', r.rolname, 'login', r.rolcanlogin, 'inherit', r.rolinherit, 'superuser', r.rolsuper,
    'createrole', r.rolcreaterole, 'createdb', r.rolcreatedb, 'replication', r.rolreplication,
    'bypassrls', r.rolbypassrls, 'connection_limit', r.rolconnlimit, 'config', to_jsonb(r.rolconfig),
    'member_of', (select coalesce(jsonb_agg(g.rolname order by g.rolname), '[]'::jsonb)
                  from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid),
    'members', (select coalesce(jsonb_agg(g.rolname order by g.rolname), '[]'::jsonb)
                from pg_auth_members m join pg_roles g on g.oid = m.member where m.roleid = r.oid)
  ) order by r.rolname), '[]'::jsonb)
  from pg_roles r
  where r.rolname !~ '^pg_' and r.rolname not in (select rolname from platform_roles)),

-- Role and database settings (alter role … set, alter database … set).
'settings', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'database', case when s.setdatabase = 0 then null else (select datname from pg_database where oid = s.setdatabase) end,
    'role', case when s.setrole = 0 then null else (select rolname from pg_roles where oid = s.setrole) end,
    'config', to_jsonb(s.setconfig)) order by s.setdatabase, (select rolname from pg_roles where oid = s.setrole)), '[]'::jsonb)
  from pg_db_role_setting s),

'default_privileges', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role', d.defaclrole::regrole::text,
    'schema', case when d.defaclnamespace = 0 then null else d.defaclnamespace::regnamespace::text end,
    'objects', case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions'
                                    when 'T' then 'types' when 'n' then 'schemas' else d.defaclobjtype::text end,
    'acl', (select coalesce(jsonb_agg(jsonb_build_object(
                     'grantee', case when a.grantee = 0 then 'public' else g.rolname end,
                     'privilege', lower(a.privilege_type), 'grantable', a.is_grantable)
                   order by case when a.grantee = 0 then 'public' else g.rolname end, lower(a.privilege_type)), '[]'::jsonb)
            from aclexplode(d.defaclacl) a left join pg_roles g on g.oid = a.grantee)
  ) order by d.defaclrole::regrole::text, d.defaclnamespace::regnamespace::text, d.defaclobjtype), '[]'::jsonb)
  from pg_default_acl d
  where d.defaclnamespace = 0 or d.defaclnamespace in (select oid from ns)),

'publications', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'publication', p.pubname, 'schema', n.nspname, 'table', c.relname,
    'columns', (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
                where a.attrelid = c.oid and a.attnum = any (pr.prattrs)),
    'where', pg_get_expr(pr.prqual, pr.prrelid)
  ) order by p.pubname, n.nspname, c.relname), '[]'::jsonb)
  from pg_publication_rel pr
  join pg_publication p on p.oid = pr.prpubid
  join pg_class c on c.oid = pr.prrelid
  join ns n on n.oid = c.relnamespace),

'cron_jobs', (
  select case when to_regclass('cron.job') is null then '[]'::jsonb else (
    select coalesce(jsonb_agg(x.j order by x.j ->> 'name'), '[]'::jsonb)
    from (select (xpath('/row/j/text()', r))[1]::text::jsonb as j
          from unnest(xpath('/table/row', query_to_xml(
            'select jsonb_build_object(''name'', jobname, ''schedule'', schedule, ''command'', btrim(command), ''active'', active) as j from cron.job',
            false, false, ''))) r) x) end),

'storage_buckets', (
  select case when to_regclass('storage.buckets') is null then '[]'::jsonb else (
    select coalesce(jsonb_agg(x.j order by x.j ->> 'id'), '[]'::jsonb)
    from (select (xpath('/row/j/text()', r))[1]::text::jsonb as j
          from unnest(xpath('/table/row', query_to_xml(
            'select jsonb_build_object(''id'', id, ''name'', name, ''public'', public, ''file_size_limit'', file_size_limit, ''allowed_mime_types'', allowed_mime_types) as j from storage.buckets',
            false, false, ''))) r) x) end),

'types', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', t.typname, 'kind', t.typtype,
    'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
    'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
    'notnull', t.typnotnull,
    'default', t.typdefault,
    'constraints', (select jsonb_agg(jsonb_build_object('name', c.conname, 'def', pg_get_constraintdef(c.oid, true)) order by c.conname)
                    from pg_constraint c where c.contypid = t.oid),
    'attributes', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                   from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped),
    'acl', ACL(t.typacl, 'T', t.typowner),
    'comment', obj_description(t.oid, 'pg_type')
  ) order by n.nspname, t.typname), '[]'::jsonb)
  from pg_type t join ns n on n.oid = t.typnamespace
  where (t.typtype in ('e', 'd') or (t.typtype = 'c' and (select relkind from pg_class where oid = t.typrelid) = 'c'))
    and not exists (select 1 from ext where classid = 'pg_type'::regclass and objid = t.oid)),

'sequences', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.nspname, 'name', r.relname,
    'type', format_type(s.seqtypid, null), 'start', s.seqstart, 'increment', s.seqincrement,
    'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle,
    'owned_by', (select d.refobjid::regclass::text || '.' || a.attname
                 from pg_depend d join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
                 where d.classid = 'pg_class'::regclass and d.objid = r.oid and d.deptype in ('a', 'i') limit 1),
    'acl', ACL(r.relacl, 's', r.relowner)
  ) order by r.nspname, r.relname), '[]'::jsonb)
  from rel r join pg_sequence s on s.seqrelid = r.oid
  where r.relkind = 'S'),

'tables', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.nspname, 'name', r.relname,
    'unlogged', r.relpersistence = 'u',
    'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
    'replica_identity', r.relreplident,
    'options', to_jsonb(r.reloptions),
    'comment', obj_description(r.oid, 'pg_class'),
    'acl', ACL(r.relacl, 'r', r.relowner),
    'columns', (
      select jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'notnull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid),
        'identity', a.attidentity,
        'generated', a.attgenerated,
        'collation', case when a.attcollation <> 0 and a.attcollation <> t.typcollation
                          then (select quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
                                from pg_collation co join pg_namespace cn on cn.oid = co.collnamespace where co.oid = a.attcollation) end,
        'comment', col_description(a.attrelid, a.attnum),
        'acl', COLUMN_ACL(a.attacl)
      ) order by a.attnum)
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped),
    'constraints', (
      select coalesce(jsonb_agg(jsonb_build_object('name', c.conname, 'type', c.contype, 'def', pg_get_constraintdef(c.oid, true),
                                                   'comment', obj_description(c.oid, 'pg_constraint')) order by c.conname), '[]'::jsonb)
      from pg_constraint c where c.conrelid = r.oid),
    'indexes', (
      select coalesce(jsonb_agg(jsonb_build_object('name', ic.relname, 'def', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid,
                                                   'comment', obj_description(ic.oid, 'pg_class')) order by ic.relname), '[]'::jsonb)
      from pg_index i join pg_class ic on ic.oid = i.indexrelid
      where i.indrelid = r.oid
        and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.conrelid = r.oid))
  ) order by r.nspname, r.relname), '[]'::jsonb)
  from rel r where r.relkind = 'r'),

'views', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', r.nspname, 'name', r.relname,
    'def', pg_get_viewdef(r.oid, true),
    'options', to_jsonb(r.reloptions),
    'comment', obj_description(r.oid, 'pg_class'),
    'acl', ACL(r.relacl, 'r', r.relowner)
  ) order by r.nspname, r.relname), '[]'::jsonb)
  from rel r where r.relkind = 'v'),

'functions', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname,
    'identity', pg_get_function_identity_arguments(p.oid),
    'def', pg_get_functiondef(p.oid),
    'comment', obj_description(p.oid, 'pg_proc'),
    'acl', ACL(p.proacl, 'f', p.proowner)
  ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
  from pg_proc p join ns n on n.oid = p.pronamespace
  where p.prokind in ('f', 'p', 'w')
    and not exists (select 1 from ext where classid = 'pg_proc'::regclass and objid = p.oid)),

-- Every trigger on one of our tables, and every trigger anywhere (auth.users,
-- storage.objects) that calls one of our functions.
'triggers', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', tn.nspname, 'table', c.relname, 'name', t.tgname,
    'def', pg_get_triggerdef(t.oid, true),
    'enabled', t.tgenabled,
    'comment', obj_description(t.oid, 'pg_trigger')
  ) order by tn.nspname, c.relname, t.tgname), '[]'::jsonb)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace tn on tn.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal
    and (c.relnamespace in (select oid from ns) or p.pronamespace in (select oid from ns))
    and not exists (select 1 from ext where classid = 'pg_trigger'::regclass and objid = t.oid)),

-- Policies on our tables and on storage.objects (the storage rules).
'policies', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', pn.nspname, 'table', c.relname, 'name', pol.polname,
    'command', case pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    'permissive', pol.polpermissive,
    'roles', (select coalesce(jsonb_agg(case when x = 0 then 'public' else (select rolname from pg_roles where oid = x) end
                                        order by case when x = 0 then 'public' else (select rolname from pg_roles where oid = x) end), '[]'::jsonb)
              from unnest(pol.polroles) x),
    'using', pg_get_expr(pol.polqual, pol.polrelid, true),
    'check', pg_get_expr(pol.polwithcheck, pol.polrelid, true),
    'comment', obj_description(pol.oid, 'pg_policy')
  ) order by pn.nspname, c.relname, pol.polname), '[]'::jsonb)
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace pn on pn.oid = c.relnamespace
  where pn.nspname in ('public', 'private', 'storage')),

-- How many rows each of our tables holds in a database nobody has used. A row
-- here was put there by a migration; the generator insists each such table is
-- classed (kept as reference data, or named as a run log).
'row_counts', (
  select coalesce(jsonb_object_agg(x.name, x.n), '{}'::jsonb)
  from (select r.nspname || '.' || r.relname as name,
               (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', r.nspname, r.relname), false, true, '')))[1]::text::bigint as n
        from rel r where r.relkind = 'r') x
  where x.n > 0)

)::text;
