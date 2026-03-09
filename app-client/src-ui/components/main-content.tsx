'use client'

import { Button } from '@/components/ui/button'
import { Plus, Server } from 'lucide-react'
import { HostsList } from './hosts-list'
import { SftpView } from './sftp-view'
import { SshConnectWizard } from './ssh-connect-wizard'

interface MainContentProps {
  activeTab: 'sftp' | 'ssh'
  activeSection: string
  sshConnections?: any[]
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
  // If we are in sessions mode, render activeTab (SFTP or SSH)
  if (activeSection === 'sessions') {
    if (activeTab === 'sftp') {
      return (
        <div className="p-6 h-full">
          <SftpView />
        </div>
      )
    }
    return (
      <div className="p-6 h-full">
        <SshConnectWizard />
      </div>
    )
  }

  // Management Views (Sidebar modules)
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

  // Default fallback for other modules (Keychain, Logs, etc.)
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
