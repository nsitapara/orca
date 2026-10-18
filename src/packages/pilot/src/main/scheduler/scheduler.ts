import type { TickTrigger } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { nextTickAfter } from '../../shared/schedule/cron'
import type { LoadedDefinitions } from '../definitions/loader'
import { mapLimit } from '../map-limit'
import type { PassFetchCache } from '../sources/fetch-cache'
import { REPO_WAIT_MS, RepoReadiness } from './repo-readiness'
import { tickQueued, type QueuedTickDeps } from './queued-ticks'
import type { RunsOnGate } from './runs-on-gate'
import type { TickOptions, TickResult } from './tick-runner'

export type SchedulerDeps = {
  now(): number
  definitions(): LoadedDefinitions
  runTick(def: AutomationDefinition, opts: TickOptions): Promise<TickResult>
  // Start of the last real (not dry-run) tick, or null if it never ticked.
  lastTickAt(id: string): number | null
  poll(): Promise<void>
  // True once Orca's runtime lists every one of these repos (it may not, right after start).
  reposListed(repos: string[]): boolean
  // A fetch cache for one loop: every automation that ticks in the loop reads through it.
  newPass(): PassFetchCache
  // A scheduled automation whose repo the runtime doesn't list is not ticked; this is where that is
  // reported (A4), so it shows as a definition problem rather than a failed tick.
  repoProblem(def: AutomationDefinition, message: string): void
  // Which jobs this machine ticks (runs_on, PILOT_SCHEDULER=pinned); absent: every job ticks here.
  runsOn?: RunsOnGate
  log(message: string): void
} & QueuedTickDeps

export type TickNowResult = TickResult | { status: 'busy' } | { status: 'unknown' }

// What a real tick or an ask-first start says in a process that doesn't run the scheduler: its run engine,
// answers and stale-start sweep live only where it runs, so a run started elsewhere would go unwatched.
export const SCHEDULER_OFF = "Pilot's scheduler isn't running in this process"

export const SCHEDULER_INTERVAL_MS = 15_000
export const SCHEDULER_START_DELAY_MS = 60_000
export const MAX_CONCURRENT_TICKS = 4
export { REPO_WAIT_MS }
// A feed's run: now ticks its receiving stage at most this often a minute; past it the ids wait for its schedule. The
// loader already refuses feeds that go round in a cycle: this bounds a burst of sender runs ending together.
export const MAX_TRIGGERS_PER_MINUTE = 4
const MINUTE_MS = 60_000

