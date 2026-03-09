'use client'

import { useCallback, useEffect, useState } from 'react'
import { ActivityLogEntry, ActivityLogsResponse } from '@/lib/types'

type ActivityLogCache = {
  limit: number
  response: ActivityLogsResponse
}

let memoryActivityLogsCache: ActivityLogCache | null = null

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function loadTauriCore() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return import('@tauri-apps/api/core')
}

function getCachedActivityLogs(limit: number) {
  if (!memoryActivityLogsCache || memoryActivityLogsCache.limit !== limit) {
    return null
  }

  return memoryActivityLogsCache.response
}

function updateActivityLogsCache(limit: number, response: ActivityLogsResponse) {
  memoryActivityLogsCache = {
    limit,
    response,
  }
}

export function useActivityLogs(limit = 250) {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true)
    }

    try {
      const tauriCore = await loadTauriCore()
      if (!tauriCore) {
        setLogs(getCachedActivityLogs(limit)?.entries ?? [])
        setError('Tauri runtime is not available.')
        return
      }

      const response = await tauriCore.invoke<ActivityLogsResponse>('list_activity_logs_command', {
        limit,
      })
      updateActivityLogsCache(limit, response)
      setLogs(response.entries)
      setError(null)
    } catch (nextError) {
      console.error('Failed to load activity logs:', nextError)
      setError(String(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  useEffect(() => {
    const cachedLogs = getCachedActivityLogs(limit)

    if (cachedLogs) {
      setLogs(cachedLogs.entries)
      setIsLoading(false)
    }

    void refresh({ silent: Boolean(cachedLogs) })

    const intervalId = window.setInterval(() => {
      void refresh({ silent: true })
    }, 4000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refresh])

  const clearLogs = useCallback(async () => {
    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      setError('Tauri runtime is not available.')
      return
    }

    await tauriCore.invoke<ActivityLogsResponse>('clear_activity_logs_command')
    updateActivityLogsCache(limit, { entries: [] })
    setLogs([])
    setError(null)
  }, [limit])

  return {
    logs,
    isLoading,
    error,
    refresh,
    clearLogs,
  }
}