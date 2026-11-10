-- ============================================================================
-- 20261110131000 — the earlier-member 18+ check is removed (OS id N662; Neil's
-- ruling of 10 November 2026)
--
-- 20261110130000 added public.my_age_confirmation_due() so the request proxy
-- could ask accounts from before the 18+ confirmation existed. Every such
-- account is a test account: the product has no members yet, and every real
-- member will join after the confirmation shipped and answer it on the way in
-- (sign-up, onboarding or guest checkout; the database refuses a handle
-- without the record, 20261107231001). The app no longer calls the function,
-- so it goes: an unused security-definer function that signed-in members can
-- call is surface with no purpose.
--
-- Nothing else changes. public.age_confirmations, its rules and its rows stay
-- as they are, and its source check still accepts 'returning_member'
-- (20261108150000) so the test rows written with it stay valid; nothing
-- writes that source any more.
--
-- Order: apply after the app from the same PR is the only app running, or at
-- any time before a first deploy (nothing is hosted). An app from before this
-- PR that still calls the function logs a failed check on each signed-in page
-- request and lets the page load, as it did before the function existed.
-- Idempotent.
-- ============================================================================

begin;

drop function if exists public.my_age_confirmation_due();

do $$
begin
  if to_regprocedure('public.my_age_confirmation_due()') is not null then
    raise exception '20261110131000: public.my_age_confirmation_due() still exists (N662)';
  end if;
  if to_regclass('public.age_confirmations') is null then
    raise exception '20261110131000: public.age_confirmations is missing; this migration must not remove it (N662)';
  end if;
  raise notice 'PASS: 20261110131000 self-checks';
end $$;

commit;
