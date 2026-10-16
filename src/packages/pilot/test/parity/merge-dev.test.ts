import { describe, expect, it } from 'vitest'
import type { PilotStore } from '../../src/main/store/store'
import { compareDecisions, formatMismatches } from './compare'
import { loadFixture, type ParityFixture } from './fixture'
import { JOB_02, VERDICTS_02 } from './jobs/job-02'
import { canRunOldSide, runOldPlan } from './old-side'
import { caseFile, dryTick, failedCheck, loadPortedAutomation } from './ported'

const CASES = [
  'quota-ok',
  'weekly-at-ceiling',
  'session-at-ceiling',
  'codex-says-out',
  'reset-passed',
  'unreadable'
]
const { definition, people } = loadPortedAutomation(JOB_02.automationId)

describe('02 · Merge dev into my MR branches, on the engine', () => {
  it('is a run-once Codex job in the main checkout with the old prompt, raw', () => {
    expect(definition).toMatchObject({
      name: '02 · Merge dev into my MR branches',
      schedule: '0 3 * * *',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * 3_600_000,
      items: null,
      workspace: { kind: 'main_checkout' },
      checks: [{ kind: 'quota', agent: 'codex', weekly: 90, session: 95 }],
      powers: ['commit', 'push']
    })
    expect(definition.steps.map((s) => [s.name, s.agent])).toEqual([
      ['trust_hooks', 'shell'],
      ['merge', 'codex']
    ])
    expect(definition.steps[0]).toMatchObject({
      run: 'pilotcli agent update-hooks codex || true',
      timeoutMs: 60_000
    })
    expect(definition.steps[1]).toMatchObject({
      prompt: '$update-my-mrs --push',
      promptStyle: 'raw',
      session: { kind: 'new' },
      args: []
    })
  })

  describe.skipIf(!canRunOldSide('worktree-gate', 'quota.py'))(
    'parity with quota.py check codex',
    () => {
      it.each(CASES)('%s: the Codex quota gate decides as quota.py did', async (name) => {
        const file = caseFile(JOB_02.job, name)
        const old = runOldPlan(JOB_02.job, file)
        const neu = await dryTick({ definition, people, fixture: loadFixture(file) })
        expect(formatMismatches(compareDecisions(old, neu, VERDICTS_02))).toBe('')
        expect(failedCheck(neu[0])).toBe(old[0].decision === 'quota' ? 'Codex quota' : null)
      })
    }
  )

  it('a run in the main checkout never blocks another (01 at 03:00, a manual M02)', async () => {
    const fixture = loadFixture(caseFile(JOB_02.job, 'quota-ok'))
    const seed = (store: PilotStore, f: ParityFixture) => {
      for (const [id, agent] of [
        ['pull-dev', 'shell'],
        ['mr-next-steps', 'codex']
      ] as const) {
        store.runs.create({
          id: `${id}-run`,
          automationId: id,
          tickId: null,
          itemKey: 'repo:web-platform',
          itemLabel: 'web-platform',
          worktreePath: f.repo.path,
          startedAt: f.now - 60_000
        })
        store.runs.createStep({
          runId: `${id}-run`,
          idx: 0,
          name: 'main',
          agent,
          skill: null,
          startedAt: f.now - 60_000
        })
        store.runs.updateStep(`${id}-run`, 0, { status: 'running' })
      }
    }
    const [decision] = await dryTick({ definition, people, fixture, seed })
    expect(decision).toMatchObject({ key: 'repo:web-platform', verdict: 'started' })
  })
})
