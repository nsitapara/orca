import { describe, expect, it } from 'vitest'
import { CALLS, NEW_USAGE, TODAY_USAGE } from '../../../../shared/__fixtures__/telemetry'
import {
  barSegments,
  causeText,
  durationText,
  isPayload,
  sortCommands,
  sparkPoints,
  totalsOf,
  whoText
} from './telemetry-view'

const NAMES = new Map([['fix-failed-ci', '05 · Fix failed CI on my MRs']])

describe('telemetry-view', () => {
  it.each([
    [{ cause: 'http', http_status: 502 }, 'HTTP 502'],
    [{ cause: 'http' }, 'HTTP'],
    [{ cause: 'invalid_flag' }, 'invalid flag'],
    [{ cause: 'stack_start' }, 'stack start'],
    [{ cause: 'timeout' }, 'timeout'],
    [{}, '-']
  ])('causeText %o is %s', (call, text) => expect(causeText(call)).toBe(text))

  it.each([
    [CALLS[0], 'Pilot (claude) · 05 context'],
    [CALLS[1], 'Claude · terminal'],
    [{ ...CALLS[0], agent: 'shell' }, 'Pilot · 05 context'],
    [{ ...CALLS[1], caller: 'app', agent: 'shell' }, 'App'],
    [{ ...CALLS[0], automation: 'gone-job', step: '' }, 'Pilot (claude) · gone-job']
  ])('whoText %#', (call, text) => expect(whoText(call, NAMES)).toBe(text))

  it.each([
    [11, '11ms'],
    [900, '900ms'],
    [1200, '1.2s'],
    [48_000, '48s'],
    [125_000, '2m05s']
  ])('durationText %d is %s', (ms, text) => expect(durationText(ms)).toBe(text))

  it('sorts commands by the column picked, then by calls', () => {
    expect(sortCommands(NEW_USAGE.commands, 'invalid').map((c) => c.command)).toEqual([
      'git get-branch',
      'gitlab check-mr',
      'worktree check'
    ])
  })

  it("totals come from pilotcli, else from the commands (today's pilotcli)", () => {
    expect(totalsOf(NEW_USAGE)).toEqual({ failed: 1, invalid: 2 })
    expect(totalsOf(TODAY_USAGE)).toEqual({ failed: 1, invalid: 0 })
  })

  it('stacks a bar ok-or-skip, failed, invalid from the bottom, a small failure still visible', () => {
    expect(barSegments(10, 1, 0, 10, 60)).toEqual([
      { kind: 'rest', y: 6, height: 54 },
      { kind: 'failed', y: 0, height: 6 }
    ])
    expect(barSegments(1000, 1, 0, 1000, 60)[1]).toMatchObject({ kind: 'failed', height: 2 })
    expect(barSegments(0, 0, 0, 10, 60)).toEqual([])
  })

  it('draws a sparkline across the width', () => {
    expect(sparkPoints([0, 2, 1])).toBe('0,19 50,1 100,10')
  })

  it.each([
    [{ fetchedAt: 1, error: 'x' }, true],
    [{ fetchedAt: 1, usage: NEW_USAGE, failures: { calls: [], more: false } }, true],
    [{ process: 'main' }, false],
    [undefined, false]
  ])('isPayload %#', (value, ok) => expect(isPayload(value)).toBe(ok))
})
