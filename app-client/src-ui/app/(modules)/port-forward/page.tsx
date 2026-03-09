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
import { ArrowRight, Plus, Trash2, Power, Edit, Copy, MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { BsRouterFill } from 'react-icons/bs'
import { TbPlugConnected } from 'react-icons/tb'
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
import type { PortForwardEntry } from '@/lib/types'

export default function PortForwardingPage() {
  const { portForwards: forwards, savePortForwards, error } = useAppDataStore()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingForwardId, setEditingForwardId] = useState<string | null>(null)
  const [forwardForm, setForwardForm] = useState({
    name: '',
    localPort: '5432',
    remoteHost: '',
    remotePort: '5432',
    host: '',
    isActive: true,
  })

  const handleDelete = (id: string) => {
    void savePortForwards(forwards.filter((f) => f.id !== id))
  }

  const resetForwardForm = () => {
    setForwardForm({
      name: '',
      localPort: '5432',
      remoteHost: '',
      remotePort: '5432',
      host: '',
      isActive: true,
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsAddOpen(open)

    if (!open) {
      setEditingForwardId(null)
      resetForwardForm()
    }
  }

  const openCreateDialog = () => {
    setEditingForwardId(null)
    resetForwardForm()
    setIsAddOpen(true)
  }

  const openEditDialog = (forward: PortForwardEntry) => {
    setEditingForwardId(forward.id)
    setForwardForm({
      name: forward.name,
      localPort: String(forward.localPort),
      remoteHost: forward.remoteHost,
      remotePort: String(forward.remotePort),
      host: forward.host,
      isActive: forward.isActive,
    })
    setIsAddOpen(true)
  }

  const toggleActive = (id: string) => {
    void savePortForwards(
      forwards.map((f) => (f.id === id ? { ...f, isActive: !f.isActive } : f))
    )
  }

  const handleSaveForward = () => {
    if (editingForwardId) {
      void savePortForwards(
        forwards.map((forward) =>
          forward.id === editingForwardId
            ? {
                ...forward,
                name: forwardForm.name,
                localPort: Number(forwardForm.localPort) || 0,
                remoteHost: forwardForm.remoteHost,
                remotePort: Number(forwardForm.remotePort) || 0,
                host: forwardForm.host,
                isActive: forwardForm.isActive,
              }
            : forward,
        ),
      )
    } else {
      void savePortForwards([
        {
          id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
          name: forwardForm.name,
          localPort: Number(forwardForm.localPort) || 0,
          remoteHost: forwardForm.remoteHost,
          remotePort: Number(forwardForm.remotePort) || 0,
          host: forwardForm.host,
          isActive: forwardForm.isActive,
        },
        ...forwards,
      ])
    }

    setEditingForwardId(null)
    resetForwardForm()
    setIsAddOpen(false)
  }

  const handleCopyTarget = async (forward: PortForwardEntry) => {
    await navigator.clipboard.writeText(`localhost:${forward.localPort} -> ${forward.remoteHost}:${forward.remotePort}`)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TbPlugConnected className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Port Forwarding</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Add Forward
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingForwardId ? 'Edit Port Forward' : 'Add Port Forward'}</DialogTitle>
            <DialogDescription>
              {editingForwardId
                ? 'Update the selected local tunnel configuration.'
                : 'Create a local tunnel from a local port to a remote destination.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="forward-name">Name</Label>
              <Input id="forward-name" value={forwardForm.name} onChange={(event) => setForwardForm({ ...forwardForm, name: event.target.value })} placeholder="Database Access" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="forward-host">Host Label</Label>
              <Input id="forward-host" value={forwardForm.host} onChange={(event) => setForwardForm({ ...forwardForm, host: event.target.value })} placeholder="Production Server" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="local-port">Local Port</Label>
                <Input id="local-port" type="number" value={forwardForm.localPort} onChange={(event) => setForwardForm({ ...forwardForm, localPort: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="remote-port">Remote Port</Label>
                <Input id="remote-port" type="number" value={forwardForm.remotePort} onChange={(event) => setForwardForm({ ...forwardForm, remotePort: event.target.value })} />
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="remote-host">Remote Host</Label>
              <Input id="remote-host" value={forwardForm.remoteHost} onChange={(event) => setForwardForm({ ...forwardForm, remoteHost: event.target.value })} placeholder="192.168.1.100" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveForward} disabled={!forwardForm.name || !forwardForm.remoteHost || !forwardForm.host}>
              {editingForwardId ? 'Save Changes' : 'Save Forward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {forwards.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <TbPlugConnected className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
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
            <ContextMenu key={forward.id}>
              <ContextMenuTrigger>
                <div className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-1 items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <BsRouterFill className="h-5 w-5" />
                      </div>
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
                    </div>

                    <div className="flex gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="hover:bg-accent/10"
                            aria-label="Port forward actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(forward)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Forward
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleActive(forward.id)}>
                            <Power className="mr-2 h-4 w-4" />
                            {forward.isActive ? 'Disable Forward' : 'Enable Forward'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopyTarget(forward)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Tunnel
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(forward.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Forward
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => openEditDialog(forward)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Forward
                </ContextMenuItem>
                <ContextMenuItem onClick={() => toggleActive(forward.id)}>
                  <Power className="mr-2 h-4 w-4" />
                  {forward.isActive ? 'Disable Forward' : 'Enable Forward'}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopyTarget(forward)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Tunnel
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => handleDelete(forward.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Forward
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </div>
  )
}
