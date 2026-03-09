'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'
import { MainContent } from '@/components/main-content'
import { CollaborationPanel } from '@/components/collaboration-panel'
import { Button } from '@/components/ui/button'
import { SshSessionRequest } from '@/lib/types'
import { clearPendingSshPreset, readPendingSshPreset } from '@/lib/ssh-preset'
import { Users } from 'lucide-react'

const managementSections = new Set([
  'hosts',
  'keychain',
  'port-forward',
  'snippets',
  'known-hosts',
  'logs',
])

function DashboardPageContent() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'sftp' | 'ssh'>('ssh')
  const [activeSection, setActiveSection] = useState('hosts')
  const [viewMode, setViewMode] = useState<'sessions' | 'management'>('management')
  const [hostViewMode, setHostViewMode] = useState<'grid' | 'list'>('list')
  const [sftpSessionTitle, setSftpSessionTitle] = useState<string | null>(null)
  const [sshSessionTitle, setSshSessionTitle] = useState<string | null>(null)
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [sshConnectionPreset, setSshConnectionPreset] = useState<Partial<SshSessionRequest> | null>(null)
  const [sshConnectionRequestId, setSshConnectionRequestId] = useState(0)
  const [sshWorkspacePersistent, setSshWorkspacePersistent] = useState(false)
  const [isSystemLoading, setIsSystemLoading] = useState(false)
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showCollaboration = !(viewMode === 'sessions' && activeTab === 'ssh')

  const beginSystemLoading = () => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
    }

    setIsSystemLoading(true)
  }

  const finishSystemLoading = (delay = 180) => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
    }

    loadingTimerRef.current = setTimeout(() => {
      setIsSystemLoading(false)
      loadingTimerRef.current = null
    }, delay)
  }

  // Handle URL parameters for navigation from separate routes
  useEffect(() => {
    const section = searchParams.get('section')
    const tab = searchParams.get('tab')
    const action = searchParams.get('action')

    if (section && managementSections.has(section)) {
      setActiveSection(section)
      setViewMode('management')
    } else if (!section) {
      setActiveSection('hosts')

      if (!tab && !action) {
        setViewMode('management')
      }
    }

    if (tab === 'sftp' || tab === 'ssh') {
      setActiveTab(tab)
      setViewMode('sessions')

      if (tab === 'ssh') {
        setSshWorkspacePersistent(true)
      }
    }

    if (action === 'add-ssh') {
      handleAddSsh()
    }

    const pendingPreset = readPendingSshPreset()
    if (pendingPreset) {
      clearPendingSshPreset()
      handleOpenSshFromHost(pendingPreset)
    }

    finishSystemLoading()
  }, [searchParams])

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!showCollaboration && collaborationOpen) {
      setCollaborationOpen(false)
    }
  }, [collaborationOpen, showCollaboration])

  const handleAddSsh = () => {
    beginSystemLoading()
    setSshWorkspacePersistent(true)
    setActiveTab('ssh')
    setViewMode('sessions')
    finishSystemLoading(220)
  }

  const handleOpenSshFromHost = (request: Partial<SshSessionRequest>) => {
    beginSystemLoading()
    setSshWorkspacePersistent(true)
    setSshConnectionPreset(request)
    setSshConnectionRequestId((current) => current + 1)
    setActiveTab('ssh')
    setActiveSection('sessions')
    setViewMode('sessions')
    finishSystemLoading(220)
  }

  const handleConsumeSshPreset = (requestId: number) => {
    setSshConnectionPreset((currentPreset) => {
      if (requestId !== sshConnectionRequestId) {
        return currentPreset
      }

      return null
    })
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <AppSidebar 
        activeSection={activeSection} 
        onSectionChange={(section) => {
          if (viewMode === 'management' && activeSection === section) {
            return
          }

          beginSystemLoading()
          setActiveSection(section)
          setViewMode('management')
        }} 
      />
      
      <div className="flex flex-col flex-1 min-w-0 lg:ml-64 transition-all duration-300">
        <AppHeader
          activeTab={activeTab}
          activeSection={viewMode === 'management' ? activeSection : 'sessions'}
          sftpSessionTitle={sftpSessionTitle}
          sshSessionTitle={sshSessionTitle}
          onTabChange={(tab) => {
            if (viewMode === 'sessions' && activeTab === tab) {
              return
            }

            beginSystemLoading()
            setActiveTab(tab as 'sftp' | 'ssh')
            setViewMode('sessions')
            finishSystemLoading(220)
          }}
          onAddSsh={handleAddSsh}
          hostViewMode={hostViewMode}
          onToggleHostView={() => setHostViewMode((currentMode) => (currentMode === 'grid' ? 'list' : 'grid'))}
        />
        
        <main className="flex-1 overflow-auto bg-background/50 backdrop-blur-sm">
          <MainContent
            activeTab={activeTab}
            activeSection={viewMode === 'management' ? activeSection : 'sessions'}
            sftpSessionTitle={sftpSessionTitle}
            sshSessionTitle={sshSessionTitle}
            onSftpSessionTitleChange={setSftpSessionTitle}
            onSshSessionTitleChange={setSshSessionTitle}
            hostViewMode={hostViewMode}
            sshConnectionPreset={sshConnectionPreset}
            sshConnectionRequestId={sshConnectionRequestId}
            persistSshWorkspace={sshWorkspacePersistent}
            onOpenSshFromHost={handleOpenSshFromHost}
            onSshConnectionPresetConsumed={handleConsumeSshPreset}
            isSystemLoading={isSystemLoading}
          />
        </main>

        {showCollaboration ? (
          <>
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
          </>
        ) : null}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-foreground">Loading...</div>}>
      <DashboardPageContent />
    </Suspense>
  )
}
