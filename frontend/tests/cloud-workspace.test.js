import test from 'node:test'
import assert from 'node:assert/strict'
import {pendingToolCalls,stringifyToolResult} from '../src/hooks/useCloudWorkspace.js'

test('serializa resultados nativos não textuais para o contrato cloud',()=>{
  assert.equal(stringifyToolResult('pronto'),'pronto')
  assert.equal(stringifyToolResult({opened:true,tabs:2}),'{"opened":true,"tabs":2}')
  assert.equal(stringifyToolResult(['a',2]),'["a",2]')
  assert.equal(stringifyToolResult(undefined),'Resultado nativo indisponível.')
})

test('considera aprovável somente a chamada pendente enviada pelo worker',()=>{
  const chat={messages:[
    {role:'assistant',content:'concluída sem chamada'},
    {role:'assistant',content:'aguardando',toolCalls:[{id:'pending-1',action:'open_browser',args:{url:'https://example.test'}}]},
    {role:'tool',tool_call_id:'old-1',content:'resultado antigo'}
  ]}
  assert.deepEqual(pendingToolCalls(chat),[{id:'pending-1',action:'open_browser',args:{url:'https://example.test'}}])
  assert.deepEqual(pendingToolCalls({messages:[{role:'tool',tool_call_id:'old-1',content:'feito'}]}),[])
})
