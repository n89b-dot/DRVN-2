-- 20261018100100 — account export contract 2026-10-18.v8.
--
-- A seller's export carries whether they chose to show each listing's
-- minimum (listings.show_offer_floor, 20261018100000). Same steps as
-- 20261017150100; request_account_export with only the version changed.
-- Idempotent.

begin;

alter table public.account_export_requests drop constraint if exists account_export_requests_contract_version_check;
alter table public.account_export_requests add constraint account_export_requests_contract_version_check
  check (contract_version in ('2026-09-05.v1', '2026-09-05.v2', '2026-09-19.v4', '2026-10-08.v5', '2026-10-17.v6', '2026-10-17.v7', '2026-10-18.v8'));

update public.account_export_requests
   set status = 'expired',
       expires_at = least(expires_at, now()),
       last_error = 'Superseded by export contract 2026-10-18.v8'
 where contract_version <> '2026-10-18.v8'
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
    values(uid,'2026-10-18.v8') returning id into request_id;
  insert into public.remediation_jobs(kind,dedup_key,payload)
    values('account_export','export:'||request_id,jsonb_build_object('request_id',request_id,'user_id',uid))
    on conflict(dedup_key) do nothing;
  return request_id;
end $function$
;

revoke all on function public.request_account_export() from public, anon;
grant execute on function public.request_account_export() to authenticated, service_role;

commit;
