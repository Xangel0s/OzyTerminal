'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SshSessionRequest, TerminalErrorPayload, TerminalEvent } from '@/lib/types'

export type ConnectionStep = 'search' | 'ip' | 'user' | 'password' | 'connecting' | 'connected'

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error'

const CONNECTION_TIMEOUT_MS = 20000
const MAX_TERMINAL_CHUNKS = 500

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function encodeInputToBase64(value: string) {
  const bytes = textEncoder.encode(value)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return window.btoa(binary)
}

function decodeOutputFromBase64(value: string) {
  const binary = window.atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))

  return textDecoder.decode(bytes)
}

function formatDiagnosticLabel(phase: string) {
  return phase.replaceAll('_', ' ')
}

function logSshUi(message: string, details?: Record<string, unknown>) {
  console.info('[ssh-ui]', message, details ?? {})
}

function buildUnknownTerminalError(message: string): TerminalErrorPayload {
  return {
    kind: 'unknown',
    title: 'No se pudo abrir la sesion SSH',
    detail: message,
    retryable: true,
  }
}

function buildTimeoutTerminalError(host: string): TerminalErrorPayload {
  return {
    kind: 'connection',
    title: 'La conexion tardo demasiado',
    detail: `No hubo respuesta util desde ${host} antes del tiempo limite.`,
    suggestion: 'Verifica IP, puerto, red, firewall y credenciales, luego intenta otra vez.',
    retryable: true,
  }
}

function buildUnavailableTerminalError(): TerminalErrorPayload {
  return {
    kind: 'unknown',
    title: 'El runtime de Tauri no esta disponible',
    detail: 'La conexion SSH solo puede abrirse desde la app de escritorio Tauri. En el navegador no existe el bridge nativo.',
    suggestion: 'Inicia la interfaz con tauri dev o abre la version de escritorio para probar la conexion real.',
    retryable: false,
  }
}

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function loadTauriCore() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return import('@tauri-apps/api/core')
}

