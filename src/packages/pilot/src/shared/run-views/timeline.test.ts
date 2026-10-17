import { describe, expect, it } from 'vitest'
import type { RunStatus, StepRow } from '../api-types'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import { testRun, testStepRow } from './__fixtures__/runs'
import { chainOf } from './chain'
import { paintRun } from './paint'
import { runHeadline, runTimeline } from './timeline'

const shell = (name: string) => testStep({ name, agent: 'shell', run: `${name}.sh`, prompt: null })
const agent = (name: string) => testStep({ name, skill: 'review' })
// Job 03's shape: each round has a Claude-led and a Codex-led step, and one of each pair is skipped by its when.
const def = testDefinition({
  id: 'job',
  steps: [
    shell('begin'),
    agent('r1_claude'),
    agent('r1_codex'),
    agent('r2_codex'),
    agent('r2_claude'),
    shell('complete'),
    shell('publish')
  ]
})
const chain = chainOf(def, [def])
const WHEN = "when: {steps.begin.lead} == 'claude' is false"
const row = (idx: number, name: string, over: Partial<StepRow>) =>
  testStepRow({ idx, name, startedAt: 10 + idx, ...over })
const LABEL: Record<RunStatus, string> = {
  asking: 'Asking first',
  running: 'Running',
  needs_you: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled'
}

function timelineOf(status: RunStatus, steps: StepRow[]) {
  const run = testRun({ status, steps, finishedAt: status === 'running' ? null : 99 })
  const timeline = runTimeline(paintRun(chain, { run }).parts, run)
  return {
    ran: timeline.ran.map((s) => `${s.n} ${s.part.name}`),
    notRun: timeline.notRun.map((g) => `${g.reason}: ${g.parts.map((p) => p.name).join(', ')}`),
    headline: runHeadline(run, timeline, (s) => LABEL[s])
  }
}

// A step found nothing to do (a shell step's stop code, or a card with nothing left to prepare): its own word, whatever
// the steps did.
it('heads a run that had nothing to do with Nothing to do', () => {
  const run = { status: 'done' as const, outcome: 'Nothing to do: the card was already answered' }
  expect(runHeadline(run, { ran: [], notRun: [] }, (s) => LABEL[s])).toBe('Nothing to do')
})

describe('runTimeline', () => {
  it.each([
    [
      'failed in round 2, the Claude-led steps skipped by their when',
      'failed' as const,
      [
        row(0, 'begin', { status: 'done' }),
        row(1, 'r1_claude', { status: 'skipped', error: WHEN }),
        row(2, 'r1_codex', { status: 'done' }),
        row(3, 'r2_codex', { status: 'skipped', error: WHEN }),
        row(4, 'r2_claude', { status: 'failed' }),
        row(5, 'complete', { status: 'skipped', error: 'Step r2_claude failed' }),
        row(6, 'publish', { status: 'skipped', error: 'Step r2_claude failed' })
      ],
      {
        ran: ['1 begin', '2 r1_codex', '3 r2_claude'],
        notRun: [
          "Their condition wasn't met: r1_claude, r2_codex",
          'Step r2_claude failed: complete, publish'
        ],
        headline: 'Failed at step 3'
      }
    ],
    [
      'running its second step, the rest not reached yet',
      'running' as const,
      [row(0, 'begin', { status: 'done' }), row(1, 'r1_claude', { status: 'running' })],
      {
        ran: ['1 begin', '2 r1_claude'],
        notRun: ['Not reached yet: r1_codex, r2_codex, r2_claude, complete, publish'],
        headline: 'Running step 2'
      }
    ],
    [
      'done, with publish skipped by its exit code: it ran',
      'done' as const,
      [
        row(0, 'begin', { status: 'done' }),
        row(1, 'r1_claude', { status: 'done' }),
        row(2, 'r1_codex', { status: 'skipped', error: WHEN }),
        row(3, 'r2_codex', { status: 'done' }),
        row(4, 'r2_claude', { status: 'skipped', error: WHEN }),
        row(5, 'complete', { status: 'done' }),
        row(6, 'publish', { status: 'skipped', exitCode: 3, error: 'Exited 3 (skip)' })
      ],
      {
        ran: ['1 begin', '2 r1_claude', '3 r2_codex', '4 complete', '5 publish'],
        notRun: ["Their condition wasn't met: r1_codex, r2_claude"],
        headline: 'Done'
      }
    ],
    [
      'numbered in the order the steps started, not their place in the YAML',
      'needs_you' as const,
      [
        row(0, 'begin', { status: 'done', startedAt: 10 }),
        row(1, 'r1_claude', { status: 'done', startedAt: 30 }),
        row(2, 'r1_codex', { status: 'done', startedAt: 20 })
      ],
      {
        ran: ['1 begin', '2 r1_codex', '3 r1_claude'],
        notRun: ['Not reached: r2_codex, r2_claude, complete, publish'],
        headline: 'Needs you'
      }
    ]
  ])('%s', (_name, status, steps, expected) => {
    expect(timelineOf(status, steps)).toEqual(expected)
  })
})