// The next tick depends only on the cron, the timezone and where the walk starts, so it is computed
// once and kept until the automation ticks or a reload changes its schedule. (A yearly cron walks ~0.5 s.)
type NextTick = { schedule: string; timezone: string; at: number | null }
export type LoopTimes = { loopStartedAt: number | null; lastLoopFinishedAt: number | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Every definition but those shown only from their last valid version (their file is invalid now).
function tickable(loaded: LoadedDefinitions): AutomationDefinition[] {
  const displayOnly = new Set(loaded.displayOnly ?? [])
  return loaded.definitions.filter((d) => !displayOnly.has(d.id))
}

function isScheduled(def: AutomationDefinition): boolean {
  return def.enabled && def.schedule !== 'manual'
}

export class PilotScheduler {
  private readonly running = new Map<string, Promise<TickResult>>()
  private readonly nextTicks = new Map<string, NextTick>()
  private timers: NodeJS.Timeout[] = []
  private readonly ticked = new Set<string>()
  private loop: Promise<void> | null = null
  private stopped = false
  private firstLoopDone = false
  private times: LoopTimes = { loopStartedAt: null, lastLoopFinishedAt: null }
  private readonly startedAt: number
  private readonly repos: RepoReadiness
  // When each stage was last triggered (within the minute), and the trigger that came while its tick ran.
  private readonly triggeredAt = new Map<string, number[]>()
  private readonly retrigger = new Map<string, TickTrigger>()
  private ready: Promise<void> = Promise.resolve()

  constructor(
    private readonly deps: SchedulerDeps,
    private readonly intervalMs = SCHEDULER_INTERVAL_MS,
    private readonly startDelayMs = SCHEDULER_START_DELAY_MS
  ) {
    this.startedAt = deps.now()
    this.repos = new RepoReadiness(deps, this.startedAt, (def) => this.scheduledHere(def))
  }

  // Whether this machine's scheduler ticks it. Run now by hand runs it here either way.
  ticksHere(def: AutomationDefinition): boolean {
    return this.deps.runsOn?.ticksHere(def) ?? true
  }

  private scheduledHere(def: AutomationDefinition): boolean {
    return isScheduled(def) && this.ticksHere(def)
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

  // Loops wait for `ready` before they poll or tick: a poll starts runs' next steps and a tick starts runs. attach-main
  // holds them until PATH is the login shell's (startup/login-path.ts).
  holdUntil(ready: Promise<void>): void {
    this.ready = ready
  }

  // A loop already running finishes its ticks in flight and starts no more.
  stop(): void {
    this.stopped = true
    for (const t of this.timers) {
      clearTimeout(t)
    }
    this.timers = []
  }

  // For a status view: a loopStartedAt far in the past means a loop is stuck.
  loopTimes(): LoopTimes {
    return { ...this.times }
  }

  nextTickAt(def: AutomationDefinition): number | null {
    if (!this.scheduledHere(def)) {
      // Forgotten, so enabling, scheduling or pinning it here later counts as an edit (see walkFrom).
      this.nextTicks.delete(def.id)
      return null
    }
    const cached = this.nextTicks.get(def.id)
    if (cached && cached.schedule === def.schedule && cached.timezone === def.timezone) {
      return cached.at
    }
    const from = this.walkFrom(def)
    const at = nextTickAfter(def.schedule, def.timezone, new Date(from))?.getTime() ?? null
    this.nextTicks.set(def.id, { schedule: def.schedule, timezone: def.timezone, at })
    return at
  }

  // Where the cron walk starts:
  // - right after a real tick: that tick, so the schedule keeps its rhythm;
  // - automations scheduled at the first pass: the last real tick, but no earlier than
  //   missed_run_grace before Pilot started, so a slot missed while it was down runs once only when
  //   it is inside the grace (spec §1);
  // - added, enabled or rescheduled after that: now (or a later real tick), so an edit never fires at
  //   once. This is what keeps a manual → cron cutover from ticking the moment it is saved.
  private walkFrom(def: AutomationDefinition): number {
    const last = this.deps.lastTickAt(def.id)
    if (this.ticked.delete(def.id) && last !== null) {
      return last
    }
    const lastOrNever = last ?? Number.NEGATIVE_INFINITY
    if (!this.firstLoopDone) {
      return Math.max(lastOrNever, this.startedAt - def.missedRunGraceMs)
    }
    return Math.max(lastOrNever, this.deps.now())
  }

  isDue(def: AutomationDefinition): boolean {
    const next = this.nextTickAt(def)
    return next !== null && next <= this.deps.now()
  }

  // One loop at a time: a call while a loop runs joins it instead of polling and ticking twice.
  tickAll(): Promise<void> {
    if (!this.loop) {
      this.times = { ...this.times, loopStartedAt: this.deps.now() }
      this.loop = this.runLoop().finally(() => {
        this.loop = null
        this.times = { loopStartedAt: null, lastLoopFinishedAt: this.deps.now() }
      })
    }
    return this.loop
  }

  // Poll first, so runs that ended (or never started) free their at_once slots and worktrees before
  // this loop's decisions. Every step is isolated: one failure never skips the rest.
  private async runLoop(): Promise<void> {
    try {
      await this.ready
    } catch (error) {
      this.ready = Promise.resolve()
      this.deps.log(`[pilot] login-shell PATH wait failed: ${messageOf(error)}`)
    }
    try {
      await this.deps.poll()
    } catch (error) {
      this.deps.log(`[pilot] step poll failed: ${messageOf(error)}`)
    }
    let definitions: AutomationDefinition[]
    try {
      definitions = tickable(this.deps.definitions())
    } catch (error) {
      this.deps.log(`[pilot] couldn't read automations: ${messageOf(error)}`)
      return
    }
    if (!this.repos.ready(definitions, this.firstLoopDone)) {
      return
    }
    const pass = this.deps.newPass()
    const byId = new Map(definitions.map((d) => [d.id, d]))
    await tickQueued(this.deps, definitions, {
      stopped: () => this.stopped,
      busy: (id) => this.running.has(id),
      tick: (id) => {
        // On the job's due slot this is its scheduled tick (tickIfDue then skips it), so Activity shows it.
        const def = byId.get(id)
        return this.tickNow(id, { dryRun: false, pass, recheck: !(def && this.isDue(def)) })
      },
      concurrency: MAX_CONCURRENT_TICKS
    })
    await mapLimit(definitions, MAX_CONCURRENT_TICKS, async (def) => {
      if (!this.stopped) {
        await this.tickIfDue(def, pass)
      }
    })
    this.firstLoopDone = true
  }

  private async tickIfDue(def: AutomationDefinition, pass: PassFetchCache): Promise<void> {
    try {
      if (this.repos.missing(def)) {
        return
      }
      if (!this.isDue(def)) {
        return
      }
      const result = await this.tickNow(def.id, { dryRun: false, pass })
      if (result.status === 'failed') {
        this.deps.log(`[pilot] ${def.id} tick failed: ${result.error}`)
      }
    } catch (error) {
      this.deps.log(`[pilot] ${def.id} tick failed: ${messageOf(error)}`)
    }
  }

  // Why a trigger can't tick the stage now, or null when it can. A stage that is off, invalid or missing never is.
  private triggerRefusal(id: string): string | null {
    const loaded = this.deps.definitions()
    const def = loaded.definitions.find((d) => d.id === id)
    if (!def) {
      return 'no such automation'
    }
    if (loaded.displayOnly?.includes(id)) {
      return "its file isn't valid"
    }
    if (!def.enabled) {
      return 'it is turned off'
    }
    const elsewhere = this.deps.runsOn?.refusal(def)
    if (elsewhere) {
      return elsewhere
    }
    const recent = (this.triggeredAt.get(id) ?? []).filter((at) => this.deps.now() - at < MINUTE_MS)
    this.triggeredAt.set(id, recent)
    if (recent.length >= MAX_TRIGGERS_PER_MINUTE) {
      return `it was triggered ${recent.length} times in the last minute`
    }
    return null
  }

  // A feed's run: now (main/handover): tick the receiving stage at once, as one of its own real ticks, so its enabled
  // switch, checks, once_per, limits and quota apply unchanged. Only where the scheduler runs. A stage whose tick is
  // running gets one more tick after it ends (the latest trigger's), however many came meanwhile. A refusal is
  // logged; the handed-over ids stay pending for the stage's next tick.
  trigger(id: string, cause: TickTrigger): void {
    if (this.timers.length === 0 || this.stopped) {
      return
    }
    const refusal = this.triggerRefusal(id)
    if (refusal) {
      this.deps.log(
        `[pilot] ${id}: not triggered by ${cause.automationId} run ${cause.runId}: ${refusal}; its handed-over ids wait`
      )
      return
    }
    if (this.running.has(id)) {
      this.retrigger.set(id, cause)
      return
    }
    this.triggeredAt.get(id)?.push(this.deps.now())
    this.deps.log(`[pilot] ${id}: triggered by ${cause.automationId} run ${cause.runId}`)
    this.tickNow(id, { dryRun: false, trigger: cause }).then(
      (result) => {
        if (result.status === 'failed') {
          this.deps.log(`[pilot] ${id} triggered tick failed: ${result.error}`)
        }
      },
      (error: unknown) => this.deps.log(`[pilot] ${id} triggered tick failed: ${messageOf(error)}`)
    )
  }

  // The only way a manual automation runs. Nothing awaits between the busy check and the set, so two
  // calls can never both start a tick of the same automation.
  async tickNow(id: string, opts: TickOptions): Promise<TickNowResult> {
    if (this.running.has(id)) {
      return { status: 'busy' }
    }
    const loaded = this.deps.definitions()
    const def = loaded.definitions.find((d) => d.id === id)
    if (!def) {
      return { status: 'unknown' }
    }
    if (loaded.displayOnly?.includes(id)) {
      throw new Error(
        `${def.file} isn't valid: Pilot shows its last valid version but won't tick it until the file is fixed`
      )
    }
    const promise = this.deps.runTick(def, opts)
    this.running.set(id, promise)
    try {
      const result = await promise
      // Only a scheduled automation keeps its rhythm from this tick; a manual one has no cache entry.
      if (!opts.dryRun && this.nextTicks.delete(id)) {
        this.ticked.add(id)
      }
      return result
    } finally {
      this.running.delete(id)
      const again = this.retrigger.get(id)
      if (again) {
        this.retrigger.delete(id)
        this.trigger(id, again)
      }
    }
  }
}
