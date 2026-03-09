import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSftp } from '../../hooks/useSftp'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('useSftp', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    invokeMock.mockReset()
  })

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    cleanup()
  })

  it('loads the local directory on mount', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_local_directory_command') {
        return Promise.resolve({
          currentPath: 'C:/',
          parentPath: undefined,
          entries: [{
            name: 'Users',
            path: 'C:/Users/',
            kind: 'folder',
            entryType: 'folder',
          }],
        })
      }

      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const { result } = renderHook(() => useSftp())

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_local_directory_command', {
        path: 'C:/',
      })
    })

    expect(result.current.localEntries).toHaveLength(1)
    expect(result.current.localPath).toBe('C:/')
  })

  it('connects and navigates the remote directory through the tauri command', async () => {
    invokeMock.mockImplementation((command: string, payload: Record<string, unknown>) => {
      if (command === 'list_local_directory_command') {
        return Promise.resolve({
          currentPath: 'C:/',
          parentPath: undefined,
          entries: [],
        })
      }

      if (command === 'list_remote_directory_command') {
        if (payload.path === '/srv') {
          return Promise.resolve({
            currentPath: '/srv/',
            parentPath: '/',
            entries: [{
              name: 'releases',
              path: '/srv/releases/',
              kind: 'folder',
              entryType: 'folder',
            }],
          })
        }

        return Promise.resolve({
          currentPath: '/srv/releases/',
          parentPath: '/srv/',
          entries: [{
            name: 'notes.txt',
            path: '/srv/releases/notes.txt',
            kind: 'txt',
            entryType: 'file',
            sizeBytes: 512,
          }],
        })
      }

      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const { result } = renderHook(() => useSftp())

    await act(async () => {
      result.current.updateRemoteDraft({
        host: 'example.com',
        username: 'ops',
        port: 2222,
        password: 'secret',
        startPath: '/srv',
      })
    })

    await act(async () => {
      await result.current.connectRemote()
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_directory_command', {
        request: expect.objectContaining({
          host: 'example.com',
          port: 2222,
          username: 'ops',
          password: 'secret',
          cols: 120,
          rows: 34,
        }),
        path: '/srv',
      })
    })

    expect(result.current.isRemoteConnected).toBe(true)
    expect(result.current.remotePath).toBe('/srv/')
    expect(result.current.remoteEntries).toHaveLength(1)

    await act(async () => {
      await result.current.navigateRemote('/srv/releases/')
    })

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('list_remote_directory_command', {
        request: expect.objectContaining({
          host: 'example.com',
          username: 'ops',
        }),
        path: '/srv/releases/',
      })
    })

    expect(result.current.remotePath).toBe('/srv/releases/')
  })
})
