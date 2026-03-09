'use client'

import { Button } from '@/components/ui/button'
import { Shield, Plus, Trash2, Copy } from 'lucide-react'
import { useState } from 'react'

interface KnownHost {
  id: string
  hostname: string
  ipAddress: string
  keyType: string
  fingerprint: string
  addedDate: string
}

const mockKnownHosts: KnownHost[] = [
  {
    id: '1',
    hostname: 'prod-server.example.com',
    ipAddress: '203.0.113.42',
    keyType: 'RSA 2048',
    fingerprint: 'SHA256:abcd1234efgh5678ijkl9012mnop3456',
    addedDate: '2024-01-15',
  },
  {
    id: '2',
    hostname: 'dev-server.example.com',
    ipAddress: '198.51.100.15',
    keyType: 'RSA 2048',
    fingerprint: 'SHA256:qrst7890uvwx1234yzab5678cdef9012',
    addedDate: '2024-01-10',
  },
  {
    id: '3',
    hostname: 'backup-server.example.com',
    ipAddress: '192.0.2.88',
    keyType: 'ED25519',
    fingerprint: 'SHA256:ghij3456klmn7890opqr1234stuv5678',
    addedDate: '2024-01-05',
  },
]

export default function KnownHostsPage() {
  const [hosts, setHosts] = useState<KnownHost[]>(mockKnownHosts)

  const handleDelete = (id: string) => {
    setHosts(hosts.filter((h) => h.id !== id))
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Known Hosts</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Add Host
        </Button>
      </div>

      {hosts.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">
              No known hosts registered
            </p>
            <p className="text-muted-foreground text-sm">
              Add SSH host keys to your known hosts database
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
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {host.hostname}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    IP: {host.ipAddress} • Type: {host.keyType}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                    onClick={() => handleCopy(host.fingerprint)}
                  >
                    <Copy className="w-4 h-4" />
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

              <div className="bg-input rounded p-3 mb-3 overflow-x-auto">
                <p className="text-xs font-mono text-muted-foreground mb-1">
                  Fingerprint:
                </p>
                <code className="text-xs font-mono text-foreground break-all">
                  {host.fingerprint}
                </code>
              </div>

              <p className="text-xs text-muted-foreground">
                Added: {host.addedDate}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
