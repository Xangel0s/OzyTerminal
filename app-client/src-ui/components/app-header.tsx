'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  Bell,
  Grid3x3,
  Plus,
  Terminal,
  Zap,
  Minimize2,
  Maximize2,
  X as CloseIcon,
  Rows3,
  CheckCheck,
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type HeaderNotification = {
  id: string
  title: string
  detail: string
}

interface AppHeaderProps {
  activeTab: 'sftp' | 'ssh'
  activeSection: string
  sftpSessionTitle?: string | null
  sshSessionTitle?: string | null
  onTabChange: (tab: 'sftp' | 'ssh') => void
  onAddSsh?: () => void
  hostViewMode?: 'grid' | 'list'
  onToggleHostView?: () => void
  notifications?: HeaderNotification[]
  onClearNotifications?: () => void
}

const tabs = [
  { id: 'sftp' as const, label: 'SFTP', icon: <Zap className="w-4 h-4" /> },
  {
    id: 'ssh' as const,
    label: 'SSH',
    icon: <Terminal className="w-4 h-4" />,
  },
]

export function AppHeader({
  activeTab,
  activeSection,
  sftpSessionTitle,
  sshSessionTitle,
  onTabChange,
  onAddSsh,
  hostViewMode = 'list',
  onToggleHostView,
  notifications = [],
  onClearNotifications,
}: AppHeaderProps) {
  const appWindow = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ 
    ? getCurrentWindow() 
    : null
  const hasNotifications = notifications.length > 0
  const canToggleHostView = activeSection === 'hosts'
  const sftpTabLabel = activeTab === 'sftp' && activeSection === 'sessions' && sftpSessionTitle
    ? sftpSessionTitle
    : 'SFTP'
  const sshTabLabel = activeTab === 'ssh' && activeSection === 'sessions' && sshSessionTitle
    ? sshSessionTitle
    : 'SSH'

  const minimizeWindow = () => appWindow?.minimize()
  const toggleMaximize = () => appWindow?.toggleMaximize()
  const closeWindow = () => appWindow?.close()

  return (
    <header 
      className="sticky top-0 w-full h-16 bg-card border-b border-border flex items-center px-6 gap-4 shrink-0 z-30"
      data-tauri-drag-region
    >
      {/* Tabs */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1" data-no-drag="true">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors text-sm font-medium ${
              activeTab === tab.id && activeSection === 'sessions'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            <span className="hidden max-w-40 truncate sm:inline" title={tab.id === 'ssh' ? sshTabLabel : sftpTabLabel}>
              {tab.id === 'ssh' ? sshTabLabel : sftpTabLabel}
            </span>
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1 h-full" data-tauri-drag-region />

      {/* Add SSH Button - Always visible */}
      <Button
        onClick={onAddSsh}
        className="bg-accent hover:bg-accent/90 text-accent-foreground hidden sm:flex"
        size="sm"
        data-no-drag="true"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add SSH
      </Button>

      {/* Search */}
      <div className="hidden sm:flex items-center max-w-xs" data-no-drag="true">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-9 pr-3 bg-input border-border text-foreground text-sm"
          />
        </div>
      </div>

      {/* Notifications and Utils */}
      <div className="flex items-center gap-1" data-no-drag="true">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {hasNotifications ? <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-card" /> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between gap-3">
              <span>Notifications</span>
              <span className="text-xs font-normal text-muted-foreground">{notifications.length} pending</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasNotifications ? (
              notifications.map((notification) => (
                <DropdownMenuItem key={notification.id} className="flex flex-col items-start gap-1 py-3">
                  <span className="text-sm font-medium text-foreground">{notification.title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{notification.detail}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled className="py-3 text-muted-foreground">
                No pending notifications.
              </DropdownMenuItem>
            )}
            {hasNotifications && onClearNotifications ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClearNotifications} className="gap-2">
                  <CheckCheck className="h-4 w-4" />
                  Mark all as read
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant={canToggleHostView ? 'secondary' : 'ghost'}
          size="icon"
          aria-label="Toggle host view"
          onClick={onToggleHostView}
          disabled={!canToggleHostView || !onToggleHostView}
          title={hostViewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
        >
          {hostViewMode === 'grid' ? <Rows3 className="w-5 h-5" /> : <Grid3x3 className="w-5 h-5" />}
        </Button>
      </div>

      {/* Window Controls */}
      <div className="flex items-center ml-2 border-l pl-2 border-border" data-no-drag="true">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-secondary" 
          onClick={minimizeWindow}
          title="Minimizar"
        >
          <Minimize2 className="w-4 h-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-secondary" 
          onClick={toggleMaximize}
          title="Maximizar"
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 hover:bg-destructive/20 text-muted-foreground hover:text-destructive" 
          onClick={closeWindow}
          title="Cerrar"
        >
          <CloseIcon className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}
