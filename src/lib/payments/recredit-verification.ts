import type Stripe from 'stripe';
export type RecreditExpectation={amountCents:number;currency:string;destination:string;operationId:string;adjustmentId:string;refundReference:string;createdAfter:number;live:boolean};
export function transferAccount(value:Stripe.Transfer['destination']):string|null{return typeof value==='string'?value:value?.id??null;}
export function verifyRecreditTransfer(transfer:Stripe.Transfer,expected:RecreditExpectation):string{
 const balance=typeof transfer.balance_transaction==='string'?transfer.balance_transaction:transfer.balance_transaction?.id;
 if(transfer.amount!==expected.amountCents||transfer.currency.toLowerCase()!==expected.currency||transferAccount(transfer.destination)!==expected.destination||transfer.livemode!==expected.live||transfer.reversed||transfer.amount_reversed!==0||!balance||transfer.created<expected.createdAfter||transfer.metadata.refund_operation_id!==expected.operationId||transfer.metadata.recredit_adjustment_id!==expected.adjustmentId||transfer.metadata.refund_reference!==expected.refundReference)throw new Error('The Stripe transfer does not exactly prove this seller recredit obligation.');
 return balance;
}
