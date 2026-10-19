import { join } from 'node:path'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import { stdoutOf, type ParityFixture } from '../fixture'
import { seedRunning } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'
import { listedWorktrees, seedSeenHeads } from '../sweep-state'
import { withWorktrees } from '../worktree-fixture'

// The old side's code is review-cycles/loop.py (no sweep.py: it had no sweep.py).
export const JOB_03 = {
  job: '03',
  folder: 'review-cycles',
  script: 'loop.py',
  loop: 'standards',
  automationId: 'review-branch-code'
}

// 03's words (frozen in each case's old block) and the verdicts that agree with them. Nothing new since the review is the worktree kind's
// `where.commits` clause (out of scope); a parked hand-off is a run still active there (Pilot has no parking). Work in
// flight starts in a throwaway (2026-10-18: the env picks the place, it never waits); a running cycle, quota and the
// per-tick limit hold the worktree in the runner's line; the MR rules skip it. A
// teammate's branch, or one whose owner GitLab can't name, is never listed by the sweep and is out of scope for Pilot.
export const VERDICTS_03: VerdictTable = {
  map: {
    base: ['baselined'],
    nothing_new: ['out_of_scope'],
    skip: ['skipped'],
    start: ['started'],
    defer: ['held'],
    QUOTA: ['held'],
    parked: ['held']
  },
  rows: [
    { word: 'skip', reason: /; retry next round$/, verdicts: ['started', 'held'] },
    { word: 'skip', reason: /^current cycle still running$/, verdicts: ['held'] }
  ],
  whenOldMissing: ['out_of_scope'],
  known: [
    {
      key: 'wt:400fee61-a463-4f76-894a-39861e906007::/wt/web-321',
      word: 'skip',
      verdict: 'skipped',
      why: 'Pilot decides the MR rules before work in flight, so an approved MR is skipped for its approval; the sweep named the uncommitted changes first'
    },
    {
      key: 'wt:400fee61-a463-4f76-894a-39861e906007::/wt/web-322',
      word: 'skip',
      verdict: 'skipped',
      why: 'Pilot decides the MR rules before work in flight, so a merged MR is skipped for the merge; the sweep named the uncommitted changes first'
    },
    {
      key: 'wt:400fee61-a463-4f76-894a-39861e906007::/wt/web-342',
      word: 'start',
      verdict: 'held',
      why: "Pilot needs both agents' quota before a cycle starts; the sweep checked only the lead's and parked round 2 until the other agent's reset"
    },
    {
      key: 'wt:400fee61-a463-4f76-894a-39861e906007::/wt/web-314',
      word: 'start',
      verdict: 'held',
      why: "Work in flight no longer skips (2026-10-18): web-305 and web-306 start in throwaways first and take the tick's two slots, so web-314 starts at the next tick"
    }
  ]
}

type Wait = { result?: { wait?: { satisfied?: boolean } } }

// Whether the loop's tab <handle> was mid-turn when the sweep looked (its `orca terminal wait` read, as gate.tab_busy).
function midTurn(f: ParityFixture, handle: string): boolean {
  const argv = ['orca', 'terminal', 'wait', '--terminal', handle, '--for', 'tui-idle']
  const read = f.reads.find((r) => argv.every((a, i) => r.argv[i] === a))
  if (!read) {
    return false
  }
  const answer = JSON.parse(stdoutOf(read)) as Wait
  return answer.result?.wait?.satisfied === false
}

function tabsOf(f: ParityFixture): [string, string][] {
  const tabs = ['tabs.json', 'tabs-codex.json'].map(
    (file) => (f.state[`${JOB_03.loop}/${file}`] ?? {}) as Record<string, string>
  )
  return tabs.flatMap((t) => Object.entries(t))
}

// The sweep's state as Pilot keeps it: each head seen.json names is a done `<worktree id>@<sha>` key, so the marker
// starts there. A cycle the sweep left running there, an agent's tab mid-turn or a parked hand-off, is a run of this
// automation still active in that worktree.
export function seed03(store: PilotStore, f: ParityFixture): void {
  seedSeenHeads(store, JOB_03.automationId, f, `${JOB_03.loop}/seen.json`)
  const cycles = (f.state[`${JOB_03.loop}/cycles.json`] ?? {}) as Record<
    string,
    { pending?: unknown }
  >
  const held = new Set([
    ...tabsOf(f)
      .filter(([, handle]) => midTurn(f, handle))
      .map(([path]) => path),
    ...Object.entries(cycles)
      .filter(([, c]) => c.pending)
      .map(([path]) => path)
  ])
  const runs = listedWorktrees(f)
    .filter((w) => held.has(w.path))
    .map((w) => ({
      id: `run-${w.id}`,
      itemKey: `wt:${w.id}`,
      path: w.path,
      label: w.branch ?? w.path
    }))
  seedRunning(store, JOB_03.automationId, runs, f.now - 600_000)
}

// loop.py sweep's per-worktree decisions, frozen in each case's old block (milestone 8 deletes loop.py): the item parity
// runs on these, and a case without them fails.
export const PARITY_03_FROZEN: ParityJob = {
  job: JOB_03.job,
  files: [
    join(portedAutomationsDir(), 'review-branch-code.yaml'),
    join(portedAutomationsDir(), 'people.yaml')
  ],
  table: VERDICTS_03,
  tickDeps: withWorktrees,
  seed: seed03,
  load() {
    const { definition, people } = loadPortedAutomation(JOB_03.automationId)
    return { def: definition, people }
  }
}
