'use client'

import { useState } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { CollaborationPanel } from '@/components/collaboration-panel'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

export default function ModulesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [activeTab, setActiveTab] = useState<'sftp' | 'ssh'>('sftp')
  const [activeSection, setActiveSection] = useState('hosts')
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [sshConnections, setSshConnections] = useState([
    { id: '1', name: 'Servidor principal', host: '192.168.1.1' },
  ])

  const handleAddSsh = () => {
    const newId = (sshConnections.length + 1).toString()
    setSshConnections([
      ...sshConnections,
      { id: newId, name: `SSH Connection ${newId}`, host: '' },
    ])
  }

  const handleRemoveSsh = (id: string) => {
    setSshConnections(sshConnections.filter((ssh) => ssh.id !== id))
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <AppSidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-64">
        {/* Header */}
        <AppHeader
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onAddSsh={handleAddSsh}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-auto pt-16 bg-background">
          {children}
        </main>

        {/* Collaboration Button */}
        <Button
          onClick={() => setCollaborationOpen(!collaborationOpen)}
          className="fixed bottom-6 right-6 bg-accent hover:bg-accent/90 text-accent-foreground rounded-full w-14 h-14 shadow-lg flex items-center justify-center z-30"
          size="icon"
          title="Open collaboration panel"
        >
          <Users className="w-6 h-6" />
        </Button>
      </div>

      {/* Collaboration Panel */}
      <CollaborationPanel
        isOpen={collaborationOpen}
        onClose={() => setCollaborationOpen(false)}
      />
    </div>
  )
}
