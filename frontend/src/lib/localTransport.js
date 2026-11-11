import { endpointFor, normalizeBackendUrl, parseToolCall, safeToolResult, toolRequest } from './agent.js'

export const DEFAULT_BACKEND_URL = 'http://localhost:3000'
export const DEFAULT_PROVIDER_BASE_URL = 'https://api.openai.com/v1'
export const HEALTH_TIMEOUT = 3000
export const REQUEST_TIMEOUT = 45000

function abortError() {
  return typeof DOMException === 'function'
    ? new DOMException('A solicitação foi cancelada.', 'AbortError')
    : Object.assign(new Error('A solicitação foi cancelada.'), { name: 'AbortError' })
}

export function isAbortError(error) { return error?.name === 'AbortError' }

/** OpenAI's Chat Completions endpoint lives under /v1; accept its common raw origin preset. */
export function normalizeLocalProviderBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim()
  try {
    const url = new URL(value)
    if (url.hostname === 'api.openai.com' && url.pathname === '/' && !url.search && !url.hash) return DEFAULT_PROVIDER_BASE_URL
  } catch {}
  return value
}

/** A fetch wrapper which clears both timeout and abort listeners. */
export async function localFetch(url, options = {}, { timeout = REQUEST_TIMEOUT, fetchImpl = globalThis.fetch } = {}) {
  if (options.signal?.aborted) throw abortError()
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível.')
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (options.signal?.aborted) throw abortError()
    if (timedOut) throw new Error('A solicitação excedeu o tempo limite.')
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function jsonResponse(response, fallback) {
  if (!response?.ok) throw new Error(fallback)
  try { return await response.json() } catch { throw new Error(fallback) }
}

export async function checkLocalBackend(backendUrl = DEFAULT_BACKEND_URL, options = {}) {
  const origin = normalizeBackendUrl(backendUrl || DEFAULT_BACKEND_URL)
  try {
    const response = await localFetch(`${origin}/health`, { method: 'GET' }, { timeout: HEALTH_TIMEOUT, ...options })
    const body = await jsonResponse(response, 'Agente Offline')
    if (body?.ok !== true) throw new Error('Agente Offline')
    return true
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new Error('Agente Offline')
  }
}

export async function createLocalCompletion(config, messages, options = {}) {
  const baseUrl = normalizeLocalProviderBaseUrl(config?.baseUrl)
  const model = String(config?.model || '').trim()
  if (!baseUrl || !model) throw new Error('Configure o provedor local e o modelo.')
  const headers = { 'content-type': 'application/json' }
  if (config?.apiKey) headers.authorization = `Bearer ${config.apiKey}`
  let response
  try {
    response = await localFetch(endpointFor(baseUrl), {
      method: 'POST', headers, signal: options.signal,
      body: JSON.stringify({ model, messages, tools: config.toolDefinitions, tool_choice: 'auto' })
    }, options)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new Error('Não foi possível contactar o provedor local.')
  }
  const data = await jsonResponse(response, 'O provedor local recusou a solicitação.')
  const message = data?.choices?.[0]?.message
  if (!message || typeof message !== 'object') throw new Error('Resposta inválida do provedor local.')
  return { content: typeof message.content === 'string' ? message.content : '', toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [] }
}

export function prepareToolCalls(rawCalls) {
  const seen = new Set()
  return rawCalls.map((raw, index) => {
    const fallbackId = `tool-${Date.now()}-${index}`
    const rawId = typeof raw?.id === 'string' && raw.id ? raw.id : fallbackId
    const id = seen.has(rawId) ? `${rawId}-${index}` : rawId
    seen.add(id)
    try {
      const parsed = parseToolCall({ ...raw, id })
      return { id, action: parsed.name, args: parsed.args, state: 'pending' }
    } catch (error) {
      return { id, action: String(raw?.function?.name || 'desconhecida'), args: {}, state: 'error', error: 'Chamada de ferramenta inválida.' }
    }
  })
}

export async function executeLocalTool(call, config, options = {}) {
  const backendUrl = normalizeBackendUrl(config?.backendUrl || DEFAULT_BACKEND_URL)
  const request = toolRequest(call.action, call.args, config?.localToken)
  let response
  try {
    response = await localFetch(`${backendUrl}${request.path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body), signal: options.signal
    }, options)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new Error('Não foi possível executar a ferramenta local.')
  }
  const result = await jsonResponse(response, 'A ferramenta local falhou.')
  return safeToolResult(result)
}

export function toOpenAiMessages(messages) {
  const output = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const toolCalls = message.toolCalls || []
      output.push({ role: 'assistant', content: message.content || '', ...(toolCalls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.action, arguments: JSON.stringify(call.args || {}) } })) } : {}) })
      for (const call of toolCalls) {
        if (!['success', 'error', 'denied'].includes(call.state)) continue
        const content = call.state === 'success' ? (call.result || '') : (call.error || (call.state === 'denied' ? 'Recusado pelo usuário.' : 'A ferramenta falhou.'))
        output.push({ role: 'tool', tool_call_id: call.id, content: safeToolResult(content) })
      }
    } else if (message.role === 'user') output.push({ role: 'user', content: String(message.content || '') })
  }
  return output
}
