import {expect,it} from 'vitest';
import {allRows} from './account-export-pagination';
it('enumerates beyond the server row cap and rejects a failed later page',async()=>{
 const records=Array.from({length:1251},(_,id)=>({id:String(id)}));
 const result=await allRows({range:async(from,to)=>({data:records.slice(from,to+1),error:null})});
 expect(result).toEqual(records);
 await expect(allRows({range:async(from,to)=>from>=1000?{data:null,error:{message:'offline'}}:{data:records.slice(from,to+1),error:null}})).rejects.toThrow('enumerate');
});
