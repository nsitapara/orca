import { cpSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { handOverRunEnd } from '../../src/main/handover/hand-over'
import { PilotStore } from '../../src/main/store/store'
import type { RunRow, TickTrigger } from '../../src/shared/api-types'
import type { FeedDef } from '../../src/shared/definition/types'
import { outputsFromFile } from '../../src/shared/run/outputs'
import { loadFixture } from './fixture'
import {
  answerIds,
  answerScripts,
  COMMANDS_13,
  JOB_13,
  PARITY_13_PIPELINES,
  PARITY_13_STARTS,
  seed13,
  VERDICTS_13
} from './jobs/job-13'
import { withLinearTickets } from './linear-fixture'
import { frozenOldPlan, PARITY_DIR, type OldDecision } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { linearHandleOf } from './people-handle'
import { caseFile, dryTick, loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'dev-e2e-fix')
const pipelines = loadPortedAutomation(JOB_13.pipelines)
const starts = loadPortedAutomation(JOB_13.starts)
const HOUR = 3_600_000
// The recorded cases. The old side (dev-e2e-fix's sweep.py and pilot_mode.py, deleted in milestone 7) is frozen in each
// case file's old block: its decisions, its worktree checks and what list-fix-tickets printed.
const CASES = join(PARITY_DIR, JOB_13.job)
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()
// The children query sweep.py made (its CHILDREN = 30 per page), as every case recorded it: Pilot's source reads the same.
const SWEEP_CHILDREN =
  'projects/polygenx%2Fweb-platform/pipelines?source=parent_pipeline&ref=dev&order_by=id&sort=desc&per_page=30'

// Stage 1's feed to stage 2: the ticket output handed over, and stage 2 ticked at once.
const STAGE1_FEED: FeedDef = {
  to: 'dev-e2e-fix-start',
  pass: { id: 'ticket' },
  run: 'now',
  when: 'success',
  caption: 'the tickets it opens',
  trust: 'shell'
}

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
      env: { PIPELINE_ID: '{pipeline.id}' },
      outputs: ['ticket'],
      run: COMMANDS_13.ticket,
      // skip: nothing to act on (green, no real failure); a hold or an error fails the run, retried after 25m.
      exitCodes: { ok: [0], skip: [3], stop: [] }
    })
    expect((step as { run: string }).run).not.toContain('{')
    expect(pipelines.definition.steps).toHaveLength(1)
  })

  it('reads the hourly children as sweep.py did: parent_pipeline on dev, the newest suite run, failed ones due', () => {
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
    // marker_jobs are sweep.py's NOTIFY_JOBS, pinned above as literals; its children query is in every case.
    for (const name of cases) {
      const reads = loadFixture(join(CASES, name)).reads
      expect([name, reads.some((r) => r.argv.at(-1) === SWEEP_CHILDREN)]).toEqual([name, true])
    }
  })

  it('start step: tickets this job opened, quota before the worktree check, a raw slash command in the ticket worktree', () => {
    expect(starts.definition).toMatchObject({
      name: '13 · Start fix sessions for red e2e tickets',
      schedule: '6,36 * * * *',
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
    // This job's open tickets, which pilotcli lists from Linear (list-items), read by identifier: no listing, no match or
    // field script. Stage 1's handover starts a ticket at once, but only one the list also names.
    expect(starts.definition.items?.where).toEqual({
      ids_from: { feed: true, run: COMMANDS_13.listItems, field: 'identifier' },
      team: 'WEB',
      state_type: ['triage', 'backlog', 'unstarted', 'started'],
      has_branch: true
    })
    expect(starts.definition.items).toMatchObject({
      kind: 'linear_ticket',
      match: [],
      customFields: []
    })
    expect(starts.definition.checks).toMatchObject([
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
      { kind: 'script', run: COMMANDS_13.checkItem, timeoutMs: 60_000 }
    ])
    // The fix alone: nothing records the start any more, and once_per {ticket.id} keeps a started ticket from starting
    // again.
    expect(starts.definition.steps).toMatchObject([
      {
        name: 'fix',
        agent: 'claude',
        always: false,
        skill: 'dev-e2e-fix',
        promptStyle: 'raw',
        prompt: '/dev-e2e-fix {ticket.id}'
      }
    ])
    expect(starts.definition.steps).toHaveLength(1)
  })

  // The contract across the two programs: pilotcli's run-item writes the ticket output, Pilot's reader parses it, and
  // stage 1's feed hands each ticket to stage 2 and ticks it at once.
  it("stage 1's ticket output, as pilotcli writes it, is handed to stage 2, which ticks at once", () => {
    // pilotcli's lines for run-item dev-e2e-fix's data (JSON scalars, in key order; outcome and reason follow).
    const outputs = outputsFromFile('ticket="WEB-2123,WEB-9"\ntickets="WEB-2123,WEB-9"\n').outputs
    expect(outputs).toEqual({ ticket: 'WEB-2123,WEB-9', tickets: 'WEB-2123,WEB-9' })
    const store = PilotStore.open(':memory:')
    const run: RunRow = {
      id: 'dev-e2e-fix-202610131805-t1-1',
      automationId: 'dev-e2e-fix',
      tickId: 1,
      itemKey: 'pipeline:77',
      itemLabel: '#77',
      worktreePath: '/repo',
      status: 'done',
      outcome: 'Done',
      startedAt: 1,
      finishedAt: 2,
      costUsd: null,
      tokens: null,
      worktreeId: null,
      trigger: 'schedule',
      parentRunId: null,
      imported: false
    }
    store.runs.create(run)
    store.runs.createStep({
      runId: run.id,
      idx: 0,
      name: 'ticket',
      agent: 'shell',
      skill: null,
      startedAt: 1
    })
    store.advance.mergeStepOutputs(run.id, 0, outputs)
    const triggered: [string, TickTrigger][] = []
    const defs = [pipelines.definition, starts.definition]
    handOverRunEnd(
      {
        store,
        now: () => 3,
        definitionFor: (id) => defs.find((d) => d.id === id) ?? null,
        trigger: (id, cause) => triggered.push([id, cause]),
        log: (m) => {
          throw new Error(m)
        }
      },
      run,
      { status: 'done', outcome: 'Done' }
    )
    expect(store.handovers.pending('dev-e2e-fix-start', 10).map((h) => h.itemId)).toEqual([
      'WEB-2123',
      'WEB-9'
    ])
    expect(triggered).toEqual([
      [
        'dev-e2e-fix-start',
        { automationId: 'dev-e2e-fix', runId: run.id, stage: 1, ids: ['WEB-2123', 'WEB-9'] }
      ]
    ])
  })

  it('every script is a pilotcli command, with no Pilot placeholder in a command', () => {
    const idsFrom = starts.definition.items?.where.ids_from as { run: string }
    const commands = [
      ...pipelines.definition.steps.flatMap((s) => (s.agent === 'shell' ? [s.run ?? ''] : [])),
      idsFrom.run,
      ...starts.definition.checks.flatMap((c) => (c.kind === 'script' ? [c.run] : [])),
      ...starts.definition.steps.flatMap((s) => (s.agent === 'shell' ? [s.run ?? ''] : []))
    ]
    expect(commands).toEqual([COMMANDS_13.ticket, COMMANDS_13.listItems, COMMANDS_13.checkItem])
    for (const command of commands) {
      expect(command).not.toContain('{')
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
    // One job of two stages: stage 1 hands stage 2 the tickets it opens (display only; the cron still links them).
    expect(Object.fromEntries(loaded.definitions.map((d) => [d.id, d.job]))).toEqual({
      'dev-e2e-fix': {
        id: '13',
        name: 'Fix red hourly e2e on dev',
        stage: 1,
        label: 'Open or update the ticket',
        feeds: [STAGE1_FEED]
      },
      'dev-e2e-fix-start': {
        id: '13',
        name: null,
        stage: 2,
        label: 'Start a fix session per ticket',
        feeds: []
      }
    })
    expect(linearHandleOf('nish')).toBe('nish')
  })
})

// 13's words (frozen in each case's old block) and the verdicts that agree with them, through the shared
// parity runner (parity-case.ts): a missed read, a tick error, a verdict mismatch or a case without frozen verdicts fails
// a case. One old sweep, two automations: each compares its own keys.
const QUOTA_OLD = /^claude (weekly|session) limit at (\d+)%/
const QUOTA_NEW = /^Claude is at (\d+)% of its (weekly|session) limit/

type Fresh = { key: string; verdict: string; reason: string }

// Both automations' decisions on a case, with the start check answered from its frozen old side.
async function decideAll(name: string): Promise<Fresh[]> {
  const fixture = loadFixture(caseFile(JOB_13.job, name))
  const old = frozenOldPlan(caseFile(JOB_13.job, name))
  const first = await dryTick({ ...pipelines, fixture, seed: seed13 })
  const second = await dryTick({
    ...starts,
    fixture,
    seed: seed13,
    runScript: answerScripts(old, fixture),
    runIds: answerIds(fixture),
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
  '13 · Fix red hourly e2e on dev: ticket step, parity with sweep.py (frozen)',
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
  '13 · Start fix sessions for red e2e tickets: parity with sweep.py (frozen)',
  () => {
    it.each(cases)(
      '%s: every fix ticket gets the verdict the sweep gave it, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_13_STARTS, join(CASES, name))
      }
    )

    // Skip reasons, not only verdicts: the sweep's QUOTA, FAIL, green, seen and has_session each land on the same reason.
    it.each(cases)('%s: each decision is for the reason the sweep gave', async (name) => {
      const old = frozenOldPlan(join(CASES, name)).filter((d) => d.decision !== 'script_check')
      const fresh = await decideAll(name.replace(/\.json$/, ''))
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
        const fresh = await decideAll(name)
        expect(fresh.find((d) => d.key === 'linear:WEB-2')).toMatchObject({
          verdict: 'skipped',
          reason
        })
      }
    })

    // The old start() checked quota first; Pilot decides eligibility (the start check) before it holds for quota.
    it('a ticket whose worktree has work in flight is skipped, even while quota is out', async () => {
      const name = 'ticket-quota-out-and-dirty'
      const fresh = await decideAll(name)
      expect(fresh.find((d) => d.key === 'linear:WEB-2')).toMatchObject({
        verdict: 'skipped',
        reason: 'uncommitted changes in /wt/web-2; retry next run'
      })
    })

    it("a ticket 13 didn't open is never read, and a canceled one is not listed", async () => {
      const other = await decideAll('tickets-not-opened-by-13')
      expect(other.filter((d) => d.key.startsWith('linear:'))).toEqual([])
      const canceled = await decideAll('ticket-canceled')
      expect(canceled.filter((d) => d.key.startsWith('linear:'))).toEqual([])
    })

    // where.ids_from: list-items names the tickets (answered with what list-fix-tickets printed), and the source reads
    // each by identifier. A case with its `orca linear list` read taken out still decides the same, so Pilot never lists
    // Linear for 13 itself.
    it.each(cases)('%s: decides the same without any Linear listing', async (name) => {
      const old = frozenOldPlan(join(CASES, name))
      const fixture = loadFixture(join(CASES, name))
      const unlisted = {
        ...fixture,
        reads: fixture.reads.filter((r) => r.argv.slice(0, 3).join(' ') !== 'orca linear list')
      }
      const verdicts = async (f: typeof fixture) =>
        (
          await dryTick({
            ...starts,
            fixture: f,
            seed: seed13,
            runScript: answerScripts(old, f),
            runIds: answerIds(f),
            tickDeps: withLinearTickets
          })
        ).map((d) => [d.key, d.verdict, d.reason])
      expect(await verdicts(unlisted)).toEqual(await verdicts(fixture))
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
    expect(frozenOldPlan(caseFile(JOB_13.job, 'no-suite-run-in-30'))).toEqual([])
    expect(await dryTick({ ...pipelines, fixture, seed: seed13 })).toEqual([])
  })
})
