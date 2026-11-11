import test from 'node:test'
import assert from 'node:assert/strict'
import {api,json} from '../src/api.js'
test('API preserva cabeçalho CSRF e credenciais em escrita',async()=>{
 const original=globalThis.fetch
 try{globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/chats');assert.equal(options.method,'POST');assert.equal(options.headers['X-Aether-Request'],'1');assert.equal(options.credentials,'include');return Response.json({ok:true})};assert.deepEqual(await api('/chats',json('POST',{})),{ok:true})}finally{globalThis.fetch=original}
})
test('API apresenta mensagem estruturada do Worker',async()=>{
 const original=globalThis.fetch
 try{globalThis.fetch=async()=>Response.json({error:{code:'ORIGIN_FORBIDDEN',message:'Origem inválida.'}},{status:403});await assert.rejects(api('/me'),e=>e.message==='Origem inválida.'&&e.status===403)}finally{globalThis.fetch=original}
})
