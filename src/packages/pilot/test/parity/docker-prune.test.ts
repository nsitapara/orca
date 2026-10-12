import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextTickAfter } from '../../src/shared/schedule/cron'
import { loadPortedAutomation } from './ported'

// Orca's saved precheck for 07 (scratchpad move/dry-07.txt), verbatim.
const OLD_PRECHECK = '/Users/nishsitapara/.agents/skills/docker-prune/prune.sh 80; exit 1'
const PRUNE = join(homedir(), '.agents', 'skills', 'docker-prune', 'prune.sh')
const { definition } = loadPortedAutomation('docker-prune')

// These tests only read prune.sh's text and the YAML: nothing here runs prune.sh or docker.
describe('07 · Clean Docker when disk is 80% full, as a run-once shell step', () => {
  it("runs prune.sh with Orca's argument, timeout and grace, in the main checkout", () => {
    expect(definition).toMatchObject({
      name: '07 · Clean Docker when disk is 80% full',
      schedule: '0 7 * * *',
      timezone: 'America/Los_Angeles',
      enabled: false,
      missedRunGraceMs: 12 * 3_600_000,
      items: null,
      checks: [],
      workspace: { kind: 'main_checkout' },
      powers: []
    })
    expect(definition.steps).toMatchObject([
      {
        name: 'prune',
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
    expect(definition.steps[0].exitCodes).toEqual({ ok: [0], skip: [3] })
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
