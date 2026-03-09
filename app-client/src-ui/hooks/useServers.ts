import { useState, useCallback, useEffect } from 'react'
import { VaultEntry, LocalVaultResponse, KnownHostEntry } from '@/lib/types'

const LOCAL_VAULT_STORAGE_KEY = 'ozyterminal.local-vault'

type PersistedLocalVault = Pick<LocalVaultResponse, 'entries' | 'knownHosts'>

let memoryVaultCache: PersistedLocalVault | null = null

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function loadTauriCore() {
  if (!isTauriRuntimeAvailable()) {
    return null
  }

  return import('@tauri-apps/api/core')
}

function readLocalVaultFallback(): PersistedLocalVault {
  if (typeof window === 'undefined') {
    return { entries: [], knownHosts: [] }
  }

  try {
    const rawValue = window.localStorage.getItem(LOCAL_VAULT_STORAGE_KEY)
    if (!rawValue) {
      return { entries: [], knownHosts: [] }
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedLocalVault>
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      knownHosts: Array.isArray(parsed.knownHosts) ? parsed.knownHosts : [],
    }
  } catch {
    return { entries: [], knownHosts: [] }
  }
}

function updateVaultCache(vault: PersistedLocalVault) {
  memoryVaultCache = vault
  writeLocalVaultFallback(vault)
}

function getCachedVaultSnapshot(): PersistedLocalVault {
  if (memoryVaultCache) {
    return memoryVaultCache
  }

  const fallback = readLocalVaultFallback()
  memoryVaultCache = fallback
  return fallback
}

function hasCachedVaultSnapshot() {
  if (memoryVaultCache) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(LOCAL_VAULT_STORAGE_KEY) !== null
}

function writeLocalVaultFallback(vault: PersistedLocalVault) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LOCAL_VAULT_STORAGE_KEY, JSON.stringify(vault))
}

async function loadVaultSnapshot(): Promise<PersistedLocalVault> {
  const tauriCore = await loadTauriCore()

  if (!tauriCore) {
    return getCachedVaultSnapshot()
  }

  const response = await tauriCore.invoke<LocalVaultResponse>('load_local_vault', {
    request: {
      masterPassword: '',
    },
  })

  const snapshot = {
    entries: response.entries,
    knownHosts: response.knownHosts,
  }

  updateVaultCache(snapshot)

  return snapshot
}

async function persistVaultSnapshot(vault: PersistedLocalVault) {
  const tauriCore = await loadTauriCore()

  if (!tauriCore) {
    updateVaultCache(vault)
    return
  }

  const response = await tauriCore.invoke<LocalVaultResponse>('save_local_vault', {
    request: {
      masterPassword: '',
      entries: vault.entries,
      knownHosts: vault.knownHosts,
    },
  })

  updateVaultCache({
    entries: response.entries,
    knownHosts: response.knownHosts,
  })
}

function mergeServerEntry(entries: VaultEntry[], server: VaultEntry) {
  const existingIndex = entries.findIndex(
    (entry) =>
      entry.host === server.host &&
      entry.port === server.port &&
      entry.username === server.username,
  )

  if (existingIndex === -1) {
    return [server, ...entries]
  }

  const nextEntries = [...entries]
  nextEntries[existingIndex] = {
    ...nextEntries[existingIndex],
    ...server,
    id: nextEntries[existingIndex].id,
  }

  const [updatedEntry] = nextEntries.splice(existingIndex, 1)
  return [updatedEntry, ...nextEntries]
}

function mergeKnownHostEntry(entries: KnownHostEntry[], knownHost: KnownHostEntry) {
  const existingIndex = entries.findIndex(
    (entry) => entry.host === knownHost.host && entry.port === knownHost.port,
  )

  if (existingIndex === -1) {
    return [knownHost, ...entries]
  }

  const nextEntries = [...entries]
  nextEntries[existingIndex] = {
    ...nextEntries[existingIndex],
    ...knownHost,
  }

  const [updatedEntry] = nextEntries.splice(existingIndex, 1)
  return [updatedEntry, ...nextEntries]
}

