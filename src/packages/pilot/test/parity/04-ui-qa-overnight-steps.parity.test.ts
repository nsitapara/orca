import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import type { ItemFields, StepStatus } from '../../src/shared/api-types'
import type { AutomationDefinition, StepDef } from '../../src/shared/definition/types'
import { renderShellEnv } from '../../src/shared/run/shell-template'
import { decideStep, runEnd, type EndedStep } from '../../src/shared/run/step-plan'
import { stepFields, type StepResult } from '../../src/shared/template'
import { JOB_04, PARITY_04 } from './jobs/job-04'
import { describeParity, parityMissing } from './parity-case'
import { loadPortedAutomation } from './ported'

type Ended = { status: StepStatus; outputs: ItemFields }
type Night = {
  name: string
  stack: StepStatus
  test: StepStatus
  finished: 'complete' | 'stack_failed' | null
  nothing: boolean
  renderFailed?: boolean
  bug?: boolean
  teardown?: StepStatus
  report?: StepStatus
  fixer?: StepStatus
}
type OldEnd = { outcome: string; tested: boolean }

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

// The run engine's own step rules (contract §7 with H3): each step's `when` and the failure gate through decideStep,
// over the fields earlier steps left (stepFields) and {run.failed}; the run's end through runEnd.
function simulate(
  def: AutomationDefinition,
  outcome: (step: StepDef, fields: ItemFields) => Ended
): { ran: string[]; status: string; outcome: string } {
  const rows: StepResult[] = []
  const ended: EndedStep[] = []
  const ran: string[] = []
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
    rows.push({ name: step.name, status: result.status, exitCode: null, outputs: result.outputs })
    ended.push({ name: step.name, status: result.status, always: step.always, error: null })
  })
  const end = runEnd(ended, 0)
  return { ran, status: end.status, outcome: end.outcome }
}

// How each step of a night ends: the stack and the session as the night says; report's outputs as pilot_mode.report
// gives them (close_out's outcome and whether it counts as tested, from loop.py itself through jobs/job_04.py; the fix
// handoff only for a complete night with a confirmed bug in this change); the verdict is the YAML's own command.
function play(n: Night, old: OldEnd): (step: StepDef, fields: ItemFields) => Ended {
  return (step, fields) => {
    switch (step.name) {
      case 'stack':
        return { status: n.stack, outputs: {} }
      case 'test':
        return { status: n.test, outputs: n.finished ? { outcome: n.finished } : {} }
      case 'teardown':
        return { status: n.teardown ?? 'done', outputs: {} }
      case 'report': {
        if (n.report && n.report !== 'done') {
          return { status: n.report, outputs: {} }
        }
        const fix = Boolean(n.bug) && old.outcome === 'complete'
        const outputs: ItemFields = {
          outcome: old.outcome,
          tested: old.tested ? 'yes' : 'no',
          fix: fix ? 'yes' : 'no'
        }
        if (fix) {
          outputs.handoff = '{"findings":["F1"]}'
        }
        return { status: 'done', outputs }
      }
      case 'verdict':
        return shell(step, fields)
      case 'fix':
        return { status: n.fixer ?? 'done', outputs: {} }
      default:
        return { status: 'done', outputs: {} } // flag_failed: its command's own `|| echo` keeps it from failing
    }
  }
}

const NIGHTS: Night[] = [
  {
    name: 'the stack never started',
    stack: 'failed',
    test: 'skipped',
    finished: null,
    nothing: true
  },
  {
    name: 'the stack step timed out',
    stack: 'timed_out',
    test: 'skipped',
    finished: null,
    nothing: true
  },
  {
    name: 'a complete session with a bug to fix',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    bug: true
  },
  {
    name: 'a complete session with nothing to fix',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false
  },
  {
    name: 'the session found the stack dead',
    stack: 'done',
    test: 'done',
    finished: 'stack_failed',
    nothing: false
  },
  {
    name: 'timed out after writing findings',
    stack: 'done',
    test: 'timed_out',
    finished: null,
    nothing: false
  },
  {
    name: 'timed out having written nothing',
    stack: 'done',
    test: 'timed_out',
    finished: null,
    nothing: true
  },
  {
    name: 'finished, then cut off at 60 minutes',
    stack: 'done',
    test: 'timed_out',
    finished: 'complete',
    nothing: false,
    bug: true
  },
  {
    name: 'stopped having written nothing',
    stack: 'done',
    test: 'done',
    finished: null,
    nothing: true
  },
  {
    name: 'its terminal closed after it wrote a charter',
    stack: 'done',
    test: 'failed',
    finished: null,
    nothing: false
  },
  {
    name: 'the report failed to render',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    renderFailed: true,
    bug: true
  },
  {
    name: 'the teardown failed',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    teardown: 'failed'
  },
  {
    name: 'the report step crashed',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    report: 'failed'
  },
  {
    name: 'the report step timed out',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    report: 'timed_out'
  },
  {
    name: 'the fixer failed',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    bug: true,
    fixer: 'failed'
  },
  {
    name: 'the fixer timed out',
    stack: 'done',
    test: 'done',
    finished: 'complete',
    nothing: false,
    bug: true,
    fixer: 'timed_out'
  }
]

// close_out's outcome and count for each night (NIGHTS, in order), from ui-qa's own pilot_mode.classify and
// loop.counts_as_tested: run_old_plan.py 04 on the nights, recorded with /opt/homebrew/bin/python3 3.15.0 on 2026-10-16,
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
    const reported = !n.report || n.report === 'done'
    const { ran, status, outcome } = simulate(def!, play(n, expected))
    // done: the marker moves. Failed or timed out: the run's key is failed (run-close.ts), so the same head waits 12
    // hours. A report that broke gives no answer, so the night isn't counted.
    expect(status === 'done').toBe(expected.tested && reported)
    expect(['done', 'failed', 'timed_out']).toContain(status)
    expect(ran).toContain('teardown') // the stack comes down on every path
    expect(ran).toContain('report')
    expect(ran.includes('test')).toBe(n.stack === 'done')
    expect(ran.includes('fix')).toBe(reported && Boolean(n.bug) && expected.outcome === 'complete')
    expect(ran.includes('flag_failed')).toBe(!reported) // report flags every other ending itself: never twice
    // The report queues context work for a separate run; no preparation step holds the night open.
    expect(ran.includes('drafts')).toBe(false)
    expect(ran.includes('draft')).toBe(false)
    // A cleanup step that broke never masks what the night counted as.
    if (status === 'done' && n.teardown === 'failed') {
      expect(outcome).toBe('Done; cleanup step teardown failed')
    }
  })

  it('a separate context failure or timeout does not hold the completed night open', () => {
    const complete = NIGHTS.findIndex((n) => n.name === 'a complete session with nothing to fix')
    const night = simulate(def!, play(NIGHTS[complete], old[complete]))
    const preparation = loadPortedAutomation('prepare-inbox-item-context').definition
    for (const broken of ['failed', 'timed_out'] as const) {
      const context = simulate(preparation, () => ({ status: broken, outputs: {} }))
      expect(context.ran).toEqual(['prepare'])
      expect(context.status).toBe(broken)
      expect(night.status).toBe('done')
      expect(night.ran.at(-1)).toBe('verdict')
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
