import type { AutomationDefinition } from '../../shared/definition/types'
import { nextTickAfter } from '../../shared/schedule/cron'
import type { LoadedDefinitions } from '../definitions/loader'
import { mapLimit } from '../map-limit'
import type { PassFetchCache } from '../sources/fetch-cache'
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
  log(message: string): void
}

export type TickNowResult = TickResult | { status: 'busy' } | { status: 'unknown' }

// What a real tick or an ask-first start says in a process that doesn't run the scheduler: its run engine,
// answers and stale-start sweep live only where it runs, so a run started elsewhere would go unwatched.
export const SCHEDULER_OFF = "Pilot's scheduler isn't running in this process"

export const SCHEDULER_INTERVAL_MS = 15_000
export const SCHEDULER_START_DELAY_MS = 60_000
export const MAX_CONCURRENT_TICKS = 4
// The first pass waits at most this long for the runtime to list the repos, then ticks anyway, so a
// misspelled repo still shows up as a failed tick.
export const REPO_WAIT_MS = 5 * 60_000

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
  private waitLogged = false
  private times: LoopTimes = { loopStartedAt: null, lastLoopFinishedAt: null }
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
    if (!isScheduled(def)) {
      // Forgotten, so enabling it or giving it a schedule later counts as an edit (see walkFrom).
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

  // Before the first pass, the runtime must list the scheduled automations' repos (or the wait ran out).
  private reposReady(definitions: AutomationDefinition[]): boolean {
    if (this.firstLoopDone) {
      return true
    }
    const repos = [...new Set(definitions.filter(isScheduled).map((d) => d.repo))]
    let listed = repos.length === 0
    if (!listed) {
      try {
        listed = this.deps.reposListed(repos)
      } catch {
        listed = false
      }
    }
    if (listed || this.deps.now() - this.startedAt >= REPO_WAIT_MS) {
      return true
    }
    if (!this.waitLogged) {
      this.waitLogged = true
      this.deps.log(`[pilot] waiting for Orca to list ${repos.join(', ')} before the first tick`)
    }
    return false
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
      definitions = tickable(this.deps.definitions())
    } catch (error) {
      this.deps.log(`[pilot] couldn't read automations: ${messageOf(error)}`)
      return
    }
    if (!this.reposReady(definitions)) {
      return
    }
    const pass = this.deps.newPass()
    await mapLimit(definitions, MAX_CONCURRENT_TICKS, async (def) => {
      if (!this.stopped) {
        await this.tickIfDue(def, pass)
      }
    })
    this.firstLoopDone = true
  }

  // A4: once the runtime lists repos (or the first pass's wait ran out), a scheduled automation naming an
  // unlisted repo is reported, not ticked. A manual automation still fails its tick with the same words.
  private repoMissing(def: AutomationDefinition): boolean {
    if (!isScheduled(def)) {
      return false
    }
    let listed: boolean
    try {
      listed = this.deps.reposListed([def.repo])
    } catch {
      listed = false
    }
    if (!listed) {
      this.deps.repoProblem(def, `repo "${def.repo}" isn't added to Pilot`)
    }
    return !listed
  }

  private async tickIfDue(def: AutomationDefinition, pass: PassFetchCache): Promise<void> {
    try {
      if (this.repoMissing(def)) {
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
    }
  }
}
