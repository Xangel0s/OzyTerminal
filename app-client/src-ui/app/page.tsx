'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { MainContent } from '@/components/main-content'
import { CollaborationPanel } from '@/components/collaboration-panel'
import { Button } from '@/components/ui/button'
import { Users } from 'lucide-react'

interface SshConnection {
  id: string;
  name: string;
  host: string;
}

export default function DashboardPage() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'sftp' | 'ssh'>('ssh')
  const [activeSection, setActiveSection] = useState('hosts')
  const [viewMode, setViewMode] = useState<'sessions' | 'management'>('management')
  const [sshConnections, setSshConnections] = useState<SshConnection[]>([])
  const [collaborationOpen, setCollaborationOpen] = useState(false)

  // Handle URL parameters for navigation from separate routes
  useEffect(() => {
    const tab = searchParams.get('tab')
    const action = searchParams.get('action')

    if (tab === 'sftp' || tab === 'ssh') {
      setActiveTab(tab)
      setViewMode('sessions')
    }

    if (action === 'add-ssh') {
      handleAddSsh()
    }
  }, [searchParams])

  const handleAddSsh = () => {
    const newId = (sshConnections.length + 1).toString()
    setSshConnections([
      ...sshConnections,
      { id: newId, name: `Server ${newId}`, host: '192.168.1.100' },
    ])
    setActiveTab('ssh')
    setViewMode('sessions')
  }

  const handleRemoveSsh = (id: string) => {
    setSshConnections(sshConnections.filter((conn) => conn.id !== id))
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <AppSidebar 
        activeSection={activeSection} 
        onSectionChange={(section) => {
          setActiveSection(section)
          setViewMode('management')
        }} 
      />
      
      <div className="flex flex-col flex-1 min-w-0 lg:ml-64 transition-all duration-300">
        <AppHeader
          activeTab={activeTab}
          activeSection={viewMode === 'management' ? activeSection : 'sessions'}
          onTabChange={(tab) => {
            setActiveTab(tab as 'sftp' | 'ssh')
            setViewMode('sessions')
          }}
          onAddSsh={handleAddSsh}
        />
        
        <main className="flex-1 overflow-auto bg-background/50 backdrop-blur-sm">
          <MainContent
            activeTab={activeTab}
            activeSection={viewMode === 'management' ? activeSection : 'sessions'}
            sshConnections={sshConnections}
            onAddSsh={handleAddSsh}
            onRemoveSsh={handleRemoveSsh}
          />
        </main>

        <div className="fixed bottom-6 right-6 flex items-center gap-2">
          <Button
            onClick={() => setCollaborationOpen(!collaborationOpen)}
            className="rounded-full h-12 px-6 bg-accent hover:bg-accent/90 text-accent-foreground shadow-lg flex items-center gap-2"
          >
            <Users className="w-5 h-5" />
            <span className="font-semibold">Collaborate</span>
          </Button>
        </div>

        <CollaborationPanel
          isOpen={collaborationOpen}
          onClose={() => setCollaborationOpen(false)}
        />
      </div>
    </div>
  )
}
