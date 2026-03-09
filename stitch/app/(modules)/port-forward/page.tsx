'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, Plus, Trash2, Power } from 'lucide-react'
import { useState } from 'react'

interface PortForward {
  id: string
  name: string
  localPort: number
  remoteHost: string
  remotePort: number
  host: string
  isActive: boolean
}

const mockForwards: PortForward[] = [
  {
    id: '1',
    name: 'Database Access',
    localPort: 5432,
    remoteHost: '192.168.1.100',
    remotePort: 5432,
    host: 'Production Server',
    isActive: true,
  },
  {
    id: '2',
    name: 'Web Server',
    localPort: 8080,
    remoteHost: '192.168.1.101',
    remotePort: 80,
    host: 'Development Server',
    isActive: false,
  },
]

export default function PortForwardingPage() {
  const [forwards, setForwards] = useState<PortForward[]>(mockForwards)

  const handleDelete = (id: string) => {
    setForwards(forwards.filter((f) => f.id !== id))
  }

  const toggleActive = (id: string) => {
    setForwards(
      forwards.map((f) => (f.id === id ? { ...f, isActive: !f.isActive } : f))
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Port Forwarding</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Add Forward
        </Button>
      </div>

      {forwards.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <ArrowRight className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">
              No port forwards configured
            </p>
            <p className="text-muted-foreground text-sm">
              Create a port forward to tunnel traffic
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {forwards.map((forward) => (
            <div
              key={forward.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-semibold text-foreground">
                      {forward.name}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        forward.isActive
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {forward.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="bg-input rounded p-3 mb-3">
                    <div className="flex items-center justify-between text-sm font-mono">
                      <span>
                        <span className="text-muted-foreground">localhost:</span>
                        <span className="text-accent">{forward.localPort}</span>
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span>
                        <span className="text-muted-foreground">
                          {forward.remoteHost}:
                        </span>
                        <span className="text-accent">{forward.remotePort}</span>
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground font-medium">Host:</span>{' '}
                    {forward.host}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                    onClick={() => toggleActive(forward.id)}
                  >
                    <Power className={`w-4 h-4 ${forward.isActive ? 'text-green-400' : ''}`} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-destructive/10"
                    onClick={() => handleDelete(forward.id)}
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
