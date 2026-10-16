import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStep, runEnd, type EndedStep } from '../../src/shared/run/step-plan'
import { nextTickAfter } from '../../src/shared/schedule/cron'
import { loadPortedAutomation } from './ported'

// Orca's saved precheck for 07 (scratchpad move/dry-07.txt), verbatim.
const OLD_PRECHECK = '/Users/nishsitapara/.agents/skills/docker-prune/prune.sh 80; exit 1'
const PRUNE = join(homedir(), '.agents', 'skills', 'docker-prune', 'prune.sh')
// The env sweep that runs first (~/.agents bb75bf8): pilotcli's orphan envs only; Pilot tears down its own runs' envs.
const SWEEP = 'pilotcli env delete orphan=true'
const { definition } = loadPortedAutomation('docker-prune')

// These tests only read prune.sh's text and the YAML: nothing here runs prune.sh, the sweep or docker.
describe('07 · Clean Docker when disk is 80% full: an env sweep, then the prune', () => {
  it("sweeps leftover envs, then runs prune.sh with Orca's argument, timeout and grace, in the main checkout", () => {
    expect(definition).toMatchObject({
      name: '07 · Clean Docker when disk is 80% full',
      schedule: '0 7 * * *',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * 3_600_000,
      items: null,
      checks: [],
      workspace: { kind: 'main_checkout' },
      powers: []
    })
    expect(definition.steps).toMatchObject([
      {
        name: 'sweep_envs',
        agent: 'shell',
        always: true,
        run: SWEEP,
        exitCodes: { ok: [0], skip: [3], stop: [] },
        timeoutMs: 300_000
      },
      {
        name: 'stacks',
        agent: 'shell',
        always: false,
        run: 'pilotcli env list stack_up=true',
        when: null
      },
      {
        name: 'prune',
        always: false,
        when: '{steps.stacks.count} == 0',
        agent: 'shell',
        run: OLD_PRECHECK.replace(/; exit 1$/, ''),
        timeoutMs: 600_000
      }
    ])
  })

  it("maps prune.sh's own exit codes: 3 (Docker not running) is a skip, 2 (bad arguments) fails", () => {
    const header = /^# Exit: (.*)$/m.exec(readFileSync(PRUNE, 'utf8'))?.[1] ?? ''
    expect(header).toContain('3 = over threshold but Docker is not running')
    expect(header).toContain('2 = bad arguments')
    expect(definition.steps[2].exitCodes).toEqual({ ok: [0], skip: [3], stop: [] })
  })

  it('a sweep that fails or times out never skips the prune, and the run still ends on the prune', () => {
    const [sweep, , prune] = definition.steps
    const clear = { 'steps.stacks.count': 0 }
    for (const status of ['failed', 'timed_out'] as const) {
      const swept: EndedStep = {
        name: sweep.name,
        status,
        always: sweep.always,
        error: 'env list failed'
      }
      expect(decideStep(prune, [swept], clear)).toEqual({ run: true })
      const pruned: EndedStep = {
        name: prune.name,
        status: 'done',
        always: prune.always,
        error: null
      }
      expect(runEnd([swept, pruned], 0).status).toBe('done')
      const prunedBadly: EndedStep = { ...pruned, status: 'failed', error: 'exit 2' }
      expect(runEnd([swept, prunedBadly], 0).status).toBe('failed')
    }
  })

  it('holds the prune while any agents-* stack is up (pilotcli env list stack_up=true counts them)', () => {
    const [, stacks, prune] = definition.steps
    const counted: EndedStep[] = [{ name: stacks.name, status: 'done', always: false, error: null }]
    expect(decideStep(prune, counted, { 'steps.stacks.count': 0 })).toEqual({ run: true })
    expect(decideStep(prune, counted, { 'steps.stacks.count': 1 })).toMatchObject({ run: false })
    // env list failing fails the step, which holds the prune back too: no prune without knowing.
    const failed: EndedStep[] = [
      { name: stacks.name, status: 'failed', always: false, error: 'docker' }
    ]
    expect(decideStep(prune, failed, {})).toMatchObject({ run: false })
  })

  it.each([
    ['2026-10-11T07:00:30-07:00', '2026-10-12T14:00:00.000Z'],
    ['2026-10-31T08:00:00-07:00', '2026-11-01T15:00:00.000Z'],
    ['2026-11-01T08:00:00-08:00', '2026-11-02T15:00:00.000Z']
  ])('fires daily at 07:00 Pacific like FREQ=DAILY;BYHOUR=7 (after %s → %s)', (after, next) => {
    expect(
      nextTickAfter(definition.schedule, definition.timezone, new Date(after))?.toISOString()
    ).toBe(next)
  })
})
