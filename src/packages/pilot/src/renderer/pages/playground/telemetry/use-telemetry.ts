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
// The answer shown and what it answers, so its labels say its window while another one loads.
export type TelemetryShown = { payload: TelemetryPayload; ask: TelemetryAsk }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// pilotcli's telemetry through Pilot: read on mount, on a change, on refresh(), and every TELEMETRY_REFRESH_MS
// while the window shows. `active` false (the tab is hidden) stops reading; turning it back on reads again.
export function useTelemetry(p: TelemetryAsk & { active?: boolean }) {
  const [shown, setShown] = useState<TelemetryShown | null>(null)
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
    const show = (payload: TelemetryPayload): void => {
      if (alive) {
        setShown({ payload, ask })
      }
    }
    const load = (): void => {
      if (document.hidden) {
        return
      }
      setLoading(true)
      pilotRpc<unknown>('pilot.telemetry.get', params, { timeoutMs: RPC_TIMEOUT_MS })
        .then(
          (answer) =>
            show(isPayload(answer) ? answer : { fetchedAt: Date.now(), error: UNREADABLE_ANSWER }),
          (e: unknown) => show({ fetchedAt: Date.now(), error: messageOf(e) })
        )
        .finally(() => alive && setLoading(false))
    }
    load()
    const timer = setInterval(load, TELEMETRY_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
      setLoading(false)
    }
  }, [since, includeDev, command, active, asked])
  return { shown, loading, refresh: () => setAsked((n) => n + 1) }
}
