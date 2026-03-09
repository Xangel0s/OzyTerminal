'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  LocalDirectoryEntry,
  LocalDirectoryResponse,
  RemoteDirectoryResponse,
  SftpRemoteConnectionDraft,
  SshSessionRequest,
} from '@/lib/types'

const DEFAULT_REMOTE_DRAFT: SftpRemoteConnectionDraft = {
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKeyPem: '',
  privateKeyPassphrase: '',
  knownHostFingerprint: '',
  startPath: '/',
}

function isTauriRuntimeAvailable() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntimeAvailable()) {
    throw new Error('Tauri runtime is unavailable')
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

function buildRemoteRequest(draft: SftpRemoteConnectionDraft): SshSessionRequest {
  return {
    host: draft.host.trim(),
    port: draft.port,
    username: draft.username.trim(),
    password: draft.password?.trim() || undefined,
    privateKeyPem: draft.privateKeyPem.trim(),
    privateKeyPassphrase: draft.privateKeyPassphrase?.trim() || undefined,
    knownHostFingerprint: draft.knownHostFingerprint?.trim() || undefined,
    cols: 120,
    rows: 34,
  }
}

export function useSftp() {
  // Local File System State
  const [localPath, setLocalPath] = useState('C:/')
  const [localEntries, setLocalEntries] = useState<LocalDirectoryEntry[]>([])
  const [isLocalLoading, setIsLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Remote File System State
  const [remoteDraft, setRemoteDraft] = useState<SftpRemoteConnectionDraft>(DEFAULT_REMOTE_DRAFT)
  const [remotePath, setRemotePath] = useState('/')
  const [remoteEntries, setRemoteEntries] = useState<LocalDirectoryEntry[]>([])
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [remoteParentPath, setRemoteParentPath] = useState<string | null>(null)
  const [isRemoteConnected, setIsRemoteConnected] = useState(false)

  // Fetch Local Directory
  const fetchLocalDirectory = useCallback(async () => {
    setIsLocalLoading(true)
    setLocalError(null)
    try {
      const response = await invokeTauri<LocalDirectoryResponse>('list_local_directory_command', {
        path: localPath,
      })
      setLocalEntries(response.entries)
      setParentPath(response.parentPath ?? null)
    } catch (error) {
      console.error('Failed to list local directory:', error)
      setLocalError(String(error))
      setLocalEntries([])
      setParentPath(null)
    } finally {
      setIsLocalLoading(false)
    }
  }, [localPath])

  useEffect(() => {
    fetchLocalDirectory()
  }, [fetchLocalDirectory, reloadToken])

  // Filtering
  const visibleLocalEntries = useMemo(() => {
    if (showHidden) return localEntries
    return localEntries.filter((entry) => !entry.name.startsWith('.'))
  }, [showHidden, localEntries])

  const visibleRemoteEntries = useMemo(() => {
    if (showHidden) return remoteEntries
    return remoteEntries.filter((entry) => !entry.name.startsWith('.'))
  }, [showHidden, remoteEntries])

  const updateRemoteDraft = useCallback((updates: Partial<SftpRemoteConnectionDraft>) => {
    setRemoteDraft((current: SftpRemoteConnectionDraft) => ({ ...current, ...updates }))
  }, [])

  const fetchRemoteDirectory = useCallback(
    async (targetPath?: string) => {
      setIsRemoteLoading(true)
      setRemoteError(null)

      try {
        const request = buildRemoteRequest(remoteDraft)
        const response = await invokeTauri<RemoteDirectoryResponse>('list_remote_directory_command', {
          request,
          path: targetPath ?? remotePath,
        })

        setRemoteEntries(response.entries)
        setRemotePath(response.currentPath)
        setRemoteParentPath(response.parentPath ?? null)
        setIsRemoteConnected(true)
      } catch (error) {
        console.error('Failed to list remote directory:', error)
        setRemoteError(String(error))
        setRemoteEntries([])
        setRemoteParentPath(null)
        setIsRemoteConnected(false)
      } finally {
        setIsRemoteLoading(false)
      }
    },
    [remoteDraft, remotePath],
  )

  // Actions
  const navigateLocal = useCallback((path: string) => {
    setLocalPath(path)
  }, [])

  const navigateLocalUp = useCallback(() => {
    if (parentPath) {
      setLocalPath(parentPath)
    }
  }, [parentPath])

  const refreshLocal = useCallback(() => {
    setReloadToken((t) => t + 1)
  }, [])

  const toggleHidden = useCallback(() => {
    setShowHidden((prev) => !prev)
  }, [])

  const connectRemote = useCallback(async () => {
    const targetPath = remoteDraft.startPath?.trim() || remotePath || '/'
    await fetchRemoteDirectory(targetPath)
  }, [fetchRemoteDirectory, remoteDraft.startPath, remotePath])

  const navigateRemote = useCallback(
    async (path: string) => {
      await fetchRemoteDirectory(path)
    },
    [fetchRemoteDirectory],
  )

  const navigateRemoteUp = useCallback(async () => {
    if (remoteParentPath) {
      await fetchRemoteDirectory(remoteParentPath)
    }
  }, [fetchRemoteDirectory, remoteParentPath])

  const refreshRemote = useCallback(async () => {
    if (isRemoteConnected) {
      await fetchRemoteDirectory(remotePath)
    }
  }, [fetchRemoteDirectory, isRemoteConnected, remotePath])

  const disconnectRemote = useCallback(() => {
    setIsRemoteConnected(false)
    setRemoteEntries([])
    setRemoteParentPath(null)
    setRemotePath('/')
    setRemoteError(null)
  }, [])

  return {
    localPath,
    localEntries: visibleLocalEntries,
    isLocalLoading,
    localError,
    showHidden,
    parentPath,
    remoteDraft,
    remotePath,
    remoteEntries: visibleRemoteEntries,
    isRemoteLoading,
    remoteError,
    remoteParentPath,
    isRemoteConnected,
    navigateLocal,
    navigateLocalUp,
    refreshLocal,
    toggleHidden,
    updateRemoteDraft,
    connectRemote,
    navigateRemote,
    navigateRemoteUp,
    refreshRemote,
    disconnectRemote,
  }
}
