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
import { TbCodeDots, TbTerminal2 } from 'react-icons/tb'
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
import { Textarea } from '@/components/ui/textarea'
import { useAppDataStore } from '@/hooks/useAppDataStore'
import type { SnippetEntry } from '@/lib/types'

export default function SnippetsPage() {
  const { snippets, saveSnippets, error } = useAppDataStore()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null)
  const [snippetForm, setSnippetForm] = useState({
    name: '',
    description: '',
    code: '',
    language: 'bash',
    tags: '',
  })

  const handleDelete = (id: string) => {
    void saveSnippets(snippets.filter((s) => s.id !== id))
  }

  const resetSnippetForm = () => {
    setSnippetForm({
      name: '',
      description: '',
      code: '',
      language: 'bash',
      tags: '',
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsAddOpen(open)

    if (!open) {
      setEditingSnippetId(null)
      resetSnippetForm()
    }
  }

  const openCreateDialog = () => {
    setEditingSnippetId(null)
    resetSnippetForm()
    setIsAddOpen(true)
  }

  const openEditDialog = (snippet: SnippetEntry) => {
    setEditingSnippetId(snippet.id)
    setSnippetForm({
      name: snippet.name,
      description: snippet.description,
      code: snippet.code,
      language: snippet.language,
      tags: snippet.tags.join(', '),
    })
    setIsAddOpen(true)
  }

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code)
  }

  const handleSaveSnippet = () => {
    if (editingSnippetId) {
      void saveSnippets(
        snippets.map((snippet) =>
          snippet.id === editingSnippetId
            ? {
                ...snippet,
                name: snippetForm.name,
                description: snippetForm.description,
                code: snippetForm.code,
                language: snippetForm.language,
                tags: snippetForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
              }
            : snippet,
        ),
      )
    } else {
      void saveSnippets([
        {
          id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
          name: snippetForm.name,
          description: snippetForm.description,
          code: snippetForm.code,
          language: snippetForm.language,
          tags: snippetForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        },
        ...snippets,
      ])
    }

    setEditingSnippetId(null)
    resetSnippetForm()
    setIsAddOpen(false)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TbCodeDots className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Snippets</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          New Snippet
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSnippetId ? 'Edit Snippet' : 'Add Snippet'}</DialogTitle>
            <DialogDescription>
              {editingSnippetId
                ? 'Update the selected reusable snippet.'
                : 'Save a reusable command or code snippet for quick access.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="snippet-name">Name</Label>
              <Input id="snippet-name" value={snippetForm.name} onChange={(event) => setSnippetForm({ ...snippetForm, name: event.target.value })} placeholder="Check Disk Space" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="snippet-description">Description</Label>
              <Input id="snippet-description" value={snippetForm.description} onChange={(event) => setSnippetForm({ ...snippetForm, description: event.target.value })} placeholder="Show disk usage for all mounted filesystems" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="snippet-code">Code</Label>
              <Textarea id="snippet-code" value={snippetForm.code} onChange={(event) => setSnippetForm({ ...snippetForm, code: event.target.value })} placeholder="df -h" className="min-h-28 font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="snippet-language">Language</Label>
                <Input id="snippet-language" value={snippetForm.language} onChange={(event) => setSnippetForm({ ...snippetForm, language: event.target.value })} placeholder="bash" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="snippet-tags">Tags</Label>
                <Input id="snippet-tags" value={snippetForm.tags} onChange={(event) => setSnippetForm({ ...snippetForm, tags: event.target.value })} placeholder="system, disk" />
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancel</Button>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground" onClick={handleSaveSnippet} disabled={!snippetForm.name || !snippetForm.code}>
              {editingSnippetId ? 'Save Changes' : 'Save Snippet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {snippets.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <TbCodeDots className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-foreground font-medium mb-2">No snippets saved</p>
            <p className="text-muted-foreground text-sm">
              Save your favorite commands as snippets
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {snippets.map((snippet) => (
            <ContextMenu key={snippet.id}>
              <ContextMenuTrigger>
                <div className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex flex-1 items-start gap-4">
                      <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <TbTerminal2 className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground mb-1">
                          {snippet.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {snippet.description}
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
                            aria-label="Snippet actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(snippet)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Snippet
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCopy(snippet.code)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Code
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(snippet.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Snippet
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="bg-input rounded p-3 mb-3 overflow-x-auto">
                    <code className="text-sm font-mono text-foreground">
                      {snippet.code}
                    </code>
                  </div>

                  <div className="flex gap-2">
                    {snippet.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-1 rounded text-xs bg-accent/10 text-accent"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => openEditDialog(snippet)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Snippet
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopy(snippet.code)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Code
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => handleDelete(snippet.id)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Snippet
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      )}
    </div>
  )
}
