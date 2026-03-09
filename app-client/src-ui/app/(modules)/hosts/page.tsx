'use client'

import { Button } from '@/components/ui/button'
import { Server, Plus, Trash2, Edit } from 'lucide-react'
import { useState } from 'react'

interface Host {
  id: string
  name: string
  address: string
  port: number
  status: 'online' | 'offline' | 'connecting'
  type: 'ssh' | 'sftp' | 'telnet'
}

const mockHosts: Host[] = [
  {
    id: '1',
    name: 'Production Server',
    address: '192.168.1.100',
    port: 22,
    status: 'online',
    type: 'ssh',
  },
  {
    id: '2',
    name: 'Development Server',
    address: '192.168.1.101',
    port: 22,
    status: 'online',
    type: 'ssh',
  },
  {
    id: '3',
    name: 'Backup Server',
    address: '192.168.1.102',
    port: 22,
    status: 'offline',
    type: 'ssh',
  },
]

const statusColors = {
  online: 'bg-green-500/20 text-green-400',
  offline: 'bg-red-500/20 text-red-400',
  connecting: 'bg-yellow-500/20 text-yellow-400',
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[]>(mockHosts)

  const handleDelete = (id: string) => {
    setHosts(hosts.filter((host) => host.id !== id))
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Hosts</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Add Host
        </Button>
      </div>

      {hosts.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">No hosts configured</p>
            <p className="text-muted-foreground text-sm">
              Add your first host to get started
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {hosts.map((host) => (
            <div
              key={host.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {host.name}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${statusColors[host.status]}`}
                    >
                      {host.status.charAt(0).toUpperCase() + host.status.slice(1)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>
                      <span className="text-foreground font-medium">Address:</span>{' '}
                      {host.address}:{host.port}
                    </p>
                    <p>
                      <span className="text-foreground font-medium">Type:</span>{' '}
                      {host.type.toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-destructive/10"
                    onClick={() => handleDelete(host.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
