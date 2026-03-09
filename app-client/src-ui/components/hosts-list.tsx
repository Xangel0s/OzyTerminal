'use client'

import { Button } from '@/components/ui/button'
import {
  OperatingSystemIcon,
  getOperatingSystemConfig,
  inferHostOperatingSystem,
  type HostOperatingSystem,
} from '@/components/os-icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  MoreVertical,
  Circle,
  Edit2,
  Trash2,
  Copy,
  Server,
} from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { SshSessionRequest, VaultEntry } from '@/lib/types'

interface ServerHost {
  id: string
  name: string
  address: string
  port: number
  user: string
  os?: HostOperatingSystem
  status: 'online' | 'offline' | 'connecting'
  lastConnected: string
}

function mapVaultEntryToServerHost(entry: VaultEntry): ServerHost {
  return {
    id: entry.id,
    name: entry.name,
    address: entry.host,
    port: entry.port,
    user: entry.username,
    os: inferHostOperatingSystem({
      name: entry.name,
      address: entry.host,
      user: entry.username,
    }),
    status: 'online',
    lastConnected: 'Saved automatically',
  }
}

interface HostsListProps {
  viewMode?: 'grid' | 'list'
  onOpenConnection?: (request: Partial<SshSessionRequest>) => void
}

function buildConnectionPreset(entry: VaultEntry): Partial<SshSessionRequest> {
  return {
    profileName: entry.name,
    host: entry.host,
    port: entry.port,
    username: entry.username,
    password: entry.password,
    privateKeyPem: entry.privateKeyPem,
    privateKeyPassphrase: entry.privateKeyPassphrase,
    certificatePem: entry.certificatePem,
    knownHostFingerprint: entry.knownHostFingerprint,
    relayHint: entry.relayHint,
    controlPlane: entry.controlPlane,
    cols: 120,
    rows: 34,
  }
}

export function HostsList({ viewMode = 'list', onOpenConnection }: HostsListProps) {
  const { servers: savedServers, isLoading } = useServers()
  const servers = savedServers.map(mapVaultEntryToServerHost)

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[0, 1].map((item) => (
          <div key={item} className="rounded-lg border border-border bg-card p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-40 rounded bg-secondary" />
              <div className="h-4 w-64 rounded bg-secondary/80" />
              <div className="h-4 w-36 rounded bg-secondary/80" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card/70 p-10">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <Server className="h-8 w-8" />
          </div>
          <h3 className="text-xl font-semibold text-foreground">No hosts configured yet</h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Save your first SSH host to start sessions, browse SFTP, and reuse the local test target already prepared for this environment.
          </p>
          <div className="mt-6 rounded-xl border border-border bg-background/70 px-4 py-3 text-left text-sm text-muted-foreground">
            Suggested first target: Lenovo@127.0.0.1:2222 using the private key from .manual-ssh/client_ed25519.
          </div>
        </div>
      </div>
    )
  }

  const getStatusColor = (status: ServerHost['status']) => {
    switch (status) {
      case 'online':
        return 'bg-green-500'
      case 'offline':
        return 'bg-gray-500'
      case 'connecting':
        return 'bg-yellow-500'
    }
  }

  const getStatusLabel = (status: ServerHost['status']) => {
    switch (status) {
      case 'online':
        return 'Online'
      case 'offline':
        return 'Offline'
      case 'connecting':
        return 'Connecting...'
    }
  }

  return (
    <div className="space-y-4">
      <div className={viewMode === 'grid' ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3' : 'grid grid-cols-1 gap-4'}>
        {servers.map((server) => (
          (() => {
            const sourceEntry = savedServers.find((entry) => entry.id === server.id)
            const detectedOs = inferHostOperatingSystem({
              name: server.name,
              address: server.address,
              user: server.user,
              os: server.os,
            })
            const osConfig = getOperatingSystemConfig(detectedOs)
            const hasSavedAuth = Boolean(sourceEntry?.password?.trim() || sourceEntry?.privateKeyPem?.trim())
            const canOpenConnection = server.status === 'online' && Boolean(sourceEntry) && Boolean(onOpenConnection)

            const handleOpenConnection = () => {
              if (!sourceEntry || !onOpenConnection) {
                return
              }

              onOpenConnection(buildConnectionPreset(sourceEntry))
            }

            return (
          <div
            key={server.id}
            role={canOpenConnection ? 'button' : undefined}
            tabIndex={canOpenConnection ? 0 : undefined}
            onDoubleClick={canOpenConnection ? handleOpenConnection : undefined}
            onKeyDown={canOpenConnection ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleOpenConnection()
              }
            } : undefined}
            className={`bg-card border border-border rounded-lg p-4 hover:bg-secondary transition-colors ${
              viewMode === 'grid' ? 'min-h-64' : ''
            } ${canOpenConnection ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/60' : ''}`}
          >
            <div className={`flex justify-between gap-4 ${viewMode === 'grid' ? 'h-full flex-col' : 'items-start'}`}>
              <div className={`flex flex-1 gap-4 ${viewMode === 'grid' ? 'flex-col' : 'items-start'}`}>
                <div className="flex-shrink-0">
                  <OperatingSystemIcon
                    os={detectedOs}
                    className={viewMode === 'grid' ? 'h-7 w-7' : 'h-5 w-5'}
                    containerClassName={viewMode === 'grid' ? 'h-14 w-14 rounded-2xl' : 'h-10 w-10 rounded-lg'}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`mb-2 flex gap-2 ${viewMode === 'grid' ? 'flex-col items-start' : 'items-center'}`}>
                    <h3 className="font-semibold text-foreground truncate">
                      {server.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <Circle
                        className={`w-2 h-2 ${getStatusColor(server.status)}`}
                        fill="currentColor"
                      />
                      <span className="text-xs text-muted-foreground">
                        {getStatusLabel(server.status)}
                      </span>
                    </div>
                  </div>

                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>
                      <span className="font-medium">Address:</span> {server.address}:{server.port}
                    </p>
                    <p>
                      <span className="font-medium">User:</span> {server.user}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">System:</span>
                      <span className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-medium ${osConfig.surfaceClassName} ${osConfig.iconClassName}`}>
                        <OperatingSystemIcon
                          os={detectedOs}
                          className="h-3.5 w-3.5"
                          containerClassName="h-5 w-5 rounded-full bg-transparent"
                        />
                        {osConfig.label}
                      </span>
                    </div>
                    <p>
                      <span className="text-xs">
                        Last connected: {server.lastConnected}
                      </span>
                    </p>
                    {canOpenConnection && hasSavedAuth ? (
                      <p className="pt-1 text-xs text-accent/90">
                        Doble click para abrir la sesion SSH guardada.
                      </p>
                    ) : canOpenConnection ? (
                      <p className="pt-1 text-xs text-muted-foreground">
                        Falta una credencial guardada para abrir en un clic.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={`flex gap-2 flex-shrink-0 ${viewMode === 'grid' ? 'mt-auto items-center justify-between' : 'items-center'}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canOpenConnection}
                  onClick={handleOpenConnection}
                  className="text-accent hover:text-accent"
                >
                  {hasSavedAuth ? 'Connect' : 'Open'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Details
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
            )
          })()
        ))}
      </div>
    </div>
  )
}
