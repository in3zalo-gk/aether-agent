import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLocalBackend, createLocalCompletion, executeLocalTool, isAbortError, localFetch, normalizeLocalProviderBaseUrl, prepareToolCalls, toOpenAiMessages } from '../src/lib/localTransport.js'

const response = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body })

test('health usa GET sem token e reconhece backend online', async () => {
  let seen
  const online = await checkLocalBackend('http://localhost:3000', { fetchImpl: async (url, options) => { seen = { url, options }; return response({ ok: true }) } })
  assert.equal(online, true)
  assert.equal(seen.url, 'http://localhost:3000/health')
  assert.equal(seen.options.method, 'GET')
  assert.equal(seen.options.headers, undefined)
})

test('health converte falha de rede e HTTP em Agente Offline', async () => {
  await assert.rejects(checkLocalBackend('http://localhost:3000', { fetchImpl: async () => { throw new Error('ECONNREFUSED') } }), /Agente Offline/)
  await assert.rejects(checkLocalBackend('http://localhost:3000', { fetchImpl: async () => response({}, false) }), /Agente Offline/)
})

test('localFetch cancela timeout e abort externo sem promessas penduradas', async () => {
  const pending = (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
  await assert.rejects(localFetch('http://localhost:3000/health', {}, { fetchImpl: pending, timeout: 5 }), /tempo limite/)
  const controller = new AbortController()
  const task = localFetch('http://localhost:3000/health', { signal: controller.signal }, { fetchImpl: pending, timeout: 1000 })
  controller.abort()
  await assert.rejects(task, error => isAbortError(error))
})

test('prepara e valida chamadas, preservando ação original e erro seguro', () => {
  const calls = prepareToolCalls([
    { id: 'nav', function: { name: 'navigate_browser', arguments: '{"url":"https://example.test"}' } },
    { id: 'bad', function: { name: 'run_termux_command', arguments: '{' } }
  ])
  assert.deepEqual(calls[0], { id: 'nav', action: 'navigate_browser', args: { url: 'https://example.test' }, state: 'pending' })
  assert.equal(calls[1].state, 'error')
  assert.equal(calls[1].error, 'Chamada de ferramenta inválida.')
})

test('origem OpenAI local é normalizada para /v1', async () => {
  assert.equal(normalizeLocalProviderBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1')
  assert.equal(normalizeLocalProviderBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1')
  let request
  await createLocalCompletion({ baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' }, [], { fetchImpl: async (url, options) => { request = { url, options }; return response({ choices: [{ message: { content: '', tool_calls: [] } }] }) } })
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
})

test('completion OpenAI-compatible envia tools e nunca expõe falha upstream', async () => {
  let request
  const answer = await createLocalCompletion({ baseUrl: 'http://localhost:11434/v1', model: 'qwen', apiKey: 'secret', toolDefinitions: [{ type: 'function' }] }, [{ role: 'user', content: 'oi' }], { fetchImpl: async (url, options) => { request = { url, options }; return response({ choices: [{ message: { content: 'olá', tool_calls: [] } }] }) } })
  assert.equal(answer.content, 'olá')
  assert.equal(request.url, 'http://localhost:11434/v1/chat/completions')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(request.options.body).tools, [{ type: 'function' }])
  await assert.rejects(createLocalCompletion({ baseUrl: 'http://localhost:11434/v1', model: 'qwen' }, [], { fetchImpl: async () => response({ private: 'upstream detail' }, false) }), /recusou a solicitação/)
})

test('ferramenta aprovada envia token apenas ao backend e serializa resultado', async () => {
  let request
  const result = await executeLocalTool({ action: 'run_termux_command', args: { command: 'pwd' } }, { backendUrl: 'http://localhost:3000', localToken: 'local-secret' }, { fetchImpl: async (url, options) => { request = { url, options }; return response({ stdout: '/data', exitCode: 0 }) } })
  assert.equal(request.url, 'http://localhost:3000/api/exec')
  assert.equal(request.options.headers['x-aether-token'], 'local-secret')
  assert.equal(result, '{"stdout":"/data","exitCode":0}')
})

test('mensagens de ferramenta só retornam resultados terminais ao modelo', () => {
  const output = toOpenAiMessages([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', action: 'open_browser', args: {}, state: 'pending' }, { id: 'b', action: 'run_termux_command', args: { command: 'id' }, state: 'denied', error: 'Recusado pelo usuário.' }] }])
  assert.equal(output.length, 2)
  assert.equal(output[1].role, 'tool')
  assert.equal(output[1].tool_call_id, 'b')
})
