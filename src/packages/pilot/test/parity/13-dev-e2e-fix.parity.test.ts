import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { handOverRunEnd } from '../../src/main/handover/hand-over'
import { PilotStore } from '../../src/main/store/store'
import type { RunRow, TickTrigger } from '../../src/shared/api-types'
import { readsFed } from '../../src/shared/definition/jobs'
import type { FeedDef } from '../../src/shared/definition/types'
import { outputsFromFile } from '../../src/shared/run/outputs'
import { renderShellEnv } from '../../src/shared/run/shell-template'
import { decideStep, runEnd, type EndedStep } from '../../src/shared/run/step-plan'
import { loadFixture } from './fixture'
import {
  answerIds,
  answerScripts,
  JOB_13,
  PARITY_13_PIPELINES,
  PARITY_13_STARTS,
  seed13,
  shimmedState,
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
const LIST_FIX_TICKETS =
  'python3 /Users/nishsitapara/.agents/skills/dev-e2e-fix/pilot_mode.py list-fix-tickets'
// 13 adopts the stage handover with the Pilot build that reads job.feeds connections. Until the controller applies
// yaml-pending.patch to ~/.agents/automations, the live files keep the old shape: an arrow only, and stage 2 reads
// list-fix-tickets alone. Run against the patched files with PARITY_AUTOMATIONS_DIR=<a patched copy>.
const adopted = readsFed(starts.definition)

// Stage 1's feed to stage 2: the ticket output handed over and stage 2 ticked at once, or (before) the arrow only.
function stage1Feed(): FeedDef {
  const feed: FeedDef = {
    to: 'dev-e2e-fix-start',
    pass: null,
    run: 'next_schedule',
    when: 'success',
    caption: 'the tickets it opens',
    trust: 'shell'
  }
  if (adopted) {
    return { ...feed, pass: { id: 'ticket' }, run: 'now' }
  }
  return feed
}

// Stage 2's ids: what stage 1 hands over (once adopted) and list-fix-tickets, as its fallback.
function stage2IdsFrom(): Record<string, unknown> {
  const idsFrom = { run: LIST_FIX_TICKETS, field: 'identifier' }
  if (adopted) {
    return { feed: true, ...idsFrom }
  }
  return idsFrom
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
      outputs: adopted ? ['ticket'] : []
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
    // Only the tickets this job recorded as open (tickets.json, through list-fix-tickets), read by identifier: no listing,
    // no match or field script. No assignee clause: like the Orca sweep, a recorded open ticket starts whoever has it.
    expect(starts.definition.items?.where).toEqual({
      ids_from: stage2IdsFrom(),
      team: 'WEB',
      state_type: ['triage', 'backlog', 'unstarted', 'started'],
      has_branch: true
    })
    expect(starts.definition.items).toMatchObject({
      kind: 'linear_ticket',
      match: [],
      customFields: []
    })
    expect(starts.definition.checks.map((c) => c.kind)).toEqual(['quota', 'script'])
    // record_start first, as the old start() recorded the session before anything else: neither step is `always`, so
    // a record that failed stops the fix (see "record_start runs first" below).
    expect(starts.definition.steps).toMatchObject([
      {
        name: 'record_start',
        agent: 'shell',
        always: false,
        timeoutMs: 60_000,
        env: { TICKET: '{ticket.id}', WT: '{worktree.path}' },
        run: 'python3 /Users/nishsitapara/.agents/skills/dev-e2e-fix/pilot_mode.py started "$TICKET" "$WT"'
      },
      {
        name: 'fix',
        agent: 'claude',
        always: false,
        skill: 'dev-e2e-fix',
        promptStyle: 'raw',
        prompt: '/dev-e2e-fix {ticket.id}'
      }
    ])
    expect(starts.definition.steps).toHaveLength(2)
  })

  it('record_start runs first, and only a recorded start lets the fix run', () => {
    for (const recorded of ['done', 'failed', 'timed_out'] as const) {
      const [first, fix] = starts.definition.steps
      const ended: EndedStep[] = [
        { name: first.name, status: recorded, always: first.always, error: null }
      ]
      const fields = { 'ticket.id': 'WEB-1', 'worktree.path': '/wt/web-1-fix' }
      expect(decideStep(first, [], fields).run).toBe(true)
      expect(decideStep(fix, ended, fields).run).toBe(recorded === 'done')
      if (recorded !== 'done') {
        expect(runEnd(ended, 0).status).toBe(recorded)
      }
    }
  })

  // The YAML's own command, through /bin/sh with its env rendered as the engine renders it, in a Pilot step's env.
  // A python3 shim points gate's state root at a temp folder, so nothing under the real checkout is touched.
  function recordStart(ticket: string, tickets: Record<string, unknown>) {
    const { root, state, bin } = shimmedState(tickets)
    const step = starts.definition.steps[0]
    const wt = join(root, 'wt', 'web-1-fix')
    const env = renderShellEnv(step.env, { 'ticket.id': ticket, 'worktree.path': wt })
    if (!env.ok) {
      throw new Error('record_start env did not render')
    }
    const outputFile = join(root, 'outputs')
    writeFileSync(outputFile, '')
    const done = spawnSync('/bin/sh', ['-c', step.run ?? ''], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: homedir(),
        PILOT_RUN_ID: 'dev-e2e-fix-start-1',
        PILOT_OUTPUT_FILE: outputFile,
        PARITY_STATE_ROOT: state,
        PYTHONDONTWRITEBYTECODE: '1',
        ...env.env
      }
    })
    return {
      code: done.status,
      wt,
      tickets: JSON.parse(readFileSync(join(state, 'dev-e2e', 'tickets.json'), 'utf8')),
      outputs: outputsFromFile(readFileSync(outputFile, 'utf8')).outputs
    }
  }

  it("record_start writes the session's path and startedAt on the ticket, as the old start() did", () => {
    const opened = { 'WEB-1': { branch: 'web-1-fix', pipeline: 7, closed: false } }
    const r = recordStart('WEB-1', opened)
    expect(r.code).toBe(0)
    expect(r.tickets['WEB-1']).toEqual({
      branch: 'web-1-fix',
      pipeline: 7,
      closed: false,
      path: r.wt,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/)
    })
    expect(r.outputs).toEqual({ path: r.wt })
  })

  it("record_start fails, recording nothing, for a ticket this job didn't open (so the fix never runs)", () => {
    const opened = { 'WEB-1': { branch: 'web-1-fix' } }
    const r = recordStart('WEB-9', opened)
    expect(r.code).toBe(1)
    expect(r.tickets).toEqual(opened)
    expect(r.outputs).toEqual({})
  })

  // The contract across the two languages: pilot_mode's report() writes the ticket output, Pilot's reader parses it,
  // and stage 1's feed hands each ticket to stage 2 and ticks it at once.
  it.runIf(adopted)(
    "stage 1's ticket output, as pilot_mode writes it, is handed to stage 2, which ticks at once",
    () => {
      const root = mkdtempSync(join(tmpdir(), 'parity-13-handover-'))
      const outputFile = join(root, 'outputs')
      writeFileSync(outputFile, '')
      const wrote = spawnSync(
        'python3',
        ['-c', "import pilot_mode; pilot_mode.report(['WEB-2123', 'WEB-9'])"],
        {
          cwd: SKILL,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH ?? '',
            HOME: homedir(),
            PILOT_OUTPUT_FILE: outputFile,
            PYTHONDONTWRITEBYTECODE: '1'
          }
        }
      )
      expect(wrote.stderr).toBe('')
      const outputs = outputsFromFile(readFileSync(outputFile, 'utf8')).outputs
      expect(outputs).toEqual({ tickets: 'WEB-2123,WEB-9', ticket: 'WEB-2123,WEB-9' })
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
    }
  )

  it('every script is the skill’s own pilot_mode.py, with no Pilot placeholder in a command', () => {
    const idsFrom = starts.definition.items?.where.ids_from as { run: string }
    const commands = [
      idsFrom.run,
      ...starts.definition.checks.flatMap((c) => (c.kind === 'script' ? [c.run] : [])),
      ...starts.definition.steps.flatMap((s) => (s.agent === 'shell' ? [s.run ?? ''] : []))
    ]
    expect(commands).toHaveLength(3)
    for (const command of commands) {
      expect(command).toMatch(
        /^python3 \/Users\/nishsitapara\/\.agents\/skills\/dev-e2e-fix\/pilot_mode\.py (list-fix-tickets|check-worktree|started "\$TICKET" "\$WT")$/
      )
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
        feeds: [stage1Feed()]
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

    it("a ticket 13 didn't open is never read, and a canceled one is not listed", async () => {
      const other = await decideAll('tickets-not-opened-by-13', [])
      expect(other.filter((d) => d.key.startsWith('linear:'))).toEqual([])
      const canceled = await decideAll('ticket-canceled', [])
      expect(canceled.filter((d) => d.key.startsWith('linear:'))).toEqual([])
    })

    // where.ids_from: list-fix-tickets names the tickets, and the source reads each by identifier. A case with its
    // `orca linear list` read taken out still decides the same, so Pilot never lists Linear for 13.
    it.each(cases)('%s: decides the same without any Linear listing', async (name) => {
      const old = runOldPlan(JOB_13.job, join(CASES, name))
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
    expect(runOldPlan(JOB_13.job, caseFile(JOB_13.job, 'no-suite-run-in-30'))).toEqual([])
    expect(await dryTick({ ...pipelines, fixture, seed: seed13 })).toEqual([])
  })
})
