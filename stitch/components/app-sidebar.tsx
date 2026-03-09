'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Server,
  Key,
  ArrowRight,
  Code2,
  Shield,
  Clock,
  Menu,
  X,
} from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  href: string
}

const navItems: NavItem[] = [
  { id: 'hosts', label: 'Hosts', icon: <Server className="w-5 h-5" />, href: '/hosts' },
  { id: 'keychain', label: 'Keychain', icon: <Key className="w-5 h-5" />, href: '/keychain' },
  {
    id: 'port-forward',
    label: 'Port Forwarding',
    icon: <ArrowRight className="w-5 h-5" />,
    href: '/port-forward',
  },
  { id: 'snippets', label: 'Snippets', icon: <Code2 className="w-5 h-5" />, href: '/snippets' },
  {
    id: 'known-hosts',
    label: 'Known Hosts',
    icon: <Shield className="w-5 h-5" />,
    href: '/known-hosts',
  },
  { id: 'logs', label: 'Logs', icon: <Clock className="w-5 h-5" />, href: '/logs' },
]

interface AppSidebarProps {
  activeSection?: string
  onSectionChange?: (section: string) => void
}

export function AppSidebar({
  activeSection = 'hosts',
  onSectionChange,
}: AppSidebarProps) {
  const [isOpen, setIsOpen] = useState(true)
  const pathname = usePathname()

  return (
    <>
      {/* Mobile toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 lg:hidden bg-sidebar hover:bg-secondary rounded-lg text-sidebar-foreground"
        aria-label="Toggle sidebar"
      >
        {isOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <Menu className="w-5 h-5" />
        )}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } w-64 flex flex-col z-40`}
      >
        {/* Logo/Branding */}
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <span className="text-sidebar-primary-foreground font-bold text-sm">
                AT
              </span>
            </div>
            <h1 className="text-lg font-bold text-sidebar-foreground">
              AdminTerminal
            </h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">
          <div className="space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname?.includes(item.id)
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => {
                    onSectionChange?.(item.id)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-secondary'
                  }`}
                >
                  {item.icon}
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border">
          <Button
            variant="outline"
            className="w-full justify-center"
            size="sm"
          >
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden z-30"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
