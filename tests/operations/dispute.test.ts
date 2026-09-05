import {admin} from './environment';
import {expect,it} from 'vitest';
import type Stripe from 'stripe';
import {dispatchStripeEvent} from '@/lib/payments/settlement';
it('books a complete lost-dispute basket once and ignores an older created callback',async()=>{
 const users:string[]=[];const orders:string[]=[];const stamp=crypto.randomUUID();const intent=`pi_local_dispute_${stamp}`;const disputeId=`dp_local_${stamp}`;
 try {
  for(const role of ['buyer','seller']){const created=await admin.auth.admin.createUser({email:`${role}-${stamp}@drvn.test`,email_confirm:true});if(created.error)throw created.error;users.push(created.data.user.id);}
  for(const amount of [6000,4000]){
   const order=await admin.from('orders').insert({buyer_id:users[0],seller_id:users[1],status:'paid',subtotal_cents:amount,platform_fee_cents:amount/10,total_cents:amount,currency:'USD'}).select('id').single().throwOnError();orders.push(order.data.id);
   await admin.from('payments').insert({order_id:order.data.id,provider:'stripe',provider_reference:intent,status:'succeeded',amount_cents:amount,currency:'USD'}).throwOnError();
  }
  const event={id:`evt_${stamp}`,type:'charge.dispute.closed',created:200,data:{object:{id:disputeId,payment_intent:intent,amount:10000,currency:'usd',status:'lost'}}} as Stripe.Event;
  const crashAdmin=Object.create(admin);
  crashAdmin.rpc=(name: string,args: never)=>name==='complete_stripe_dispute_loss'
    ?Promise.resolve({data:null,error:{message:'simulated completion crash'}})
    :admin.rpc(name as never,args);
  await expect(dispatchStripeEvent(crashAdmin,event)).rejects.toThrow('completion');
  await admin.from('stripe_dispute_journal').update({lease_expires_at:'2000-01-01'}).eq('dispute_id',disputeId).throwOnError();
  expect(await dispatchStripeEvent(admin,event)).toBe('committed');
  expect(await dispatchStripeEvent(admin,event)).toBe('committed');
  expect(await dispatchStripeEvent(admin,{...event,id:`evt_old_${stamp}`,type:'charge.dispute.created',created:100,data:{object:{...event.data.object,status:'needs_response'}}} as Stripe.Event)).toBe('committed');
  const rows=await admin.from('orders').select('status,total_cents,refunded_cents').in('id',orders).throwOnError();
  expect(rows.data).toHaveLength(2);for(const row of rows.data){expect(row.status).toBe('refunded');expect(row.refunded_cents).toBe(row.total_cents);}
  const operations=await admin.from('refund_operations').select('id').in('order_id',orders).throwOnError();expect(operations.data).toHaveLength(2);
  expect((await admin.from('stripe_dispute_journal').select('state').eq('dispute_id',disputeId).single().throwOnError()).data.state).toBe('lost');
 }finally{
  await admin.from('stripe_dispute_journal').delete().eq('dispute_id',disputeId).throwOnError();
  if(orders.length)await admin.from('orders').delete().in('id',orders).throwOnError();
  for(const uid of users){const result=await admin.auth.admin.deleteUser(uid);if(result.error)throw result.error;}
 }
});
