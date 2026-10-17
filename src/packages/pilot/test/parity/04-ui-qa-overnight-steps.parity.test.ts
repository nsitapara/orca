import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import type { ItemFields, StepStatus } from '../../src/shared/api-types'
import type { StoredResult } from '../../src/shared/api-types-result'
import type { AutomationDefinition, StepDef } from '../../src/shared/definition/types'
import { renderShellEnv } from '../../src/shared/run/shell-template'
import { decideStep, runEnd, type EndedStep } from '../../src/shared/run/step-plan'
import { stepFields, type StepResult } from '../../src/shared/template'
import { JOB_04, PARITY_04 } from './jobs/job-04'
import { describeParity, parityMissing } from './parity-case'
import { loadPortedAutomation } from './ported'

type Ended = { status: StepStatus; outputs: ItemFields; result?: StoredResult }
type Night = {
  name: string
  // env create's answer before any step (spec §7.10.2): ready, failed (setup, or a stack that never served), or not_yet
  // (the full-stack cap).
  prepared: 'ok' | 'failed' | 'not_yet'
  test: StepStatus
  // What the session said with `pilot run output outcome=…` (run.md); it survives the session's timeout.
  said: 'complete' | 'stack_failed' | null
  nothing: boolean
  renderFailed?: boolean
  bug?: boolean
  closePage?: StepStatus
  report?: StepStatus
  fixer?: StepStatus
}
type OldEnd = { outcome: string; tested: boolean }
type Night04 = {
  ran: string[]
  steps: Record<string, StepStatus>
  status: string
  outcome: string
  release: boolean
}

const ITEM: ItemFields = {
  'worktree.path': '/wt/web-1',
  'worktree.at_head': `repo::/wt/web-1@${'c'.repeat(40)}`,
  'run.id': 'ui-qa-overnight-1'
}

function broke(s: EndedStep): boolean {
  return s.status === 'failed' || s.status === 'timed_out'
}

// A shell step as the engine runs it: env: rendered from the fields (a value it can't fill fails the step before it
// starts), then the YAML's own command, as written, by /bin/sh.
function shell(step: StepDef, fields: ItemFields): Ended {
  const env = renderShellEnv(step.env, fields)
  if (!env.ok) {
    return { status: 'failed', outputs: {} }
  }
  const done = spawnSync('/bin/sh', ['-c', step.run ?? ''], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env.env }
  })
  return { status: done.status === 0 ? 'done' : 'failed', outputs: {} }
}

// A pilotcli step's ending: its outputs as pilotcli writes them to $PILOT_OUTPUT_FILE (data's scalars, then outcome and
// reason) and its stdout's envelope as Pilot stores it.
function pilotcli(status: StepStatus, outcome: string, data: Record<string, unknown>): Ended {
  const scalars = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v === null || typeof v !== 'object')
  ) as ItemFields
  return {
    status,
    outputs: { ...scalars, outcome, reason: '' },
    result: { command: 'skills', outcome, reason: '', data }
  }
}

// The run engine's own step rules (contract §7 with H3): each step's `when` and the failure gate through decideStep,
// over the fields earlier steps left (stepFields) and {run.failed}; the run's end through runEnd.
function simulate(
  def: AutomationDefinition,
  outcome: (step: StepDef, fields: ItemFields) => Ended
): Night04 {
  const rows: StepResult[] = []
  const ended: EndedStep[] = []
  const ran: string[] = []
  const steps: Record<string, StepStatus> = {}
  def.steps.forEach((step, idx) => {
    const fields = {
      ...ITEM,
      ...stepFields(rows, idx),
      'run.failed': ended.some((s) => !s.always && broke(s))
    }
    const go = decideStep(step, ended, fields).run
    const result: Ended = go ? outcome(step, fields) : { status: 'skipped', outputs: {} }
    if (go) {
      ran.push(step.name)
    }
    steps[step.name] = result.status
    rows.push({
      name: step.name,
      status: result.status,
      exitCode: null,
      outputs: result.outputs,
      result: result.result ?? null
    })
    ended.push({ name: step.name, status: result.status, always: step.always, error: null })
  })
  const end = runEnd(ended, 0)
  return { ran, steps, status: end.status, outcome: end.outcome, release: false }
}

// A night as Pilot runs it: env create first (main/envs/prepare.ts, spec §7.10.13 (d)). A failed create fails the run
// "Couldn't prepare its workspace", so its head waits 12 hours; not_yet cancels it "Deferred", its key released for the
// next tick. Either way no step runs and nothing flags the worktree (§7.10.14 (4)). Ready, the steps run.
function night(def: AutomationDefinition, n: Night, old: OldEnd): Night04 {
  if (n.prepared === 'failed') {
    const reason = "Couldn't prepare its workspace: the stack never served"
    return { ran: [], steps: {}, status: 'failed', outcome: reason, release: false }
  }
  if (n.prepared === 'not_yet') {
    const reason = 'Deferred: the stack cap is reached (full 2 of 2)'
    return { ran: [], steps: {}, status: 'cancelled', outcome: reason, release: true }
  }
  return simulate(def, play(n, old))
}

