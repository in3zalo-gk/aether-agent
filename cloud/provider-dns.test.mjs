import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProviderUrl } from './worker.js';
const reply = Answer => new Response(JSON.stringify({ Status: 0, Answer }));
test('DeepSeek accepts a public CNAME IPv4 result with no AAAA address', async () => {
 const calls=[];
 const fetcher=async (url,init)=>{assert.equal(init.redirect,'manual');calls.push(url);return reply(url.endsWith('type=A')?[{type:5,data:'cdn.example.net.'},{type:1,data:'3.173.21.63'}]:[{type:5,data:'cdn.example.net.'}]);};
 assert.equal(await validateProviderUrl('https://api.deepseek.com',fetcher),'https://api.deepseek.com');
 assert.equal(calls.length,2);
});
test('independent DNS fallback survives resolver failure', async () => {
 const fetcher=async url=>{if(url.startsWith('https://dns.google/'))throw Error('outage');return reply([{type:1,data:'3.173.21.63'}]);};
 assert.equal(await validateProviderUrl('https://api.deepseek.com',fetcher),'https://api.deepseek.com');
});
test('DNS fallback never bypasses private address rejection', async () => {
 await assert.rejects(validateProviderUrl('https://api.example.com',async ()=>reply([{type:1,data:'10.1.2.3'}])),/dns/);
});
test('complete resolver outage is distinguishable from unsafe URL', async () => {
 await assert.rejects(validateProviderUrl('https://api.example.com',async ()=>{throw Error('offline');}),/dns_unavailable/);
});
