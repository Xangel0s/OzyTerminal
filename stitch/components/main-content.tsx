'use client'

import { Button } from '@/components/ui/button'
import { Plus, Terminal as TerminalIcon, Zap, Server, X } from 'lucide-react'
import { TerminalEmulator } from './terminal-emulator'
import { HostsList } from './hosts-list'

interface SshConnection {
  id: string
  name: string
  host: string
}

interface MainContentProps {
  activeTab: 'sftp' | 'ssh'
  activeSection: string
  sshConnections?: SshConnection[]
  onAddSsh?: () => void
  onRemoveSsh?: (id: string) => void
}

export function MainContent({
  activeTab,
  activeSection,
  sshConnections = [],
  onAddSsh,
  onRemoveSsh,
}: MainContentProps) {
  if (activeTab === 'sftp') {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="text-center max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
            <Zap className="w-8 h-8 text-accent" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">SFTP</h2>
          <p className="text-muted-foreground mb-6">
            Cuando agregues algo aparecerá aquí para seleccionarlo fácilmente.
          </p>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
            <Plus className="w-4 h-4 mr-2" />
            CREATE
          </Button>
        </div>
      </div>
    )
  }

  if (activeTab === 'ssh') {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-6">
          <TerminalIcon className="w-5 h-5 text-accent" />
          <h2 className="text-xl font-bold text-foreground">SSH Connections</h2>
        </div>

        {sshConnections.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4">
                <TerminalIcon className="w-8 h-8 text-accent" />
              </div>
              <p className="text-foreground font-medium mb-2">No SSH connections</p>
              <p className="text-muted-foreground mb-4 text-sm">
                Click "Add SSH" in the header to create a new connection
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 flex-1 overflow-auto">
            {sshConnections.map((ssh) => (
              <div
                key={ssh.id}
                className="bg-card border border-border rounded-lg p-4 relative hover:border-accent/50 transition-colors"
              >
                <button
                  onClick={() => onRemoveSsh?.(ssh.id)}
                  className="absolute top-3 right-3 p-1 rounded hover:bg-destructive/20 text-destructive transition-colors"
                  title="Remove SSH connection"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="pr-6">
                  <div className="flex-1 min-h-96">
                    <TerminalEmulator title={`SSH Connection - ${ssh.name}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Hosts section
  if (activeSection === 'hosts') {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-accent" />
            <h2 className="text-xl font-bold text-foreground">Hosts</h2>
          </div>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
            <Plus className="w-4 h-4 mr-2" />
            Add Host
          </Button>
        </div>
        <HostsList />
      </div>
    )
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-foreground mb-6 capitalize">
        {activeSection}
      </h2>
      <div className="bg-card border border-border rounded-lg p-6">
        <p className="text-muted-foreground">Content area for {activeSection}</p>
      </div>
    </div>
  )
}