export async function upsertServerEntry(server: VaultEntry) {
  const vault = await loadVaultSnapshot()
  const entries = mergeServerEntry(vault.entries, server)
  await persistVaultSnapshot({
    entries,
    knownHosts: vault.knownHosts,
  })

  return (
    entries.find(
      (entry) =>
        entry.host === server.host &&
        entry.port === server.port &&
        entry.username === server.username,
    ) ?? null
  )
}

export function useServers() {
  const [servers, setServers] = useState<VaultEntry[]>([])
  const [activeServer, setActiveServer] = useState<VaultEntry | null>(null)
  const [knownHosts, setKnownHosts] = useState<LocalVaultResponse['knownHosts']>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadVault = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true)
    }

    setError(null)
    try {
      const vault = await loadVaultSnapshot()
      setServers(vault.entries)
      setKnownHosts(vault.knownHosts)
    } catch (err) {
      console.error('Failed to load vault:', err)
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const hasClientCache = typeof window !== 'undefined' && hasCachedVaultSnapshot()

    if (hasClientCache) {
      const cachedVault = getCachedVaultSnapshot()
      setServers(cachedVault.entries)
      setKnownHosts(cachedVault.knownHosts)
      setIsLoading(false)
    }

    void loadVault({ silent: hasClientCache })
  }, [loadVault])

  const persistVault = useCallback(
    async (entries: VaultEntry[], nextKnownHosts: LocalVaultResponse['knownHosts'] = knownHosts) => {
      await persistVaultSnapshot({ entries, knownHosts: nextKnownHosts })

      setServers(entries)
      setKnownHosts(nextKnownHosts)
    },
    [knownHosts],
  )

  const addServer = useCallback(async (server: VaultEntry) => {
    try {
      const nextEntries = mergeServerEntry(servers, server)
      await persistVault(nextEntries)
    } catch (err) {
      console.error('Failed to add server:', err)
    }
  }, [servers, persistVault])

  const removeServer = useCallback(async (serverId: string) => {
    try {
      const updated = servers.filter((s) => s.id !== serverId)
      await persistVault(updated)
      if (activeServer?.id === serverId) {
        setActiveServer(null)
      }
    } catch (err) {
      console.error('Failed to remove server:', err)
    }
  }, [servers, activeServer, persistVault])

  const upsertServer = useCallback(async (server: VaultEntry) => {
    try {
      const nextEntries = mergeServerEntry(servers, server)
      await persistVault(nextEntries)
      const activeEntry = nextEntries.find((entry) => entry.host === server.host && entry.port === server.port && entry.username === server.username) ?? null
      setActiveServer(activeEntry)
    } catch (err) {
      console.error('Failed to upsert server:', err)
    }
  }, [servers, persistVault])

  const connectToServer = useCallback((serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (server) {
      setActiveServer(server)
    }
  }, [servers])

  const upsertKnownHost = useCallback(async (knownHost: KnownHostEntry) => {
    try {
      const nextKnownHosts = mergeKnownHostEntry(knownHosts, knownHost)
      await persistVault(servers, nextKnownHosts)
    } catch (err) {
      console.error('Failed to upsert known host:', err)
    }
  }, [knownHosts, persistVault, servers])

  const removeKnownHost = useCallback(async (target: Pick<KnownHostEntry, 'host' | 'port' | 'fingerprintSha256'>) => {
    try {
      const nextKnownHosts = knownHosts.filter(
        (entry) =>
          !(
            entry.host === target.host &&
            entry.port === target.port &&
            entry.fingerprintSha256 === target.fingerprintSha256
          ),
      )
      await persistVault(servers, nextKnownHosts)
    } catch (err) {
      console.error('Failed to remove known host:', err)
    }
  }, [knownHosts, persistVault, servers])

  return {
    servers,
    activeServer,
    knownHosts,
    isLoading,
    error,
    addServer,
    upsertServer,
    removeServer,
    upsertKnownHost,
    removeKnownHost,
    connectToServer,
    setActiveServer,
    refresh: loadVault
  }
}
