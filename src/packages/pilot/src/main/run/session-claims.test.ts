import { describe, expect, it } from 'vitest'
import { CLAIM_TTL_MS, SessionClaims } from './session-claims'

function setup(seen = false) {
  const clock = { t: 1_000 }
  const claims = new SessionClaims(
    () => clock.t,
    async () => seen
  )
  return { clock, claims }
}

describe('SessionClaims', () => {
  it('lets one caller hold a session; a second is told who and which tab', () => {
    const { claims } = setup()
    expect(claims.acquire('s1', 'resume')).toEqual({ ok: true })
    claims.setHandle('s1', 'resume', 'term_9')
    expect(claims.acquire('s1', 'launch:r1:0')).toEqual({
      ok: false,
      by: 'resume',
      handle: 'term_9'
    })
    expect(claims.acquire('s2', 'launch:r1:0')).toEqual({ ok: true })
  })

  it('the holder may take its own claim again; only the holder can release it', () => {
    const { claims } = setup()
    claims.acquire('s1', 'a')
    expect(claims.acquire('s1', 'a')).toEqual({ ok: true })
    claims.release('s1', 'b')
    expect(claims.holder('s1')).toMatchObject({ by: 'a' })
    claims.release('s1', 'a')
    expect(claims.acquire('s1', 'b')).toEqual({ ok: true })
  })

  it('a claim ends at the TTL', () => {
    const { claims, clock } = setup()
    claims.acquire('s1', 'a')
    clock.t += CLAIM_TTL_MS - 1
    expect(claims.acquire('s1', 'b').ok).toBe(false)
    clock.t += 1
    expect(claims.acquire('s1', 'b')).toEqual({ ok: true })
  })

  it.each([
    [true, null],
    [false, { by: 'a', handle: null }]
  ])('expireIfSeen with a tab showing the session: %s', async (seen, held) => {
    const { claims } = setup(seen)
    claims.acquire('s1', 'a')
    await claims.expireIfSeen('s1')
    expect(claims.holder('s1')).toEqual(held)
  })
})
