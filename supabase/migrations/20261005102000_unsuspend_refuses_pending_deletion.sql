-- 20261005102000 — unsuspend refuses an account that is being deleted.
--
-- request_account_deletion suspends the member, pauses their listings and
-- queues the `delete:<uid>` cleanup job. The admin console's unsuspend
-- (execute_admin_command 'user.unsuspend') didn't look for that job, so an
-- operator could reactivate — and re-list the stock of — an account whose
-- owner had asked for it to be erased, while the worker was mid-cleanup.
--
-- The branch now locks the profile first (request_account_deletion updates
-- that row before queueing its job, so the two serialise on it) and refuses
-- while a deletion job is pending, processing or failed. A failed job is
-- still an unanswered erasure request; it needs an operator to resolve the
-- job, not to reactivate the account. A completed deletion has no profile to
-- unsuspend.
--
-- Everything else is copied verbatim from the latest definition
-- (20260905011618_remediation_integrity.sql); only the 'user.unsuspend'
-- branch changed. Grants are restated unchanged.
--
-- Idempotent: create or replace.

begin;

create or replace function public.execute_admin_command(p_action text,p_subject uuid,p_reason text,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); subject_type text; result jsonb:='{}'; l public.listings; ord public.orders; c public.ops_cases; ids uuid[]; n int;
begin
 if not public.is_admin() or public.admin_role()<>'admin' or not exists(
 select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'amr','[]'::jsonb)) m
 where m->>'method' in ('totp','mfa/totp') and (m->>'timestamp')::numeric between extract(epoch from now())-900 and extract(epoch from now())+60
 ) then raise exception 'Admin step-up required' using errcode='42501'; end if;
 if length(trim(p_reason))<1 or length(p_reason)>4000 then raise exception 'A reason of 1–4000 characters is required'; end if;
 case p_action
 when 'listing.remove' then
  subject_type:='listing'; select * into strict l from public.listings where id=p_subject for update;
  if l.status in ('reserved','sold','removed') then raise exception 'Listing is not available for removal'; end if;
  update public.listings set status='removed',removed_at=now(),removed_reason=p_reason where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href) values(l.seller_id,'listing_removed','marketplace','A listing was removed',l.title||' — '||p_reason,'/selling');
  result:=jsonb_build_object('previousStatus',l.status);
 when 'listing.restore' then
  subject_type:='listing'; update public.listings set status='paused',removed_at=null,removed_reason=null where id=p_subject and status='removed';
  if not found then raise exception 'Listing is not removed'; end if;
 when 'user.suspend' then
  subject_type:='user';
  if actor=p_subject or exists(select 1 from public.admin_users where user_id=p_subject) then raise exception 'Admin membership is managed separately'; end if;
  update public.profiles set suspended_at=now(),suspended_reason=p_reason where id=p_subject and suspended_at is null;
  if not found then raise exception 'User is already suspended or missing'; end if;
  with paused as(update public.listings set status='paused' where seller_id=p_subject and status='active' returning id) select array_agg(id) into ids from paused;
  result:=jsonb_build_object('pausedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'user.unsuspend' then
  subject_type:='user';
  perform 1 from public.profiles where id=p_subject for update;
  if exists(select 1 from public.remediation_jobs where dedup_key='delete:'||p_subject::text and status in ('pending','processing','failed')) then raise exception 'Account deletion is in progress; this account cannot be reactivated'; end if;
  update public.profiles set suspended_at=null,suspended_reason=null where id=p_subject and suspended_at is not null;
  if not found then raise exception 'User is not suspended'; end if;
  select array(select jsonb_array_elements_text(a.metadata->'result'->'pausedListingIds')::uuid) into ids from public.admin_audit_log a where action='user.suspend' and subject_id=p_subject and metadata->'result' is not null order by created_at desc limit 1;
  with restored as(update public.listings set status='active' where id=any(coalesce(ids,'{}'::uuid[])) and seller_id=p_subject and status='paused' returning id) select array_agg(id) into ids from restored;
  result:=jsonb_build_object('reactivatedListingIds',coalesce(ids,'{}'::uuid[]));
 when 'report.actioned','report.dismissed' then
  subject_type:='report'; update public.reports set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Report is already resolved or missing'; end if;
 when 'recovery.recovered','recovery.written_off' then
  subject_type:='payment'; update public.payment_recoveries set status=split_part(p_action,'.',2),resolved_by=actor,resolved_at=now(),resolution_note=p_reason where id=p_subject and status='open';
  if not found then raise exception 'Recovery is already closed or missing'; end if;
 when 'note.internal' then
  subject_type:=p_data->>'subjectType';
  if subject_type not in ('user','listing','order','report','payment','dispute') then raise exception 'Invalid note subject'; end if;
 when 'dispute.resolve_for_seller' then
  subject_type:='dispute'; select * into strict ord from public.orders where id=p_subject for update;
  if ord.status<>'disputed' then raise exception 'Order is not disputed'; end if;
  update public.orders set status=coalesce(pre_dispute_status,'delivered'),dispute_resolved_at=now(),dispute_outcome='admin_resolved',refund_offer_cents=null,refund_offered_at=null where id=p_subject;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','DRVN support resolved this dispute','The dispute was closed in the seller''s favour after review.','/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  result:=jsonb_build_object('restored',ord.pre_dispute_status);
 when 'order.message_parties' then
  subject_type:='order'; select * into strict ord from public.orders where id=p_subject for update;
  insert into public.notifications(user_id,kind,section,title,body,href)
  select uid,'admin_action','marketplace','A message from DRVN support',p_reason,'/orders/'||p_subject from unnest(array[ord.buyer_id,ord.seller_id]) uid where uid is not null;
  get diagnostics n=row_count; result:=jsonb_build_object('recipients',n);
 when 'case.claim','case.release','case.update' then
  select * into strict c from public.ops_cases where order_id=p_subject or report_id=p_subject for update;
  subject_type:=case when c.kind='dispute' then 'order' else 'report' end;
  if c.status='resolved' then raise exception 'Case is closed'; end if;
  if p_action='case.claim' then
   if c.assigned_to is not null and c.assigned_to<>actor then raise exception 'Case is already assigned'; end if;
   update public.ops_cases set assigned_to=actor,status='claimed',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',false);
  elsif p_action='case.release' then
   if c.assigned_to is distinct from actor then raise exception 'Only the assignee may release a case'; end if;
   update public.ops_cases set assigned_to=null,status='open',updated_at=now() where id=c.id;
   result:=jsonb_build_object('released',true);
  else
   if p_data->>'priority' not in ('normal','high') or jsonb_typeof(p_data->'labels')<>'array' or jsonb_array_length(p_data->'labels')>6 then raise exception 'Invalid case update'; end if;
   if exists(select 1 from jsonb_array_elements_text(p_data->'labels') label where length(label)>30) then raise exception 'Case label too long'; end if;
   update public.ops_cases set priority=p_data->>'priority',labels=array(select jsonb_array_elements_text(p_data->'labels')),updated_at=now() where id=c.id;
   result:=jsonb_build_object('priority',p_data->>'priority','labels',p_data->'labels');
  end if;

 else raise exception 'Unsupported admin command';
 end case;
 insert into public.admin_audit_log(actor_id,action,subject_type,subject_id,order_id,reason,metadata)
 values(actor,p_action,subject_type,p_subject,(p_data->>'orderId')::uuid,p_reason,jsonb_build_object('phase','completed','result',result));
 return result;
end $$;
revoke all on function public.execute_admin_command(text,uuid,text,jsonb) from public,anon;
grant execute on function public.execute_admin_command(text,uuid,text,jsonb) to authenticated;

commit;
