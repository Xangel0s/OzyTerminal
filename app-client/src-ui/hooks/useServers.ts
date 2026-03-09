import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VaultEntry, LocalVaultResponse } from '@/lib/types'

export function useServers() {
  const [servers, setServers] = useState<VaultEntry[]>([])
  const [activeServer, setActiveServer] = useState<VaultEntry | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadVault = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await invoke<LocalVaultResponse>('load_local_vault', {
        password: '', // Default or session-based password handling
      })
      setServers(response.entries)
    } catch (err) {
      console.error('Failed to load vault:', err)
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVault()
  }, [loadVault])

  const addServer = useCallback(async (server: VaultEntry) => {
    try {
      await invoke('save_local_vault', {
        password: '',
        entries: [...servers, server],
        knownHosts: []
      })
      await loadVault()
    } catch (err) {
      console.error('Failed to add server:', err)
    }
  }, [servers, loadVault])

  const removeServer = useCallback(async (serverId: string) => {
    try {
      const updated = servers.filter((s) => s.id !== serverId)
      await invoke('save_local_vault', {
        password: '',
        entries: updated,
        knownHosts: []
      })
      await loadVault()
      if (activeServer?.id === serverId) {
        setActiveServer(null)
      }
    } catch (err) {
      console.error('Failed to remove server:', err)
    }
  }, [servers, activeServer, loadVault])

  const connectToServer = useCallback((serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (server) {
      setActiveServer(server)
    }
  }, [servers])

  return {
    servers,
    activeServer,
    isLoading,
    error,
    addServer,
    removeServer,
    connectToServer,
    setActiveServer,
    refresh: loadVault
  }
}
