import {afterEach,expect,it,vi} from 'vitest';
const db=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('./supabase/admin',()=>({createAdminClient:db.create}));
vi.mock('next/headers',()=>({cookies:vi.fn(()=>{throw new Error('disabled analytics must not read cookies');})}));
vi.mock('next/server',()=>({after:vi.fn(()=>{throw new Error('disabled analytics must not schedule dispatch');})}));
import {capture} from './analytics';
import {processPurchaseAnalytics} from './purchase-analytics';
import {typesenseRequest,typesenseUpsert,typesenseDelete} from './search/typesense';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
it('disabled analytics never claims queued work or dispatches events',async()=>{
 vi.stubEnv('POSTHOG_KEY','');const send=vi.fn();vi.stubGlobal('fetch',send);
 capture('user',{event:'seller_dispatched'});
 expect(await processPurchaseAnalytics()).toEqual({configured:false,delivered:0});
 expect(send).not.toHaveBeenCalled();expect(db.create).not.toHaveBeenCalled();
});
it.each([{url:'',key:''},{url:'https://unused-search.example',key:''},{url:'',key:'test-only'}])('disabled/partial search configuration makes no network requests (%j)',async({url,key})=>{
 vi.stubEnv('TYPESENSE_URL',url);vi.stubEnv('TYPESENSE_API_KEY',key);const send=vi.fn();vi.stubGlobal('fetch',send);
 await typesenseUpsert('listings',{id:'listing'});await typesenseDelete('listings','listing');
 await expect(typesenseRequest('/collections')).rejects.toThrow('disabled');expect(send).not.toHaveBeenCalled();
});
