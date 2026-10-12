import { describe, expect, it } from 'vitest'
import {
  codexQuotaReading,
  rateLimitsResultTap,
  type CodexRateLimitsResult
} from './codex-quota-reading'

const RESET = 1792010879 // Unix seconds, after NOW
const NOW = 1_760_000_000_000
const PAST = 1_700_000_000
function codex(used: number, allowed = true, reached: string | null = null): CodexRateLimitsResult {
  return {
    ordinaryUsageAllowed: allowed,
    rateLimits: {
      primary: { usedPercent: used, windowDurationMins: 10080, resetsAt: RESET },
      secondary: null,
      rateLimitReachedType: reached
    }
  }
}
const window = (
  usedPercent: number,
  windowDurationMins: number,
  resetsAt: number | null = RESET
) => ({
  usedPercent,
  windowDurationMins,
  resetsAt
})

describe('codexQuotaReading (quota.py codex_limits + out_reason)', () => {
  it.each([
    ['codex under its ceiling', codex(29), { weekly: 29, session: null }],
    ['codex weekly at its ceiling', codex(91), { weekly: 91, session: null }],
    [
      'codex says usage is not allowed',
      codex(40, false, 'primary'),
      { weekly: 100, session: null }
    ],
    [
      'a limit reached while the window reads low',
      codex(40, true, 'secondary'),
      { weekly: 100, session: null }
    ],
    [
      'a window under a day is the session',
      { rateLimits: { primary: window(60, 300) } },
      { weekly: null, session: 60 }
    ],
    [
      'both windows',
      { rateLimits: { primary: window(60, 300), secondary: window(30, 10080) } },
      { weekly: 30, session: 60 }
    ],
    [
      'a day-long window counts as weekly',
      { rateLimits: { primary: window(70, 1440) } },
      { weekly: 70, session: null }
    ],
    [
      'a window past its reset no longer counts',
      { rateLimits: { primary: window(99, 10080, PAST) } },
      { weekly: null, session: null }
    ],
    [
      'out, but every known reset has passed',
      { ordinaryUsageAllowed: false, rateLimits: { primary: window(40, 10080, PAST) } },
      { weekly: null, session: null }
    ],
    [
      'out with no reset known still stops',
      { ordinaryUsageAllowed: false, rateLimits: {} },
      { weekly: 100, session: null }
    ],
    [
      'a window without its duration makes the reading unknown',
      {
        rateLimits: { primary: { usedPercent: 60, resetsAt: RESET }, secondary: window(30, 10080) }
      },
      { weekly: null, session: null }
    ],
    [
      'a window without its usedPercent makes the reading unknown',
      { rateLimits: { primary: { windowDurationMins: 300 }, secondary: window(30, 10080) } },
      { weekly: null, session: null }
    ],
    ['no answer', {}, { weekly: null, session: null }]
  ] as [string, CodexRateLimitsResult, { weekly: number | null; session: number | null }][])(
    '%s',
    (_name, result, want) => {
      expect(codexQuotaReading(result, NOW)).toEqual(want)
    }
  )
})

describe('rateLimitsResultTap', () => {
  it('keeps the account/rateLimits/read answer across chunks and skips other lines', () => {
    const listeners: ((chunk: Buffer) => void)[] = []
    const read = rateLimitsResultTap({ on: (_event, listener) => listeners.push(listener) })
    const send = (text: string) => {
      for (const listener of listeners) {
        listener(Buffer.from(text))
      }
    }
    send('{"id":1,"result":{"userAgent":"codex"}}\nnot json\n{"id":2,"res')
    expect(read()).toBeNull()
    send('ult":{"rateLimits":{"primary":{"usedPercent":12,"windowDurationMins":10080}}}}\n')
    expect(read()).toEqual({
      rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080 } }
    })
  })
})