export function useSsh() {
  const [activeStep, setActiveStep] = useState<ConnectionStep>('search')
  const [draftConnection, setDraftConnection] = useState<Partial<SshSessionRequest>>({
    port: 22,
    cols: 120,
    rows: 34,
    privateKeyPem: '',
  })
  const [sessions, setSessions] = useState<SshSessionRequest[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionMessage, setSessionMessage] = useState('ready')
  const [sessionError, setSessionError] = useState<TerminalErrorPayload | null>(null)
  const [terminalOutput, setTerminalOutput] = useState<string[]>([])

  const activeSessionIdRef = useRef<string | null>(null)
  const attemptRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionStatusRef = useRef<SessionStatus>('idle')
  const pendingTerminalOutputRef = useRef<string[]>([])
  const flushOutputFrameRef = useRef<number | null>(null)
  const draftConnectionRef = useRef<Partial<SshSessionRequest>>({
    port: 22,
    cols: 120,
    rows: 34,
    privateKeyPem: '',
  })
  const connectionStartedAtRef = useRef<number | null>(null)
  const terminalInputCountRef = useRef(0)

  useEffect(() => {
    draftConnectionRef.current = draftConnection
  }, [draftConnection])

  useEffect(() => {
    sessionStatusRef.current = sessionStatus
  }, [sessionStatus])

  const updateDraft = useCallback((updates: Partial<SshSessionRequest>) => {
    setDraftConnection((prev) => ({ ...prev, ...updates }))
  }, [])

  const flushTerminalOutput = useCallback(() => {
    flushOutputFrameRef.current = null

    if (pendingTerminalOutputRef.current.length === 0) {
      return
    }

    const chunk = pendingTerminalOutputRef.current.join('')
    pendingTerminalOutputRef.current = []

    setTerminalOutput((current) => {
      const next = [...current, chunk]

      if (next.length <= MAX_TERMINAL_CHUNKS) {
        return next
      }

      return next.slice(-MAX_TERMINAL_CHUNKS)
    })
  }, [])

  const appendTerminalOutput = useCallback((value: string) => {
    pendingTerminalOutputRef.current.push(value)

    if (typeof window === 'undefined') {
      flushTerminalOutput()
      return
    }

    if (flushOutputFrameRef.current !== null) {
      return
    }

    flushOutputFrameRef.current = window.requestAnimationFrame(() => {
      flushTerminalOutput()
    })
  }, [flushTerminalOutput])

  const appendTerminalStatus = useCallback((value: string) => {
    appendTerminalOutput(`\r\n${value}\r\n`)
  }, [appendTerminalOutput])

  const clearConnectionTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const resetBufferedTerminalOutput = useCallback(() => {
    pendingTerminalOutputRef.current = []

    if (flushOutputFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(flushOutputFrameRef.current)
      flushOutputFrameRef.current = null
    }
  }, [])

  const closeActiveSession = useCallback(async () => {
    clearConnectionTimeout()

    const sessionId = activeSessionIdRef.current
    activeSessionIdRef.current = null
    setActiveSessionId(null)

    if (!sessionId) {
      return
    }

    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      return
    }

    try {
      await tauriCore.invoke('close_session', { sessionId })
    } catch (error) {
      console.error('Failed to close SSH session:', error)
    }
  }, [clearConnectionTimeout])

  const connect = useCallback(async (overrideDraft?: Partial<SshSessionRequest>) => {
    const resolvedDraft = {
      ...draftConnectionRef.current,
      ...overrideDraft,
    }
    const host = resolvedDraft.host?.trim()
    const username = resolvedDraft.username?.trim()
    const port = resolvedDraft.port ?? 22

    if (!host || !username) {
      return
    }

    setDraftConnection(resolvedDraft)

    attemptRef.current += 1
    const attemptId = attemptRef.current

    await closeActiveSession()
    resetBufferedTerminalOutput()

    setSessionStatus('connecting')
    setSessionMessage(`Conectando con ${host}:${port}`)
    setSessionError(null)
    setTerminalOutput([`[opening] ${username}@${host}:${port}\r\n`])
    setActiveStep('connecting')
    connectionStartedAtRef.current = Date.now()
    terminalInputCountRef.current = 0
    logSshUi('connect requested', {
      host,
      port,
      username,
      hasPassword: Boolean(resolvedDraft.password),
      hasKey: Boolean(resolvedDraft.privateKeyPem?.trim()),
    })

    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      clearConnectionTimeout()
      const terminalError = buildUnavailableTerminalError()
      setSessionStatus('error')
      setSessionMessage(terminalError.title)
      setSessionError(terminalError)
      appendTerminalStatus(`[${terminalError.kind}] ${terminalError.title}`)
      appendTerminalOutput(`${terminalError.detail}\r\n`)
      if (terminalError.suggestion) {
        appendTerminalOutput(`[suggestion] ${terminalError.suggestion}\r\n`)
      }
      connectionStartedAtRef.current = null
      return
    }

    const { Channel, invoke } = tauriCore

    const request: SshSessionRequest = {
      host,
      port,
      username,
      privateKeyPem: resolvedDraft.privateKeyPem?.trim() ?? '',
      privateKeyPassphrase: resolvedDraft.privateKeyPassphrase?.trim() || undefined,
      password: resolvedDraft.password || undefined,
      certificatePem: resolvedDraft.certificatePem?.trim() || undefined,
      knownHostFingerprint: resolvedDraft.knownHostFingerprint?.trim() || undefined,
      cols: resolvedDraft.cols ?? 120,
      rows: resolvedDraft.rows ?? 34,
      profileName: resolvedDraft.profileName?.trim() || undefined,
      relayHint: resolvedDraft.relayHint,
      controlPlane: resolvedDraft.controlPlane,
      mirrorOwnerId: resolvedDraft.mirrorOwnerId,
    }

    setSessions([request])

    const eventChannel = new Channel<TerminalEvent>()
    eventChannel.onmessage = (event) => {
      if (attemptRef.current !== attemptId) {
        return
      }

      switch (event.type) {
        case 'diagnostic':
          logSshUi('backend diagnostic', {
            phase: event.phase,
            elapsedMs: event.elapsed_ms,
            message: event.message,
          })
          if (sessionStatusRef.current !== 'connected') {
            setSessionMessage(`${event.message} (${event.elapsed_ms} ms)`)
          }
          appendTerminalStatus(`[diag:${formatDiagnosticLabel(event.phase)} +${event.elapsed_ms}ms] ${event.message}`)
          break
        case 'connected':
          clearConnectionTimeout()
          activeSessionIdRef.current = event.session_id
          setActiveSessionId(event.session_id)
          setSessionStatus('connected')
          setSessionMessage(`Conectado a ${host}:${port}`)
          setSessionError(null)
          setActiveStep('connected')
          logSshUi('connected event received', { host, port, sessionId: event.session_id })
          if (connectionStartedAtRef.current) {
            const elapsedMs = Date.now() - connectionStartedAtRef.current
            appendTerminalStatus(`[diag:ui +${elapsedMs}ms] La UI recibio el evento connected`)
          }
          break
        case 'stdout':
          appendTerminalOutput(decodeOutputFromBase64(event.chunk_b64))
          break
        case 'closed':
          clearConnectionTimeout()
          activeSessionIdRef.current = null
          setActiveSessionId(null)
          setSessionStatus((current) => (current === 'error' ? current : 'closed'))
          setSessionMessage(event.reason)
          appendTerminalStatus(`[closed] ${event.reason}`)
          logSshUi('session closed', { reason: event.reason, previousSessionId: activeSessionIdRef.current })
          connectionStartedAtRef.current = null
          break
        case 'error':
          clearConnectionTimeout()
          setSessionStatus('error')
          setSessionMessage(event.error.title)
          setSessionError(event.error)
          appendTerminalStatus(`[${event.error.kind}] ${event.error.title}`)
          appendTerminalOutput(`${event.error.detail}\r\n`)
          logSshUi('session error', {
            kind: event.error.kind,
            title: event.error.title,
            detail: event.error.detail,
          })
          if (event.error.suggestion) {
            appendTerminalOutput(`[suggestion] ${event.error.suggestion}\r\n`)
          }
          connectionStartedAtRef.current = null
          break
      }
    }

    timeoutRef.current = setTimeout(() => {
      if (attemptRef.current !== attemptId) {
        return
      }

      const timeoutError = buildTimeoutTerminalError(host)
      setSessionStatus('error')
      setSessionMessage(timeoutError.title)
      setSessionError(timeoutError)
      appendTerminalStatus(`[timeout] ${timeoutError.detail}`)
      connectionStartedAtRef.current = null

      const sessionId = activeSessionIdRef.current
      if (sessionId) {
        void invoke('close_session', { sessionId }).catch((error) => {
          console.error('Failed to close timed-out SSH session:', error)
        })
      }
    }, CONNECTION_TIMEOUT_MS)

    try {
      const sessionId = await invoke<string>('open_session', {
        request,
        events: eventChannel,
      })

      if (attemptRef.current === attemptId && connectionStartedAtRef.current) {
        const elapsedMs = Date.now() - connectionStartedAtRef.current
        appendTerminalStatus(`[diag:ui +${elapsedMs}ms] Backend devolvio el session id ${sessionId.slice(0, 8)}`)
        logSshUi('session id allocated', { sessionId, elapsedMs })
      }

      if (attemptRef.current !== attemptId) {
        void invoke('close_session', { sessionId }).catch(() => {})
        return
      }

      activeSessionIdRef.current = sessionId
      setActiveSessionId(sessionId)
    } catch (error) {
      if (attemptRef.current !== attemptId) {
        return
      }

      clearConnectionTimeout()
      const terminalError = buildUnknownTerminalError(String(error))
      setSessionStatus('error')
      setSessionMessage(terminalError.title)
      setSessionError(terminalError)
      appendTerminalStatus(`[${terminalError.kind}] ${terminalError.title}`)
      appendTerminalOutput(`${terminalError.detail}\r\n`)
      connectionStartedAtRef.current = null
    }
  }, [appendTerminalOutput, appendTerminalStatus, clearConnectionTimeout, closeActiveSession, resetBufferedTerminalOutput])

  const sendTerminalInput = useCallback(async (value: string) => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId || value.length === 0) {
      return
    }

    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      const terminalError = buildUnavailableTerminalError()
      setSessionStatus('error')
      setSessionMessage(terminalError.title)
      setSessionError(terminalError)
      appendTerminalStatus(`[${terminalError.kind}] ${terminalError.title}`)
      appendTerminalOutput(`${terminalError.detail}\r\n`)
      return
    }

    const { invoke } = tauriCore
    terminalInputCountRef.current += 1
    const containsNewline = value.includes('\n') || value.includes('\r')

    try {
      await invoke('send_input', {
        sessionId,
        dataB64: encodeInputToBase64(value),
      })
      if (terminalInputCountRef.current === 1 || containsNewline) {
        logSshUi('terminal input forwarded', {
          sessionId,
          inputIndex: terminalInputCountRef.current,
          charLength: value.length,
          containsNewline,
        })
      }
    } catch (error) {
      const errorMessage = String(error)

      if (errorMessage.includes('session not found') || errorMessage.includes('channel closed')) {
        return
      }

      const terminalError = buildUnknownTerminalError(String(error))
      setSessionStatus('error')
      setSessionMessage(terminalError.title)
      setSessionError(terminalError)
      appendTerminalStatus(`[${terminalError.kind}] ${terminalError.title}`)
      appendTerminalOutput(`${terminalError.detail}\r\n`)
    }
  }, [appendTerminalOutput, appendTerminalStatus])

  const resizeTerminal = useCallback(async (cols: number, rows: number) => {
    setDraftConnection((current) => {
      if (current.cols === cols && current.rows === rows) {
        return current
      }

      return { ...current, cols, rows }
    })

    const sessionId = activeSessionIdRef.current
    if (!sessionId || sessionStatusRef.current !== 'connected') {
      return
    }

    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      return
    }

    try {
      await tauriCore.invoke('resize_session', {
        sessionId,
        cols,
        rows,
      })
    } catch (error) {
      const errorMessage = String(error)

      if (errorMessage.includes('session not found') || errorMessage.includes('channel closed')) {
        return
      }

      return
    }
  }, [])

  const nextStep = useCallback(() => {
    setActiveStep((current) => {
      switch (current) {
        case 'search': return 'ip'
        case 'ip': return 'user'
        case 'user': return 'password'
        case 'password': return 'connecting'
        default: return current
      }
    })
  }, [])

  const prevStep = useCallback(() => {
    setActiveStep((current) => {
      switch (current) {
        case 'ip': return 'search'
        case 'user': return 'ip'
        case 'password': return 'user'
        case 'connecting': return 'password'
        case 'connected': return 'password'
        default: return current
      }
    })
  }, [])

  const resetWizard = useCallback(() => {
    attemptRef.current += 1
    void closeActiveSession()
    clearConnectionTimeout()
    resetBufferedTerminalOutput()
    setActiveStep('search')
    setDraftConnection({ port: 22, cols: 120, rows: 34, privateKeyPem: '' })
    setSessions([])
    setActiveSessionId(null)
    setSessionStatus('idle')
    setSessionMessage('ready')
    setSessionError(null)
    setTerminalOutput([])
    connectionStartedAtRef.current = null
  }, [clearConnectionTimeout, closeActiveSession, resetBufferedTerminalOutput])

  useEffect(() => {
    return () => {
      attemptRef.current += 1
      resetBufferedTerminalOutput()
      void closeActiveSession()
    }
  }, [closeActiveSession, resetBufferedTerminalOutput])

  return {
    activeStep,
    draftConnection,
    sessions,
    activeSessionId,
    sessionStatus,
    sessionMessage,
    sessionError,
    terminalOutput,
    updateDraft,
    nextStep,
    prevStep,
    connect,
    sendTerminalInput,
    resizeTerminal,
    closeActiveSession,
    resetWizard,
    setActiveStep,
    setSessions,
    setActiveSessionId
  }
}
