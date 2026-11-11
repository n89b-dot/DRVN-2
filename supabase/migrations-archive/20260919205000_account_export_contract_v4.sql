-- 20260919205000 — account export contract 2026-09-19.v4.
--
-- The export's contract version lives in TWO places: the constant in
-- src/lib/account-export-contract.ts, and this database — a check
-- constraint on `account_export_requests.contract_version` and the literal
-- `request_account_export()` stamps on every new request. The constant was
-- bumped to 2026-09-19.v3 when the mod record columns joined the export,
-- with no migration. From then on every request was created as
-- '2026-09-05.v2', the worker saw a version that wasn't its own, purged the
-- request and finished the job — so "Download my data" queued, and never
-- completed, for every member. Only the browser journey caught it.
--
-- v4 is the projection in the contract file today: the v3 mod columns plus
-- profiles country/region/main_car_id/store_note, listing brand and part
-- miles, and tagged parts (activity_post_listings). Follows 20260905203510:
-- widen the check, expire what can't finish, re-stamp the function.
--
-- Idempotent.

begin;

alter table public.account_export_requests drop constraint if exists account_export_requests_contract_version_check;
alter table public.account_export_requests add constraint account_export_requests_contract_version_check
  check (contract_version in ('2026-09-05.v1', '2026-09-05.v2', '2026-09-19.v4'));

update public.account_export_requests
   set status = 'expired',
       expires_at = least(expires_at, now()),
       last_error = 'Superseded by export contract 2026-09-19.v4'
 where contract_version <> '2026-09-19.v4'
   and status in ('pending', 'processing', 'failed');

CREATE OR REPLACE FUNCTION public.request_account_export()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare uid uuid := auth.uid(); request_id uuid;
begin
  if uid is null then raise exception 'Sign in first' using errcode='42501'; end if;
  -- Shared with deletion and export publication so eligibility changes are
  -- serialized in one order for this account.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  perform 1 from public.profiles where id=uid and suspended_at is null for share;
  if not found then raise exception 'Account access is suspended' using errcode='42501'; end if;
  select id into request_id from public.account_export_requests
   where user_id=uid and status in ('pending','processing') and expires_at>now()
   order by requested_at desc limit 1;
  if found then return request_id; end if;
  insert into public.account_export_requests(user_id,contract_version)
    values(uid,'2026-09-19.v4') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $function$
;

revoke all on function public.request_account_export() from public, anon;
grant execute on function public.request_account_export() to authenticated, service_role;

commit;
