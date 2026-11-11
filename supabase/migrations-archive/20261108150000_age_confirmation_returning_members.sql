-- ============================================================================
-- 20261108150000 — earlier members confirm they are 18 at their next sign-in
-- (N686, remediation plan C5)
--
-- 20261107231001 (R69-age) asked new accounts and guest buyers, and left the
-- members who joined before it without a record. The plan's default, applied
-- on 8 Nov 2026 (keep the 18+ confirmation and the copyright takedown), asks
-- each of them once, the next time they sign in: a signed-in member with a
-- handle and no age_confirmations row is sent to /confirm-age, and their
-- answer is recorded with the new source 'returning_member'.
--
-- The only change is the source check: the table, its policies and its
-- triggers are unchanged. No row is invented for anyone: absence of a row is
-- what "not asked yet" means, so no flag column is needed.
--
-- Idempotent.
-- ============================================================================

begin;

alter table public.age_confirmations drop constraint if exists age_confirmations_source_check;
alter table public.age_confirmations add constraint age_confirmations_source_check
  check (source in ('email_signup', 'onboarding', 'guest_checkout', 'returning_member'));

comment on column public.age_confirmations.source is
  'Where the confirmation was given: email_signup, onboarding (first Google sign-in), guest_checkout, or returning_member (a member who joined before 20261107231001, asked once at their next sign-in, N686).';

commit;
