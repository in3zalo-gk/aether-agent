import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_ROUNDS, SYSTEM_PROMPT, toolDefinitions } from '../lib/agent.js'
import { createLocalCompletion, executeLocalTool, isAbortError, prepareToolCalls, toOpenAiMessages } from '../lib/localTransport.js'

const makeId = () => globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
const cancelled = 'Cancelado pelo usuário.'

export function useLocalAgent(config = {}) {
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef([])
  const configRef = useRef(config)
  const generationRef = useRef(0)
  const roundRef = useRef(0)
  const turnConfigRef = useRef(null)
  const controllersRef = useRef(new Set())
  const runningToolsRef = useRef(new Set())
  const mountedRef = useRef(true)
  configRef.current = config

  const replaceMessages = useCallback((update) => {
    const next = typeof update === 'function' ? update(messagesRef.current) : update
    messagesRef.current = next
    if (mountedRef.current) setMessages(next)
    return next
  }, [])
  const updateCall = useCallback((callId, patch) => replaceMessages(current => current.map(message => message.role !== 'assistant' ? message : ({ ...message, toolCalls: message.toolCalls?.map(call => call.id === callId ? { ...call, ...patch } : call) }))), [replaceMessages])
  const trackController = useCallback((controller) => {
    controllersRef.current.add(controller)
    if (mountedRef.current) setBusy(true)
  }, [])
  const releaseController = useCallback((controller) => {
    controllersRef.current.delete(controller)
    if (mountedRef.current) setBusy(controllersRef.current.size > 0)
  }, [])

  const run = useCallback(async (generation) => {
    if (generation !== generationRef.current || controllersRef.current.size) return
    const turn = turnConfigRef.current
    if (!turn || turn.generation !== generation) return
    const controller = new AbortController()
    trackController(controller)
    try {
      while (roundRef.current < MAX_ROUNDS) {
        if (generation !== generationRef.current || controller.signal.aborted) return
        roundRef.current += 1
        const systemPrompt = String(turn.config?.systemPrompt || SYSTEM_PROMPT)
        const completion = await createLocalCompletion({ ...turn.config, toolDefinitions }, [{ role: 'system', content: systemPrompt }, ...toOpenAiMessages(messagesRef.current)], { signal: controller.signal })
        if (generation !== generationRef.current) return
        const calls = prepareToolCalls(completion.toolCalls)
        const assistant = { id: makeId(), role: 'assistant', content: completion.content, ...(calls.length ? { toolCalls: calls } : {}) }
        replaceMessages(current => [...current, assistant])
        if (!calls.length) return
        if (calls.some(call => call.state === 'pending' || call.state === 'running')) return
        // Invalid calls have terminal errors; return those errors to the model in the next round.
      }
      if (generation === generationRef.current && mountedRef.current) setError('Limite de ações do agente atingido.')
    } catch (caught) {
      if (generation !== generationRef.current || isAbortError(caught)) return
      if (mountedRef.current) setError(caught?.message === 'Agente Offline' ? 'Agente Offline' : (caught?.message || 'Não foi possível concluir a solicitação.'))
    } finally {
      releaseController(controller)
    }
  }, [releaseController, replaceMessages, trackController])

  const send = useCallback((text) => {
    const content = String(text || '').trim()
    const hasOpenTools = messagesRef.current.some(message => message.toolCalls?.some(call => ['pending', 'running'].includes(call.state)))
    if (!content || controllersRef.current.size || hasOpenTools) return false
    const generation = generationRef.current + 1
    generationRef.current = generation
    roundRef.current = 0
    turnConfigRef.current = { generation, config: { ...configRef.current } }
    setError('')
    replaceMessages(current => [...current, { id: makeId(), role: 'user', content }])
    void run(generation)
    return true
  }, [replaceMessages, run])

  const resolveTool = useCallback(async (call, approved) => {
    const currentCall = messagesRef.current.flatMap(message => message.toolCalls || []).find(item => item.id === call?.id)
    // Tool approval is deliberately serialized: one controller owns one local action.
    if (!currentCall || currentCall.state !== 'pending' || runningToolsRef.current.size || controllersRef.current.size) return false
    const generation = generationRef.current
    const turn = turnConfigRef.current
    if (!turn || turn.generation !== generation) return false
    if (!approved) {
      updateCall(currentCall.id, { state: 'denied', error: 'Recusado pelo usuário.' })
    } else {
      runningToolsRef.current.add(currentCall.id)
      updateCall(currentCall.id, { state: 'running', error: undefined })
      const controller = new AbortController()
      trackController(controller)
      try {
        const result = await executeLocalTool(currentCall, turn.config, { signal: controller.signal })
        if (generation === generationRef.current) updateCall(currentCall.id, { state: 'success', result })
      } catch (caught) {
        if (generation === generationRef.current) updateCall(currentCall.id, { state: 'error', error: isAbortError(caught) ? cancelled : (caught?.message || 'A ferramenta local falhou.') })
      } finally {
        runningToolsRef.current.delete(currentCall.id)
        releaseController(controller)
      }
    }
    if (generation !== generationRef.current) return false
    const allDone = messagesRef.current.some(message => message.role === 'assistant' && message.toolCalls?.some(item => item.id === call.id)) && !messagesRef.current.some(message => message.role === 'assistant' && message.toolCalls?.some(item => item.state === 'pending' || item.state === 'running'))
    if (allDone) void run(generation)
    return true
  }, [releaseController, run, trackController, updateCall])

  const stop = useCallback(() => {
    generationRef.current += 1
    for (const controller of controllersRef.current) controller.abort()
    controllersRef.current.clear()
    runningToolsRef.current.clear()
    replaceMessages(current => current.map(message => message.role !== 'assistant' ? message : ({ ...message, toolCalls: message.toolCalls?.map(call => ['pending', 'running'].includes(call.state) ? { ...call, state: 'error', error: cancelled } : call) })))
    if (mountedRef.current) { setBusy(false); setError('Operação cancelada.') }
  }, [replaceMessages])

  const newChat = useCallback(() => { stop(); roundRef.current = 0; turnConfigRef.current = null; replaceMessages([]); if (mountedRef.current) setError('') }, [replaceMessages, stop])
  const clearError = useCallback(() => { if (mountedRef.current) setError('') }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      for (const controller of controllersRef.current) controller.abort()
      controllersRef.current.clear()
      runningToolsRef.current.clear()
    }
  }, [])

  return { messages, busy, error, send, stop, resolveTool, newChat, clearError }
}

export default useLocalAgent
