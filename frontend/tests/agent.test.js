import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TOOL_RESULT, endpointFor, fetchWithTimeout, normalizeBackendUrl, normalizeBaseUrl, normalizeProviderBaseUrl, parseToolCall, safeToolResult, toolRequest } from '../src/lib/agent.js'

test('normaliza URLs HTTP(S) e endpoint HTTPS de provedor',()=>{
  assert.equal(normalizeBaseUrl('https://api.test/'),'https://api.test')
  assert.equal(endpointFor('https://api.test/'),'https://api.test/chat/completions')
  assert.equal(normalizeProviderBaseUrl('http://localhost:11434/v1'),'http://localhost:11434/v1')
  assert.throws(()=>endpointFor('http://api.test'))
  assert.throws(()=>normalizeBaseUrl('ftp://x'))
})
test('aceita somente backend HTTP loopback com porta válida',()=>{
  assert.equal(normalizeBackendUrl('http://localhost:3000/'),'http://localhost:3000')
  assert.equal(normalizeBackendUrl('http://127.0.0.1:65535'),'http://127.0.0.1:65535')
  for (const invalid of ['https://localhost:3000','http://api.example:3000','http://localhost','http://localhost:0','http://localhost:3000/path']) assert.throws(()=>normalizeBackendUrl(invalid))
})
test('valida contrato de ferramentas',()=>{const call=parseToolCall({id:'1',function:{name:'navigate_browser',arguments:'{"url":"https://vite.dev"}'}});assert.equal(call.args.url,'https://vite.dev');assert.throws(()=>parseToolCall({function:{name:'unknown',arguments:'{}'}}));assert.throws(()=>parseToolCall({function:{name:'run_termux_command',arguments:'{}'}}))})
test('mapeia ferramentas e trunca resultados com marcador',()=>{assert.equal(toolRequest('run_termux_command',{command:'node --version'},'token').path,'/api/exec');assert.equal(toolRequest('navigate_browser',{url:'https://x'},'').body.url,'https://x');const truncated=safeToolResult('x'.repeat(MAX_TOOL_RESULT+2));assert.match(truncated,/truncado/);assert.ok(truncated.startsWith('x'.repeat(MAX_TOOL_RESULT)));assert.ok(truncated.length>MAX_TOOL_RESULT)})
test('não chama fetch quando o sinal já está abortado',async()=>{const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('não deveria chamar fetch')};const controller=new AbortController();controller.abort();try{await assert.rejects(fetchWithTimeout('https://example.test',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0)}finally{globalThis.fetch=original}})
