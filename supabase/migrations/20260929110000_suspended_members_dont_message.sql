-- ============================================================================
-- 20260929110000 — Suspended members don't message
--
-- 20260928182300 stopped a suspended member posting, replying and making
-- offers, but left messages to the Messages work. This closes that gap with
-- the same restrictive shape: AND'd with the existing "senders create
-- messages" policy (0012), so a suspended member's client insert is refused.
-- Server-written lifecycle notes (kind = 'event') go through the service role
-- and are unaffected, so a dispute or return still narrates itself.
--
-- Idempotent.
-- ============================================================================

begin;

drop policy if exists "suspended members don't message" on public.messages;
create policy "suspended members don't message"
  on public.messages as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

commit;
