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
import { Plus, Trash2, Copy, Edit, MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { RiShieldKeyholeFill } from 'react-icons/ri'
import { MdOutlineVerifiedUser } from 'react-icons/md'
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
import { useServers } from '@/hooks/useServers'
import { KnownHostEntry } from '@/lib/types'

interface KnownHost {
  id: string
  hostname: string
  ipAddress: string
  hostKey: string
  fingerprint: string
  addedDate: string
  port: number
}

function getKnownHostId(entry: KnownHostEntry) {
  return `${entry.host}:${entry.port}:${entry.fingerprintSha256}`
}

function getKnownHostKeyType(hostKey: string) {
  return hostKey.trim().split(/\s+/)[0] || 'unknown'
}

function mapKnownHost(entry: KnownHostEntry): KnownHost {
  return {
    id: getKnownHostId(entry),
    hostname: entry.label || entry.host,
    ipAddress: entry.host,
    hostKey: entry.hostKeyOpenssh,
    fingerprint: entry.fingerprintSha256,
    addedDate: new Date(entry.addedAt).toISOString().slice(0, 10),
    port: entry.port,
  }
}

export default function KnownHostsPage() {
  const { knownHosts, upsertKnownHost, removeKnownHost } = useServers()
  const hosts = knownHosts.map(mapKnownHost)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingHostId, setEditingHostId] = useState<string | null>(null)
  const [hostForm, setHostForm] = useState({
    hostname: '',
    ipAddress: '',
    hostKey: '',
    fingerprint: '',
    addedDate: new Date().toISOString().slice(0, 10),
  })

  const handleDelete = async (id: string) => {
    const knownHost = hosts.find((entry) => entry.id === id)
    if (!knownHost) {
      return
    }

    await removeKnownHost({
      host: knownHost.ipAddress,
      port: knownHost.port,
      fingerprintSha256: knownHost.fingerprint,
    })
  }

  const resetHostForm = () => {
    setHostForm({
      hostname: '',
      ipAddress: '',
      hostKey: '',
      fingerprint: '',
      addedDate: new Date().toISOString().slice(0, 10),
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsAddOpen(open)

    if (!open) {
      setEditingHostId(null)
      resetHostForm()
    }
  }

  const openCreateDialog = () => {
    setEditingHostId(null)
    resetHostForm()
    setIsAddOpen(true)
  }

  const openEditDialog = (host: KnownHost) => {
    setEditingHostId(host.id)
    setHostForm({
      hostname: host.hostname,
      ipAddress: host.ipAddress,
      hostKey: host.hostKey,
      fingerprint: host.fingerprint,
      addedDate: host.addedDate,
    })
    setIsAddOpen(true)
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const handleSaveKnownHost = async () => {
    const existingHost = editingHostId ? hosts.find((host) => host.id === editingHostId) : null

    await upsertKnownHost({
      host: hostForm.ipAddress,
      port: existingHost?.port ?? 22,
      fingerprintSha256: hostForm.fingerprint,
      hostKeyOpenssh: hostForm.hostKey,
      addedAt: Date.parse(hostForm.addedDate) || Date.now(),
      label: hostForm.hostname,
    })

    setEditingHostId(null)
    resetHostForm()
    setIsAddOpen(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <RiShieldKeyholeFill className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Known Hosts</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Add Host
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingHostId ? 'Edit Known Host' : 'Add Known Host'}</DialogTitle>
            <DialogDescription>
              {editingHostId
                ? 'Update the selected known host fingerprint entry.'
                : 'Register a host key fingerprint in the known hosts database view.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="known-hostname">Hostname</Label>
              <Input id="known-hostname" value={hostForm.hostname} onChange={(event) => setHostForm({ ...hostForm, hostname: event.target.value })} placeholder="prod-server.example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="known-host-ip">IP Address</Label>
              <Input id="known-host-ip" value={hostForm.ipAddress} onChange={(event) => setHostForm({ ...hostForm, ipAddress: event.target.value })} placeholder="203.0.113.42" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="known-host-key-type">Key Type</Label>
              <Input id="known-host-key-type" value={hostForm.hostKey} onChange={(event) => setHostForm({ ...hostForm, hostKey: event.target.value })} placeholder="ssh-ed25519 AAAAC3..." />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="known-host-fingerprint">Fingerprint</Label>
              <Input id="known-host-fingerprint" value={hostForm.fingerprint} onChange={(event) => setHostForm({ ...hostForm, fingerprint: event.target.value })} placeholder="SHA256:abcd1234..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveKnownHost} disabled={!hostForm.hostname || !hostForm.ipAddress || !hostForm.hostKey || !hostForm.fingerprint}>
              {editingHostId ? 'Save Changes' : 'Save Host'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {hosts.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <RiShieldKeyholeFill className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
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
            <ContextMenu key={host.id}>
              <ContextMenuTrigger>
                <div className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex flex-1 items-start gap-4">
                      <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <MdOutlineVerifiedUser className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                          {host.hostname}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          IP: {host.ipAddress}:{host.port} • Type: {getKnownHostKeyType(host.hostKey)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="hover:bg-accent/10"
                            aria-label="Known host actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(host)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Host
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopy(host.fingerprint)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Fingerprint
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(host.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Host
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => openEditDialog(host)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Host
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(host.fingerprint)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Fingerprint
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => handleDelete(host.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Host
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </div>
  )
}
