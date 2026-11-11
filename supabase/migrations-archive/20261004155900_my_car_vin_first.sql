-- 20261004155900 — my_car_vin() exists before the VIN column is closed.
--
-- 20261004160000 does two things in one file: it revokes table-wide SELECT
-- on cars (so the VIN can't be read), and it creates my_car_vin(), the only
-- way an owner reads their own VIN afterwards. The round-three app calls
-- my_car_vin() on the Manage-car page and on every car save, and no longer
-- reads cars with select("*"). That left no safe order on a live
-- environment: the app first, and Manage car fails for want of the function;
-- the migration first, and the old app's whole-row reads are refused.
--
-- This creates the function on its own, ahead of the revoke. Apply this,
-- deploy the app, then apply 20261004160000. The definition and grants are
-- exactly those in 20261004160000, which restates them. Idempotent; a no-op
-- where 20261004160000 has already run.

begin;

create or replace function public.my_car_vin(p_car uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.vin from public.cars c where c.id = p_car and c.owner_id = auth.uid();
$$;

revoke all on function public.my_car_vin(uuid) from public, anon;
grant execute on function public.my_car_vin(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
