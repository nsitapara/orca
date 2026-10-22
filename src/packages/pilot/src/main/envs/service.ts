import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import type { ItemDecision, RunRow } from '../../shared/api-types'
import { homeOf, type StrandedWork } from '../../shared/api-types-env'
import type { RunEnd } from '../../shared/run/step-plan'
import type { AutomationDefinition } from '../../shared/definition/types'
import { envRunKey } from '../../shared/run/env-args'
import type { EngineEnv } from '../engine-env'
import { resolveRepoPath } from '../fields/runtime-facts'
import { closeSessionTerminal } from '../run/launch'
import { closeRun, type CloseOptions } from '../run/run-close'
import { terminalOpen } from '../run/session-tabs'
import type { PilotStore } from '../store/store'
import { ownProcessIdentity, writerGone } from '../store/store-actions'
import { stopOrphanCreate } from './orphan-create'
import { pilotcliRunner, type Pilotcli } from './pilotcli'
import { previewEnvs } from './preview'
import { createPreparations, type EnvPreparer, type Preparations } from './prepare'
import { recoverPreparing } from './recover'
import { resolveEnvPath } from './resolve-path'
import { strandedWork } from './stranded'
import { sweepEnvs } from './sweep'
import { createTeardowns } from './teardown'

export type EnvServiceDeps = {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  log(message: string): void
  definitionFor(automationId: string): AutomationDefinition | null
  engineEnv: EngineEnv
  dataDir: string
  // A tab's unsent input: a throwaway's tab someone is typing in stays open, and its delete waits.
  terminalDraft(handle: string): Promise<string>
  // The rest of a run's end (answer runs' cards): runEnded calls it, then removes the run's env.
  onRunEnd?(run: RunRow): void
  // env delete kept a throwaway's commits on pilot/<run>: queue job 15 (items: kept_branch), which merges them home.
  onKept?(run: RunRow): void
  // A throwaway env delete couldn't remove that holds work nothing else has: its flagged card, raised and closed by the
  // teardown (main/envs/stranded-card.ts).
  strandedCard?: {
    raise(run: RunRow, work: StrandedWork, reason: string): string | null
    close(cardId: string, outcome: string): void
  }
  pilotcli?: Pilotcli
}
export type EnvService = {
  preparations: Preparations
  // An env automation's answer runs (main/answers/answer-env.ts): this process's preparer, and a close like any run's (its
  // answers hook, then its env's teardown).
  answerHooks: {
    preparer: EnvPreparer
    close(run: RunRow, end: RunEnd, opts?: CloseOptions): void
  }
  // The run engine's onRunEnd (M4 §8, the run ends however it ends): the rest of the run's end, then its env's teardown,
  // which first stops a create still in flight.
  runEnded(run: RunRow): void
  // The scheduler's poll: the deletes now due (a retry, a not_yet, a run that ended outside closeRun). Never awaits one.
  housekeep(): void
  // A dry run's workspace preview (main/envs/preview.ts): asks `env create --dry-run true`, makes nothing.
  preview(def: AutomationDefinition, decisions: ItemDecision[]): Promise<void>
  // Only the process that runs the scheduler, at its start: recover what a stopped Pilot left, then the sweep.
  startup(): Promise<void>
  stop(): void
}

// What a reason calls another Pilot run's job (--throwaway, a deferred run): its automation's name, else its id.
export function nameOf(
  definitionFor: EnvServiceDeps['definitionFor']
): (automationId: string) => string {
  return (automationId) => definitionFor(automationId)?.name ?? automationId
}

