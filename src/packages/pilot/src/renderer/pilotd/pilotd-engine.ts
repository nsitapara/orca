import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import {
  automationEngine,
  type AutomationEngine,
  type PilotdCounts,
  type PilotdHealth
} from '../../shared/automation-engine-settings'
import { pilotRpc } from '../api'
import type { PilotAutomationsView } from '../pages/automations-view'
import { errorText } from '../pages/format'

export function useAutomationEngine(): AutomationEngine {
  return automationEngine(useAppStore((s) => s.settings?.pilotAutomationEngine))
}

/** The saved address as typed (blank when unset). */
export function usePilotdAddress(): string {
  return useAppStore((s) => s.settings?.pilotdAddress) ?? ''
}

// Pilot's Automations sub-views and the pilotd dashboard views that replace them. Playground stays Pilot's own.
const DASHBOARD_VIEW: Record<Exclude<PilotAutomationsView, 'playground'>, string> = {
  automations: 'automations',
  running: 'overview',
  inbox: 'inbox',
  activity: 'runs',
  usage: 'usage'
}

/** The dashboard's deep link for a Pilot view, or null for a view pilotd doesn't show. An id opens that item. */
export function pilotdHash(
  view: PilotAutomationsView,
  open: { automationId?: string | null; runId?: string | null; cardId?: string | null } = {}
): string | null {
  if (view === 'playground') {
    return null
  }
  const base = DASHBOARD_VIEW[view]
  const ids: Record<string, string | null | undefined> = {
    automations: open.automationId,
    runs: open.runId,
    inbox: open.cardId
  }
  const id = ids[base]
  return id ? `#${base}/${encodeURIComponent(id)}` : `#${base}`
}

/** The sidebar's pills from pilotd's counts; nothing (no pill) when pilotd didn't answer. */
export function pilotdPills(counts: PilotdCounts | null): {
  inbox: number
  running: number
  queued: number
} {
  if (!counts) {
    return { inbox: 0, running: 0, queued: 0 }
  }
  return {
    inbox: counts.needsYou.cards + counts.needsYou.sessions,
    running: counts.running,
    queued: counts.queued
  }
}

function windowHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

// One of this machine's pilotd reads, asked now and every `intervalMs` while the window shows. `fail` (a module-level
// function) turns a failed call into a value, so nothing ever throws into the page.
function usePilotdRead<T>(
  method: string,
  address: string,
  intervalMs: number,
  enabled: boolean,
  fail: (error: string) => T
): { value: T | null; refresh(): void } {
  const [value, setValue] = useState<{ address: string; value: T } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    let alive = true
    const ask = (): void => {
      pilotRpc<T>(method, { address }, { timeoutMs: 5_000 }).then(
        (v) => alive && setValue({ address, value: v }),
        (e: unknown) => alive && setValue({ address, value: fail(errorText(e)) })
      )
    }
    ask()
    const timer = window.setInterval(() => {
      if (!windowHidden()) {
        ask()
      }
    }, intervalMs)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [method, address, intervalMs, enabled, fail, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  // A read for another address (the setting just changed) is never shown as this one's.
  return { value: enabled && value?.address === address ? value.value : null, refresh }
}

const unreachable = (error: string): PilotdHealth => ({ reachable: false, error })
const noCounts = (): PilotdCounts | null => null

export function usePilotdHealth(
  address: string,
  intervalMs: number,
  enabled = true
): { health: PilotdHealth | null; refresh(): void } {
  const { value, refresh } = usePilotdRead(
    'pilot.pilotd.health',
    address,
    intervalMs,
    enabled,
    unreachable
  )
  return { health: value, refresh }
}

export function usePilotdCounts(intervalMs: number): PilotdCounts | null {
  const address = usePilotdAddress()
  return usePilotdRead('pilot.pilotd.counts', address, intervalMs, true, noCounts).value
}

// Settings › Automations, where the engine is chosen.
export function openAutomationEngineSetting(): void {
  const state = useAppStore.getState()
  state.setSettingsSearchQuery('')
  state.openSettingsTarget({ pane: 'automations', repoId: null })
  state.openSettingsPage()
}
