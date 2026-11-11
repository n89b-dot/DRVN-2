-- ============================================================================
-- 0017 — Lock the payment columns on profiles
--
-- 0016 shipped Connect on a stated assumption: "the profiles self-update policy
-- already restricts column-level writes." It does not, and this was confirmed
-- against the live database by impersonating role `authenticated`:
--
--     C1  CONFIRMED: authenticated user set their own payouts_enabled (f → t)
--     C1b CONFIRMED: transfer destination is self-writable (acct_ATTACKER)
--
-- The self-update policy is `USING/WITH CHECK (auth.uid() = id)` with no column
-- predicate, and guard_profile_columns only pinned profile_type and username.
-- So any signed-in user could:
--
--   1. set payouts_enabled = true, clearing the Connect/KYC publish gate
--      (`sellerCanPublish` reads exactly this flag), and
--   2. set stripe_account_id to any string, which `transferForOrder` passes
--      straight to `transfers.create({ destination })` — directing real money
--      at an account they nominate.
--
-- Both columns are also readable by anon under `profiles are public`
-- (USING true), so the account ids needed for step 2 could simply be listed.
--
-- Defence in depth, because either layer alone has failed before:
--   a) column-level GRANT/REVOKE, so PostgREST rejects the write outright;
--   b) a trigger, so any path that bypasses the grant still raises.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- 1. Column privileges
-- ============================================================
-- REVOKE on a column is not expressible as "all columns except"; Postgres
-- requires re-granting the allowed set. These are the columns a user may
-- legitimately edit about themselves.
revoke update on public.profiles from anon, authenticated;

grant update (
  display_name,
  headline,
  bio,
  location,
  links,
  avatar_url,
  username,          -- still trigger-guarded to first-set-only
  notification_prefs
) on public.profiles to authenticated;

-- Stripe pointers are not secrets in the credential sense, but publishing them
-- hands an attacker the exact values needed to aim a transfer, and they are of
-- no use to any client. Keep them server-side.
--
-- A column-level REVOKE is ineffective while a table-wide GRANT SELECT stands,
-- so the grant has to be replaced by an explicit column list. Verified: with
-- only the column revoke in place, `select stripe_account_id` still succeeded.
revoke select on public.profiles from anon, authenticated;

grant select (
  id,
  username,
  display_name,
  headline,
  bio,
  location,
  links,
  avatar_url,
  profile_type,
  notification_prefs,
  payouts_enabled,   -- readable (drives seller UI), writable only by the sync
  created_at,
  updated_at
) on public.profiles to anon, authenticated;

-- ============================================================
-- 2. Trigger backstop
-- ============================================================
-- Extends the 0006 guard. Written so a future grant mistake cannot silently
-- reopen the hole — the same reasoning that made guard_offer_insert worth
-- having even with an insert policy in place.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  -- Role flag: self-granting 'shop' would hand a user any seller tooling or
  -- fee tier keyed off it.
  if new.profile_type is distinct from old.profile_type then
    raise exception 'profile_type cannot be changed by the account holder'
      using errcode = '42501';
  end if;

  -- Identity other people link to; set once at onboarding.
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'username cannot be changed once set'
      using errcode = '42501';
  end if;

  -- Payout authorisation. Only the Connect sync (service role, driven by
  -- Stripe's account.updated) may move this.
  if new.payouts_enabled is distinct from old.payouts_enabled then
    raise exception 'payouts_enabled is set by Stripe onboarding, not by the account holder'
      using errcode = '42501';
  end if;

  -- Where money would be sent, and whose card is on file.
  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Stripe account references are managed server-side'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ============================================================
-- 3. Housekeeping on the deny-all tables
-- ============================================================
-- rate_limits and purchase_attempts rely on RLS-with-no-policies. That works,
-- but the grants were never revoked, so a single `disable row level security`
-- would expose them. Remove the grants too.
revoke all on public.rate_limits from anon, authenticated;
revoke all on public.purchase_attempts from anon, authenticated;

commit;
