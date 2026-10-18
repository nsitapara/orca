import { useEffect, useState } from 'react'
import type {
  TelemetryParams,
  TelemetryPayload,
  TelemetryWindow
} from '../../../../shared/api-types-telemetry'
import { pilotRpc } from '../../../api'
import { isPayload, UNREADABLE_ANSWER } from './telemetry-view'

// No fast polling: every read writes its own telemetry line (caller app).
export const TELEMETRY_REFRESH_MS = 120_000
// The service may read the catalog, the usage and the calls, 10 s each.
const RPC_TIMEOUT_MS = 35_000

export type TelemetryAsk = { since: TelemetryWindow; includeDev: boolean; command: string | null }
export type TelemetryData = Extract<TelemetryPayload, { usage: unknown }>
// The last answer read and what it answers, so its labels say its window while another one loads.
export type TelemetryShown = { payload: TelemetryData; ask: TelemetryAsk }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// pilotcli's telemetry through Pilot: read on mount, on a change, on refresh(), when the window shows again, and every
// TELEMETRY_REFRESH_MS while it shows. `active` false (the tab is hidden) stops reading; turning it on reads again.
// A failed read keeps the last data and sets `error` beside it.
export function useTelemetry(p: TelemetryAsk & { active?: boolean }) {
  const [shown, setShown] = useState<TelemetryShown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [asked, setAsked] = useState(0)
  const { since, includeDev, command, active = true } = p
  useEffect(() => {
    if (!active) {
      return
    }
    let alive = true
    const ask: TelemetryAsk = { since, includeDev, command }
    const params: TelemetryParams = command ? { since, includeDev, command } : { since, includeDev }
    // Data replaces the last data; an error, or a shape this page doesn't read, sits beside it.
    const take = (answer: unknown): void => {
      if (!alive) {
        return
      }
      if (!isPayload(answer)) {
        setError(UNREADABLE_ANSWER)
        return
      }
      if ('error' in answer) {
        setError(answer.error)
        return
      }
      setError(null)
      setShown({ payload: answer, ask })
    }
    const load = (): void => {
      if (document.hidden) {
        return
      }
      setLoading(true)
      pilotRpc<unknown>('pilot.telemetry.get', params, { timeoutMs: RPC_TIMEOUT_MS })
        .then(take, (e: unknown) => alive && setError(messageOf(e)))
        .finally(() => alive && setLoading(false))
    }
    const onVisible = (): void => {
      if (!document.hidden) {
        load()
      }
    }
    load()
    const timer = setInterval(load, TELEMETRY_REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      setLoading(false)
    }
  }, [since, includeDev, command, active, asked])
  return { shown, error, loading, refresh: () => setAsked((n) => n + 1) }
}
