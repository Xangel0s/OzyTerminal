'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Users,
  Send,
  Phone,
  Video,
  Eye,
  X,
  Clock,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { usePersistedCollection } from '@/hooks/usePersistedCollection'

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
  timestamp: string
}

interface CollaborationPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function CollaborationPanel({ isOpen, onClose }: CollaborationPanelProps) {
  const [messages, setMessages] = usePersistedCollection<Message>('ozyterminal.collaboration-messages')
  const [newMessage, setNewMessage] = useState('')
  const [users] = useState<CollaborativeUser[]>([])

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      const message: Message = {
        id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
        userId: 'local-user',
        userName: 'You',
        userAvatar: 'YO',
        content: newMessage,
        timestamp: new Date().toISOString(),
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
        {users.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            No active collaborators connected.
          </div>
        ) : (
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
        )}
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
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            No messages yet. Start the conversation from this device.
          </div>
        ) : (
          messages.map((msg) => (
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
                    {new Date(msg.timestamp).toLocaleTimeString([], {
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
          ))
        )}
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
