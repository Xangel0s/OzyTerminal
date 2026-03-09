'use client'

import { Button } from '@/components/ui/button'
import { Clock, Trash2, Download, Filter } from 'lucide-react'
import { useState } from 'react'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success'
  host: string
  action: string
  details: string
}

const mockLogs: LogEntry[] = [
  {
    id: '1',
    timestamp: '2024-01-22 14:35:22',
    level: 'success',
    host: 'Production Server',
    action: 'SSH Connection',
    details: 'Successfully connected to prod-server via SSH',
  },
  {
    id: '2',
    timestamp: '2024-01-22 14:28:45',
    level: 'info',
    host: 'Development Server',
    action: 'File Transfer',
    details: 'Uploaded 3 files via SFTP (125.4 MB)',
  },
  {
    id: '3',
    timestamp: '2024-01-22 14:15:10',
    level: 'warning',
    host: 'Backup Server',
    action: 'Connection Timeout',
    details: 'Connection attempt timed out after 30 seconds',
  },
  {
    id: '4',
    timestamp: '2024-01-22 13:52:33',
    level: 'error',
    host: 'Production Server',
    action: 'Authentication Failed',
    details: 'SSH key verification failed - invalid fingerprint',
  },
  {
    id: '5',
    timestamp: '2024-01-22 13:45:12',
    level: 'success',
    host: 'Development Server',
    action: 'Port Forward',
    details: 'Port forwarding tunnel established (localhost:5432)',
  },
]

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

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(mockLogs)
  const [filterLevel, setFilterLevel] = useState<'all' | LogEntry['level']>('all')

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear all logs?')) {
      setLogs([])
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
          <Clock className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Activity Logs</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLogs}
            className="hover:bg-accent/10"
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
            <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">No logs found</p>
            <p className="text-muted-foreground text-sm">
              Your activity will appear here
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-auto">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
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
          ))}
        </div>
      )}
    </div>
  )
}
