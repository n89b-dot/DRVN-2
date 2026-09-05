import {randomUUID} from 'node:crypto';
import type Stripe from 'stripe';
import type {createAdminClient} from '@/lib/supabase/admin';
import type {StripeDispatchOutcome} from './settlement';

type Admin=ReturnType<typeof createAdminClient>;
/** The database owns open/close ordering and atomic basket transitions. Only
 * an exactly attributed lost dispute may enter the external refund ledger. */
export async function applyJournaledDispute(
 admin:Admin,event:Stripe.Event,dispute:Stripe.Dispute,closed:boolean,
 applyLoss:()=>Promise<StripeDispatchOutcome>,
):Promise<StripeDispatchOutcome>{
 const intent=typeof dispute.payment_intent==='string'?dispute.payment_intent:dispute.payment_intent?.id;
 if(!intent||!dispute.id||!Number.isSafeInteger(dispute.amount)||dispute.amount<=0||!dispute.currency)return 'retry';
 const lease=randomUUID();
 const admission=await admin.rpc('apply_stripe_dispute_event',{
  p_dispute:dispute.id,p_intent:intent,p_amount:dispute.amount,p_currency:dispute.currency.toLowerCase(),
  p_status:dispute.status,p_closed:closed,p_event:event.id,p_created:event.created,p_lease:lease,
 });
 if(admission.error)throw new Error('Provider dispute journal could not commit');
 if(admission.data==='committed'||admission.data==='recovery_recorded'||admission.data==='retry')return admission.data;
 if(admission.data!=='apply_loss'||!closed||dispute.status!=='lost')throw new Error('Invalid provider dispute admission');
 const outcome=await applyLoss();
 if(outcome!=='committed')return outcome;
 const completed=await admin.rpc('complete_stripe_dispute_loss',{p_dispute:dispute.id,p_event:event.id,p_lease:lease});
 if(completed.error)throw new Error('Provider dispute ledger completion requires retry');
 return 'committed';
}
