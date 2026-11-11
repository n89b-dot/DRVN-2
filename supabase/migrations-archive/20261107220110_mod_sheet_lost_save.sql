-- OS-W23 N65 follow-up: a save whose response was lost moved the sheet's
-- revision on, so the editor's next save (with further edits) was refused as
-- stale against its own write. The editor now asks, in one statement, whether
-- the sheet is exactly what that lost save sent; only then does it adopt the
-- current revision. If anything else changed the sheet, the answer is null
-- and the stale check still protects it.
begin;

create or replace function public.mod_sheet_revision_if_matches(p_car uuid, p_items jsonb)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case when public.mod_sheet_matches(p_car, coalesce(p_items, '[]'::jsonb))
              then public.mod_sheet_revision(p_car) end;
$$;

revoke all on function public.mod_sheet_revision_if_matches(uuid, jsonb) from public, anon;
grant execute on function public.mod_sheet_revision_if_matches(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
