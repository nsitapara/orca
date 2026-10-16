import { describe, expect, it } from 'vitest'
import { loadPortedAutomation } from './ported'

// 01 left Orca's precheck for pilotcli (~/.agents bb75bf8): `git update-branch dev` fetches origin/dev, then
// fast-forwards dev where it is checked out while nothing is in flight there, else moves the ref. What it does to a
// checkout is pilotCLI's to test (internal/modules/git/update_branch_test.go); this pins the step that calls it.
const MAIN = '/Users/nishsitapara/Documents/web-platform'
const { definition } = loadPortedAutomation('pull-dev')

describe('01 · Pull latest dev into local dev, as a pilotcli shell step', () => {
  it("keeps Orca's schedule, zone and grace, in the main checkout", () => {
    expect(definition).toMatchObject({
      name: '01 · Pull latest dev into local dev',
      repo: 'web-platform',
      schedule: '0 * * * *',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * 3_600_000,
      items: null,
      checks: [],
      workspace: { kind: 'main_checkout' },
      powers: []
    })
  })

  it('updates dev with pilotcli; exit 3 (work in flight, or no fast-forward) skips the hour', () => {
    expect(definition.steps).toHaveLength(1)
    expect(definition.steps[0]).toMatchObject({
      name: 'pull',
      agent: 'shell',
      run: `pilotcli git update-branch dev --to origin/dev -C ${MAIN} --format text`,
      timeoutMs: 120_000
    })
    expect(definition.steps[0].exitCodes).toEqual({ ok: [0], skip: [3], stop: [] })
  })
})
