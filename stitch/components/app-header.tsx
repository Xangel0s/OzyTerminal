'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Bell, Grid3x3, Plus, Terminal, Zap } from 'lucide-react'

interface AppHeaderProps {
  activeTab: 'sftp' | 'ssh'
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
  onTabChange,
  onAddSsh,
}: AppHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border flex items-center px-6 gap-4 z-20 lg:left-64">
      {/* Tabs */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors text-sm font-medium ${
              activeTab === tab.id
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
      <div className="flex-1" />

      {/* Add SSH Button - Always visible */}
      <Button
        onClick={onAddSsh}
        className="bg-accent hover:bg-accent/90 text-accent-foreground hidden sm:flex"
        size="sm"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add SSH
      </Button>

      {/* Search */}
      <div className="hidden sm:flex items-center max-w-xs">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-9 pr-3 bg-input border-border text-foreground text-sm"
          />
        </div>
      </div>

      {/* Notifications */}
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full" />
      </Button>

      {/* View Toggle */}
      <Button variant="ghost" size="icon" aria-label="Toggle view">
        <Grid3x3 className="w-5 h-5" />
      </Button>
    </header>
  )
}
