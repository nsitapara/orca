import { join } from 'node:path'
import type { TickDeps } from '../../../src/main/scheduler/tick-runner'
import { addImportedHandled } from '../../../src/main/store/__fixtures__/imported-rows'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import { stdoutOf, type ParityFixture } from '../fixture'
import { seedRunning } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'
import { isSha, listedWorktrees, seedSeenHeads, stateObject } from '../sweep-state'
import { withWorktrees } from '../worktree-fixture'

// The old side's code was ui-qa/scripts/loop.py (it had no sweep.py); its decisions are frozen
// in each case's old block.
export const JOB_04 = {
  job: '04',
  folder: 'ui-qa',
  script: 'scripts/loop.py',
  loop: 'ui-qa',
  automationId: 'ui-qa-overnight'
}

const REPO = '400fee61-a463-4f76-894a-39861e906007'
const wt = (n: number): string => `wt:${REPO}::/wt/web-${n}`

// 04's words (frozen in the test data) and the verdicts that agree with them. Nothing new since the last test is the worktree
// kind's `where.commits` clause (out of scope); a failed head's 12-hour hold is retry_after_failure (not due); a QA run in
// progress holds its own head (already handled) and every other due worktree (at most 1 at once). Answers, agents,
// the window, quota and the limits hold a worktree in the runner's line; a git operation and the MR rules skip it. A
// teammate's branch, or one whose owner GitLab can't name, is never listed by the sweep and is out of scope for Pilot.
export const VERDICTS_04: VerdictTable = {
  map: {
    baseline: ['baselined'],
    idle: ['out_of_scope'],
    skip: ['skipped'],
    start: ['started'],
    queued: ['held'],
    outside: ['held'],
    QUOTA: ['held'],
    held_active: ['notdue'],
    held: ['held']
  },
  rows: [
    { word: 'skip', reason: /; retry next night$/, verdicts: ['notdue'] },
    {
      word: 'skip',
      reason:
        /^automatic UI QA fixes are running$|^answers are being applied or an agent is working there; QA waits$/,
      verdicts: ['held']
    }
  ],
  whenOldMissing: ['out_of_scope'],
  known: [
    {
      key: wt(472),
      word: 'start',
      verdict: 'held',
      why: "Pilot's fixer is a step of the QA run, so the next run waits for it (at_once 1); the sweep's fixer ran in its own tab beside the next QA run"
    },
    {
      key: wt(484),
      word: 'skip',
      verdict: 'notdue',
      why: 'Pilot holds a failed head (retry_after_failure) before any check; the sweep looked at answers and agents first. Nothing starts either way.'
    },
    {
      key: wt(485),
      word: 'skip',
      verdict: 'out_of_scope',
      why: "Pilot's worktree kind leaves out a branch with nothing new before any check; the sweep looked for a git operation first. Nothing starts either way."
    },
    {
      key: wt(486),
      word: 'skip',
      verdict: 'baselined',
      why: 'Pilot records a first sight with no recent own commit before its checks; the sweep waited for the merge or rebase to end first. Neither tests the branch.'
    }
  ]
}

type Wait = { result?: { wait?: { satisfied?: boolean } } }
type OpenRun = {
  status?: string
  codex_tab?: string
  head?: string
  worktree?: { id?: string; path?: string }
  branch?: string
}
type FixRecord = { path?: string; status?: string; terminal?: string; branch?: string }

// Whether tab <handle> was mid-turn when the sweep looked (its `orca terminal wait` read, as gate.tab_busy).
function midTurn(f: ParityFixture, handle: string): boolean {
  const argv = ['orca', 'terminal', 'wait', '--terminal', handle, '--for', 'tui-idle']
  const read = f.reads.find((r) => argv.every((a, i) => r.argv[i] === a))
  if (!read) {
    return false
  }
  const answer = JSON.parse(stdoutOf(read)) as Wait
  return answer.result?.wait?.satisfied === false
}

