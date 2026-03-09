'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Users,
  MessageCircle,
  Send,
  Phone,
  Video,
  Eye,
  X,
  User,
  Clock,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface CollaborativeUser {
  id: string
  name: string
  avatar: string
  status: 'active' | 'idle' | 'away'
  role: string
  cursorPosition?: { x: number; y: number }
}

interface Message {
  id: string
  userId: string
  userName: string
  userAvatar: string
  content: string
  timestamp: Date
}

const mockUsers: CollaborativeUser[] = [
  {
    id: '1',
    name: 'Alex Johnson',
    avatar: 'AJ',
    status: 'active',
    role: 'Admin',
  },
  {
    id: '2',
    name: 'Sarah Chen',
    avatar: 'SC',
    status: 'active',
    role: 'Operator',
  },
  {
    id: '3',
    name: 'Mike Russell',
    avatar: 'MR',
    status: 'idle',
    role: 'Support',
  },
]

const mockMessages: Message[] = [
  {
    id: '1',
    userId: '2',
    userName: 'Sarah Chen',
    userAvatar: 'SC',
    content: 'Server reboot initiated',
    timestamp: new Date(Date.now() - 5 * 60000),
  },
  {
    id: '2',
    userId: '1',
    userName: 'Alex Johnson',
    userAvatar: 'AJ',
    content: 'Confirmed. Monitoring systems online',
    timestamp: new Date(Date.now() - 3 * 60000),
  },
  {
    id: '3',
    userId: '3',
    userName: 'Mike Russell',
    userAvatar: 'MR',
    content: 'All services responding normally',
    timestamp: new Date(Date.now() - 1 * 60000),
  },
]

interface CollaborationPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function CollaborationPanel({ isOpen, onClose }: CollaborationPanelProps) {
  const [messages, setMessages] = useState<Message[]>(mockMessages)
  const [newMessage, setNewMessage] = useState('')
  const [users, setUsers] = useState<CollaborativeUser[]>(mockUsers)

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      const message: Message = {
        id: String(messages.length + 1),
        userId: '1',
        userName: 'You',
        userAvatar: 'AJ',
        content: newMessage,
        timestamp: new Date(),
      }
      setMessages([...messages, message])
      setNewMessage('')
    }
  }

  const getStatusColor = (status: CollaborativeUser['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500'
      case 'idle':
        return 'bg-yellow-500'
      case 'away':
        return 'bg-gray-500'
    }
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-card border-l border-border flex flex-col z-40 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          <h2 className="font-semibold text-foreground">Collaboration</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button className="flex-1 px-4 py-2 text-sm font-medium text-accent border-b-2 border-accent">
          Users
        </button>
        <button className="flex-1 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          Activity
        </button>
      </div>

      {/* Connected Users */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 bg-secondary rounded-lg hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-accent text-accent-foreground">
                      {user.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ${getStatusColor(user.status)} border border-card`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {user.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.role}</p>
                </div>
              </div>
              <Eye className="w-4 h-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border-t border-border p-4 space-y-2">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled
          >
            <Phone className="w-4 h-4 mr-1" />
            Call
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled
          >
            <Video className="w-4 h-4 mr-1" />
            Share
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-2">
            <Avatar className="h-6 w-6 flex-shrink-0">
              <AvatarFallback className="text-xs bg-accent text-accent-foreground">
                {msg.userAvatar}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs font-medium text-foreground">
                  {msg.userName}
                </p>
                <Clock className="w-3 h-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {msg.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <p className="text-sm text-muted-foreground bg-secondary rounded p-2">
                {msg.content}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Message Input */}
      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage()
              }
            }}
            placeholder="Type message..."
            className="bg-input border-border text-sm"
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            className="bg-accent hover:bg-accent/90"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
