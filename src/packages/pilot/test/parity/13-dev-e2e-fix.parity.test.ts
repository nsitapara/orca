import { cpSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { loadFixture } from './fixture'
import {
  answerScripts,
  JOB_13,
  PARITY_13_PIPELINES,
  PARITY_13_STARTS,
  seed13,
  VERDICTS_13
} from './jobs/job-13'
import { withLinearTickets } from './linear-fixture'
import { PARITY_DIR, runOldPlan, type OldDecision } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { linearHandleOf } from './people-handle'
import { caseFile, dryTick, loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'dev-e2e-fix')
const pipelines = loadPortedAutomation(JOB_13.pipelines)
const starts = loadPortedAutomation(JOB_13.starts)
const HOUR = 3_600_000

function modeOutputs(): string[] {
  const text = readFileSync(join(SKILL, 'modes', 'answers.md'), 'utf8')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('13 · Fix red hourly e2e on dev: the definitions (old job: orca automation 6d74cfe2, precheck sweep.py)', () => {
  it('ticket step: the old schedule, a shell step with its value in env, 90%/95% quota, one pipeline per tick', () => {
    expect(pipelines.definition).toMatchObject({
      name: '13 · Fix red hourly e2e on dev',
      schedule: '5,35 * * * *',
      timezone: 'America/Los_Angeles',
      enabled: false,
      missedRunGraceMs: 12 * HOUR,
      firstSeen: 'process',
      oncePer: '{pipeline.id}',
      retryAfterFailureMs: 25 * 60_000,
      limits: { perTick: 1 },
      workspace: { kind: 'main_checkout' },
      powers: ['create_ticket', 'update_ticket'],
      inbox: 'nish'
    })
    expect(pipelines.definition.checks).toMatchObject([
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
    ])
    const step = pipelines.definition.steps[0]
    expect(step).toMatchObject({
      name: 'ticket',
      agent: 'shell',
      env: { PIPELINE_ID: '{pipeline.id}' }
    })
    expect(step).toMatchObject({
      run: 'python3 /Users/nishsitapara/.agents/skills/dev-e2e-fix/pilot_mode.py ticket "$PIPELINE_ID"'
    })
    expect((step as { run: string }).run).not.toContain('{')
  })

  it('reads the hourly children as sweep.py does: parent_pipeline on dev, the newest suite run, failed ones due', () => {
    expect(pipelines.definition.items).toMatchObject({
      kind: 'pipeline',
      where: {
        ref: 'dev',
        source: 'parent_pipeline',
        status: 'failed',
        select: 'newest_suite_running',
        marker_jobs: ['notify-slack', 'notify-slack-recovery']
      }
    })
    const sweep = readFileSync(join(SKILL, 'sweep.py'), 'utf8')
    expect(sweep).toContain('NOTIFY_JOBS = {"notify-slack", "notify-slack-recovery"}')
    expect(sweep).toContain(
      'pipelines?source=parent_pipeline&ref=dev&order_by=id&sort=desc&per_page={CHILDREN}'
    )
  })

  it('start step: tickets this job opened, quota before the worktree check, a raw slash command in the ticket worktree', () => {
    expect(starts.definition).toMatchObject({
      name: '13 · Start fix sessions for red e2e tickets',
      schedule: '6,36 * * * *',
      enabled: false,
      oncePer: '{ticket.id}',
      retryAfterFailureMs: 25 * 60_000,
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
    // No assignee clause: Linear's `assigned` filter (the signed-in user's tickets) lists them, not the whole org.
    expect(starts.definition.items?.where).toEqual({
      team: 'WEB',
      state_type: ['triage', 'backlog', 'unstarted', 'started'],
      has_branch: true
    })
    expect(starts.definition.items).toMatchObject({
      kind: 'linear_ticket',
      match: ['{ticket.dev_e2e} == true']
    })
    expect(starts.definition.checks.map((c) => c.kind)).toEqual(['quota', 'script'])
    expect(starts.definition.steps).toMatchObject([
      {
        name: 'fix',
        agent: 'claude',
        skill: 'dev-e2e-fix',
        promptStyle: 'raw',
        prompt: '/dev-e2e-fix {ticket.id}'
      }
    ])
  })

  it('every script is the skill’s own pilot_mode.py, with no Pilot placeholder in a command', () => {
    const commands = [
      ...(starts.definition.items?.customFields ?? []).map((f) => f.script),
      ...starts.definition.checks.flatMap((c) => (c.kind === 'script' ? [c.run] : []))
    ]
    expect(commands).toHaveLength(2)
    for (const command of commands) {
      expect(command).toMatch(
        /^python3 \/Users\/nishsitapara\/\.agents\/skills\/dev-e2e-fix\/pilot_mode\.py (field-fix-ticket|check-worktree)$/
      )
    }
  })

  it("sends an answered 'stopped without a fix' card back to its session, else to the skill's answers mode", () => {
    expect(starts.definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'dev-e2e-fix', mode: 'answers' }
    })
    expect(modeOutputs()).toEqual(['outcome', 'item_status', 'reply'])
    expect(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')).toContain(
      '~/.agents/skills/dev-e2e-fix/modes/answers.md'
    )
  })

  it("both files load through the loader on a copy, with Nish's Linear display name from people.yaml", () => {
    const copy = mkdtempSync(join(tmpdir(), 'parity-13-yaml-'))
    for (const file of ['dev-e2e-fix.yaml', 'dev-e2e-fix-start.yaml', 'people.yaml']) {
      cpSync(join(portedAutomationsDir(), file), join(copy, file))
    }
    const loaded = loadDefinitions([copy])
    expect(loaded.errors).toEqual([])
    expect(loaded.definitions.map((d) => d.id).sort()).toEqual(['dev-e2e-fix', 'dev-e2e-fix-start'])
    expect(linearHandleOf('nish')).toBe('nish')
  })
})

// 13's words (jobs/job_13.py) and the verdicts that agree with them, through the shared parity runner (parity-case.ts): a
// missed read, a tick error or a verdict mismatch fails a case. One old sweep, two automations: each compares its own keys.
const CASES = join(PARITY_DIR, JOB_13.job)
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

const QUOTA_OLD = /^claude (weekly|session) limit at (\d+)%/
const QUOTA_NEW = /^Claude is at (\d+)% of its (weekly|session) limit/

type Fresh = { key: string; verdict: string; reason: string }

async function decideAll(name: string, old: OldDecision[]): Promise<Fresh[]> {
  const fixture = loadFixture(caseFile(JOB_13.job, name))
  const first = await dryTick({ ...pipelines, fixture, seed: seed13 })
  const second = await dryTick({
    ...starts,
    fixture,
    seed: seed13,
    runScript: answerScripts(old, fixture),
    tickDeps: withLinearTickets
  })
  return [...first, ...second]
}

// The reason each old word's skip gives, in the new side's words.
function reasonAgrees(o: OldDecision, n: Fresh): boolean {
  if (o.decision === 'green') {
    return n.reason === `Pipeline ${o.key.split(':')[1]} passed`
  }
  if (o.decision === 'seen' || o.decision === 'has_session') {
    return n.reason.startsWith('Already handled ')
  }
  if (o.decision === 'FAIL') {
    return n.reason === o.reason.replace(/; retried next run$/, '')
  }
  if (o.decision === 'act' || o.decision === 'start') {
    return n.verdict === 'started' && n.reason === 'All checks pass'
  }
  if (o.decision === 'QUOTA') {
    const [, window, percent] = QUOTA_OLD.exec(o.reason) ?? []
    const [, newPercent, newWindow] = QUOTA_NEW.exec(n.reason) ?? []
    return window !== undefined && window === newWindow && percent === newPercent
  }
  return true
}

describeParity(
  PARITY_13_PIPELINES,
  '13 · Fix red hourly e2e on dev: ticket step, parity with sweep.py',
  () => {
    it.each(cases)(
      '%s: the red run gets the verdict the sweep gave it, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_13_PIPELINES, join(CASES, name))
      }
    )
  }
)

describeParity(
  PARITY_13_STARTS,
  '13 · Start fix sessions for red e2e tickets: parity with sweep.py',
  () => {
    it.each(cases)(
      '%s: every fix ticket gets the verdict the sweep gave it, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_13_STARTS, join(CASES, name))
      }
    )

    // Skip reasons, not only verdicts: the sweep's QUOTA, FAIL, green, seen and has_session each land on the same reason.
    it.each(cases)('%s: each decision is for the reason the sweep gave', async (name) => {
      const old = runOldPlan(JOB_13.job, join(CASES, name)).filter(
        (d) => d.decision !== 'script_check'
      )
      const fresh = await decideAll(
        name.replace(/\.json$/, ''),
        runOldPlan(JOB_13.job, join(CASES, name))
      )
      for (const o of old.filter((d) =>
        ['green', 'seen', 'has_session', 'FAIL', 'QUOTA', 'act', 'start'].includes(d.decision)
      )) {
        if (VERDICTS_13.known?.some((k) => k.key === o.key && k.word === o.decision)) {
          continue // a deliberate difference, named in VERDICTS_13 with its reason
        }
        const n = fresh.find((d) => d.key === o.key)
        expect(n, o.key).toBeDefined()
        expect([o.key, reasonAgrees(o, n!), n!.reason]).toEqual([o.key, true, n!.reason])
      }
    })

    it('a worktree with work in flight refuses before it starts, whichever of the sweep’s two reasons it gives', async () => {
      for (const [name, reason] of [
        ['ticket-worktree-in-flight', 'uncommitted changes in /wt/web-2; retry next run'],
        ['ticket-worktree-rebasing', 'rebase-merge present in /wt/web-2; retry next run']
      ]) {
        const fresh = await decideAll(name, runOldPlan(JOB_13.job, join(CASES, `${name}.json`)))
        expect(fresh.find((d) => d.key === 'linear:WEB-2')).toMatchObject({
          verdict: 'skipped',
          reason
        })
      }
    })

    it('quota is checked before the worktree, as the old start() did', async () => {
      const name = 'ticket-quota-out-and-dirty'
      const fresh = await decideAll(name, runOldPlan(JOB_13.job, join(CASES, `${name}.json`)))
      expect(fresh.find((d) => d.key === 'linear:WEB-2')).toMatchObject({
        verdict: 'skipped',
        reason: expect.stringMatching(QUOTA_NEW)
      })
    })

    it("a ticket 13 didn't open is out of scope, and a canceled one is not listed", async () => {
      const other = await decideAll('tickets-not-opened-by-13', [])
      expect(other.find((d) => d.key === 'linear:WEB-50')).toMatchObject({
        verdict: 'out_of_scope'
      })
      const canceled = await decideAll('ticket-canceled', [])
      expect(canceled.filter((d) => d.key.startsWith('linear:'))).toEqual([])
    })
  }
)

describeParity(PARITY_13_PIPELINES, '13: no suite run among the newest 30 children', () => {
  // Pilot's pipeline source reads 30 children, as the sweep did. A window with no run that ran the suite has no item:
  // not a green run, not a handled one.
  it('lists nothing, on either side, and decides nothing', async () => {
    const fixture = loadFixture(caseFile(JOB_13.job, 'no-suite-run-in-30'))
    const children = fixture.reads.find((r) =>
      (r.argv.at(-1) ?? '').includes('/pipelines?source=parent_pipeline')
    )
    expect(children?.json).toHaveLength(30)
    expect(runOldPlan(JOB_13.job, caseFile(JOB_13.job, 'no-suite-run-in-30'))).toEqual([])
    expect(await dryTick({ ...pipelines, fixture, seed: seed13 })).toEqual([])
  })
})
