-- ============================================================================
-- 20261110130000 — earlier members are asked to confirm 18+ on their next
-- visit, not only at their next sign-in (report five #110, OS id N662)
--
-- 20261108150000 (N686) asked members who joined before the 18+ confirmation
-- existed, once, at their next sign-in. A member who stays signed in (Supabase
-- refreshes the session for as long as it is used) was never asked. The
-- request proxy now asks this, once per browser, on the member's next page
-- request, and sends them to /confirm-age if they still owe the answer
-- (src/lib/supabase/proxy.ts).
--
-- public.my_age_confirmation_due(): true for the signed-in caller when their
-- account was created before the confirmation shipped (2026-11-08 02:03:15
-- UTC, the same cut as src/lib/age-confirmation.ts), they have a handle (no
-- handle means onboarding, which asks it), and they have no confirmation on
-- record. Reads only the caller's own rows; answers false for anyone else.
-- Idempotent.
-- ============================================================================

begin;

create or replace function public.my_age_confirmation_due()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.id = auth.uid()
       and u.created_at < timestamptz '2026-11-08 02:03:15+00'
       and p.username is not null
       and not exists (select 1 from public.age_confirmations a where a.user_id = u.id)
  );
$$;

revoke all on function public.my_age_confirmation_due() from public, anon;
grant execute on function public.my_age_confirmation_due() to authenticated;

commit;
