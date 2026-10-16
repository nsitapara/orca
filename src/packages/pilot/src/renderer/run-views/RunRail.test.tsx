// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { chainOf } from '../../shared/run-views/chain'

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

  it('shows the plan in groups, the steps numbered, with who runs each part, what it runs and its conditions', () => {
    const { container } = render(<RunRail parts={chain} />)
    expect(
      within(screen.getByRole('region', { name: 'Before any step' })).getByText('f.py')
    ).toBeTruthy()
    const steps = screen.getByRole('region', { name: 'Steps' })
    expect(
      within(steps)
        .getAllByText(/^(Script|Agent)$/)
        .map((e) => e.textContent)
    ).toEqual(['Script', 'Agent', 'Script'])
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-step-n]')].map(
        (e) => `${e.dataset.stepN} ${e.dataset.part}`
      )
    ).toEqual(['1 step:0', '2 step:1', '3 step:2'])
    expect(screen.getByText('x == 1')).toBeTruthy()
    expect(screen.getByText('only if')).toBeTruthy()
    expect(screen.getByText('always')).toBeTruthy()
    expect(container.querySelector('[data-state]')).toBeNull()
  })
})
