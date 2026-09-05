import {expect,it} from 'vitest';
import type Stripe from 'stripe';
import {verifyRecreditTransfer,type RecreditExpectation} from './recredit-verification';
const expected:RecreditExpectation={amountCents:2700,currency:'usd',destination:'acct_seller',operationId:'operation',adjustmentId:'adjustment',refundReference:'re_failed',createdAfter:100,live:false};
const transfer=()=>({id:'tr_recredit',amount:2700,currency:'usd',destination:'acct_seller',livemode:false,reversed:false,amount_reversed:0,balance_transaction:'txn_recredit',created:200,metadata:{refund_operation_id:'operation',recredit_adjustment_id:'adjustment',refund_reference:'re_failed'}} as unknown as Stripe.Transfer);
it('accepts exactly attributed unreversed seller recredit evidence',()=>{expect(verifyRecreditTransfer(transfer(),expected)).toBe('txn_recredit');});
it.each([
 ['amount',{amount:2699}],['currency',{currency:'gbp'}],['recipient',{destination:'acct_other'}],['mode',{livemode:true}],['partial reversal',{amount_reversed:1}],['full reversal',{reversed:true}],['missing balance',{balance_transaction:null}],['older payment',{created:99}],['wrong obligation',{metadata:{refund_operation_id:'other',recredit_adjustment_id:'adjustment',refund_reference:'re_failed'}}],['wrong adjustment',{metadata:{refund_operation_id:'operation',recredit_adjustment_id:'other',refund_reference:'re_failed'}}],['wrong refund',{metadata:{refund_operation_id:'operation',recredit_adjustment_id:'adjustment',refund_reference:'re_other'}}],
])('rejects %s evidence',(_label,patch)=>{expect(()=>verifyRecreditTransfer({...transfer(),...patch} as Stripe.Transfer,expected)).toThrow('exactly');});
