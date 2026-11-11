-- 20261008100200 — the auto-confirm warning reaches guest buyers by email.
--
-- An untracked order is marked delivered 21 days after dispatch unless the
-- buyer confirms or reports a problem; they are warned 3 days before
-- (20261006100100). The warning is an in-app notification, and a guest buyer
-- has a passwordless account they have never opened, so they were never
-- warned.
--
-- The app's only email channel is Supabase Auth. The money worker now sends
-- a guest their order-access link again, with a paragraph saying the order
-- will be marked delivered and when (src/lib/auto-confirm-email.ts). These
-- columns are its "sent once" record and retry state; the worker is the only
-- writer. The table stays closed to clients.
--
-- Idempotent.

begin;

alter table public.delivery_auto_confirmations
  add column if not exists emailed_at timestamptz,
  add column if not exists email_attempts integer not null default 0,
  add column if not exists email_last_error text;

-- What the worker reads each pass: warned, not yet confirmed, not yet emailed.
create index if not exists delivery_auto_confirmations_email_due_idx
  on public.delivery_auto_confirmations (reminded_at)
  where emailed_at is null and confirmed_at is null;

commit;
