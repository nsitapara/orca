// Which engine's automations Pilot shows: its own (the fallback) or pilotd's, whose dashboard then fills the Automations
// page. It changes what Pilot shows, never what either engine runs.
export type AutomationEngine = 'builtin' | 'pilotd'

// Composed into upstream's GlobalSettingsBase (pilot-hook: automation-engine-settings).
export type AutomationEngineSettings = {
  /** Absent means the built-in engine. */
  pilotAutomationEngine?: AutomationEngine
  /** pilotd's dashboard and API. Absent or blank means DEFAULT_PILOTD_ADDRESS. */
  pilotdAddress?: string
}

export const DEFAULT_PILOTD_ADDRESS = 'http://127.0.0.1:8787'

export function automationEngine(saved: unknown): AutomationEngine {
  return saved === 'pilotd' ? 'pilotd' : 'builtin'
}

/** The address's origin (`http://host:port`), the default when blank, or null when it isn't an http(s) address. */
export function pilotdOrigin(saved: unknown): string | null {
  const text = typeof saved === 'string' ? saved.trim() : ''
  if (text === '') {
    return DEFAULT_PILOTD_ADDRESS
  }
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

// What pilotd's GET /health says, as Pilot shows it. Never the raw body.
export type PilotdHealth =
  | { reachable: true; engineRunning: boolean; build: string | null }
  | { reachable: false; error: string }

// GET /counts, numbers only; null when pilotd didn't answer with them.
export type PilotdCounts = {
  running: number
  queued: number
  needsYou: { cards: number; sessions: number }
  failedToday: number
  gaveUp: number
  engineRunning: boolean
}
