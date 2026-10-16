// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { stepAt, testCard, testRun, testStepRow } from '../../shared/run-views/__fixtures__/runs'
import { chainOf } from '../../shared/run-views/chain'
import { paintRun } from '../../shared/run-views/paint'

vi.mock('../api', () => ({ pilotRpc: vi.fn().mockResolvedValue(null) }))

import { RunTimeline } from './RunTimeline'

const shell = (name: string) => testStep({ name, agent: 'shell', run: `${name}.sh`, prompt: null })
const def = testDefinition({
  id: 'review',
  steps: [
    shell('begin'),
    testStep({ name: 'r1_claude', skill: 'review-cycles', when: "lead == 'claude'" }),
    testStep({ name: 'r1_codex', skill: 'review-cycles', when: "lead == 'codex'" }),
    testStep({ name: 'r2_claude', skill: 'review-cycles' }),
    shell('publish')
  ]
})
const chain = chainOf(def, [def])
const WHEN = "when: lead == 'claude' is false"

describe('RunTimeline', () => {
  afterEach(cleanup)

  it('numbers the steps that ran in order, shows the cards each left and how the run ended, then what did not run', () => {
    const onOpenCard = vi.fn()
    const run = testRun({
      automationId: 'review',
      status: 'failed',
      finishedAt: 100,
      outcome: 'Step r2_claude failed: no turn',
      steps: [
        testStepRow({
          idx: 0,
          name: 'begin',
          kind: 'shell',
          agent: 'shell',
          startedAt: 10,
          finishedAt: 11,
          outputs: { lead: 'codex' }
        }),
        testStepRow({ idx: 1, name: 'r1_claude', status: 'skipped', error: WHEN }),
        testStepRow({ idx: 2, name: 'r1_codex', startedAt: 12, finishedAt: 20, costUsd: 7.97 }),
        testStepRow({
          idx: 3,
          name: 'r2_claude',
          status: 'failed',
          startedAt: 21,
          finishedAt: 22,
          error: 'no turn'
        }),
        testStepRow({ idx: 4, name: 'publish', status: 'skipped', error: 'Step r2_claude failed' })
      ],
      inbox: [
        testCard({ id: 'q', stepIdx: 2, title: 'Review the earlier commits?' }),
        testCard({ id: 'd', stepIdx: 2, type: 'default', title: 'Keep the old name? → Yes' })
      ]
    })
    render(
      <RunTimeline parts={paintRun(chain, { run }).parts} run={run} onOpenCard={onOpenCard} />
    )
    const ran = screen.getByRole('list', { name: 'Steps that ran' })
    expect(
      [...ran.querySelectorAll<HTMLElement>('[data-step-n]')].map(
        (e) => `${e.dataset.stepN} ${e.dataset.part} ${e.dataset.state}`
      )
    ).toEqual(['1 step:0 done', '2 step:2 done', '3 step:3 failed'])
    expect(within(ran).getByText('lead = codex')).toBeTruthy()
    expect(within(ran).getByText('$7.97')).toBeTruthy()
    expect(within(ran).getByText('Asked you')).toBeTruthy()
    expect(within(ran).getByText('Took a default')).toBeTruthy()
    expect(within(ran).getByText('no turn')).toBeTruthy()
    expect(within(ran).getByText('Run failed')).toBeTruthy()
    fireEvent.click(within(ran).getAllByRole('button', { name: 'Open card' })[0])
    expect(onOpenCard).toHaveBeenCalledWith('q')
    const notRun = screen.getByRole('region', { name: "Didn't run" })
    expect(within(notRun).getByText("Didn't run · 2")).toBeTruthy()
    expect(within(notRun).getByText("Their condition wasn't met")).toBeTruthy()
    expect(within(notRun).getByText('r1_claude').getAttribute('title')).toBe(
      "only if lead == 'claude'"
    )
    expect(within(notRun).getByText('Step r2_claude failed')).toBeTruthy()
    expect(screen.queryByText('?')).toBeNull()
  })

  it("expands a step to what it stored, and an agent step's Resume", () => {
    const run = testRun({
      automationId: 'review',
      steps: [
        testStepRow({
          idx: 0,
          name: 'begin',
          agent: 'shell',
          kind: 'shell',
          sessionId: null,
          result: { command: 'mr context', outcome: 'ok', reason: 'read' }
        }),
        testStepRow({ idx: 1, name: 'r1_claude', status: 'running', startedAt: 5 })
      ]
    })
    render(<RunTimeline parts={paintRun(chain, { run }).parts} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'begin' }))
    expect(screen.getByText('pilotcli mr context · ok: read')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'r1_claude' }))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    expect(screen.getByText('Not reached yet')).toBeTruthy()
  })

  it('marks the step a link names', () => {
    const run = testRun({
      automationId: 'review',
      status: 'needs_you',
      finishedAt: 9,
      steps: [stepAt(0, 'begin', 'done'), stepAt(1, 'r1_claude', 'done')],
      inbox: [testCard({ id: 'c1', stepIdx: 1 })]
    })
    const { container } = render(
      <RunTimeline parts={paintRun(chain, { run }).parts} run={run} highlight="step:1" />
    )
    const row = container.querySelector('[data-part="step:1"]')
    expect(row?.getAttribute('data-state')).toBe('done')
    expect(row?.getAttribute('data-highlighted')).toBe('')
  })

  it('says the YAML changed since a run whose steps no longer match it', () => {
    const run = testRun({
      automationId: 'review',
      status: 'done',
      steps: [stepAt(0, 'old', 'done')]
    })
    const painted = paintRun(chain, { run })
    render(<RunTimeline parts={painted.parts} run={run} drifted={painted.drifted} />)
    expect(screen.getByText('The YAML has changed since this run')).toBeTruthy()
  })
})
