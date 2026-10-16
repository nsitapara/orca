import { cpSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { loadFixture } from './fixture'
import { JOB_M01, PARITY_M01, VERDICTS_M01, answerScripts, seedM01 } from './jobs/job-m01'
import { withLinearTickets } from './linear-fixture'
import { PARITY_DIR, runOldPlan, type OldDecision } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { caseFile, dryTick, loadPortedAutomation, portedAutomationsDir } from './ported'

const { definition, people } = loadPortedAutomation(JOB_M01.automationId)
const HOUR = 3_600_000

describe('M01 · Start my Todo Linear tickets: the definition (old job: orca automation 08181dcd, prompt /linear-todo-sweep)', () => {
  it('is a manual run (Orca had no schedule, a Jan 1 placeholder), at most three tickets, urgent first, one kickoff each', () => {
    expect(definition).toMatchObject({
      name: 'M01 · Start my Todo Linear tickets',
      schedule: 'manual',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * HOUR,
      firstSeen: 'process',
      oncePer: '{ticket.id}',
      limits: { perTick: 3, order: 'priority' },
      powers: ['commit', 'push', 'update_ticket'],
      inbox: 'nish',
      workspace: {
        kind: 'new_worktree',
        base: 'origin/dev',
        name: '{ticket.branch}',
        reuseExisting: true,
        setup: 'run'
      }
    })
    expect(definition.steps).toMatchObject([
      {
        name: 'kickoff',
        agent: 'claude',
        skill: 'ticket-kickoff',
        promptStyle: 'raw',
        prompt: '/ticket-kickoff {ticket.id}'
      }
    ])
  })

  it('lists Todo tickets with a branch, with no assignee clause (Linear’s `assigned` filter is the signed-in user)', () => {
    expect(definition.items).toMatchObject({ kind: 'linear_ticket' })
    expect(definition.items?.where).toEqual({ state_type: ['unstarted'], has_branch: true })
    expect(definition.checks.map((c) => c.kind)).toEqual(['script', 'quota'])
    expect(definition.checks[0]).toMatchObject({
      run: 'python3 /Users/nishsitapara/.agents/skills/linear-todo-sweep/sweep.py --check-item',
      timeoutMs: 60_000
    })
  })

  it('routes prepared kickoff decisions to a fresh answer worker after the original session ends', () => {
    expect(definition.answers).toEqual({
      resume: 'never',
      else: { agent: 'claude', skill: 'ticket-kickoff', mode: 'answers' }
    })
  })

  it('loads through the loader on a copy', () => {
    const copy = mkdtempSync(join(tmpdir(), 'parity-m01-yaml-'))
    for (const file of ['linear-todo.yaml', 'people.yaml']) {
      cpSync(join(portedAutomationsDir(), file), join(copy, file))
    }
    const loaded = loadDefinitions([copy])
    expect(loaded.errors).toEqual([])
    expect(loaded.definitions.map((d) => d.id)).toEqual(['linear-todo'])
  })
})

const CASES = join(PARITY_DIR, JOB_M01.job)
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json') && f !== 'incomplete-listing.json')
  .sort()
const QUOTA_OLD = /^claude (weekly|session) limit at (\d+)%/
const QUOTA_NEW = /^Claude is at (\d+)% of its (weekly|session) limit/

type Fresh = { key: string; verdict: string; reason: string }

async function decide(name: string): Promise<{ old: OldDecision[]; fresh: Fresh[] }> {
  const file = join(CASES, `${name}.json`)
  const old = runOldPlan(JOB_M01.job, file)
  const fixture = loadFixture(caseFile(JOB_M01.job, name))
  const fresh = await dryTick({
    definition,
    people,
    fixture,
    seed: seedM01,
    runScript: answerScripts(old),
    tickDeps: withLinearTickets
  })
  return { old, fresh }
}

// Whether Pilot's reason is the old sweep's, in Pilot's words.
function reasonAgrees(o: OldDecision, n: Fresh): boolean {
  if (o.decision === 'start') {
    return n.reason === 'All checks pass'
  }
  if (o.decision === 'QUOTA') {
    const [, window, percent] = QUOTA_OLD.exec(o.reason) ?? []
    const [, newPercent, newWindow] = QUOTA_NEW.exec(n.reason) ?? []
    return window !== undefined && window === newWindow && percent === newPercent
  }
  if (o.decision === 'skip' && /^kickoff session still open$|^kicked off /.test(o.reason)) {
    return n.reason.startsWith('Already handled ')
  }
  if (o.decision === 'skip' && o.reason === 'no branch name in Linear') {
    return n.verdict === 'out_of_scope'
  }
  if (o.decision === 'skip') {
    return n.reason === o.reason // the script check's reason, as the check printed it
  }
  return true
}

describeParity(PARITY_M01, 'M01 · Start my Todo Linear tickets: parity with sweep.py', () => {
  it.each(cases)(
    '%s: every ticket gets the verdict the sweep gave it, from reads the case holds',
    async (name) => {
      await expectParity(PARITY_M01, join(CASES, name))
    }
  )

  it.each(cases)('%s: each decision is for the reason the sweep gave', async (file) => {
    const { old, fresh } = await decide(file.replace(/\.json$/, ''))
    for (const o of old.filter((d) => d.decision !== 'script_check' && d.decision !== 'defer')) {
      if (VERDICTS_M01.known?.some((k) => k.key === o.key && k.word === o.decision)) {
        continue // a deliberate difference, named in VERDICTS_M01 with its reason
      }
      const n = fresh.find((d) => d.key === o.key)
      expect(n, o.key).toBeDefined()
      expect([o.key, reasonAgrees(o, n!), n!.reason]).toEqual([o.key, true, n!.reason])
    }
  })

  it('starts the first three by priority then age, and the rest are over the limit', async () => {
    const { fresh } = await decide('fresh-tickets-start-urgent-first-three-per-run')
    const verdicts = Object.fromEntries(fresh.map((d) => [d.key, d.verdict]))
    expect(verdicts).toEqual({
      'linear:WEB-3': 'started',
      'linear:WEB-5': 'started',
      'linear:WEB-4': 'started',
      'linear:WEB-2': 'over_limit',
      'linear:WEB-1': 'over_limit'
    })
  })

  it('with no worktree only the local branch is checked: it exists, so the ticket waits for Nish', async () => {
    const { fresh } = await decide('local-branch-without-a-worktree')
    expect(fresh).toMatchObject([
      {
        key: 'linear:WEB-1',
        verdict: 'skipped',
        reason: 'branch web-1-work exists without an Orca worktree; open it in Orca, then re-run'
      }
    ])
  })

  it('an incomplete Linear listing fails the tick, as it stops the old sweep', async () => {
    const file = caseFile(JOB_M01.job, 'incomplete-listing')
    expect(() => runOldPlan(JOB_M01.job, file)).toThrow(/incomplete Linear listing/)
    await expect(
      dryTick({
        definition,
        people,
        fixture: loadFixture(file),
        seed: seedM01,
        runScript: answerScripts([]),
        tickDeps: withLinearTickets
      })
    ).rejects.toThrow(/Linear/i)
  })
})
