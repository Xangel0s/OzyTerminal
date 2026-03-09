'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Plus, Trash2, Copy, Eye, EyeOff, Edit, MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { FaKey, FaKeycdn } from 'react-icons/fa'
import { RiKey2Fill } from 'react-icons/ri'
import { TbTicket } from 'react-icons/tb'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppDataStore } from '@/hooks/useAppDataStore'
import type { KeychainEntry } from '@/lib/types'

const typeIcons: Record<'ssh-key' | 'password' | 'token', typeof RiKey2Fill> = {
  'ssh-key': RiKey2Fill,
  password: FaKey,
  token: TbTicket,
}

const typeIconColors = {
  'ssh-key': 'text-amber-300 bg-amber-500/10',
  password: 'text-sky-400 bg-sky-500/10',
  token: 'text-pink-400 bg-pink-500/10',
}

const typeLabels = {
  'ssh-key': 'SSH Key',
  password: 'Password',
  token: 'Token',
}

export default function KeychainPage() {
  const { keychainEntries: keys, saveKeychainEntries, error } = useAppDataStore()
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [keyForm, setKeyForm] = useState({
    name: '',
    type: 'ssh-key' as KeychainEntry['type'],
    fingerprint: '',
    createdAt: new Date().toISOString().slice(0, 10),
  })

  const handleDelete = (id: string) => {
    void saveKeychainEntries(keys.filter((key) => key.id !== id))
  }

  const resetKeyForm = () => {
    setKeyForm({
      name: '',
      type: 'ssh-key',
      fingerprint: '',
      createdAt: new Date().toISOString().slice(0, 10),
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsAddOpen(open)

    if (!open) {
      setEditingKeyId(null)
      resetKeyForm()
    }
  }

  const openCreateDialog = () => {
    setEditingKeyId(null)
    resetKeyForm()
    setIsAddOpen(true)
  }

  const openEditDialog = (key: KeychainEntry) => {
    setEditingKeyId(key.id)
    setKeyForm({
      name: key.name,
      type: key.type,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
    })
    setIsAddOpen(true)
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

  const handleSaveKey = () => {
    if (editingKeyId) {
      void saveKeychainEntries(
        keys.map((key) =>
          key.id === editingKeyId
            ? {
                ...key,
                name: keyForm.name,
                type: keyForm.type,
                fingerprint: keyForm.fingerprint,
                createdAt: keyForm.createdAt,
              }
            : key,
        ),
      )
    } else {
      void saveKeychainEntries([
        {
          id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
          name: keyForm.name,
          type: keyForm.type,
          fingerprint: keyForm.fingerprint,
          createdAt: keyForm.createdAt,
        },
        ...keys,
      ])
    }

    setEditingKeyId(null)
    resetKeyForm()
    setIsAddOpen(false)
  }

  const handleCopyFingerprint = async (fingerprint: string) => {
    await navigator.clipboard.writeText(fingerprint)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FaKeycdn className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Keychain</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Add Key
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Dialog open={isAddOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingKeyId ? 'Edit Keychain Entry' : 'Add Keychain Entry'}</DialogTitle>
            <DialogDescription>
              {editingKeyId
                ? 'Update the selected SSH key, password, or token.'
                : 'Store a new SSH key, password, or token in the local keychain view.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={keyForm.name} onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })} placeholder="Production SSH Key" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-type">Type</Label>
              <select id="key-type" className="border-input bg-background h-9 rounded-md border px-3 text-sm" value={keyForm.type} onChange={(event) => setKeyForm({ ...keyForm, type: event.target.value as KeychainEntry['type'] })}>
                <option value="ssh-key">SSH Key</option>
                <option value="password">Password</option>
                <option value="token">Token</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-fingerprint">Secret or Fingerprint</Label>
              <Input id="key-fingerprint" value={keyForm.fingerprint} onChange={(event) => setKeyForm({ ...keyForm, fingerprint: event.target.value })} placeholder="SHA256:abcd1234..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveKey} disabled={!keyForm.name || !keyForm.fingerprint}>
              {editingKeyId ? 'Save Changes' : 'Save Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {keys.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <FaKeycdn className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-foreground font-medium mb-2">No keys stored</p>
            <p className="text-muted-foreground text-sm">
              Add your SSH keys and credentials
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {keys.map((key) => {
            const TypeIcon = typeIcons[(key.type in typeIcons ? key.type : 'token') as keyof typeof typeIcons]

            return (
              <ContextMenu key={key.id}>
                <ContextMenuTrigger>
                  <div className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${typeIconColors[key.type]}`}>
                            <TypeIcon className="h-5 w-5" />
                          </div>
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="hover:bg-accent/10"
                              aria-label="Key actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(key)}>
                              <Edit className="mr-2 h-4 w-4" />
                              Edit Entry
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => toggleReveal(key.id)}>
                              {revealedKeys.has(key.id) ? (
                                <EyeOff className="mr-2 h-4 w-4" />
                              ) : (
                                <Eye className="mr-2 h-4 w-4" />
                              )}
                              {revealedKeys.has(key.id) ? 'Hide Secret' : 'Reveal Secret'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopyFingerprint(key.fingerprint)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy Secret
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(key.id)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Entry
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => openEditDialog(key)}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Entry
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => toggleReveal(key.id)}>
                    {revealedKeys.has(key.id) ? (
                      <EyeOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    {revealedKeys.has(key.id) ? 'Hide Secret' : 'Reveal Secret'}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyFingerprint(key.fingerprint)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Secret
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(key.id)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Entry
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      )}
    </div>
  )
}
