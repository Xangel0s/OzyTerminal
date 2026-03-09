'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Maximize2, X } from 'lucide-react'

interface TerminalLine {
  type: 'command' | 'output' | 'error'
  content: string
  timestamp: Date
}

interface TerminalEmulatorProps {
  title?: string
  defaultLines?: TerminalLine[]
}

export function TerminalEmulator({ title = 'Terminal', defaultLines }: TerminalEmulatorProps) {
  const [lines, setLines] = useState<TerminalLine[]>(
    defaultLines || []
  )
  const [input, setInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const executeCommand = (command: string) => {
    const trimmed = command.trim()

    if (trimmed === 'clear') {
      setLines([])
      setInput('')
      return
    }

    if (!trimmed) {
      return
    }

    setLines((prev) => [
      ...prev,
      {
        type: 'command',
        content: `$ ${trimmed}`,
        timestamp: new Date(),
      },
      {
        type: 'error',
        content: 'No live shell is attached to this terminal. Open an active SSH session to execute commands.',
        timestamp: new Date(),
      },
    ])

    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(input)
    }
  }

  const copyOutput = () => {
    const output = lines
      .map((line) => `${line.type === 'command' ? '$ ' : ''}${line.content}`)
      .join('\n')
    navigator.clipboard.writeText(output)
  }

  const terminalContent = (
    <>
      <div className="flex items-center justify-between border-b border-border bg-secondary p-4">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <div className="h-3 w-3 rounded-full bg-yellow-500" />
          <div className="h-3 w-3 rounded-full bg-green-500" />
          <span className="ml-4 text-sm font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={copyOutput}
            title="Copy output"
          >
            <Copy className="h-4 w-4" />
          </Button>
          {!isFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsFullscreen(true)}
              title="Fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          {isFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsFullscreen(false)}
              title="Exit fullscreen"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={terminalRef}
        className="flex-1 overflow-auto bg-input p-4 font-mono text-sm text-foreground"
      >
        <div className="space-y-1">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className={
                line.type === 'error'
                  ? 'text-destructive'
                  : line.type === 'command'
                    ? 'text-accent'
                    : 'text-muted-foreground'
              }
            >
              {line.type === 'command' && <span className="text-accent">$ </span>}
              <span className="break-words whitespace-pre-wrap">{line.content}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-secondary p-4">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="text-accent">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-foreground outline-none"
            placeholder="Type a command..."
            autoComplete="off"
            spellCheck="false"
          />
        </div>
      </div>
    </>
  )

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-input">
        {terminalContent}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-input">
      {terminalContent}
    </div>
  )
}
