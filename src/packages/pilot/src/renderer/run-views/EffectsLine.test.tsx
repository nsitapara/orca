// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Effect } from '../../shared/visibility-types'
import { EffectsLine, WhatItChanged } from './EffectsLine'

const effect = (over: Partial<Effect>): Effect => ({
  kind: 'pushed',
  target: 'web-1',
  url: null,
  count: 1,
  stepIdx: 1,
  at: 1,
  ...over
})

describe('EffectsLine and WhatItChanged', () => {
  afterEach(cleanup)

  it('shows the first four effects in a line, linked where they have a link, then +N', () => {
    render(
      <EffectsLine
        effects={[
          effect({
            kind: 'mr_opened',
            target: '!9',
            url: 'https://gitlab.com/g/p/-/merge_requests/9'
          }),
          effect({}),
          effect({ kind: 'ticket_commented', target: 'WEB-1' }),
          effect({ kind: 'ticket_created', target: 'WEB-2' }),
          effect({ kind: 'mr_ready', target: '!9' })
        ]}
      />
    )
    expect(screen.getByRole('link', { name: 'opened !9 ↗' }).getAttribute('href')).toBe(
      'https://gitlab.com/g/p/-/merge_requests/9'
    )
    expect(screen.getByText('pushed web-1')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.queryByText('marked !9 ready')).toBeNull()
  })

  it("lists every effect with the step it came from in the run panel, and shows nothing when there's none", () => {
    const { container } = render(
      <WhatItChanged
        effects={[
          effect({ stepIdx: 1 }),
          effect({ kind: 'action', target: 'created WEB-5', stepIdx: null })
        ]}
      />
    )
    expect(screen.getByRole('heading', { name: 'What it changed' })).toBeTruthy()
    expect(screen.getByText('· step 2')).toBeTruthy()
    expect(screen.getByText('created WEB-5')).toBeTruthy()
    cleanup()
    const empty = render(<WhatItChanged effects={[]} />)
    expect(empty.container.textContent).toBe('')
    expect(container).toBeTruthy()
  })
})
