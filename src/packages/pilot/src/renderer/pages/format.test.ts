import { describe, expect, it } from 'vitest'
import type { ItemDecision, Verdict } from '../../shared/api-types'
import {
  dryRunLine,
  errorText,
  itemUrl,
  outcomeLine,
  relativeTime,
  runStatusLabel,
  spentLabel,
  stepStatusLabel,
  tickLine,
  verdictLabel
} from './format'

const decided = (verdict: Verdict): ItemDecision => ({
  key: 'mr:1',
  label: '!1',
  verdict,
  reason: '',
  checks: [],
  onceKey: '1',
  fields: {}
})

describe('renderer formatting', () => {
  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [-10 * 60_000, 'in 10 min']
  ])('relativeTime(%s)', (delta, s) =>
    expect(relativeTime(1_000_000_000 - delta, 1_000_000_000)).toBe(s)
  )

  it('labels verdicts in plain words', () => {
    expect(
      ['started', 'skipped', 'notdue', 'out_of_scope', 'over_limit', 'baselined'].map((v) =>
        verdictLabel(v as never)
      )
    ).toEqual(['Started', 'Skipped', 'Not due', 'Not in scope', 'Next tick', 'Baselined'])
    // A dry run's verdicts are what a tick would do.
    expect(
      ['started', 'asked', 'baselined', 'skipped'].map((v) => verdictLabel(v as never, true))
    ).toEqual(['Would start', 'Would ask first', 'Would baseline', 'Skipped'])
  })

  it.each([
    [{ 'ticket.url': 'https://linear.app/h/issue/WEB-1' }, 'https://linear.app/h/issue/WEB-1'],
    [
      { 'mr.web_url': 'https://gitlab.com/h/w/-/merge_requests/2' },
      'https://gitlab.com/h/w/-/merge_requests/2'
    ],
    [
      { 'pipeline.web_url': 'https://gitlab.com/h/w/-/pipelines/3' },
      'https://gitlab.com/h/w/-/pipelines/3'
    ],
    [{ 'mr.web_url': null }, null],
    [{ 'ticket.url': 'javascript:alert(1)' }, null],
    [{}, null]
  ])('itemUrl(%j): the page an item is about, web links only', (fields, url) =>
    expect(itemUrl(fields)).toBe(url)
  )

  it('summarizes a tick', () => {
    expect(
      tickLine({
        id: 1,
        automationId: 'a',
        startedAt: 0,
        finishedAt: 1,
        status: 'ok',
        error: null,
        counts: { started: 1, skipped: 3, notdue: 2, out_of_scope: 15 }
      })
    ).toBe('6 checked · 1 started · 3 skipped · 2 not due')
    // Held items are counted: the runner's line has them.
    expect(
      tickLine({
        id: 3,
        automationId: 'a',
        startedAt: 0,
        finishedAt: 1,
        status: 'ok',
        error: null,
        counts: { started: 1, held: 21 }
      })
    ).toBe('22 checked · 1 started · 21 waiting')
    expect(dryRunLine([decided('started'), decided('held'), decided('held')])).toBe(
      '3 checked · 1 would start · 2 would wait'
    )
    expect(
      tickLine({
        id: 2,
        automationId: 'a',
        startedAt: 0,
        finishedAt: 1,
        status: 'failed',
        error: 'glab: 502',
        counts: {}
      })
    ).toBe('Failed: glab: 502')
  })
})

describe('call results and errors', () => {
  const ok = { tickId: 4, status: 'ok' as const, error: null, decisions: [] }
  it.each([
    [{ status: 'busy' as const }, 'Tick already running'],
    [{ status: 'unknown' as const }, 'No automation fix-ci'],
    [ok, 'Tick 4 · ok'],
    [{ ...ok, tickId: null }, 'Dry run · ok'],
    [{ ...ok, status: 'failed' as const, error: 'glab: 502' }, 'Tick 4 · failed: glab: 502']
  ])('outcomeLine(%j)', (outcome, text) => expect(outcomeLine(outcome, 'fix-ci')).toBe(text))

  it('errorText keeps the message without the Error: prefix', () => {
    expect(errorText(new Error("Pilot isn't running: x"))).toBe("Pilot isn't running: x")
    expect(errorText('plain')).toBe('plain')
  })
})

describe('status labels', () => {
  it.each([
    ['asking', 'Asking first'],
    ['running', 'Running'],
    ['needs_you', 'Needs you'],
    ['done', 'Done'],
    ['failed', 'Failed'],
    ['timed_out', 'Timed out'],
    ['cancelled', 'Cancelled']
  ] as const)('run %s → %s', (s, label) => expect(runStatusLabel(s)).toBe(label))

  it.each([
    ['pending', 'Waiting'],
    ['starting', 'Starting'],
    ['skipped', 'Skipped'],
    ['timed_out', 'Timed out']
  ] as const)('step %s → %s', (s, label) => expect(stepStatusLabel(s)).toBe(label))
})

describe('verdictLabel', () => {
  it('words a held item as Waiting', () => expect(verdictLabel('held')).toBe('Waiting'))
})

describe('spentLabel', () => {
  it.each([
    [0.84, 0, '$0.84'],
    [0.84, 2, '$0.84 + unpriced'],
    [0, 1, '$0.00 + unpriced']
  ])('%s with %s unpriced → %s', (usd, unpriced, label) =>
    expect(spentLabel(usd, unpriced)).toBe(label)
  )
})
