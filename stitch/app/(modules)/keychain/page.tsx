'use client'

import { Button } from '@/components/ui/button'
import { Key, Plus, Trash2, Copy, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

interface KeyEntry {
  id: string
  name: string
  type: 'ssh-key' | 'password' | 'token'
  fingerprint: string
  createdAt: string
}

const mockKeys: KeyEntry[] = [
  {
    id: '1',
    name: 'Production SSH Key',
    type: 'ssh-key',
    fingerprint: 'SHA256:abcd1234...efgh5678',
    createdAt: '2024-01-15',
  },
  {
    id: '2',
    name: 'Development SSH Key',
    type: 'ssh-key',
    fingerprint: 'SHA256:ijkl9012...mnop3456',
    createdAt: '2024-01-10',
  },
  {
    id: '3',
    name: 'API Token',
    type: 'token',
    fingerprint: 'tk_live_****...****5678',
    createdAt: '2024-01-05',
  },
]

const typeIcons = {
  'ssh-key': '🔐',
  password: '🔑',
  token: '🎟️',
}

const typeLabels = {
  'ssh-key': 'SSH Key',
  password: 'Password',
  token: 'Token',
}

export default function KeychainPage() {
  const [keys, setKeys] = useState<KeyEntry[]>(mockKeys)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const handleDelete = (id: string) => {
    setKeys(keys.filter((key) => key.id !== id))
  }

  const toggleReveal = (id: string) => {
    const newRevealed = new Set(revealedKeys)
    if (newRevealed.has(id)) {
      newRevealed.delete(id)
    } else {
      newRevealed.add(id)
    }
    setRevealedKeys(newRevealed)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Keychain</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Add Key
        </Button>
      </div>

      {keys.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">No keys stored</p>
            <p className="text-muted-foreground text-sm">
              Add your SSH keys and credentials
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {keys.map((key) => (
            <div
              key={key.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl">{typeIcons[key.type]}</span>
                    <h3 className="text-lg font-semibold text-foreground">
                      {key.name}
                    </h3>
                    <span className="px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
                      {typeLabels[key.type]}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p className="font-mono">
                      {revealedKeys.has(key.id)
                        ? key.fingerprint
                        : key.fingerprint.replace(/./g, '*')}
                    </p>
                    <p>Created: {key.createdAt}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                    onClick={() => toggleReveal(key.id)}
                  >
                    {revealedKeys.has(key.id) ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-destructive/10"
                    onClick={() => handleDelete(key.id)}
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