// failed.json, { "<path>": { head, at (epoch s) } }: each failed head is a failed key no run holds, from its failure
// time, so retry_after_failure's 12 hours run from the old failure. A head also in seen.json keeps its tested key.
function seedFailedHeads(store: PilotStore, f: ParityFixture): void {
  const byPath = new Map(listedWorktrees(f).map((w) => [w.path, w]))
  for (const [path, entry] of Object.entries(stateObject(f, `${JOB_04.loop}/failed.json`))) {
    const wt = byPath.get(path)
    const e = (entry ?? {}) as { head?: unknown; at?: unknown }
    if (wt && isSha(e.head) && typeof e.at === 'number') {
      const at = Math.round(e.at * 1000)
      addImportedHandled(store, JOB_04.automationId, [
        { onceKey: `${wt.id}@${e.head}`, status: 'failed', at, failedAt: at }
      ])
    }
  }
}

// The sweep's state as Pilot keeps it: each tested head a done `<worktree id>@<sha>` key, each failed one a failed key
// from its failure time. A QA run whose Codex tab was mid-turn (the sweep's "active") is a running run of this automation
// in its worktree, holding its head; an automatic fix whose tab was mid-turn is the fix step of a run still running there.
export function seed04(store: PilotStore, f: ParityFixture): void {
  seedSeenHeads(store, JOB_04.automationId, f, `${JOB_04.loop}/seen.json`)
  seedFailedHeads(store, f)
  const at = f.now - 600_000
  const byPath = new Map(listedWorktrees(f).map((w) => [w.path, w]))
  const held = (path: string | undefined) => (path ? byPath.get(path) : undefined)
  const run = (f.state[`${JOB_04.loop}/run.json`] ?? {}) as OpenRun
  const active = run.status === 'running' && run.codex_tab ? held(run.worktree?.path) : undefined
  const fixes = Object.values(
    (f.state[`${JOB_04.loop}/fixes.json`] ?? {}) as Record<string, FixRecord>
  )
    .filter((x) => x.terminal && midTurn(f, x.terminal))
    .map((x) => held(x.path))
  const running = [
    ...(active && run.codex_tab && midTurn(f, run.codex_tab) ? [active] : []),
    ...fixes.filter((w) => w !== undefined)
  ]
  seedRunning(
    store,
    JOB_04.automationId,
    running.map((w) => ({
      id: `run-${w.id}`,
      itemKey: `wt:${w.id}`,
      path: w.path,
      label: w.branch ?? w.path
    })),
    at
  )
  if (active && run.head && running.includes(active)) {
    store.markHandled(JOB_04.automationId, `${active.id}@${run.head}`, `run-${active.id}`, at)
  }
}

// The answers waiting to be applied on each branch (the case's parity/answers.json, { branch: count }), which the
// sweep read from the branch's note: in Pilot, this automation's answers saved on the item and not yet dispatched.
function withAnswers(deps: TickDeps, f: ParityFixture): TickDeps {
  const waiting = (f.state['parity/answers.json'] ?? {}) as Record<string, number>
  const branchOf = new Map(listedWorktrees(f).map((w) => [`wt:${w.id}`, w.branch ?? '']))
  return {
    ...deps,
    fields: {
      ...deps.fields,
      pendingAnswers: (_automationId: string, itemKey: string) =>
        waiting[branchOf.get(itemKey) ?? ''] ?? 0
    }
  }
}

export const PARITY_04: ParityJob = {
  job: JOB_04.job,
  files: [
    join(portedAutomationsDir(), 'ui-qa-overnight.yaml'),
    join(portedAutomationsDir(), 'people.yaml')
  ],
  table: VERDICTS_04,
  tickDeps: (deps, f) => withAnswers(withWorktrees(deps, f), f),
  seed: seed04,
  load() {
    const { definition, people } = loadPortedAutomation(JOB_04.automationId)
    return { def: definition, people }
  }
}
