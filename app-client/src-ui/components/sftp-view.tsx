'use client'

import { useEffect } from 'react'
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

interface SftpViewProps {
  onSessionTitleChange?: (title: string | null) => void
}

export function SftpView({ onSessionTitleChange }: SftpViewProps) {
  const {
    localPath,
    localEntries,
    isLocalLoading,
    localError,
    remoteDraft,
    remotePath,
    remoteEntries,
    isRemoteLoading,
    remoteError,
    isRemoteConnected,
    navigateLocal,
    navigateLocalUp,
    refreshLocal,
    updateRemoteDraft,
    connectRemote,
    navigateRemote,
    navigateRemoteUp,
    refreshRemote,
    disconnectRemote,
  } = useSftp()

  const currentSftpTitle = isRemoteConnected && remoteDraft.host.trim()
    ? remoteDraft.host.trim()
    : null

  useEffect(() => {
    onSessionTitleChange?.(currentSftpTitle)

    return () => {
      onSessionTitleChange?.(null)
    }
  }, [currentSftpTitle, onSessionTitleChange])

  const renderEntry = (entry: LocalDirectoryEntry, pane: 'local' | 'remote') => {
    const isFolder = entry.entryType === 'folder'
    const Icon = isFolder ? Folder : File

    return (
      <div
        key={entry.path}
        className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/50 rounded-lg cursor-pointer transition-colors group"
        onDoubleClick={() => {
          if (!isFolder) {
            return
          }

          if (pane === 'local') {
            navigateLocal(entry.path)
            return
          }

          void navigateRemote(entry.path)
        }}
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
                {localError && <p className="mt-2 text-xs text-destructive">{localError}</p>}
              </div>
            ) : (
              <div className="space-y-0.5">
                {localEntries.map(e => renderEntry(e, 'local'))}
              </div>
            )}
          </div>
        </div>

        {/* Remote Pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted/5">
          <div className="p-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2 overflow-hidden">
              <Globe className="w-4 h-4 text-accent flex-shrink-0" />
              <span className="text-xs font-mono text-muted-foreground truncate">{remotePath}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void navigateRemoteUp()} disabled={!isRemoteConnected}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void refreshRemote()} disabled={!isRemoteConnected}>
                <RotateCw className={`w-3.5 h-3.5 ${isRemoteLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            {!isRemoteConnected ? (
              <form
                className="grid gap-3 p-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  void connectRemote()
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <input
                    aria-label="Remote host"
                    value={remoteDraft.host}
                    onChange={(event) => updateRemoteDraft({ host: event.target.value })}
                    placeholder="Host"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  />
                  <input
                    aria-label="Remote port"
                    type="number"
                    value={remoteDraft.port}
                    onChange={(event) => updateRemoteDraft({ port: Number(event.target.value) || 22 })}
                    placeholder="Port"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    aria-label="Remote username"
                    value={remoteDraft.username}
                    onChange={(event) => updateRemoteDraft({ username: event.target.value })}
                    placeholder="Username"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  />
                  <input
                    aria-label="Remote start path"
                    value={remoteDraft.startPath ?? ''}
                    onChange={(event) => updateRemoteDraft({ startPath: event.target.value })}
                    placeholder="/"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                  />
                </div>
                <input
                  aria-label="Remote password"
                  type="password"
                  value={remoteDraft.password ?? ''}
                  onChange={(event) => updateRemoteDraft({ password: event.target.value })}
                  placeholder="Password (optional if key is provided)"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
                <textarea
                  aria-label="Remote private key"
                  value={remoteDraft.privateKeyPem}
                  onChange={(event) => updateRemoteDraft({ privateKeyPem: event.target.value })}
                  placeholder="Private key PEM (optional if password is provided)"
                  className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm font-mono"
                />
                <input
                  aria-label="Remote known host fingerprint"
                  value={remoteDraft.knownHostFingerprint ?? ''}
                  onChange={(event) => updateRemoteDraft({ knownHostFingerprint: event.target.value })}
                  placeholder="Known host fingerprint (optional)"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                />
                {remoteError && <p className="text-sm text-destructive">{remoteError}</p>}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Connect with password, key, or certificate-backed key flow from the backend.
                  </p>
                  <Button type="submit" className="bg-accent hover:bg-accent/90 text-accent-foreground" disabled={isRemoteLoading}>
                    {isRemoteLoading ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b p-3">
                  <p className="text-xs text-muted-foreground">
                    Browsing {remoteDraft.username}@{remoteDraft.host}
                  </p>
                  <Button variant="outline" size="sm" onClick={disconnectRemote}>
                    Disconnect
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                  {remoteEntries.length === 0 && !isRemoteLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <p className="text-sm">This remote folder is empty</p>
                      {remoteError && <p className="mt-2 text-xs text-destructive">{remoteError}</p>}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {remoteEntries.map((entry) => renderEntry(entry, 'remote'))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
