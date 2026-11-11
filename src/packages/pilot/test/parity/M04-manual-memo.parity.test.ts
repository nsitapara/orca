import { describe, expect, it } from 'vitest'
import { runTick } from '../../src/main/scheduler/tick-runner'
import { PilotStore } from '../../src/main/store/store'
import { compareDecisions, formatMismatches, type VerdictTable } from './compare'
import { fixtureMisses, fixturePass, fixtureTickDeps } from './fixture'
import type { OldDecision } from './old-side'
import { parityFixture, withScripts } from './overrides'
import { loadPortedAutomation } from './ported'

const PRECHECK =
  'node /Users/nishsitapara/Documents/web-platform/scripts/agent-loops/manual-memo.mjs precheck'

type Precheck = { code: number; stdout: string; stderr: string }

// Orca's rule for these jobs: no precheck, or a precheck that exits 0, starts the run; any other exit is skipped_precheck.
function orcaDecision(precheck: Precheck | null): OldDecision {
  const key = { key: 'repo:web-platform', label: 'web-platform' }
  if (precheck === null || precheck.code === 0) {
    return { ...key, decision: 'run', reason: '' }
  }
  return { ...key, decision: 'skipped_precheck', reason: precheck.stderr.trim() }
}

const TABLE: VerdictTable = {
  map: { run: ['started'], skipped_precheck: ['skipped'] },
  whenOldMissing: ['out_of_scope']
}

const RUNS: { name: string; id: string; precheck: Precheck | null; reason?: string }[] = [
  {
    name: 'M04 starts when its precheck names a file',
    id: 'manual-memo',
    precheck: {
      code: 0,
      stdout: 'Next target: apps/staff/src/Report.tsx (3 open call(s))',
      stderr: ''
    }
  },
  {
    name: 'M04 skips with no eligible file',
    id: 'manual-memo',
    precheck: { code: 1, stdout: '', stderr: 'Skipping: no eligible file.\n' },
    reason: 'Skipping: no eligible file.'
  },
  {
    name: 'M04 skips while a loop worktree awaits review',
    id: 'manual-memo',
    precheck: {
      code: 1,
      stdout: '',
      stderr:
        'Skipping: a loop worktree awaits review:\n/wt/memo (agent-loop/manual-memo/report, 1 commit(s))\n'
    },
    reason: '/wt/memo (agent-loop/manual-memo/report, 1 commit(s))' // Pilot's reason is the check's last stderr line (Contract addition 8)
  }
]

describe('M04 starts when Orca would have', () => {
  it.each(RUNS)('$name', async (run) => {
    const fixture = parityFixture(
      'M04',
      run.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      Date.parse('2026-10-12T16:00:00Z')
    )
    const pre = run.precheck
    const deps = withScripts(fixtureTickDeps(fixture, PilotStore.open(':memory:')), (req) => {
      if (!pre || req.command !== PRECHECK) {
        return null
      }
      return { code: pre.code, stdout: pre.stdout, stderr: pre.stderr, timedOut: false }
    })
    const { definition, people } = loadPortedAutomation(run.id)
    const result = await runTick(definition, people, deps, {
      dryRun: true,
      pass: fixturePass(fixture)
    })
    expect(result.error).toBeNull()
    expect(fixtureMisses(fixture)).toEqual([]) // no read the case lacks
    expect(
      formatMismatches(compareDecisions([orcaDecision(run.precheck)], result.decisions, TABLE))
    ).toBe('')
    if (run.reason !== undefined) {
      expect(result.decisions[0].reason).toContain(run.reason)
    }
  })

  it('M04 gate is a tick check, so a skipped run is decided before any workspace is made', async () => {
    const fixture = parityFixture('M04', 'no-stray-worktree', Date.parse('2026-10-12T16:00:00Z'))
    const deps = withScripts(fixtureTickDeps(fixture, PilotStore.open(':memory:')), () => ({
      code: 1,
      stdout: '',
      stderr: 'Skipping: no eligible file.\n',
      timedOut: false
    }))
    const { definition, people } = loadPortedAutomation('manual-memo')
    const result = await runTick(definition, people, deps, {
      dryRun: true,
      pass: fixturePass(fixture)
    })
    expect(result.decisions.map((d) => d.verdict)).toEqual(['skipped'])
    expect(result.decisions[0].checks.map((c) => c.ok)).toEqual([false])
  })
})
