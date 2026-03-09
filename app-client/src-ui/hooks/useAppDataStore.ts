'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppDataResponse, KeychainEntry, PortForwardEntry, SnippetEntry } from '@/lib/types'

const APP_DATA_STORAGE_KEY = 'ozyterminal.app-data'

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function loadTauriCore() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return import('@tauri-apps/api/core')
}

const emptyState: AppDataResponse = {
  keychainEntries: [],
  snippets: [],
  portForwards: [],
  updatedAt: 0,
  storagePath: '',
}

let memoryAppDataCache: AppDataResponse | null = null

function readAppDataFallback(): AppDataResponse {
  if (typeof window === 'undefined') {
    return emptyState
  }

  try {
    const rawValue = window.localStorage.getItem(APP_DATA_STORAGE_KEY)
    if (!rawValue) {
      return emptyState
    }

    const parsed = JSON.parse(rawValue) as Partial<AppDataResponse>
    return {
      keychainEntries: Array.isArray(parsed.keychainEntries) ? parsed.keychainEntries : [],
      snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
      portForwards: Array.isArray(parsed.portForwards) ? parsed.portForwards : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      storagePath: typeof parsed.storagePath === 'string' ? parsed.storagePath : '',
    }
  } catch {
    return emptyState
  }
}

function writeAppDataFallback(data: AppDataResponse) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify(data))
}

function updateAppDataCache(data: AppDataResponse) {
  memoryAppDataCache = data
  writeAppDataFallback(data)
}

function getCachedAppDataSnapshot() {
  if (memoryAppDataCache) {
    return memoryAppDataCache
  }

  const fallback = readAppDataFallback()
  memoryAppDataCache = fallback
  return fallback
}

function hasCachedAppDataSnapshot() {
  if (memoryAppDataCache) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(APP_DATA_STORAGE_KEY) !== null
}

async function loadAppDataSnapshot() {
  const tauriCore = await loadTauriCore()

  if (!tauriCore) {
    return getCachedAppDataSnapshot()
  }

  const response = await tauriCore.invoke<AppDataResponse>('load_app_data_command')
  updateAppDataCache(response)
  return response
}

export function useAppDataStore() {
  const [data, setData] = useState<AppDataResponse>(emptyState)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true)
    }

    setError(null)

    try {
      const response = await loadAppDataSnapshot()
      setData(response)
    } catch (nextError) {
      console.error('Failed to load app data:', nextError)
      setError(String(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const hasClientCache = typeof window !== 'undefined' && hasCachedAppDataSnapshot()

    if (hasClientCache) {
      setData(getCachedAppDataSnapshot())
      setIsLoading(false)
    }

    void refresh({ silent: hasClientCache })
  }, [refresh])

  const saveKeychainEntries = useCallback(async (entries: KeychainEntry[]) => {
    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      const nextData = {
        ...data,
        keychainEntries: entries,
        updatedAt: Date.now(),
      }
      setData(nextData)
      updateAppDataCache(nextData)
      setError(null)
      return
    }

    const response = await tauriCore.invoke<AppDataResponse>('save_keychain_entries_command', {
      entries,
    })
    setData(response)
    updateAppDataCache(response)
    setError(null)
  }, [data])

  const saveSnippets = useCallback(async (entries: SnippetEntry[]) => {
    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      const nextData = {
        ...data,
        snippets: entries,
        updatedAt: Date.now(),
      }
      setData(nextData)
      updateAppDataCache(nextData)
      setError(null)
      return
    }

    const response = await tauriCore.invoke<AppDataResponse>('save_snippets_command', {
      entries,
    })
    setData(response)
    updateAppDataCache(response)
    setError(null)
  }, [data])

  const savePortForwards = useCallback(async (entries: PortForwardEntry[]) => {
    const tauriCore = await loadTauriCore()
    if (!tauriCore) {
      const nextData = {
        ...data,
        portForwards: entries,
        updatedAt: Date.now(),
      }
      setData(nextData)
      updateAppDataCache(nextData)
      setError(null)
      return
    }

    const response = await tauriCore.invoke<AppDataResponse>('save_port_forwards_command', {
      entries,
    })
    setData(response)
    updateAppDataCache(response)
    setError(null)
  }, [data])

  return {
    keychainEntries: data.keychainEntries,
    snippets: data.snippets,
    portForwards: data.portForwards,
    updatedAt: data.updatedAt,
    storagePath: data.storagePath,
    isLoading,
    error,
    refresh,
    saveKeychainEntries,
    saveSnippets,
    savePortForwards,
  }
}