'use client'

import { Button } from '@/components/ui/button'
import KeychainPage from '@/app/(modules)/keychain/page'
import KnownHostsPage from '@/app/(modules)/known-hosts/page'
import LogsPage from '@/app/(modules)/logs/page'
import PortForwardingPage from '@/app/(modules)/port-forward/page'
import SnippetsPage from '@/app/(modules)/snippets/page'
import { ModuleTransitionOverlay } from './module-transition-overlay'
import { SshSessionRequest } from '@/lib/types'
import { Plus, Server } from 'lucide-react'
import { HostsList } from './hosts-list'
import { SftpView } from './sftp-view'
import { SshConnectWizard } from './ssh-connect-wizard'

interface MainContentProps {
  activeTab: 'sftp' | 'ssh'
  activeSection: string
  sftpSessionTitle?: string | null
  sshSessionTitle?: string | null
  onSftpSessionTitleChange?: (title: string | null) => void
  onSshSessionTitleChange?: (title: string | null) => void
  hostViewMode?: 'grid' | 'list'
  sshConnectionPreset?: Partial<SshSessionRequest> | null
  sshConnectionRequestId?: number
  persistSshWorkspace?: boolean
  onOpenSshFromHost?: (request: Partial<SshSessionRequest>) => void
  onSshConnectionPresetConsumed?: (requestId: number) => void
  isSystemLoading?: boolean
}

export function MainContent({
  activeTab,
  activeSection,
  sftpSessionTitle,
  sshSessionTitle,
  onSftpSessionTitleChange,
  onSshSessionTitleChange,
  hostViewMode = 'list',
  sshConnectionPreset,
  sshConnectionRequestId,
  persistSshWorkspace = false,
  onOpenSshFromHost,
  onSshConnectionPresetConsumed,
  isSystemLoading = false,
}: MainContentProps) {
  const showSftpSession = activeSection === 'sessions' && activeTab === 'sftp'
  const showSshSession = activeSection === 'sessions' && activeTab === 'ssh'
  const showHostsModule = activeSection === 'hosts'
  const showKeychainModule = activeSection === 'keychain'
  const showPortForwardModule = activeSection === 'port-forward'
  const showSnippetsModule = activeSection === 'snippets'
  const showKnownHostsModule = activeSection === 'known-hosts'
  const showLogsModule = activeSection === 'logs'
  const keepMountedSftpSession = showSftpSession || Boolean(sftpSessionTitle)
  const keepMountedSshSession = persistSshWorkspace || showSshSession || Boolean(sshConnectionPreset)
  const transitionSectionLabel = activeSection.replace(/-/g, ' ')

  return (
    <div className="relative h-full min-h-0">
      {isSystemLoading ? <ModuleTransitionOverlay sectionLabel={transitionSectionLabel} /> : null}

      {keepMountedSftpSession ? (
        <section className={`${showSftpSession ? 'flex' : 'hidden'} h-full min-h-0 p-6`}>
          <SftpView onSessionTitleChange={onSftpSessionTitleChange} />
        </section>
      ) : null}

      {keepMountedSshSession ? (
        <section
          aria-hidden={!showSshSession}
          className={showSshSession
            ? 'relative z-10 flex h-full min-h-0 overflow-hidden'
            : 'pointer-events-none absolute inset-0 flex min-h-0 overflow-hidden opacity-0'}
        >
          <SshConnectWizard
            onSessionTitleChange={onSshSessionTitleChange}
            connectionPreset={sshConnectionPreset}
            connectionRequestId={sshConnectionRequestId}
            onConnectionPresetConsumed={onSshConnectionPresetConsumed}
          />
        </section>
      ) : null}

      {showHostsModule ? (
        <section className="block p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-bold text-foreground">Hosts</h2>
            </div>
            <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
              <Plus className="w-4 h-4 mr-2" />
              Add Host
            </Button>
          </div>
          <HostsList viewMode={hostViewMode} onOpenConnection={onOpenSshFromHost} />
        </section>
      ) : null}

      {showKeychainModule ? (
        <section className="block">
          <KeychainPage />
        </section>
      ) : null}

      {showPortForwardModule ? (
        <section className="block">
          <PortForwardingPage />
        </section>
      ) : null}

      {showSnippetsModule ? (
        <section className="block">
          <SnippetsPage />
        </section>
      ) : null}

      {showKnownHostsModule ? (
        <section className="block">
          <KnownHostsPage />
        </section>
      ) : null}

      {showLogsModule ? (
        <section className="block">
          <LogsPage />
        </section>
      ) : null}

      {!showSftpSession &&
      !showSshSession &&
      !showHostsModule &&
      !showKeychainModule &&
      !showPortForwardModule &&
      !showSnippetsModule &&
      !showKnownHostsModule &&
      !showLogsModule ? (
        <section className="block p-6">
          <h2 className="text-xl font-bold text-foreground mb-6 capitalize">
            {activeSection}
          </h2>
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-muted-foreground">Content area for {activeSection}</p>
          </div>
        </section>
      ) : null}
    </div>
  )
}
