'use client'

import { Button } from '@/components/ui/button'
import { Code2, Plus, Trash2, Copy } from 'lucide-react'
import { useState } from 'react'

interface Snippet {
  id: string
  name: string
  description: string
  code: string
  language: string
  tags: string[]
}

const mockSnippets: Snippet[] = [
  {
    id: '1',
    name: 'Check Disk Space',
    description: 'Show disk usage for all mounted filesystems',
    code: 'df -h',
    language: 'bash',
    tags: ['system', 'disk'],
  },
  {
    id: '2',
    name: 'List Active Processes',
    description: 'Display CPU and memory usage by process',
    code: 'ps aux --sort=-%cpu | head -20',
    language: 'bash',
    tags: ['system', 'processes'],
  },
  {
    id: '3',
    name: 'Check Network Connections',
    description: 'Show all active network connections',
    code: 'netstat -tulpn | grep LISTEN',
    language: 'bash',
    tags: ['network', 'system'],
  },
]

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[]>(mockSnippets)

  const handleDelete = (id: string) => {
    setSnippets(snippets.filter((s) => s.id !== id))
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-accent" />
          <h1 className="text-2xl font-bold text-foreground">Snippets</h1>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          New Snippet
        </Button>
      </div>

      {snippets.length === 0 ? (
        <div className="flex items-center justify-center min-h-96 border border-border rounded-lg">
          <div className="text-center">
            <Code2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">No snippets saved</p>
            <p className="text-muted-foreground text-sm">
              Save your favorite commands as snippets
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {snippets.map((snippet) => (
            <div
              key={snippet.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-1">
                    {snippet.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {snippet.description}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-accent/10"
                    onClick={() => handleCopy(snippet.code)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hover:bg-destructive/10"
                    onClick={() => handleDelete(snippet.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
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
          ))}
        </div>
      )}
    </div>
  )
}
