import { useState, useCallback } from 'react'
import { ServerHost } from '@/lib/types'

const initialServers: ServerHost[] = [
  {
    id: '1',
    name: 'Servidor Principal',
    address: '192.168.1.100',
    port: 22,
    user: 'admin',
    status: 'online',
    lastConnected: '2 minutes ago',
  },
  {
    id: '2',
    name: 'Backup Server',
    address: '192.168.1.101',
    port: 22,
    user: 'admin',
    status: 'online',
    lastConnected: '1 hour ago',
  },
  {
    id: '3',
    name: 'Dev Environment',
    address: '192.168.1.102',
    port: 2222,
    user: 'developer',
    status: 'offline',
    lastConnected: '3 days ago',
  },
]

export function useServers() {
  const [servers, setServers] = useState<ServerHost[]>(initialServers)
  const [activeServer, setActiveServer] = useState<ServerHost | null>(
    servers[0]
  )

  const addServer = useCallback((server: ServerHost) => {
    setServers((prev) => [...prev, server])
  }, [])

  const removeServer = useCallback((serverId: string) => {
    setServers((prev) => prev.filter((s) => s.id !== serverId))
    if (activeServer?.id === serverId) {
      setActiveServer(null)
    }
  }, [activeServer])

  const updateServer = useCallback((serverId: string, updates: Partial<ServerHost>) => {
    setServers((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, ...updates } : s))
    )
    if (activeServer?.id === serverId) {
      setActiveServer((prev) => prev ? { ...prev, ...updates } : null)
    }
  }, [activeServer])

  const connectToServer = useCallback((serverId: string) => {
    const server = servers.find((s) => s.id === serverId)
    if (server) {
      setActiveServer(server)
      updateServer(serverId, { lastConnected: 'Just now' })
    }
  }, [servers, updateServer])

  return {
    servers,
    activeServer,
    addServer,
    removeServer,
    updateServer,
    connectToServer,
    setActiveServer,
  }
}
