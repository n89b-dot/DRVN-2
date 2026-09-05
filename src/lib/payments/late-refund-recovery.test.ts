import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({retrieve:vi.fn(),reversal:vi.fn(),find:vi.fn(),client:vi.fn()}));
vi.mock('./stripe',()=>({stripeSecretKey:()=> 'sk_test_fixture',stripeClient:()=>{mocks.client();return {transfers:{retrieve:mocks.retrieve,retrieveReversal:mocks.reversal}};}}));
vi.mock('./reversal-recovery',()=>({findExistingReversal:mocks.find}));
import {verifyLateRefundRecovery} from './late-refund-recovery';
function fixture(amount:number|null=2700,recorded=true){
 const rows=[{kind:'refund_late_failure',recovery_key:'refund-late-failure:re_failed',order_id:'order'},
 {id:'adjustment',refund_operation_id:'operation',refund_reference:'re_failed',seller_recredit_cents:amount,created_at:'2026-09-01T00:00:00Z'},
 {id:'operation',order_id:'order',currency:'USD',reversal_reference:recorded?'trr_original':null,reversal_due_cents:2700,reversal_transfer_reference:'tr_original',reversal_operation_key:'reversal:operation'},
 {transfer_reference:'tr_original'}];
 const chain={select:vi.fn(),eq:vi.fn(),single:vi.fn(),throwOnError:vi.fn(async()=>({data:rows.shift()}))};for(const key of ['select','eq','single'] as const)chain[key].mockReturnValue(chain);
 const persisted=vi.fn().mockResolvedValue({data:null});return {from:vi.fn(()=>chain),rpc:vi.fn(()=>({throwOnError:persisted})),persisted};
}
beforeEach(()=>{
 vi.clearAllMocks();mocks.find.mockResolvedValue({kind:'found',reversalId:'trr_original'});
 mocks.reversal.mockResolvedValue({id:'trr_original',transfer:'tr_original',amount:2700,currency:'usd'});
 mocks.retrieve.mockImplementation(async(id:string)=>id==='tr_original'?{id,metadata:{order_id:'order'},destination:'acct_seller',currency:'usd',livemode:false}:{id,amount:2700,currency:'usd',destination:'acct_seller',livemode:false,reversed:false,amount_reversed:0,balance_transaction:'txn_repaid',created:1900000000,metadata:{refund_operation_id:'operation',recredit_adjustment_id:'adjustment',refund_reference:'re_failed'}});
});
it('records a proven zero obligation without contacting Stripe',async()=>{
 const admin=fixture(0);await verifyLateRefundRecovery(admin as never,'recovery','actor','');expect(mocks.client).not.toHaveBeenCalled();expect(admin.rpc).toHaveBeenCalledWith('record_refund_recredit_proof',{p_recovery:'recovery',p_adjustment:'adjustment',p_actor:'actor',p_amount:0,p_currency:'usd'});
});
it('verifies original reversal and exact repayment before persisting proof',async()=>{
 const admin=fixture();await verifyLateRefundRecovery(admin as never,'recovery','actor','tr_repaid');expect(admin.rpc.mock.calls[0]).toEqual(['record_refund_recredit_proof',{p_recovery:'recovery',p_adjustment:'adjustment',p_actor:'actor',p_amount:2700,p_currency:'usd',p_transfer:'tr_repaid',p_reversal:'trr_original',p_balance_transaction:'txn_repaid'}]);
});
it('reconciles an unrecorded original reversal before proving recredit',async()=>{
 const admin=fixture(null,false);await verifyLateRefundRecovery(admin as never,'recovery','actor','tr_repaid');expect(mocks.find).toHaveBeenCalledOnce();expect(admin.rpc).toHaveBeenCalledOnce();
});
it('leaves uncertain original reversals open',async()=>{
 const admin=fixture(null,false);mocks.find.mockResolvedValue({kind:'unsafe'});await expect(verifyLateRefundRecovery(admin as never,'recovery','actor','tr_repaid')).rejects.toThrow('uncertain');expect(admin.rpc).not.toHaveBeenCalled();
});
it('requires an actual transfer reference and checked provider reads',async()=>{
 const admin=fixture();await expect(verifyLateRefundRecovery(admin as never,'recovery','actor','')).rejects.toThrow('transfer ID');expect(admin.rpc).not.toHaveBeenCalled();
 const retry=fixture();mocks.reversal.mockRejectedValue(new Error('provider unavailable'));await expect(verifyLateRefundRecovery(retry as never,'recovery','actor','tr_repaid')).rejects.toThrow('unavailable');expect(retry.rpc).not.toHaveBeenCalled();
});
it('cannot acknowledge a failed proof write',async()=>{
 const admin=fixture();admin.persisted.mockRejectedValue(new Error('proof unavailable'));await expect(verifyLateRefundRecovery(admin as never,'recovery','actor','tr_repaid')).rejects.toThrow('proof unavailable');
});
