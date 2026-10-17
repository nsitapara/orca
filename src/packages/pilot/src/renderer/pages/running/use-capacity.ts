import { useEffect, useRef, useState } from 'react'
import type { CapacityPayload } from '../../../shared/api-types-capacity'
import { pilotRpc } from '../../api'

// Runs start and end within a few seconds of each other; the memory behind the figures is sampled every 15 s.
export const CAPACITY_POLL_MS = 5_000

export type CapacityState = {
  payload: CapacityPayload | null
  error: string | null
  saving: boolean
  setLimit(limit: number | null): Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useCapacity(): CapacityState {
  const [payload, setPayload] = useState<CapacityPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // A poll answered after a change was asked for would show the old limit again.
  const changes = useRef(0)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      if (document.hidden) {
        return
      }
      const asked = changes.current
      pilotRpc<CapacityPayload>('pilot.capacity.get').then(
        (p) => {
          if (alive && asked === changes.current) {
            setPayload(p)
            setError(null)
          }
        },
        (e) => alive && setError(messageOf(e))
      )
    }
    load()
    const timer = setInterval(load, CAPACITY_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const setLimit = async (limit: number | null): Promise<void> => {
    changes.current += 1
    setSaving(true)
    try {
      setPayload(await pilotRpc<CapacityPayload>('pilot.capacity.setLimit', { limit }))
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSaving(false)
    }
  }

  return { payload, error, saving, setLimit }
}
