import { statSync } from 'node:fs'
import { z } from 'zod'
import {
  TelemetryCallsSchema,
  TelemetryUsageSchema,
  type TelemetryFailures,
  type TelemetryParams,
  type TelemetryPayload,
  type TelemetryUsage
} from '../../shared/api-types-telemetry'
import { pilotcliPath, type Pilotcli, type PilotcliReply } from '../envs/pilotcli'

export const TELEMETRY_TIMEOUT_MS = 10_000
export const TELEMETRY_CACHE_MS = 30_000
export const FAILURES_SHOWN = 50
export const NEEDS_NEWER_PILOTCLI =
  'This pilotcli lists no calls yet: install a newer one (self list-telemetry-calls)'
export const UNREADABLE = "pilotcli answered in a shape Pilot doesn't read"

// What the installed pilotcli can do: --series on get-telemetry, and list-telemetry-calls.
export type TelemetryFeatures = { series: boolean; calls: boolean }
const NONE: TelemetryFeatures = { series: false, calls: false }

const Catalog = z.object({
  modules: z.array(
    z.object({
      commands: z.array(
        z.object({ command: z.string(), flags: z.array(z.object({ name: z.string() })) })
      )
    })
  )
})

// The features `self list-commands`' data lists; none when it can't be read.
export function featuresOf(data: unknown): TelemetryFeatures {
  const parsed = Catalog.safeParse(data)
  if (!parsed.success) {
    return NONE
  }
  const commands = parsed.data.modules.flatMap((m) => m.commands)
  const get = commands.find((c) => c.command === 'self get-telemetry')
  return {
    series: get?.flags.some((f) => f.name === 'series') ?? false,
    calls: commands.some((c) => c.command === 'self list-telemetry-calls')
  }
}

export function usageArgs(p: TelemetryParams, series: boolean): string[] {
  const args = ['self', 'get-telemetry', '--since', p.since, '--include-dev', String(p.includeDev)]
  if (series) {
    args.push('--series', 'day')
  }
  return [...args, '--format', 'json']
}

// The command is a name only (pilot.telemetry.get's params check it), so the quoted condition can't carry more.
export function callsArgs(p: TelemetryParams): string[] {
  const args = ['self', 'list-telemetry-calls', 'outcome=failed,invalid']
  if (p.command) {
    args.push(`command="${p.command}"`)
  }
  return [
    ...args,
    '--since',
    p.since,
    '--include-dev',
    String(p.includeDev),
    '--limit',
    String(FAILURES_SHOWN + 1),
    '--format',
    'json'
  ]
}

// The window's failed and invalid calls: one command's, or every command's.
function badCalls(usage: TelemetryUsage, command: string | undefined): number {
  const rows = command ? usage.commands.filter((c) => c.command === command) : usage.commands
  return rows.reduce((n, c) => n + c.failed + c.invalid, 0)
}

function reasonOf(reply: PilotcliReply, what: string): string {
  return reply.reason || `pilotcli ${what}: ${reply.outcome}`
}

function installed(): { path: string; mtimeMs: number } | null {
  const path = pilotcliPath()
  if (!path) {
    return null
  }
  try {
    return { path, mtimeMs: statSync(path).mtimeMs }
  } catch {
    return null
  }
}

type Entry<T> = { at: number; value: Promise<T> }

function cached<T>(
  store: Map<string, Entry<T>>,
  key: string,
  now: number,
  load: () => Promise<T>
): Entry<T> {
  const hit = store.get(key)
  if (hit && now - hit.at < TELEMETRY_CACHE_MS) {
    return hit
  }
  const entry = { at: now, value: load() }
  store.set(key, entry)
  return entry
}

export type TelemetryService = { get(p: TelemetryParams): Promise<TelemetryPayload> }

// pilotcli's telemetry on this Mac, read through pilotcli (never the file), 30 s at a time.
export function telemetryService(deps: {
  pilotcli: Pilotcli
  binary?: () => { path: string; mtimeMs: number } | null
  now?: () => number
}): TelemetryService {
  const now = deps.now ?? Date.now
  const binary = deps.binary ?? installed
  const call = (args: string[]) => deps.pilotcli({ args, timeoutMs: TELEMETRY_TIMEOUT_MS })
  let probe: { key: string; features: Promise<TelemetryFeatures> } | null = null
  const usages = new Map<string, Entry<TelemetryUsage | string>>()
  const failures = new Map<string, Entry<TelemetryFailures>>()

  // Read once per installed binary: a new install (another path or mtime) is read again; a failed read isn't kept.
  function features(): Promise<TelemetryFeatures> {
    const b = binary()
    const key = b ? `${b.path}:${b.mtimeMs}` : ''
    if (probe?.key !== key) {
      const read = call(['self', 'list-commands', '--format', 'json']).then((r) =>
        r.outcome === 'ok' ? featuresOf(r.data) : null
      )
      const mine = { key, features: read.then((f) => f ?? NONE) }
      probe = mine
      void read.then((f) => {
        if (f === null && probe === mine) {
          probe = null
        }
      })
    }
    return probe.features
  }

  async function readUsage(p: TelemetryParams): Promise<TelemetryUsage | string> {
    const reply = await call(usageArgs(p, (await features()).series))
    if (reply.outcome !== 'ok') {
      return reasonOf(reply, 'self get-telemetry')
    }
    const parsed = TelemetryUsageSchema.safeParse(reply.data)
    return parsed.success ? parsed.data : UNREADABLE
  }

  async function readFailures(
    p: TelemetryParams,
    usage: TelemetryUsage
  ): Promise<TelemetryFailures> {
    if (!(await features()).calls) {
      return { unavailable: NEEDS_NEWER_PILOTCLI }
    }
    if (badCalls(usage, p.command) === 0) {
      return { calls: [], more: false }
    }
    const reply = await call(callsArgs(p))
    if (reply.outcome !== 'ok') {
      return { unavailable: reasonOf(reply, 'self list-telemetry-calls') }
    }
    const parsed = TelemetryCallsSchema.safeParse(reply.data)
    if (!parsed.success) {
      return { unavailable: UNREADABLE }
    }
    return {
      calls: parsed.data.slice(0, FAILURES_SHOWN),
      more: parsed.data.length > FAILURES_SHOWN
    }
  }

  return {
    async get(p) {
      const window = `${p.since}|${p.includeDev}`
      const entry = cached(usages, window, now(), () => readUsage(p))
      const usage = await entry.value
      if (typeof usage === 'string') {
        usages.delete(window)
        return { fetchedAt: entry.at, error: usage }
      }
      const bad = cached(failures, `${window}|${p.command ?? ''}`, entry.at, () =>
        readFailures(p, usage)
      )
      return { fetchedAt: entry.at, usage, failures: await bad.value }
    }
  }
}
