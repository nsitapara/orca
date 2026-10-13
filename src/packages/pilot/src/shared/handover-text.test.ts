import { describe, expect, it } from 'vitest'
import type { HandoverRow, TickHandover } from './api-types'
import { handoverActivityLines, handoverPreviewLines, lastHandoverText } from './handover-text'

const row = (over: Partial<HandoverRow>): HandoverRow => ({
  id: 1,
  senderId: 'dev-e2e-fix',
  senderRunId: 'dev-e2e-fix-202610131805-t4-1',
  receiverId: 'dev-e2e-fix-start',
  itemId: 'WEB-2123',
  createdAt: 1_000,
  state: 'consumed',
  consumedAt: 2_000,
  tickId: 9,
  verdict: 'started',
  reason: 'Started',
  runId: 'dev-e2e-fix-start-1',
  ...over
})
const TRIGGER = {
  automationId: 'dev-e2e-fix',
  runId: 'dev-e2e-fix-202610131805-t4-1',
  stage: 1,
  ids: ['WEB-2123']
}

describe('handoverActivityLines: what Activity says about a tick of a fed stage', () => {
  it.each([
    [
      'a triggered tick, with the ids it was handed',
      { trigger: TRIGGER, handedOver: [row({})] },
      ['Triggered by stage 1 run dev-e2e-fix-202610131805-t4-1, handed over WEB-2123']
    ],
    [
      'a triggered tick of a feed that passes nothing',
      { trigger: { ...TRIGGER, ids: [] }, handedOver: [] },
      ['Triggered by stage 1 run dev-e2e-fix-202610131805-t4-1']
    ],
    [
      'a triggered tick that also read ids handed over earlier',
      {
        trigger: TRIGGER,
        handedOver: [row({}), row({ id: 2, itemId: 'WEB-2100', senderRunId: 'older' })]
      },
      [
        'Triggered by stage 1 run dev-e2e-fix-202610131805-t4-1, handed over WEB-2123',
        'Read handed-over ids: WEB-2123, WEB-2100'
      ]
    ],
    [
      'a scheduled tick that read handed-over ids',
      {
        trigger: null,
        handedOver: [row({}), row({ id: 2, itemId: 'WEB-2123', senderRunId: 'r2' })]
      },
      ['Read handed-over ids: WEB-2123']
    ],
    [
      'a tick that expired a handover pending 7 days',
      {
        trigger: null,
        handedOver: [
          row({ state: 'expired', verdict: null, senderStage: 1 }),
          row({ id: 2, itemId: 'WEB-9' })
        ]
      },
      ['Read handed-over ids: WEB-9', 'Handover of WEB-2123 from stage 1 expired after 7 days']
    ],
    [
      'an expired handover from a sender that is no stage any more',
      { trigger: null, handedOver: [row({ state: 'expired', verdict: null })] },
      ['Handover of WEB-2123 from dev-e2e-fix expired after 7 days']
    ],
    ['a tick that read none', { trigger: null, handedOver: [] }, []],
    ['a tick from before handovers existed', {}, []]
  ])('%s', (_name, tick, lines) => {
    expect(handoverActivityLines(tick)).toEqual(lines)
  })
})

describe('handoverPreviewLines: what a dry run (or a tick) says it reads and hands on', () => {
  const name = (id: string) => (id === 'dev-e2e-fix-start' ? 'stage 2' : id)
  const feed = { to: 'dev-e2e-fix-start', output: 'ticket', run: 'now', when: 'success' } as const
  it.each([
    [
      'a sender whose dry run would start one run',
      { read: [], feeds: [{ ...feed, starts: 1 }] },
      true,
      ['1 run would hand stage 2 its ticket output if it succeeds; stage 2 then ticks at once']
    ],
    [
      'a sender whose tick started two, handing over on its schedule, always',
      { read: [], feeds: [{ ...feed, run: 'next_schedule', when: 'always', starts: 2 }] },
      false,
      ['2 runs hand stage 2 their ticket output however they end; stage 2 reads it on its schedule']
    ],
    [
      'a sender that starts nothing',
      { read: [], feeds: [{ ...feed, starts: 0 }] },
      true,
      ['No run would start, so nothing would be handed to stage 2']
    ],
    [
      'a run: now feed that passes nothing',
      { read: [], feeds: [{ ...feed, output: null, starts: 1 }] },
      true,
      ['1 run would tick stage 2 at once if it succeeds']
    ],
    [
      'a receiver with pending ids',
      { read: ['WEB-1', 'WEB-2'], feeds: [] },
      true,
      ['Reads 2 handed-over ids: WEB-1, WEB-2']
    ],
    ['a receiver with none pending', { read: [], feeds: [] }, true, ['Reads no handed-over ids']]
  ] as [string, TickHandover, boolean, string[]][])('%s', (_name, handover, dry, lines) => {
    expect(handoverPreviewLines(handover, dry, name)).toEqual(lines)
  })
})

describe('lastHandoverText: the job page arrow’s most recent handover and how it went', () => {
  const NOW = 2_000 + 5 * 60_000
  it.each([
    ['none yet', [], null],
    ['one id its tick started', [row({})], 'Last: WEB-2123 started · 5 min ago'],
    [
      'one waiting and one the source did not return',
      [
        row({
          state: 'pending',
          verdict: null,
          consumedAt: null,
          tickId: null,
          createdAt: NOW - 60_000
        }),
        row({ id: 2, itemId: 'WEB-9', verdict: null, createdAt: NOW - 60_000 })
      ],
      'Last: WEB-2123 waiting, WEB-9 not read · 1 min ago'
    ],
    ['one skipped', [row({ verdict: 'skipped' })], 'Last: WEB-2123 skipped · 5 min ago'],
    [
      'one expired',
      [row({ state: 'expired', verdict: null })],
      'Last: WEB-2123 expired · 5 min ago'
    ]
  ])('%s', (_name, rows, text) => {
    expect(lastHandoverText(rows, NOW)).toBe(text)
  })
})
