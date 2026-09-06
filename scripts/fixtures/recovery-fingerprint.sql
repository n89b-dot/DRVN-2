-- Hash synthetic rows without printing identities, payloads or credentials.
select format(
 'select jsonb_build_object(''table'', %L, ''rows'', count(*), ''digest'', md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')))::text from %I.%I t;',
 n.nspname||'.'||c.relname,n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','private','auth','storage') and c.relkind='r'
 and not(n.nspname='public' and c.relname='job_config')
order by n.nspname,c.relname
\gexec
