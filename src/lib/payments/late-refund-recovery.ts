import type {createAdminClient} from '@/lib/supabase/admin';
import {findExistingReversal} from './reversal-recovery';
import {stripeClient,stripeSecretKey} from './stripe';
import {transferAccount,verifyRecreditTransfer} from './recredit-verification';
/** Reads provider evidence; never creates a transfer or repeats a reversal. */
export async function verifyLateRefundRecovery(admin:ReturnType<typeof createAdminClient>,recoveryId:string,actorId:string,recreditReference:string){
 const recovery=await admin.from('payment_recoveries').select('kind,recovery_key,order_id').eq('id',recoveryId).single().throwOnError();
 if(recovery.data.kind!=='refund_late_failure')return;
 // Historical repayment proof remains valid after its transfer is legitimately
 // reversed for the linked replacement. Do not require it to remain unreversed.
 const saved=await admin.from('refund_recredit_proofs').select('adjustment_id').eq('recovery_id',recoveryId).maybeSingle().throwOnError();
 if(saved.data)return;
 const reference=recovery.data.recovery_key?.replace(/^refund-late-failure:/,'');
 if(!reference)throw new Error('The late-refund recovery reference is missing.');
 const adjustment=await admin.from('refund_lifecycle_adjustments').select('id,refund_operation_id,refund_reference,seller_recredit_cents,created_at').eq('refund_reference',reference).single().throwOnError();
 const a=adjustment.data;
 const operation=await admin.from('refund_operations').select('id,order_id,currency,reversal_reference,reversal_due_cents,reversal_transfer_reference,reversal_operation_key').eq('id',a.refund_operation_id).single().throwOnError();
 const op=operation.data;
 if(op.order_id!==recovery.data.order_id)throw new Error('The recovery does not match this refund operation.');
 const currency=op.currency.toLowerCase();
 if(a.seller_recredit_cents===0){
  await admin.rpc('record_refund_recredit_proof',{p_recovery:recoveryId,p_adjustment:a.id,p_actor:actorId,p_amount:0,p_currency:currency}).throwOnError();return;
 }
 if(!/^tr_[A-Za-z0-9]+$/.test(recreditReference))throw new Error('Enter the Stripe transfer ID that repaid this seller before closing the case.');
 const order=await admin.from('orders').select('transfer_reference').eq('id',op.order_id).single().throwOnError();
 const originalReference=op.reversal_transfer_reference??order.data.transfer_reference;
 const amount=a.seller_recredit_cents??op.reversal_due_cents;
 if(!originalReference||!amount||amount<=0)throw new Error('Reconcile the original seller reversal before confirming a recredit.');
 const key=stripeSecretKey();if(!key)throw new Error('Stripe verification is unavailable.');
 let reversalReference=op.reversal_reference;
 if(!reversalReference){
  const found=await findExistingReversal({operationId:op.id,operationKey:op.reversal_operation_key??`reversal:${op.id}`,orderId:op.order_id,transferReference:originalReference,amountCents:amount,currency});
  if(found.kind!=='found')throw new Error('The original reversal outcome remains uncertain; the case must stay open.');
  reversalReference=found.reversalId;
 }
 const stripe=stripeClient();const options={timeout:10_000,maxNetworkRetries:0};
 const [original,reversal,recredit]=await Promise.all([
  stripe.transfers.retrieve(originalReference,{},options),
  stripe.transfers.retrieveReversal(originalReference,reversalReference,{},options),
  stripe.transfers.retrieve(recreditReference,{},options),
 ]);
 const destination=transferAccount(original.destination);
 const reversedTransfer=typeof reversal.transfer==='string'?reversal.transfer:reversal.transfer.id;
 if(!destination||original.metadata.order_id!==op.order_id||original.currency.toLowerCase()!==currency||original.livemode!==key.startsWith('sk_live_')||reversedTransfer!==originalReference||reversal.amount!==amount||reversal.currency.toLowerCase()!==currency)throw new Error('Original seller/reversal evidence does not match this obligation.');
 const balance=verifyRecreditTransfer(recredit,{amountCents:amount,currency,destination,operationId:op.id,orderId:op.order_id,adjustmentId:a.id,refundReference:a.refund_reference,createdAfter:Math.floor(Date.parse(a.created_at)/1000),live:key.startsWith('sk_live_')});
 await admin.rpc('record_refund_recredit_proof',{p_recovery:recoveryId,p_adjustment:a.id,p_actor:actorId,p_amount:amount,p_currency:currency,p_transfer:recredit.id,p_reversal:reversalReference,p_balance_transaction:balance}).throwOnError();
}
