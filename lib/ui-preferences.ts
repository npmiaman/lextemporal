'use client'

import { useSyncExternalStore } from 'react'

// localStorage-backed UI preferences (sidebar width, appearance, ...).
// useSyncExternalStore keeps SSR hydration clean: the server snapshot renders
// the default and the client value takes over after hydration - no mismatch,
// no setState-in-effect cascade.
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function writeUiPreference(key: string, value: string): void {
  localStorage.setItem(key, value)
  for (const listener of listeners) listener()
}

export function usePersistedWidth(key: string, fallback: number, min: number, max: number): number {
  return useSyncExternalStore(
    subscribe,
    () => Math.min(max, Math.max(min, Number(localStorage.getItem(key)) || fallback)),
    () => fallback,
  )
}

export function usePersistedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  return useSyncExternalStore(
    subscribe,
    () => {
      const raw = localStorage.getItem(key)
      return allowed.includes(raw as T) ? (raw as T) : fallback
    },
    () => fallback,
  )
}
