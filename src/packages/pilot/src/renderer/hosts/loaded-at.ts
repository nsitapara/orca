import { useLayoutEffect, useRef, useState } from 'react'
import type { HostRead } from './host-poll'

// When a machine last brought a new list: ages are measured from it, so a render never reads the clock.
export function useLoadedAt(reads: readonly HostRead<unknown>[]): number {
  const [loadedAt, setLoadedAt] = useState(0)
  const seen = useRef<ReadonlySet<unknown>>(new Set())
  // Before paint, so a new list never shows with the old clock.
  useLayoutEffect(() => {
    const values = reads.map((r) => r.value)
    const fresh = values.some((v) => v !== null && !seen.current.has(v))
    seen.current = new Set(values)
    if (fresh) {
      setLoadedAt(Date.now())
    }
  }, [reads])
  return loadedAt
}
