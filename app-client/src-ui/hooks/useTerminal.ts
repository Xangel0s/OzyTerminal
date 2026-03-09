import { useState, useCallback, useRef } from 'react'
import { TerminalLine } from '@/lib/types'

export function useTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      type: 'output',
      content: 'Welcome to OzyTerminal - Server Management Console',
      timestamp: new Date(),
    },
    {
      type: 'output',
      content: 'Type "help" for available commands',
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)

  const clearTerminal = useCallback(() => {
    setLines([])
  }, [])

  const addLine = useCallback((line: TerminalLine) => {
    setLines((prev) => [...prev, line])
  }, [])

  const addCommand = useCallback(
    (command: string) => {
      addLine({
        type: 'command',
        content: command,
        timestamp: new Date(),
      })
      setCommandHistory((prev) => [...prev, command])
      setHistoryIndex(-1)
    },
    [addLine]
  )

  const addOutput = useCallback(
    (output: string, type: 'output' | 'error' = 'output') => {
      addLine({
        type,
        content: output,
        timestamp: new Date(),
      })
    },
    [addLine]
  )

  const getPreviousCommand = useCallback(() => {
    if (historyIndex < commandHistory.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      return commandHistory[commandHistory.length - 1 - newIndex]
    }
    return ''
  }, [commandHistory, historyIndex])

  const getNextCommand = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      return commandHistory[commandHistory.length - 1 - newIndex]
    }
    setHistoryIndex(-1)
    return ''
  }, [commandHistory, historyIndex])

  return {
    lines,
    input,
    setInput,
    commandHistory,
    clearTerminal,
    addLine,
    addCommand,
    addOutput,
    getPreviousCommand,
    getNextCommand,
  }
}
