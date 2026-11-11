-- 20261004100000 — internal functions are not public API.
--
-- These SECURITY DEFINER functions check nothing about their caller, and
-- Supabase's default privileges granted EXECUTE on them to anon and
-- authenticated, so anyone holding the public API key could call them:
--   * notify(...) wrote any text into any member's notification bell —
--     a signed-out caller could send "your payout is on hold, reply with
--     your bank details" to every profile (the channel 0012's F4 closed for
--     messages);
--   * invoke_transfer_worker() fired a full money-worker pass through pg_net
--     with the worker secret, as often as asked;
--   * mark_due_transfer_intents(), escalate_stale_disputes() and
--     prune_rate_limits() ran scheduled maintenance early, on demand.
-- Their real callers are triggers and pg_cron jobs, which run as the
-- function owner and need no grant. The service role keeps EXECUTE for
-- operator scripts.
--
-- supabase/tests/definer_exposure_guard.sql now fails if any definer
-- function a signed-out caller can execute isn't on its reviewed list.
-- Idempotent.

begin;

revoke all on function public.notify(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.invoke_transfer_worker() from public, anon, authenticated;
revoke all on function public.mark_due_transfer_intents() from public, anon, authenticated;
revoke all on function public.escalate_stale_disputes() from public, anon, authenticated;
revoke all on function public.prune_rate_limits() from public, anon, authenticated;

grant execute on function public.notify(uuid, text, text, text, text, text, uuid) to service_role;
grant execute on function public.invoke_transfer_worker() to service_role;
grant execute on function public.mark_due_transfer_intents() to service_role;
grant execute on function public.escalate_stale_disputes() to service_role;
grant execute on function public.prune_rate_limits() to service_role;

commit;
