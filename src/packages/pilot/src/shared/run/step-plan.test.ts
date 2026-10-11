import { describe, expect, it } from 'vitest'
import type { ItemFields, StepStatus } from '../api-types'
import { formatDuration } from './format-duration'
import { decideStep, runEnd, type EndedStep } from './step-plan'

function ended(
  name: string,
  status: StepStatus,
  opts: { always?: boolean; error?: string } = {}
): EndedStep {
  return { name, status, always: opts.always ?? false, error: opts.error ?? null }
}
function step(opts: { when?: string; always?: boolean } = {}) {
  return { when: opts.when ?? null, always: opts.always ?? false }
}
const CHANGED = '{steps.review.changed} == true'

describe('decideStep', () => {
  it.each([
    [
      'runs when every earlier step succeeded or was skipped',
      step(),
      [ended('a', 'done'), ended('b', 'skipped')],
      {},
      { run: true }
    ],
    [
      'skips after an earlier step failed',
      step(),
      [ended('a', 'failed')],
      {},
      { run: false, reason: 'Step a failed' }
    ],
    [
      'skips after an earlier step timed out',
      step(),
      [ended('a', 'timed_out')],
      {},
      { run: false, reason: 'Step a timed out' }
    ],
    [
      'runs an always step after a failure',
      step({ always: true }),
      [ended('a', 'failed')],
      {},
      { run: true }
    ],
    [
      'is not held back by a failed always step',
      step(),
      [ended('a', 'done'), ended('c', 'failed', { always: true })],
      {},
      { run: true }
    ],
    [
      'runs when its when is true',
      step({ when: CHANGED }),
      [ended('review', 'done')],
      { 'steps.review.changed': true },
      { run: true }
    ],
    [
      'skips when its when is false',
      step({ when: CHANGED }),
      [ended('review', 'done')],
      { 'steps.review.changed': false },
      { run: false, reason: `when: ${CHANGED} is false` }
    ],
    [
      'names the placeholders that had no value',
      step({ when: CHANGED }),
      [ended('review', 'done')],
      {},
      { run: false, reason: `when: ${CHANGED} is false (no value for {steps.review.changed})` }
    ],
    [
      "doesn't let when lift the failure gate",
      step({ when: "{previous.status} == 'failed'" }),
      [ended('a', 'failed')],
      { 'previous.status': 'failed' },
      { run: false, reason: 'Step a failed' }
    ],
    [
      'still honours when on an always step',
      step({ always: true, when: "{steps.a.status} == 'done'" }),
      [ended('a', 'failed')],
      { 'steps.a.status': 'failed' },
      { run: false, reason: "when: {steps.a.status} == 'done' is false" }
    ],
    [
      'runs an always step with when {run.failed} after a failure',
      step({ always: true, when: '{run.failed} == true' }),
      [ended('a', 'failed')],
      { 'run.failed': true },
      { run: true }
    ],
    [
      'skips an always step with when {run.failed} when nothing failed',
      step({ always: true, when: '{run.failed} == true' }),
      [ended('a', 'done')],
      { 'run.failed': false },
      { run: false, reason: 'when: {run.failed} == true is false' }
    ]
  ] as [string, ReturnType<typeof step>, EndedStep[], ItemFields, unknown][])(
    '%s',
    (_name, s, earlier, fields, expected) => {
      expect(decideStep(s, earlier, fields)).toEqual(expected)
    }
  )

  it('skips a step whose when does not parse, with the parse error', () => {
    expect(decideStep(step({ when: '{x} ==' }), [], {})).toEqual({
      run: false,
      reason: expect.stringMatching(/^when: /)
    })
  })
})

describe('runEnd', () => {
  it.each([
    ['done', [ended('a', 'done'), ended('b', 'done')], 0, { status: 'done', outcome: 'Done' }],
    [
      'failed, naming the first failed step, ahead of anything else',
      [ended('a', 'failed', { error: 'boom' }), ended('b', 'timed_out')],
      2,
      { status: 'failed', outcome: 'Step a failed: boom' }
    ],
    [
      'timed_out',
      [ended('a', 'done'), ended('b', 'timed_out')],
      1,
      { status: 'timed_out', outcome: 'Step b timed out' }
    ],
    [
      'needs_you with open items',
      [ended('a', 'done')],
      2,
      { status: 'needs_you', outcome: 'Waiting on you: 2 open items' }
    ],
    [
      'needs_you with one open item',
      [ended('a', 'done')],
      1,
      { status: 'needs_you', outcome: 'Waiting on you: 1 open item' }
    ],
    [
      'done when only a cleanup step failed',
      [ended('a', 'done'), ended('cleanup', 'failed', { always: true })],
      0,
      { status: 'done', outcome: 'Done; cleanup step cleanup failed' }
    ],
    [
      'done when every step was skipped',
      [ended('a', 'skipped'), ended('b', 'skipped')],
      0,
      { status: 'done', outcome: 'Done: every step was skipped' }
    ]
  ] as [string, EndedStep[], number, unknown][])('%s', (_name, steps, open, expected) => {
    expect(runEnd(steps, open)).toEqual(expected)
  })
})

describe('formatDuration', () => {
  it.each([
    [45_000, '45s'],
    [90_000, '90s'],
    [3_600_000, '60m'],
    [7_200_000, '2h'],
    [129_600_000, '36h']
  ])('%i ms → %s', (ms, text) => expect(formatDuration(ms)).toBe(text))
})
