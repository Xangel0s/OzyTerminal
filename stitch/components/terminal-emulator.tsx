'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const mockCommands: Record<string, string> = {
  ls: 'app\nbin\nconfig\ndata\nlib\nscripts\nutils',
  pwd: '/home/admin/workspace',
  'ls -la': 'drwxr-xr-x  10 admin  admin  4096 Mar  8 10:45 .\ndrwxr-xr-x  15 root   root   4096 Mar  1 14:23 ..\n-rw-r--r--   1 admin  admin   124 Mar  8 09:12 .gitignore\ndrwxr-xr-x   3 admin  admin  4096 Mar  8 10:45 src',
  help: 'Available commands:\n  ls       - List directory contents\n  pwd      - Print working directory\n  clear    - Clear terminal\n  help     - Show this help message',
  whoami: 'admin',
  date: new Date().toISOString(),
  clear: '',
}

export function TerminalEmulator({ title = 'Terminal', defaultLines }: TerminalEmulatorProps) {
  const [lines, setLines] = useState<TerminalLine[]>(
    defaultLines || [
      {
        type: 'output',
        content: 'Welcome to AdminTerminal - Server Management Console',
        timestamp: new Date(),
      },
      {
        type: 'output',
        content: 'Type "help" for available commands',
        timestamp: new Date(),
      },
    ]
  )
  const [input, setInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [lines])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const executeCommand = (command: string) => {
    const trimmed = command.trim()

    // Add command to terminal
    setLines((prev) => [
      ...prev,
      {
        type: 'command',
        content: `$ ${trimmed}`,
        timestamp: new Date(),
      },
    ])

    if (trimmed === 'clear') {
      setLines([])
    } else if (trimmed in mockCommands) {
      const output = mockCommands[trimmed as keyof typeof mockCommands]
      if (output) {
        setLines((prev) => [
          ...prev,
          {
            type: 'output',
            content: output,
            timestamp: new Date(),
          },
        ])
      }
    } else if (trimmed) {
      setLines((prev) => [
        ...prev,
        {
          type: 'error',
          content: `Command not found: ${trimmed}`,
          timestamp: new Date(),
        },
      ])
    }

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
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-secondary">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <div className="w-3 h-3 rounded-full bg-green-500" />
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
            <Copy className="w-4 h-4" />
          </Button>
          {!isFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsFullscreen(true)}
              title="Fullscreen"
            >
              <Maximize2 className="w-4 h-4" />
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
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Terminal Content */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto p-4 font-mono text-sm bg-input text-foreground"
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

      {/* Input */}
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
      <div className="fixed inset-0 bg-input z-50 flex flex-col rounded-lg overflow-hidden border border-border">
        {terminalContent}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-input rounded-lg border border-border overflow-hidden">
      {terminalContent}
    </div>
  )
}
