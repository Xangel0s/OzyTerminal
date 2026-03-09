import { useCallback, useEffect, useState } from 'react'
import type { SetStateAction } from 'react'

export function usePersistedCollection<T>(storageKey: string, initialValue: T[] = []) {
  const [items, setItems] = useState<T[]>(initialValue)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      const rawValue = window.localStorage.getItem(storageKey)
      if (!rawValue) {
        setItems(initialValue)
        return
      }

      const parsed = JSON.parse(rawValue) as T[]
      setItems(Array.isArray(parsed) ? parsed : initialValue)
    } catch {
      setItems(initialValue)
    }
  }, [storageKey])

  const updateItems = useCallback(
    (nextValue: SetStateAction<T[]>) => {
      setItems((currentItems) => {
        const resolvedItems =
          typeof nextValue === 'function'
            ? (nextValue as (currentItems: T[]) => T[])(currentItems)
            : nextValue

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(storageKey, JSON.stringify(resolvedItems))
        }

        return resolvedItems
      })
    },
    [storageKey],
  )

  return [items, updateItems] as const
}