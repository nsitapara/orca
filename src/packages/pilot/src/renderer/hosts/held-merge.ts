import { useEffect, useMemo, useState } from 'react'
import type { HostRead } from './host-poll'

// A new poll (another person) starts with no answers; the last merged answer stays until one arrives, as before.
export function useHeldMerge<R, T>(
  reads: readonly HostRead<R>[],
  merge: (reads: readonly HostRead<R>[]) => T
): T | null {
  const merged = useMemo(
    () => (reads.some((r) => r.value !== null) ? merge(reads) : null),
    [reads, merge]
  )
  const [held, setHeld] = useState<T | null>(null)
  useEffect(() => {
    if (merged !== null) {
      setHeld(merged)
    }
  }, [merged])
  return merged ?? held
}
