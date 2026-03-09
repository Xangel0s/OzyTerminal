'use client'

import { useEffect, useRef } from 'react'

function logTerminalLifecycle(message: string, details?: Record<string, unknown>) {
  console.info('[ssh-terminal]', message, details ?? {})
}

interface LiveSshTerminalProps {
  chunks: string[]
  sessionStatus: 'idle' | 'connecting' | 'connected' | 'closed' | 'error'
  onData: (value: string) => void
  onResize: (cols: number, rows: number) => void
}

export function LiveSshTerminal({ chunks, sessionStatus, onData, onResize }: LiveSshTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<{
    focus: () => void
    dispose: () => void
    write: (value: string) => void
    reset: () => void
    loadAddon: (addon: unknown) => void
    cols: number
    rows: number
    options: { disableStdin: boolean }
    onData: (callback: (value: string) => void) => { dispose: () => void }
  } | null>(null)
  const chunkIndexRef = useRef(0)
  const resizeFrameRef = useRef<number | null>(null)
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const fitAddonRef = useRef<{ fit: () => void } | null>(null)
  const sessionStatusRef = useRef(sessionStatus)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const terminalDisposedRef = useRef(false)

  useEffect(() => {
    sessionStatusRef.current = sessionStatus
    onDataRef.current = onData
    onResizeRef.current = onResize
  }, [onData, onResize, sessionStatus])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    let isCancelled = false
    let resizeObserver: ResizeObserver | null = null
    let dataDisposable: { dispose: () => void } | null = null
    let fitAddon: { fit: () => void } | null = null
    let localTerminal: { dispose: () => void } | null = null

    const initializeTerminal = async () => {
      logTerminalLifecycle('initializing terminal', { sessionStatus: sessionStatusRef.current })

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])

      if (isCancelled || !containerRef.current) {
        logTerminalLifecycle('initialization cancelled before terminal creation')
        return
      }

      const terminal = new Terminal({
        allowProposedApi: false,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: 'Geist Mono, Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        scrollback: 10000,
        theme: {
          background: '#061017',
          foreground: '#d7f3f3',
          cursor: '#f59e0b',
          cursorAccent: '#061017',
          selectionBackground: 'rgba(245, 158, 11, 0.28)',
          black: '#061017',
          red: '#f87171',
          green: '#34d399',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#e5f3f2',
          brightBlack: '#5b7680',
          brightRed: '#fca5a5',
          brightGreen: '#6ee7b7',
          brightYellow: '#fcd34d',
          brightBlue: '#93c5fd',
          brightMagenta: '#d8b4fe',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
      })
      localTerminal = terminal
      terminalDisposedRef.current = false

      fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      terminal.loadAddon(fitAddon)

      if (process.env.NODE_ENV === 'production') {
        try {
          const { WebglAddon } = await import('@xterm/addon-webgl')
          if (!isCancelled) {
            terminal.loadAddon(new WebglAddon())
            logTerminalLifecycle('webgl addon enabled')
          }
        } catch (error) {
          console.warn('[ssh-terminal] failed to enable webgl addon', error)
        }
      } else {
        logTerminalLifecycle('webgl addon skipped in development')
      }

      terminal.open(containerRef.current)
      terminalRef.current = terminal
      logTerminalLifecycle('terminal ready')

      const emitResize = () => {
        fitAddon?.fit()
        const nextSize = { cols: terminal.cols, rows: terminal.rows }
        const lastSize = lastSizeRef.current

        if (!lastSize || lastSize.cols !== nextSize.cols || lastSize.rows !== nextSize.rows) {
          lastSizeRef.current = nextSize
          onResizeRef.current(nextSize.cols, nextSize.rows)
        }
      }

      const scheduleResize = () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current)
        }

        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null
          emitResize()
        })
      }

      emitResize()
      terminal.focus()

      dataDisposable = terminal.onData((value) => {
        if (sessionStatusRef.current === 'connected') {
          onDataRef.current(value)
        }
      })

      resizeObserver = new ResizeObserver(() => {
        scheduleResize()
      })
      resizeObserver.observe(containerRef.current)

      const handleWindowResize = () => {
        scheduleResize()
      }

      window.addEventListener('resize', handleWindowResize)

      return () => {
        window.removeEventListener('resize', handleWindowResize)
      }
    }

    let removeWindowResizeListener: (() => void) | undefined
    void initializeTerminal().then((cleanup) => {
      removeWindowResizeListener = cleanup
    })

    return () => {
      isCancelled = true
      logTerminalLifecycle('disposing terminal', {
        hasTerminal: Boolean(terminalRef.current ?? localTerminal),
      })
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      removeWindowResizeListener?.()
      resizeObserver?.disconnect()
      dataDisposable?.dispose()

      const terminal = terminalRef.current ?? localTerminal
      terminalRef.current = null
      localTerminal = null

      if (terminal && !terminalDisposedRef.current) {
        terminalDisposedRef.current = true
        try {
          terminal.dispose()
        } catch (error) {
          console.warn('[ssh-terminal] terminal dispose failed', error)
        }
      }

      chunkIndexRef.current = 0
      lastSizeRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.disableStdin = sessionStatus !== 'connected'

    if (sessionStatus === 'connected') {
      terminal.focus()
    }
  }, [sessionStatus])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    if (chunks.length < chunkIndexRef.current) {
      terminal.reset()
      chunkIndexRef.current = 0
    }

    for (let index = chunkIndexRef.current; index < chunks.length; index += 1) {
      terminal.write(chunks[index] ?? '')
    }

    chunkIndexRef.current = chunks.length

    const frame = requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      const nextSize = { cols: terminal.cols, rows: terminal.rows }
      const lastSize = lastSizeRef.current

      if (!lastSize || lastSize.cols !== nextSize.cols || lastSize.rows !== nextSize.rows) {
        lastSizeRef.current = nextSize
        onResizeRef.current(nextSize.cols, nextSize.rows)
      }
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [chunks])

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 w-full"
      onClick={() => terminalRef.current?.focus()}
    />
  )
}