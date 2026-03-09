/**
 * Server/Host types
 */
export interface ServerHost {
  id: string
  name: string
  address: string
  port: number
  user: string
  status: 'online' | 'offline' | 'connecting'
  lastConnected: string
  keyId?: string
  tags?: string[]
}

/**
 * User types
 */
export interface User {
  id: string
  name: string
  email: string
  avatar: string
  role: 'admin' | 'operator' | 'support' | 'viewer'
  status: 'active' | 'idle' | 'away' | 'offline'
}

/**
 * Terminal types
 */
export interface TerminalLine {
  type: 'command' | 'output' | 'error'
  content: string
  timestamp: Date
}

export interface TerminalSession {
  id: string
  serverId: string
  userId: string
  createdAt: Date
  closedAt?: Date
  lines: TerminalLine[]
}

/**
 * Collaboration types
 */
export interface CollaborationUser {
  id: string
  name: string
  avatar: string
  status: 'active' | 'idle' | 'away'
  role: string
  cursorPosition?: { x: number; y: number }
}

export interface Message {
  id: string
  userId: string
  userName: string
  userAvatar: string
  content: string
  timestamp: Date
  edited?: Date
}

export interface Activity {
  id: string
  userId: string
  userName: string
  action: string
  targetId?: string
  targetName?: string
  timestamp: Date
}

/**
 * SSH Key types
 */
export interface SSHKey {
  id: string
  name: string
  fingerprint: string
  public_key: string
  createdAt: Date
  lastUsed?: Date
}

/**
 * Port Forwarding types
 */
export interface PortForwardingRule {
  id: string
  name: string
  serverId: string
  localPort: number
  remoteHost: string
  remotePort: number
  isActive: boolean
  createdAt: Date
}
