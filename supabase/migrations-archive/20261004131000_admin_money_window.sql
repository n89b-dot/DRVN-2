-- 20261004131000 — the console's 7-day money tiles are summed in the database.
--
-- getOverview summed GMV, fees and refunds in TypeScript over the order rows
-- PostgREST returned. PostgREST caps a response at max_rows (1000), so a busy
-- week silently under-reported every total, and nothing said so. This returns
-- the sums and counts for one window in one statement. PostgREST aggregate
-- functions aren't enabled for this project, so it's a function.
--
-- Read-only and SECURITY INVOKER; only the service role (the console's
-- server-side read layer, behind getAdminContext) may call it.
--
-- Idempotent: create or replace.

begin;

create or replace function public.admin_order_money_window(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'orders', (
      select count(*) from public.orders
      where created_at >= p_from and created_at < p_to
        and status in ('paid', 'shipped', 'delivered', 'completed', 'disputed', 'refunded')
    ),
    'gmv_cents', (
      select coalesce(sum(total_cents), 0) from public.orders
      where created_at >= p_from and created_at < p_to
        and status in ('paid', 'shipped', 'delivered', 'completed', 'disputed', 'refunded')
    ),
    'fee_cents', (
      select coalesce(sum(platform_fee_cents), 0) from public.orders
      where created_at >= p_from and created_at < p_to
        and status in ('paid', 'shipped', 'delivered', 'completed', 'disputed', 'refunded')
    ),
    'refunded_cents', (
      select coalesce(sum(refunded_cents), 0) from public.orders
      where refunded_cents > 0 and refunded_at >= p_from and refunded_at < p_to
    ),
    'fee_refunded_cents', (
      select coalesce(sum(platform_fee_refunded_cents), 0) from public.orders
      where refunded_cents > 0 and refunded_at >= p_from and refunded_at < p_to
    )
  );
$$;

revoke all on function public.admin_order_money_window(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_order_money_window(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
