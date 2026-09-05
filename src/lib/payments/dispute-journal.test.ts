import {describe,expect,it,vi} from 'vitest';
import type Stripe from 'stripe';
import {applyJournaledDispute} from './dispute-journal';
const event={id:'evt_dispute',created:12345} as Stripe.Event;
const dispute={id:'dp_journal',payment_intent:'pi_journal',amount:10000,currency:'usd',status:'lost'} as Stripe.Dispute;
function adminFor(...results:unknown[]){const rpc=vi.fn();for(const result of results)rpc.mockResolvedValueOnce(result);return {rpc};}
describe('provider dispute journal dispatch',()=>{
 it.each(['committed','recovery_recorded','retry'])('does not call refund booking for %s',async outcome=>{
  const admin=adminFor({data:outcome,error:null});const effect=vi.fn();
  expect(await applyJournaledDispute(admin as never,event,dispute,true,effect)).toBe(outcome);expect(effect).not.toHaveBeenCalled();
 });
 it('does not acknowledge journal persistence failure',async()=>{
  const admin=adminFor({data:null,error:{message:'offline'}});const effect=vi.fn();
  await expect(applyJournaledDispute(admin as never,event,dispute,true,effect)).rejects.toThrow('journal');expect(effect).not.toHaveBeenCalled();
 });
 it('books exact admitted loss before fenced completion with the same lease',async()=>{
  const admin=adminFor({data:'apply_loss',error:null},{data:null,error:null});const effect=vi.fn().mockResolvedValue('committed');
  expect(await applyJournaledDispute(admin as never,event,dispute,true,effect)).toBe('committed');
  expect(effect).toHaveBeenCalledOnce();expect(admin.rpc.mock.calls[0][1]).toMatchObject({p_amount:10000,p_currency:'usd',p_intent:'pi_journal',p_event:event.id,p_created:event.created});
  expect(admin.rpc.mock.calls[1]).toEqual(['complete_stripe_dispute_loss',{p_dispute:dispute.id,p_event:event.id,p_lease:admin.rpc.mock.calls[0][1].p_lease}]);
 });
 it('requires replay when refund ledger completion cannot be persisted',async()=>{
  const admin=adminFor({data:'apply_loss',error:null},{data:null,error:{message:'lost lease'}});
  await expect(applyJournaledDispute(admin as never,event,dispute,true,vi.fn().mockResolvedValue('committed'))).rejects.toThrow('completion');
 });
 it('cannot turn a retryable refund into a completed dispute',async()=>{
  const admin=adminFor({data:'apply_loss',error:null});
  expect(await applyJournaledDispute(admin as never,event,dispute,true,vi.fn().mockResolvedValue('retry'))).toBe('retry');expect(admin.rpc).toHaveBeenCalledOnce();
 });
 it('rejects loss admission for any other event and malformed provider identity',async()=>{
  const effect=vi.fn();const admin=adminFor({data:'apply_loss',error:null});
  await expect(applyJournaledDispute(admin as never,event,{...dispute,status:'won'},true,effect)).rejects.toThrow('Invalid');expect(effect).not.toHaveBeenCalled();
  expect(await applyJournaledDispute(admin as never,event,{...dispute,payment_intent:null},true,effect)).toBe('retry');expect(admin.rpc).toHaveBeenCalledOnce();
 });
});
