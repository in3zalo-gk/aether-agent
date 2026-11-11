import { useCallback, useEffect, useRef, useState } from 'react'
import { checkLocalBackend, DEFAULT_BACKEND_URL, isAbortError } from '../lib/localTransport.js'

const POLL_MS = 30000

export function useLocalConnection(backendUrl = DEFAULT_BACKEND_URL) {
  const [status, setStatus] = useState('checking')
  const controllerRef = useRef(null)
  const mountedRef = useRef(true)

  const check = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (mountedRef.current) setStatus('checking')
    try {
      await checkLocalBackend(backendUrl || DEFAULT_BACKEND_URL, { signal: controller.signal })
      if (mountedRef.current && controllerRef.current === controller) setStatus('online')
      return true
    } catch (error) {
      if (!isAbortError(error) && mountedRef.current && controllerRef.current === controller) setStatus('offline')
      return false
    }
  }, [backendUrl])

  useEffect(() => {
    mountedRef.current = true
    let timer = null
    const run = () => { if (!document.hidden) void check() }
    run()
    const visibility = () => { if (!document.hidden) void check() }
    document.addEventListener('visibilitychange', visibility)
    timer = setInterval(run, POLL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
      controllerRef.current?.abort()
    }
  }, [check])

  return { status, check }
}

export default useLocalConnection
