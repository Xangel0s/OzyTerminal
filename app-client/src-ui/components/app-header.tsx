'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Bell, Grid3x3, Plus, Terminal, Zap, Minimize2, Maximize2, X as CloseIcon } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface AppHeaderProps {
  activeTab: 'sftp' | 'ssh'
  activeSection: string
  onTabChange: (tab: 'sftp' | 'ssh') => void
  onAddSsh?: () => void
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
  onTabChange,
  onAddSsh,
}: AppHeaderProps) {
  const appWindow = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ 
    ? getCurrentWindow() 
    : null

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
            <span className="hidden sm:inline">{tab.label}</span>
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
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
        </Button>

        <Button variant="ghost" size="icon" aria-label="Toggle view">
          <Grid3x3 className="w-5 h-5" />
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
