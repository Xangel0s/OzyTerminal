'use client'

import { Button } from '@/components/ui/button'
import { Clock, Trash2, Download, Filter } from 'lucide-react'
import { useState } from 'react'
import { BsActivity } from 'react-icons/bs'
import { HiOutlineStatusOnline } from 'react-icons/hi'
import { MdErrorOutline, MdInfoOutline, MdWarningAmber } from 'react-icons/md'
import type { IconType } from 'react-icons'
import { useActivityLogs } from '@/hooks/useActivityLogs'
import type { ActivityLogEntry } from '@/lib/types'

const levelColors = {
  info: 'text-blue-400 bg-blue-500/10',
  warning: 'text-yellow-400 bg-yellow-500/10',
  error: 'text-red-400 bg-red-500/10',
  success: 'text-green-400 bg-green-500/10',
}

const levelLabels = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  success: 'Success',
}

const levelIcons: Record<'info' | 'warning' | 'error' | 'success', IconType> = {
  info: MdInfoOutline,
  warning: MdWarningAmber,
  error: MdErrorOutline,
  success: HiOutlineStatusOnline,
}

export default function LogsPage() {
  const { logs, clearLogs, error } = useActivityLogs()
  const [filterLevel, setFilterLevel] = useState<'all' | ActivityLogEntry['level']>('all')

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear all logs?')) {
      void clearLogs()
    }
  }

  const handleExportLogs = () => {
    const csv = [
      ['Timestamp', 'Level', 'Host', 'Action', 'Details'],
      ...logs.map((log) => [
        log.timestamp,
        log.level,
        log.host,
        log.action,
        log.details,
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${new Date().toISOString()}.csv`
    a.click()
  }

  const filteredLogs =
    filterLevel === 'all'
      ? logs
      : logs.filter((log) => log.level === filterLevel)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BsActivity className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Activity Logs</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLogs}
            className="hover:bg-accent/10"
            disabled={logs.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLogs}
            className="hover:bg-destructive/10"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-6 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className={filterLevel === 'all' ? 'bg-accent text-accent-foreground' : ''}
          onClick={() => setFilterLevel('all')}
        >
          <Filter className="w-4 h-4 mr-2" />
          All
        </Button>
        {(['info', 'warning', 'error', 'success'] as const).map((level) => (
          <Button
            key={level}
            variant="outline"
            size="sm"
            className={
              filterLevel === level
                ? `${levelColors[level]} border-current`
                : ''
            }
            onClick={() => setFilterLevel(level)}
          >
            {levelLabels[level]}
          </Button>
        ))}
      </div>

      {filteredLogs.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <BsActivity className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-foreground font-medium mb-2">No logs found</p>
            <p className="text-muted-foreground text-sm">
              Your activity will appear here
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-auto">
          {filteredLogs.map((log) => {
            const LevelIcon = levelIcons[(log.level in levelIcons ? log.level : 'info') as keyof typeof levelIcons]

            return (
            <div
              key={log.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex flex-1 items-start gap-4">
                  <div className={`mt-1 flex h-11 w-11 items-center justify-center rounded-xl ${levelColors[log.level]}`}>
                    <LevelIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${levelColors[log.level]}`}
                    >
                      {levelLabels[log.level]}
                    </span>
                    <p className="text-sm font-mono text-muted-foreground">
                      {log.timestamp}
                    </p>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">
                    {log.action}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-1">
                    Host: {log.host}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {log.details}
                  </p>
                </div>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
