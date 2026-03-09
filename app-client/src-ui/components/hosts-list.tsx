'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Server,
  MoreVertical,
  Circle,
  Edit2,
  Trash2,
  Copy,
} from 'lucide-react'

interface ServerHost {
  id: string
  name: string
  address: string
  port: number
  user: string
  status: 'online' | 'offline' | 'connecting'
  lastConnected: string
}

const mockServers: ServerHost[] = [
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
  {
    id: '4',
    name: 'Production',
    address: 'prod.example.com',
    port: 22,
    user: 'ubuntu',
    status: 'online',
    lastConnected: 'Just now',
  },
]

export function HostsList() {
  const [servers, setServers] = useState<ServerHost[]>(mockServers)

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
      <div className="grid grid-cols-1 gap-4">
        {servers.map((server) => (
          <div
            key={server.id}
            className="bg-card border border-border rounded-lg p-4 hover:bg-secondary transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                {/* Server Icon */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Server className="w-5 h-5 text-accent" />
                  </div>
                </div>

                {/* Server Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
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
                    <p>
                      <span className="text-xs">
                        Last connected: {server.lastConnected}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={server.status !== 'online'}
                  className="text-accent hover:text-accent"
                >
                  Connect
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
        ))}
      </div>
    </div>
  )
}
