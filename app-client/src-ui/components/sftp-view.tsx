'use client'

import { Button } from '@/components/ui/button'
import { 
  Folder, 
  File, 
  ChevronLeft, 
  RotateCw, 
  Monitor, 
  Globe, 
  Search,
  Plus
} from 'lucide-react'
import { useSftp } from '@/hooks/useSftp'
import { LocalDirectoryEntry } from '@/lib/types'

export function SftpView() {
  const {
    localPath,
    localEntries,
    isLocalLoading,
    remotePath,
    remoteEntries,
    isRemoteLoading,
    navigateLocal,
    navigateLocalUp,
    refreshLocal,
  } = useSftp()

  const renderEntry = (entry: LocalDirectoryEntry, pane: 'local' | 'remote') => {
    const isFolder = entry.entryType === 'folder'
    const Icon = isFolder ? Folder : File

    return (
      <div
        key={entry.path}
        className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/50 rounded-lg cursor-pointer transition-colors group"
        onDoubleClick={() => pane === 'local' && isFolder && navigateLocal(entry.path)}
      >
        <Icon className={`w-4 h-4 ${isFolder ? 'text-accent' : 'text-muted-foreground'}`} />
        <span className="text-sm font-medium text-foreground truncate">{entry.name}</span>
        {entry.sizeBytes !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            {(entry.sizeBytes / 1024).toFixed(1)} KB
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background border rounded-xl overflow-hidden shadow-sm">
      {/* SFTP Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg">
            <Button variant="ghost" size="sm" className="h-8 px-3 bg-background shadow-sm text-accent">
              LOCAL
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-3 text-muted-foreground">
              REMOTE
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search files..."
              className="pl-9 h-9 w-64 rounded-lg bg-secondary/50 border-none text-sm focus:ring-1 focus:ring-accent outline-none"
            />
          </div>
          <Button className="h-9 bg-accent hover:bg-accent/90 text-accent-foreground">
            <Plus className="w-4 h-4 mr-2" />
            UPLOAD
          </Button>
        </div>
      </div>

      {/* Dual Pane */}
      <div className="flex flex-1 min-h-0 divide-x overflow-hidden">
        {/* Local Pane */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Monitor className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate">{localPath}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={navigateLocalUp}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={refreshLocal}>
                <RotateCw className={`w-3.5 h-3.5 ${isLocalLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
            {localEntries.length === 0 && !isLocalLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <p className="text-sm">This folder is empty</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {localEntries.map(e => renderEntry(e, 'local'))}
              </div>
            )}
          </div>
        </div>

        {/* Remote Pane (Placeholder for now) */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted/5">
          <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Globe className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate">{remotePath}</span>
            </div>
            <div className="flex items-center gap-1">
               <RotateCw className={`w-3.5 h-3.5 text-muted-foreground ${isRemoteLoading ? 'animate-spin' : ''}`} />
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <Globe className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Remote Session</h3>
            <p className="text-sm text-muted-foreground max-w-[200px]">
              Connect to a server via SSH to enable remote file browsing.
            </p>
            <Button variant="outline" size="sm" className="mt-4 border-accent text-accent hover:bg-accent/10">
              Connect Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
