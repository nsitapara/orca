// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summary } from '../pages/fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { resetAutomationsFeed, useAutomationsFeed } from './automations-feed'

function Names(): React.JSX.Element {
  const { list, byId } = useAutomationsFeed()
  return (
    <p>{list.length ? `${list.map((a) => a.id).join(',')}:${byId.get('fix-ci')?.name}` : 'none'}</p>
  )
}

describe('useAutomationsFeed', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    pilotRpc.mockReset()
  })

  it('loads the list once for every reader on screen', async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    render(
      <>
        <Names />
        <Names />
      </>
    )
    expect(await screen.findAllByText('fix-ci:Fix failed CI')).toHaveLength(2)
    expect(pilotRpc).toHaveBeenCalledTimes(1)
  })
})