// How each step of a night ends: the context ok; the session as the night says, naming its page; create-report's data as
// spec §7.10.5 gives it (the session's ending and whether it counts as tested are close_out's, from loop.py itself
// through the old side, frozen below; the fix only for a complete night with a confirmed bug in this change; a render
// that failed still gives its flag); the verdict is the YAML's own command.
function play(n: Night, old: OldEnd): (step: StepDef, fields: ItemFields) => Ended {
  return (step, fields) => {
    switch (step.name) {
      case 'context':
        return pilotcli('done', 'ok', { branch: 'feat/x', worktree: '/wt/web-1', checkout: '.' })
      case 'test':
        return {
          status: n.test,
          outputs: n.said ? { outcome: n.said, page: 'p1' } : { page: 'p1' }
        }
      case 'close_page':
        return { status: n.closePage ?? 'done', outputs: {} }
      case 'report': {
        if (n.report) {
          return { status: n.report, outputs: {} } // crashed or timed out: no outputs
        }
        const fix = Boolean(n.bug) && old.outcome === 'complete'
        const clean = old.outcome === 'complete' && !n.bug
        const data = {
          session: old.outcome,
          tested: old.tested,
          fix,
          flag: clean ? 'ui-qa: clean through cccccccc' : 'ui-qa: 1 bug → feat-x.md',
          unread: !clean,
          handoff: fix ? { findings: ['F1'] } : null
        }
        return n.renderFailed ? pilotcli('failed', 'failed', data) : pilotcli('done', 'ok', data)
      }
      case 'verdict':
        return shell(step, fields)
      case 'fix':
        return { status: n.fixer ?? 'done', outputs: {} }
      case 'merge_back':
        return pilotcli('done', 'ok', { merged: true })
      default:
        return { status: 'done', outputs: {} } // the flags and close_page: their own `|| echo` keeps them from failing
    }
  }
}

// The old nights, in their frozen order. The stack nights are preparation outcomes now: a stack that never started fails
// env create; the old stack step's timeout is the full-stack cap's wait, which defers (a deliberate difference: the next
// tick tries again, not the next night). The old teardown is Pilot's env delete after the last step, so night 11's
// cleanup step that broke is close_page.
const NIGHTS: Night[] = [
  {
    name: 'the stack never started',
    prepared: 'failed',
    test: 'skipped',
    said: null,
    nothing: true
  },
  {
    name: 'the stack step timed out',
    prepared: 'not_yet',
    test: 'skipped',
    said: null,
    nothing: true
  },
  {
    name: 'a complete session with a bug to fix',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    bug: true
  },
  {
    name: 'a complete session with nothing to fix',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false
  },
  {
    name: 'the session found the stack dead',
    prepared: 'ok',
    test: 'done',
    said: 'stack_failed',
    nothing: false
  },
  {
    name: 'timed out after writing findings',
    prepared: 'ok',
    test: 'timed_out',
    said: null,
    nothing: false
  },
  {
    name: 'timed out having written nothing',
    prepared: 'ok',
    test: 'timed_out',
    said: null,
    nothing: true
  },
  {
    name: 'finished, then cut off at 60 minutes',
    prepared: 'ok',
    test: 'timed_out',
    said: 'complete',
    nothing: false,
    bug: true
  },
  {
    name: 'stopped having written nothing',
    prepared: 'ok',
    test: 'done',
    said: null,
    nothing: true
  },
  {
    name: 'its terminal closed after it wrote a charter',
    prepared: 'ok',
    test: 'failed',
    said: null,
    nothing: false
  },
  {
    name: 'the report failed to render',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    renderFailed: true,
    bug: true
  },
  {
    name: 'the teardown failed',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    closePage: 'timed_out'
  },
  {
    name: 'the report step crashed',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    report: 'failed'
  },
  {
    name: 'the report step timed out',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    report: 'timed_out'
  },
  {
    name: 'the fixer failed',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    bug: true,
    fixer: 'failed'
  },
  {
    name: 'the fixer timed out',
    prepared: 'ok',
    test: 'done',
    said: 'complete',
    nothing: false,
    bug: true,
    fixer: 'timed_out'
  }
]

// close_out's outcome and count for each night (NIGHTS, in order), from ui-qa's own pilot_mode.classify and
// loop.counts_as_tested: the old plan on the nights, recorded with /opt/homebrew/bin/python3 3.15.0 on 2026-10-16,
// before milestone 8b deleted them.
const FROZEN_ENDS: OldEnd[] = [
  { outcome: 'start_failed', tested: false }, // 0: the stack never started
  { outcome: 'start_failed', tested: false }, // 1: the stack step timed out
  { outcome: 'complete', tested: true }, // 2: a complete session with a bug to fix
  { outcome: 'complete', tested: true }, // 3: a complete session with nothing to fix
  { outcome: 'stack_failed', tested: false }, // 4: the session found the stack dead
  { outcome: 'timed_out', tested: true }, // 5: timed out after writing findings
  { outcome: 'timed_out', tested: false }, // 6: timed out having written nothing
  { outcome: 'complete', tested: true }, // 7: finished, then cut off at 60 minutes
  { outcome: 'stopped', tested: false }, // 8: stopped having written nothing
  { outcome: 'stopped', tested: true }, // 9: its terminal closed after it wrote a charter
  { outcome: 'render_failed', tested: false }, // 10: the report failed to render
  { outcome: 'complete', tested: true }, // 11: the teardown failed
  { outcome: 'complete', tested: true }, // 12: the report step crashed
  { outcome: 'complete', tested: true }, // 13: the report step timed out
  { outcome: 'complete', tested: true }, // 14: the fixer failed
  { outcome: 'complete', tested: true } // 15: the fixer timed out
]

