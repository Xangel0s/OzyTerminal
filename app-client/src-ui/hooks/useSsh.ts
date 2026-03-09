'use client'

import { useState, useCallback } from 'react'
import { SshSessionRequest } from '@/lib/types'

export type ConnectionStep = 'search' | 'ip' | 'user' | 'password' | 'connecting' | 'connected'

export function useSsh() {
  const [activeStep, setActiveStep] = useState<ConnectionStep>('search')
  const [draftConnection, setDraftConnection] = useState<Partial<SshSessionRequest>>({
    port: 22,
    cols: 120,
    rows: 34,
  })
  const [sessions, setSessions] = useState<SshSessionRequest[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const updateDraft = useCallback((updates: Partial<SshSessionRequest>) => {
    setDraftConnection((prev) => ({ ...prev, ...updates }))
  }, [])

  const nextStep = useCallback(() => {
    setActiveStep((current) => {
      switch (current) {
        case 'search': return 'ip'
        case 'ip': return 'user'
        case 'user': return 'password'
        case 'password': return 'connecting'
        default: return current
      }
    })
  }, [])

  const prevStep = useCallback(() => {
    setActiveStep((current) => {
      switch (current) {
        case 'ip': return 'search'
        case 'user': return 'ip'
        case 'password': return 'user'
        case 'connecting': return 'password'
        default: return current
      }
    })
  }, [])

  const resetWizard = useCallback(() => {
    setActiveStep('search')
    setDraftConnection({ port: 22, cols: 120, rows: 34 })
  }, [])

  return {
    activeStep,
    draftConnection,
    sessions,
    activeSessionId,
    updateDraft,
    nextStep,
    prevStep,
    resetWizard,
    setActiveStep,
    setSessions,
    setActiveSessionId
  }
}
