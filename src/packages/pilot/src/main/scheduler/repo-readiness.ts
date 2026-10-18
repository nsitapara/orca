import type { AutomationDefinition } from '../../shared/definition/types'
import type { SchedulerDeps } from './scheduler'

// The first pass waits at most this long for the runtime to list the repos, then ticks anyway, so a
// misspelled repo still shows up as a failed tick.
export const REPO_WAIT_MS = 5 * 60_000

export class RepoReadiness {
  private waitLogged = false

  constructor(
    private readonly deps: Pick<SchedulerDeps, 'reposListed' | 'repoProblem' | 'log' | 'now'>,
    private readonly startedAt: number,
    private readonly scheduled: (def: AutomationDefinition) => boolean
  ) {}

  // Before the first pass, the runtime must list the scheduled automations' repos (or the wait ran out).
  ready(definitions: AutomationDefinition[], firstLoopDone: boolean): boolean {
    if (firstLoopDone) {
      return true
    }
    const repos = [...new Set(definitions.filter(this.scheduled).map((d) => d.repo))]
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

  // A4: once the runtime lists repos (or the first pass's wait ran out), a scheduled automation naming an
  // unlisted repo is reported, not ticked. A manual automation still fails its tick with the same words.
  missing(def: AutomationDefinition): boolean {
    if (!this.scheduled(def)) {
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
}