const ready = parityMissing(PARITY_04).length === 0
const old = FROZEN_ENDS
const def = ready ? loadPortedAutomation(JOB_04.automationId).definition : null

// The nights' old ends are frozen above, so neither python3 nor ui-qa's code is needed; skipped, with what's missing in
// its title and on stderr, only where ~/.agents/automations (or PARITY_AUTOMATIONS_DIR) isn't there.
describeParity(PARITY_04, '04 · a night run ends as close_out would have counted it', () => {
  it.each(NIGHTS.map((n, i) => [i, n.name, n] as const))('night %i: %s', (i, _name, n) => {
    const expected = old[i]
    const { ran, steps, status, outcome, release } = night(def!, n, expected)
    if (n.prepared !== 'ok') {
      // No step runs, so nothing is counted and nothing flags; a deferred night's key is freed for the next tick.
      expect([ran, status === 'done', expected.tested, release]).toEqual([
        [],
        false,
        false,
        n.prepared === 'not_yet'
      ])
      return
    }
    // The report gave its answer (a render that failed still gives one); a report that crashed or timed out gave none.
    const reported = !n.report
    const tested = expected.tested && reported
    // done: the marker moves. Failed or timed out: the run's key is failed (run-close.ts), so the same head waits 12
    // hours. A report that gave no answer leaves the night uncounted.
    expect(status === 'done').toBe(tested)
    expect(['done', 'failed', 'timed_out']).toContain(status)
    expect(ran.slice(0, 2)).toEqual(['context', 'test'])
    expect(ran).toContain('report') // whenever the context is ok
    expect(ran.includes('flag')).toBe(reported)
    expect(ran.includes('flag_failed')).toBe(!reported) // flag xor flag_failed: never flagged twice
    expect(steps.verdict === 'failed').toBe(!tested) // the verdict fails only when untested
    expect(ran.includes('fix')).toBe(reported && Boolean(n.bug) && expected.outcome === 'complete')
    expect(ran.includes('merge_back')).toBe(ran.includes('fix'))
    expect(ran.includes('forget_branch')).toBe(ran.includes('fix'))
    expect(ran.includes('flag_held')).toBe(false) // every merge back here came home
    // The report queues context work for a separate run; no preparation step holds the night open.
    expect(ran.includes('drafts')).toBe(false)
    expect(ran.includes('draft')).toBe(false)
    // A cleanup step that broke never masks what the night counted as.
    if (n.closePage) {
      expect(outcome).toBe('Done; cleanup step close_page timed out')
    }
  })

  it('a separate context failure or timeout does not hold the completed night open', () => {
    const complete = NIGHTS.findIndex((n) => n.name === 'a complete session with nothing to fix')
    const done = night(def!, NIGHTS[complete], old[complete])
    const preparation = loadPortedAutomation('prepare-inbox-item-context').definition
    for (const broken of ['failed', 'timed_out'] as const) {
      const context = simulate(preparation, () => ({ status: broken, outputs: {} }))
      expect(context.ran).toEqual(['prepare'])
      expect(context.status).toBe(broken)
      expect(done.status).toBe('done')
      expect(done.ran.at(-1)).toBe('verdict')
    }
  })

  it('every outcome close_out knows is covered, tested and retried', () => {
    expect(new Set(old.map((o) => o.outcome))).toEqual(
      new Set(['start_failed', 'complete', 'stack_failed', 'timed_out', 'stopped', 'render_failed'])
    )
    expect(new Set(old.map((o) => o.tested))).toEqual(new Set([true, false]))
  })

  it("keeps the night's limits", () => {
    expect(def!.limits).toMatchObject({
      perTick: 1,
      atOnce: 1,
      timeoutMs: 3_600_000,
      order: 'oldest_waiting_first'
    })
    expect(def!.retryAfterFailureMs).toBe(12 * 3_600_000)
    expect(def!.missedRunGraceMs).toBe(20 * 60_000)
    expect(def!.checks).toContainEqual({ kind: 'window', start: '02:00', end: '05:59' })
    expect(def!.steps.find((s) => s.name === 'test')).toMatchObject({
      agent: 'codex',
      always: true,
      timeoutMs: 3_600_000
    })
    expect(def!.steps.find((s) => s.name === 'fix')).toMatchObject({
      agent: 'claude',
      always: true,
      args: [] // no --permission-mode: Pilot's Claude command's --dangerously-skip-permissions outranks it
    })
  })
})
