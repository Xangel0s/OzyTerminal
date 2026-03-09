'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { LocalDirectoryEntry, LocalDirectoryResponse } from '@/lib/types'

export function useSftp() {
  // Local File System State
  const [localPath, setLocalPath] = useState('C:/')
  const [localEntries, setLocalEntries] = useState<LocalDirectoryEntry[]>([])
  const [isLocalLoading, setIsLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Remote File System State (Stubs for now, will connect to SSH session later)
  const [remotePath, setRemotePath] = useState('/')
  const [remoteEntries, setRemoteEntries] = useState<LocalDirectoryEntry[]>([])
  const [isRemoteLoading, setIsRemoteLoading] = useState(false)

  // Fetch Local Directory
  const fetchLocalDirectory = useCallback(async () => {
    setIsLocalLoading(true)
    setLocalError(null)
    try {
      const response = await invoke<LocalDirectoryResponse>('list_local_directory_command', {
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

  return {
    localPath,
    localEntries: visibleLocalEntries,
    isLocalLoading,
    localError,
    showHidden,
    parentPath,
    remotePath,
    remoteEntries,
    isRemoteLoading,
    navigateLocal,
    navigateLocalUp,
    refreshLocal,
    toggleHidden,
  }
}
