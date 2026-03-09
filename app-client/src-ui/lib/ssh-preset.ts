'use client'

import { SshSessionRequest } from '@/lib/types'

const PENDING_SSH_PRESET_KEY = 'ozyterminal.pending-ssh-preset'

export function writePendingSshPreset(request: Partial<SshSessionRequest>) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(PENDING_SSH_PRESET_KEY, JSON.stringify(request))
}

export function readPendingSshPreset(): Partial<SshSessionRequest> | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(PENDING_SSH_PRESET_KEY)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as Partial<SshSessionRequest>
  } catch {
    return null
  }
}

export function clearPendingSshPreset() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(PENDING_SSH_PRESET_KEY)
}