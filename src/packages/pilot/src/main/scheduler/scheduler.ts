import type { AutomationDefinition } from '../../shared/definition/types'
import { nextTickAfter } from '../../shared/schedule/cron'
import type { LoadedDefinitions } from '../definitions/loader'
import type { TickResult } from './tick-runner'

export type SchedulerDeps = {
  now(): number
  definitions(): LoadedDefinitions
  runTick(def: AutomationDefinition, opts: { dryRun: boolean }): Promise<TickResult>
  // Start of the last real (not dry-run) tick, or null if it never ticked.
  lastTickAt(id: string): number | null
  poll(): Promise<void>
  log(message: string): void
}

export type TickNowResult = TickResult | { status: 'busy' } | { status: 'unknown' }

const HOUR = 60 * 60_000
export const SCHEDULER_INTERVAL_MS = 15_000
export const SCHEDULER_START_DELAY_MS = 60_000

// The next tick depends only on the cron, the timezone and the last real tick, so it is computed once
// and kept until the automation ticks or a reload changes its schedule. (A yearly cron walks ~0.5 s.)
type NextTick = { schedule: string; timezone: string; at: number | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isScheduled(def: AutomationDefinition): boolean {
  return def.enabled && def.schedule !== 'manual'
}

export class PilotScheduler {
  private readonly running = new Map<string, Promise<TickResult>>()
  private readonly nextTicks = new Map<string, NextTick>()
  private timers: NodeJS.Timeout[] = []
  private loop: Promise<void> | null = null
  private stopped = false
  private readonly startedAt: number

  constructor(
    private readonly deps: SchedulerDeps,
    private readonly intervalMs = SCHEDULER_INTERVAL_MS,
    private readonly startDelayMs = SCHEDULER_START_DELAY_MS
  ) {
    this.startedAt = deps.now()
  }

  // Why the delay: PTYs register after the window opens (desktop) or serve launch, so agents can't
  // start sooner, and polling earlier would read live terminals as gone.
  start(): void {
    if (this.timers.length > 0) {
      return
    }
    this.stopped = false
    const first = setTimeout(() => {
      void this.tickAll()
      const every = setInterval(() => void this.tickAll(), this.intervalMs)
      every.unref?.()
      this.timers.push(every)
    }, this.startDelayMs)
    first.unref?.()
    this.timers.push(first)
    const seconds = (ms: number) => `${Math.round(ms / 1000)}s`
    this.deps.log(
      `[pilot] scheduler started: first check in ${seconds(this.startDelayMs)}, then every ${seconds(this.intervalMs)}`
    )
  }

  // A loop already running finishes its current tick and stops before the next automation.
  stop(): void {
    this.stopped = true
    for (const t of this.timers) {
      clearTimeout(t)
    }
    this.timers = []
  }

  nextTickAt(def: AutomationDefinition): number | null {
    if (!isScheduled(def)) {
      return null
    }
    const cached = this.nextTicks.get(def.id)
    if (cached && cached.schedule === def.schedule && cached.timezone === def.timezone) {
      return cached.at
    }
    // Never ticked: a slot in the hour before start still counts, so a restart doesn't skip it.
    const from = this.deps.lastTickAt(def.id) ?? this.startedAt - HOUR
    const at = nextTickAfter(def.schedule, def.timezone, new Date(from))?.getTime() ?? null
    this.nextTicks.set(def.id, { schedule: def.schedule, timezone: def.timezone, at })
    return at
  }

  isDue(def: AutomationDefinition): boolean {
    const next = this.nextTickAt(def)
    return next !== null && next <= this.deps.now()
  }

  // One loop at a time: a call while a loop runs joins it instead of polling and ticking twice.
  tickAll(): Promise<void> {
    if (!this.loop) {
      this.loop = this.runLoop().finally(() => {
        this.loop = null
      })
    }
    return this.loop
  }

  // Poll first, so runs that ended (or never started) free their at_once slots and worktrees before
  // this loop's decisions. Every step is isolated: one failure never skips the rest.
  private async runLoop(): Promise<void> {
    try {
      await this.deps.poll()
    } catch (error) {
      this.deps.log(`[pilot] step poll failed: ${messageOf(error)}`)
    }
    let definitions: AutomationDefinition[]
    try {
      definitions = this.deps.definitions().definitions
    } catch (error) {
      this.deps.log(`[pilot] couldn't read automations: ${messageOf(error)}`)
      return
    }
    for (const def of definitions) {
      if (this.stopped) {
        return
      }
      await this.tickIfDue(def)
    }
  }

  private async tickIfDue(def: AutomationDefinition): Promise<void> {
    try {
      if (!this.isDue(def)) {
        return
      }
      const result = await this.tickNow(def.id, { dryRun: false })
      if (result.status === 'failed') {
        this.deps.log(`[pilot] ${def.id} tick failed: ${result.error}`)
      }
    } catch (error) {
      this.deps.log(`[pilot] ${def.id} tick failed: ${messageOf(error)}`)
    }
  }

  // The only way a manual automation runs. Nothing awaits between the busy check and the set, so two
  // calls can never both start a tick of the same automation.
  async tickNow(id: string, opts: { dryRun: boolean }): Promise<TickNowResult> {
    if (this.running.has(id)) {
      return { status: 'busy' }
    }
    const def = this.deps.definitions().definitions.find((d) => d.id === id)
    if (!def) {
      return { status: 'unknown' }
    }
    const promise = this.deps.runTick(def, opts)
    this.running.set(id, promise)
    try {
      const result = await promise
      if (!opts.dryRun) {
        this.nextTicks.delete(id)
      }
      return result
    } finally {
      this.running.delete(id)
    }
  }
}
