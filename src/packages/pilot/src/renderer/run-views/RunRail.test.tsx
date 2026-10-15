// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { stepAt, testCard, testRun, testStepRow } from '../../shared/run-views/__fixtures__/runs'
import { chainOf } from '../../shared/run-views/chain'
import { paintRun } from '../../shared/run-views/paint'

vi.mock('../api', () => ({ pilotRpc: vi.fn().mockResolvedValue(null) }))

import { RunRail } from './RunRail'

const def = testDefinition({
  id: 'fix-ci',
  items: {
    kind: 'merge_request',
    where: {},
    match: [],
    customFields: [{ name: 'head8', script: 'f.py', cache: 'per_tick', timeoutMs: 1 }]
  },
  steps: [
    testStep({ name: 'context', agent: 'shell', run: 'ctx.py', prompt: null }),
    testStep({ name: 'fix', skill: 'fix-gitlab-ci', when: 'x == 1' }),
    testStep({ name: 'cleanup', agent: 'shell', run: 'clean.sh', prompt: null, always: true })
  ]
})
const chain = chainOf(def, [def])

describe('RunRail', () => {
  afterEach(cleanup)

  it('shows the bare chain in groups, with who runs each part, what it runs and its conditions', () => {
    render(<RunRail parts={chain} run={null} />)
    expect(
      within(screen.getByRole('region', { name: 'Before any step' })).getByText('f.py')
    ).toBeTruthy()
    const steps = screen.getByRole('region', { name: 'Steps' })
    expect(
      within(steps)
        .getAllByText(/^(Script|Agent)$/)
        .map((e) => e.textContent)
    ).toEqual(['Script', 'Agent', 'Script'])
    expect(screen.getByText('when x == 1')).toBeTruthy()
    expect(screen.getByText('always')).toBeTruthy()
  })

  it("expands a step row to what the step stored, and an agent step's Resume", () => {
    const run = testRun({
      automationId: 'fix-ci',
      steps: [
        testStepRow({
          idx: 0,
          name: 'context',
          agent: 'shell',
          kind: 'shell',
          sessionId: null,
          result: { command: 'mr context', outcome: 'ok', reason: 'read' }
        }),
        testStepRow({ idx: 1, name: 'fix', status: 'running' })
      ]
    })
    render(<RunRail parts={paintRun(chain, { run }).parts} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'context' }))
    expect(screen.getByText('pilotcli mr context · ok: read')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'fix' }))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('marks the row a link names, and offers the card a step waits on', () => {
    const onOpenCard = vi.fn()
    const run = testRun({
      automationId: 'fix-ci',
      status: 'needs_you',
      steps: [stepAt(0, 'context', 'done'), stepAt(1, 'fix', 'done')],
      inbox: [testCard({ id: 'c1', stepIdx: 1 })]
    })
    const { container } = render(
      <RunRail
        parts={paintRun(chain, { run }).parts}
        run={run}
        highlight="step:1"
        onOpenCard={onOpenCard}
      />
    )
    const row = container.querySelector('[data-part="step:1"]')
    expect(row?.getAttribute('data-state')).toBe('asking')
    expect(row?.getAttribute('data-highlighted')).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Open card' }))
    expect(onOpenCard).toHaveBeenCalledWith('c1')
  })

  it('says the YAML changed since a run whose steps no longer match it', () => {
    const run = testRun({
      automationId: 'fix-ci',
      status: 'done',
      steps: [stepAt(0, 'old', 'done')]
    })
    const painted = paintRun(chain, { run })
    render(<RunRail parts={painted.parts} run={run} drifted={painted.drifted} />)
    expect(screen.getByText('The YAML has changed since this run')).toBeTruthy()
  })
})
