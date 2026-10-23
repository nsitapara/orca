import { describe, expect, it } from 'vitest'
import { porcelainUpstreamStatus } from './porcelain-upstream-status'

describe('porcelainUpstreamStatus', () => {
  it.each([
    {
      name: 'an upstream with counts',
      upstreamName: 'origin/feat',
      counts: { ahead: 2, behind: 3 },
      status: { hasUpstream: true, upstreamName: 'origin/feat', ahead: 2, behind: 3 }
    },
    {
      name: 'an upstream whose ref is gone',
      upstreamName: 'origin/feat',
      counts: undefined,
      status: { hasUpstream: false, ahead: 0, behind: 0 }
    },
    {
      name: 'no upstream',
      upstreamName: undefined,
      counts: undefined,
      status: { hasUpstream: false, ahead: 0, behind: 0 }
    }
  ])('$name', ({ upstreamName, counts, status }) => {
    expect(porcelainUpstreamStatus(upstreamName, counts)).toEqual(status)
  })
})
