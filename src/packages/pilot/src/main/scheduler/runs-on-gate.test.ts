import { describe, expect, it } from 'vitest'
import { runsOnGate } from './runs-on-gate'

describe('runsOnGate', () => {
  it.each([
    ['an unpinned job where every job ticks', null, false, true],
    ['not an unpinned job where only pinned jobs tick', null, true, false],
    ['a job pinned here, whatever the case', 'mac MINI', true, true],
    ['not a job pinned to another machine', 'Linux box', false, false]
  ])('ticks %s', (_w, runsOn, pinnedOnly, ticks) =>
    expect(runsOnGate({ machineName: () => 'Mac mini', pinnedOnly }).ticksHere({ runsOn })).toBe(
      ticks
    )
  )

  it("says why it won't tick a job", () => {
    expect(
      runsOnGate({ machineName: () => 'Mac mini', pinnedOnly: false }).refusal({
        runsOn: 'Linux box'
      })
    ).toBe('it runs on Linux box, not Mac mini')
    expect(
      runsOnGate({ machineName: () => 'Mac mini', pinnedOnly: true }).refusal({ runsOn: null })
    ).toBe('it has no runs_on, and this Pilot ticks only jobs pinned to Mac mini')
  })

  it('has no refusal for a job that ticks', () => {
    expect(
      runsOnGate({ machineName: () => 'Mac mini', pinnedOnly: false }).refusal({ runsOn: null })
    ).toBeNull()
  })

  it("reads the machine's name at every call, so a rename counts from the next pass", () => {
    let name = 'Mac mini'
    const gate = runsOnGate({ machineName: () => name, pinnedOnly: false })
    expect(gate.ticksHere({ runsOn: 'Studio' })).toBe(false)
    name = 'Studio'
    expect(gate.ticksHere({ runsOn: 'Studio' })).toBe(true)
  })
})