// Job environments (pilotcli M4 §8): one per process. Pid files of creates in flight live in <data>/envs.
export function createEnvService(deps: EnvServiceDeps): EnvService {
  const { runtime } = deps
  // The same binDir engineChildEnv puts first on PATH: pilotcliEnv drops it by exact match.
  const pilotcli = deps.pilotcli ?? pilotcliRunner({ pilotBinDir: deps.engineEnv.binDir })
  const pidDir = join(deps.dataDir, 'envs')
  mkdirSync(pidDir, { recursive: true })
  const pidFileOf = (runId: string): string => join(pidDir, `${envRunKey(runId)}.pid`)
  const preparations = createPreparations({
    runs: deps.store.runs,
    pilotcli,
    resolvePath: async (repo, path, signal) =>
      resolveEnvPath(runtime, (await resolveRepoPath(runtime, repo)).id, path, signal),
    nameOf: nameOf(deps.definitionFor),
    pidFile: pidFileOf,
    preparer: () => ({ pid: process.pid, identity: ownProcessIdentity() }),
    nestThrowaway: async (worktreeId, home, label) => {
      await runtime.updateManagedWorktreeMeta(`id:${worktreeId}`, {
        displayName: label,
        displayNameIsPinned: true,
        lineage: { parentWorktree: `path:${home}` }
      })
    },
    log: deps.log
  })
  const stopCreateOf = (runId: string): Promise<void> => stopOrphanCreate(pidFileOf(runId), runId)
  const teardowns = createTeardowns({
    store: deps.store,
    now: deps.now,
    pilotcli,
    preparations,
    stopOrphanCreate: stopCreateOf,
    tabs: {
      isOpen: (handle) => terminalOpen(runtime, handle),
      draft: (handle) => deps.terminalDraft(handle),
      close: (handle) => closeSessionTerminal(runtime, handle)
    },
    // A rescan of the run's repo, so the runtime forgets a removed folder. Best effort: any failure is ignored.
    forget: (run) => {
      const repo = deps.definitionFor(run.automationId)?.repo
      if (repo) {
        void resolveRepoPath(runtime, repo)
          .then((found) => runtime.invalidateWorktreeCatalog(found.id))
          .catch(() => {})
      }
    },
    kept: (run) => deps.onKept?.(run),
    ...(deps.strandedCard
      ? {
          stranded: {
            read: (run) =>
              strandedWork(
                (args, cwd) => gitExecFileAsync(args, { cwd }).then((r) => r.stdout),
                run.env.path ?? '',
                homeOf(run)
              ),
            ...deps.strandedCard
          }
        }
      : {}),
    log: deps.log
  })
  const runEnded = (run: RunRow): void => {
    try {
      deps.onRunEnd?.(run)
    } finally {
      if (run.env && run.env.removedAt === null) {
        teardowns.start(run)
      }
    }
  }
  const closing = { store: deps.store, now: deps.now, log: deps.log, onRunEnd: runEnded }
  const close = (run: RunRow, end: RunEnd, opts?: CloseOptions): void =>
    closeRun(closing, run, end, opts)
  return {
    preparations,
    answerHooks: { preparer: preparations, close },
    runEnded,
    housekeep: () => teardowns.housekeep(),
    preview: (def, decisions) =>
      previewEnvs(
        { runs: deps.store.runs, pilotcli, nameOf: nameOf(deps.definitionFor), now: deps.now },
        def,
        decisions
      ),
    async startup() {
      await recoverPreparing({
        store: deps.store,
        now: deps.now,
        isPreparing: preparations.isPreparing,
        preparerGone: (p) => p === undefined || writerGone(p.pid, p.identity),
        stopOrphanCreate: stopCreateOf,
        // Closed like any run: its answers hook, then its env's teardown.
        close,
        log: deps.log
      })
      const report = await sweepEnvs({
        store: deps.store,
        pilotcli,
        teardown: (run) => teardowns.start(run),
        isPreparing: preparations.isPreparing,
        now: deps.now,
        log: deps.log
      })
      const { deleted, removed, skipped } = report
      deps.log(
        `[pilot] env sweep: ${deleted.length} deleted, ${removed.length} already gone, ${skipped} left alone`
      )
    },
    stop: () => preparations.stopAll()
  }
}
