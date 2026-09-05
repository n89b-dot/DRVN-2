import {beforeEach,expect,it,vi} from 'vitest';
const recover=vi.hoisted(()=>vi.fn());
vi.mock('./reversal-recovery',()=>({recoverTransferReversal:recover}));
import {runRefundOperation} from './refunds';
beforeEach(()=>{vi.clearAllMocks();recover.mockResolvedValue({ok:true,reversedCents:2700});});
it('uses the dedicated recredit after settlement and on worker retry',async()=>{
 for(const initialStatus of ['effects_pending','reversal_pending']){
  let operation={id:'op',order_id:'order',amount_cents:3000,currency:'USD',reason:'replacement',attempts:0,status:initialStatus,provider_status:'succeeded',reversal_due_cents:2700,replacement_transfer_reference:'tr_recredit'};
  const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:{...operation},error:null}))};chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);
  const admin={from:vi.fn(()=>chain),rpc:vi.fn(async()=>{operation={...operation,status:'reversal_pending'};return {data:{ok:true,status:'reversal_pending',transfer_reference:'tr_original',reversal_due_cents:2700}};})};
  await expect(runRefundOperation(admin as never,'op')).resolves.toMatchObject({ok:true,reversedCents:2700});
  expect(recover).toHaveBeenLastCalledWith(admin,expect.objectContaining({operationId:'op',transferReference:'tr_recredit',amountCents:2700}));
  expect(admin.from.mock.calls.flat()).not.toContain('orders');
 }
});

it.each([
  {data:'recovery_required',error:null},
  {data:null,error:{message:'database unavailable'}},
])('does not cross a refused or unavailable provider boundary',async(claim)=>{
 const operation={id:'op',order_id:'order',status:'requested',replaces_adjustment_id:'adjustment'};
 const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:operation,error:null}))};
 chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);
 const admin={from:vi.fn(()=>chain),rpc:vi.fn(async()=>claim)};
 await expect(runRefundOperation(admin as never,'op')).resolves.toEqual({ok:false,error:'Reconcile other provider refund evidence before continuing the replacement.'});
 expect(admin.rpc).toHaveBeenCalledExactlyOnceWith('claim_refund_replacement_provider',{p_operation:'op'});
 expect(recover).not.toHaveBeenCalled();
});
