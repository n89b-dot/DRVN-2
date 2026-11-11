begin;
create table public.refund_recredit_proofs (
 adjustment_id uuid primary key references public.refund_lifecycle_adjustments(id) on delete restrict,
 recovery_id uuid not null unique references public.payment_recoveries(id) on delete restrict,
 recredit_transfer_reference text unique,
 original_reversal_reference text,
 amount_cents integer not null check(amount_cents>=0),
 currency text not null check(currency~'^[a-z]{3}$'),
 balance_transaction text,
 verified_by uuid not null references auth.users(id) on delete restrict,
 verified_at timestamptz not null default now(),
 check((amount_cents=0 and recredit_transfer_reference is null) or
       (amount_cents>0 and recredit_transfer_reference is not null and original_reversal_reference is not null and balance_transaction is not null))
);
alter table public.refund_recredit_proofs enable row level security;
revoke all on public.refund_recredit_proofs from public,anon,authenticated;
grant all on public.refund_recredit_proofs to service_role;
create or replace function public.immutable_refund_recredit_proof() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Verified refund recredit proof is immutable'; end $$;
create trigger refund_recredit_proof_immutable before update or delete on public.refund_recredit_proofs for each row execute function public.immutable_refund_recredit_proof();
revoke all on function public.immutable_refund_recredit_proof() from public,anon,authenticated;

create or replace function public.record_refund_recredit_proof(
 p_recovery uuid,p_adjustment uuid,p_actor uuid,p_amount integer,p_currency text,
 p_transfer text default null,p_reversal text default null,p_balance_transaction text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare recovery public.payment_recoveries%rowtype; adjustment public.refund_lifecycle_adjustments%rowtype;
 operation public.refund_operations%rowtype; existing public.refund_recredit_proofs%rowtype;
begin
 if not exists(select 1 from public.admin_users where user_id=p_actor and role='admin') then raise exception 'Administrator verification required'; end if;
 select * into strict recovery from public.payment_recoveries where id=p_recovery for update;
 select * into strict adjustment from public.refund_lifecycle_adjustments where id=p_adjustment;
 select * into strict operation from public.refund_operations where id=adjustment.refund_operation_id;
 if recovery.kind<>'refund_late_failure' or recovery.status<>'open'
 or recovery.recovery_key<>'refund-late-failure:'||adjustment.refund_reference
 or recovery.order_id is distinct from operation.order_id
 or p_amount is distinct from coalesce(adjustment.seller_recredit_cents,operation.reversal_due_cents)
 or lower(operation.currency) is distinct from p_currency
 or (operation.reversal_reference is not null and p_amount>0 and operation.reversal_reference is distinct from p_reversal)
 then raise exception 'Recredit proof does not match the immutable obligation'; end if;
 insert into public.refund_recredit_proofs(adjustment_id,recovery_id,recredit_transfer_reference,original_reversal_reference,amount_cents,currency,balance_transaction,verified_by)
 values(p_adjustment,p_recovery,p_transfer,p_reversal,p_amount,p_currency,p_balance_transaction,p_actor)
 on conflict(adjustment_id) do nothing;
 select * into strict existing from public.refund_recredit_proofs where adjustment_id=p_adjustment;
 if existing.recovery_id<>p_recovery or existing.recredit_transfer_reference is distinct from p_transfer or existing.amount_cents<>p_amount or existing.currency<>p_currency or existing.original_reversal_reference is distinct from p_reversal then raise exception 'Conflicting recredit proof'; end if;
end $$;
revoke all on function public.record_refund_recredit_proof(uuid,uuid,uuid,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_refund_recredit_proof(uuid,uuid,uuid,integer,text,text,text,text) to service_role;

create or replace function public.require_refund_recredit_proof() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.kind='refund_late_failure' and new.status<>'open' and not exists(select 1 from public.refund_recredit_proofs where recovery_id=old.id) then
  raise exception 'Verify the seller recredit obligation before closing this recovery case';
 end if;
 if old.kind='refund_late_failure' and new.status<>'open' and (
  select count(*) from public.refund_recredit_proofs proof
  join public.refund_lifecycle_adjustments adjustment on adjustment.id=proof.adjustment_id
  join public.refund_operations failed on failed.id=adjustment.refund_operation_id
  join public.refund_operations replacement on replacement.order_id=failed.order_id
   and replacement.id<>failed.id and replacement.payment_reference=failed.payment_reference
   and replacement.amount_cents=adjustment.refund_amount_cents
   and replacement.created_at>=adjustment.created_at
   and replacement.refund_reference is not null and replacement.refund_reference<>adjustment.refund_reference
   and replacement.reason='Admin refund: Replacement for failed refund '||adjustment.refund_reference
   and replacement.status='completed' and replacement.provider_status='succeeded'
  where proof.recovery_id=old.id
 )<>1 then raise exception 'Seller recredit verified; an exactly identified replacement buyer refund must also be settled before closure'; end if;
 return new;
end $$;
create trigger late_refund_recovery_closure_guard before update of status on public.payment_recoveries for each row execute function public.require_refund_recredit_proof();
revoke all on function public.require_refund_recredit_proof() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
