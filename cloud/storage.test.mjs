import test from 'node:test';
import assert from 'node:assert/strict';
import { AetherAccount } from './worker.js';
class Storage {
  constructor(){this.m=new Map();}
  async get(k){return this.m.get(k);}
  async put(k,v){this.m.set(k,v);}
  async delete(k){this.m.delete(k);}
  async list({prefix=''}){return new Map([...this.m].filter(([k])=>k.startsWith(prefix)));}
  async transaction(fn){return fn(this);}
}
const request=(body)=>new Request('https://do/data',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('account data uses revision CAS and chunked storage', async()=>{
 const storage=new Storage(), worker=new AetherAccount({storage});
 let r=await worker.fetch(request({account:{username:'say',text:'x'.repeat(50000)},expectedRevision:0}));
 assert.equal(r.status,200); assert.equal((await r.json()).revision,1);
 assert.ok([...storage.m.keys()].some(k=>k==='account:1'));
 r=await worker.fetch(request({account:{username:'other'},expectedRevision:0}));
 assert.equal(r.status,409);
 r=await worker.fetch(new Request('https://do/data'));
 const a=await r.json(); assert.equal(a.username,'say'); assert.equal(a._revision,1); assert.equal(a.text.length,50000);
 r=await worker.fetch(request({account:{username:'say'},expectedRevision:1}));
 assert.equal((await r.json()).revision,2);
});
