import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ItemFields, StepStatus } from '../../src/shared/api-types'
import type { AutomationDefinition, StepDef } from '../../src/shared/definition/types'
import { decideStep, runEnd, type EndedStep } from '../../src/shared/run/step-plan'
import { stepFields, type StepResult } from '../../src/shared/template'
import { JOB_03, PARITY_03 } from './jobs/job-03'
import { runOldPlan } from './old-side'
import { parityFixture } from './overrides'
import { describeParity, parityMissing } from './parity-case'
import { loadPortedAutomation } from './ported'

const BLOCK = '!1577 approved by alex1craig'
const ROUND = /^r(\d)_(claude|codex)$/

type Ended = { status: StepStatus; outputs: ItemFields }

function broke(s: EndedStep): boolean {
  return s.status === 'failed' || s.status === 'timed_out'
}

// The run engine's own step rules (contract §7 with H3): each step's `when` and the failure gate through decideStep,
// over the fields earlier steps left (stepFields) and {run.failed}; the run's end through runEnd.
function simulate(
  def: AutomationDefinition,
  outcome: (step: StepDef, fields: ItemFields) => Ended
): { ran: string[]; status: string } {
  const rows: StepResult[] = []
  const ended: EndedStep[] = []
  const ran: string[] = []
  def.steps.forEach((step, idx) => {
    const fields = {
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
  return { ran, status: runEnd(ended, 0).status }
}

// How a round's step ends on the Pilot side (pilot_mode.handoff, pinned by its Python tests): `changed` always, `blocked`
// only when the cycle would go on and a review block holds; no outputs when the agent ended without `handoff`;
// timed_out at the step's limit. `complete` (pilot_mode.complete) passes only when the last round that ran handed off
// and no block stopped the cycle.
function roundEnd(n: number, result: string): Ended {
  const changed = result.replace(/^blocked-/, '')
  if (changed === 'timeout') {
    return { status: 'timed_out', outputs: {} }
  }
  if (changed === 'none') {
    return { status: 'done', outputs: {} }
  }
  const goesOn = n === 1 || (changed === 'yes' && n < 3)
  const outputs: ItemFields = { changed }
  if (result.startsWith('blocked-') && goesOn) {
    outputs.blocked = BLOCK
  }
  return { status: 'done', outputs }
}

function play(lead: string, script: string[]): (step: StepDef, fields: ItemFields) => Ended {
  return (step, fields) => {
    if (step.name === 'begin') {
      const other = lead === 'claude' ? 'codex' : 'claude'
      return {
        status: 'done',
        outputs: { lead, other, base: 'b'.repeat(40), head: 'c'.repeat(40) }
      }
    }
    const round = ROUND.exec(step.name)
    if (round) {
      const n = Number(round[1])
      return roundEnd(n, script[n - 1] ?? 'none')
    }
    if (step.name === 'complete') {
      const last = [3, 2, 1]
        .flatMap((n) => ['claude', 'codex'].map((a) => `steps.r${n}_${a}`))
        .find((s) => fields[`${s}.status`] !== undefined && fields[`${s}.status`] !== 'skipped')
      const clean =
        last !== undefined &&
        fields[`${last}.status`] === 'done' &&
        fields[`${last}.changed`] !== undefined &&
        fields[`${last}.blocked`] === undefined
      return { status: clean ? 'done' : 'failed', outputs: {} }
    }
    return { status: 'done', outputs: {} }
  }
}

const SCENARIOS: [string, string[]][] = [
  ['claude', ['no', 'no']],
  ['claude', ['yes', 'no']],
  ['claude', ['no', 'yes', 'no']],
  ['claude', ['yes', 'yes', 'yes']],
  ['codex', ['no', 'yes', 'no']],
  ['codex', ['yes', 'no']],
  ['claude', ['none']],
  ['claude', ['no', 'none']],
  ['codex', ['yes', 'yes', 'none']],
  ['claude', ['yes', 'yes', 'none']],
  ['claude', ['timeout']],
  ['codex', ['no', 'timeout']],
  ['claude', ['blocked-no']],
  ['codex', ['blocked-yes']],
  ['claude', ['no', 'blocked-yes']],
  ['claude', ['no', 'blocked-no']],
  ['codex', ['yes', 'yes', 'blocked-yes']]
]

type OldEnd = { rounds: [number, string][]; end: string }

// loop.py's own Orca hand-offs (jobs/job_03.py drives `handoff` through each scenario), run once for every case.
function oldEnds(): OldEnd[] {
  const file = join(mkdtempSync(join(tmpdir(), 'parity-03-rounds-')), 'case.json')
  const scenarios = SCENARIOS.map(([lead, script]) => ({ lead, script }))
  const now = Date.parse('2026-10-11T17:20:00Z')
  const state = { 'parity/case.json': { scenarios } }
  writeFileSync(file, JSON.stringify(parityFixture(JOB_03.job, 'rounds', now, { state })))
  return runOldPlan(JOB_03.job, file).map((d) => ({
    rounds: JSON.parse(d.reason) as [number, string][],
    end: d.decision
  }))
}

const ready = parityMissing(PARITY_03).length === 0
const old = ready ? oldEnds() : []
const def = ready ? loadPortedAutomation(JOB_03.automationId).definition : null

// Skipped, with what's missing in its title and on stderr, where ~/.agents (or PARITY_SKILLS_DIR /
// PARITY_AUTOMATIONS_DIR) or python3 isn't there.
describeParity(PARITY_03, "03 · the YAML's steps run the rounds loop.py's hand-offs would", () => {
  it.each(SCENARIOS.map(([lead, script], n) => [n, lead, script] as const))(
    'scenario %i: %s leads, rounds end %j',
    (n, lead, script) => {
      const { ran, status } = simulate(def!, play(lead, script))
      const rounds = ran.flatMap((name) => {
        const m = ROUND.exec(name)
        return m ? [[Number(m[1]), m[2]] as [number, string]] : []
      })
      const expected = old[n]
      expect(rounds).toEqual(expected.rounds)
      // complete: the run is done and the marker moves; stopped or abandoned: it fails and the commits stay due
      expect(status === 'done').toBe(expected.end === 'complete')
      expect(ran.includes('publish')).toBe(expected.end === 'complete')
      // a stopped cycle stays unflagged, as in the sweep; an abandoned one is flagged by the next cycle's begin
      expect(ran.includes('flag_failed')).toBe(false)
    }
  )

  it('flags the worktree when the cycle fails to start, and runs nothing else', () => {
    const failsToStart = (step: StepDef, fields: ItemFields): Ended =>
      step.name === 'begin'
        ? { status: 'failed', outputs: {} }
        : play('claude', ['no', 'no'])(step, fields)
    expect(simulate(def!, failsToStart)).toEqual({
      ran: ['begin', 'flag_failed'],
      status: 'failed'
    })
  })

  it('every ending the old hand-offs know is covered', () => {
    expect(new Set(old.map((o) => o.end))).toEqual(new Set(['complete', 'stopped', 'abandoned']))
  })

  it('keeps one session per agent and worktree across the rounds, each Codex round launched the same way', () => {
    const rounds = def!.steps.filter((s) => ROUND.test(s.name))
    expect(rounds.map((s) => s.name)).toEqual([
      'r1_claude',
      'r1_codex',
      'r2_codex',
      'r2_claude',
      'r3_claude',
      'r3_codex'
    ])
    for (const step of rounds) {
      expect(step.session).toEqual({ kind: 'per_worktree' })
      expect(step.agent).toBe(ROUND.exec(step.name)?.[2])
      expect(step.mode).toBe(step.name.startsWith('r1_') ? 'pass' : 'review')
    }
    const codex = rounds.filter((s) => s.agent === 'codex').map((s) => s.args)
    expect(new Set(codex.map((a) => JSON.stringify(a))).size).toBe(1)
    expect(codex[0]).toContain('--dangerously-bypass-approvals-and-sandbox') // Codex commits
  })
})
