begin;

-- Provider observation epochs come from the database clock returned by the
-- claim, avoiding application-host clock skew in the post-expiry proof.
create or replace function public.claim_outbound_label_void(p_shipment uuid,p_worker uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved public.outbound_label_void_requests;
  observed_at timestamptz:=now();
begin
  if p_worker is null then raise exception 'Worker identity required'; end if;
  select * into strict saved from public.outbound_label_void_requests where shipment_id=p_shipment for update;
  if saved.status='completed' then
    return jsonb_build_object('action','completed','request',to_jsonb(saved),'observation_started_at',observed_at);
  elsif saved.status='rejected' then
    return jsonb_build_object('action','rejected','request',to_jsonb(saved),'observation_started_at',observed_at);
  elsif saved.status='provider_pending' and saved.claim_owner=p_worker and saved.claim_expires_at>now() then
    return jsonb_build_object('action','dispatch','request',to_jsonb(saved),'observation_started_at',observed_at);
  elsif saved.status='requested' or (
    saved.status='provider_pending' and saved.claim_expires_at<=now()
    and saved.provider_state='not_requested' and saved.provider_observed_at>=saved.claim_expires_at
  ) then
    update public.outbound_label_void_requests
    set status='provider_pending',claim_owner=p_worker,claim_expires_at=now()+interval '2 minutes',
        attempts=attempts+1,provider_state=null,provider_observed_at=null,last_error=null,updated_at=now()
    where shipment_id=p_shipment returning * into saved;
    return jsonb_build_object('action','dispatch','request',to_jsonb(saved),'observation_started_at',observed_at);
  end if;
  return jsonb_build_object('action','reconcile','request',to_jsonb(saved),'observation_started_at',observed_at);
end $$;
revoke all on function public.claim_outbound_label_void(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_outbound_label_void(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
