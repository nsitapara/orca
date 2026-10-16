import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAIM_TTL_MS,
  DEAD_GRACE_MS,
  isStartTimeout,
  judgeClaim,
  SessionClaims,
  type ClaimVerdict
} from './session-claims'

function setup(verdict: ClaimVerdict = 'pending') {
  const clock = { t: 1_000 }
  const claims = new SessionClaims(
    () => clock.t,
    async () => verdict
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
    ['landed', null],
    ['dead', null],
    ['pending', { by: 'a', handle: null }]
  ] as const)('expireIfSeen with the start %s', async (verdict, held) => {
    const { claims } = setup(verdict)
    claims.acquire('s1', 'a')
    await claims.expireIfSeen('s1')
    expect(claims.holder('s1')).toEqual(held)
  })

  it('judges the claim it looked at, with when it was taken and the tab it opened', async () => {
    const seen: unknown[] = []
    const claims = new SessionClaims(
      () => 5_000,
      async (id, claim) => (seen.push([id, claim]), 'pending')
    )
    claims.acquire('s1', 'a')
    claims.setHandle('s1', 'a', 'term_9')
    await claims.expireIfSeen('s1')
    expect(seen).toEqual([['s1', { since: 5_000, handle: 'term_9' }]])
  })
})

describe('judgeClaim', () => {
  const SINCE = 10_000
  function deps(
    over: {
      panes?: { handle: string; rowAt: number | null }[]
      state?: Record<string, 'free' | 'busy' | 'gone' | 'other'>
      open?: boolean
    } = {}
  ) {
    return {
      panes: async () => (over.panes ?? []).map((p) => ({ ...p, paneKey: `${p.handle}:leaf` })),
      state: async (t: { handle: string }) => over.state?.[t.handle] ?? 'gone',
      isOpen: async () => over.open ?? true
    }
  }
  const judge = (d: ReturnType<typeof deps>, handle: string | null = null, now = SINCE + 1) =>
    judgeClaim(d, 's1', { since: SINCE, handle }, now)

  it('landed: a tab that is not gone shows a row for the session from after the start began', async () => {
    expect(
      await judge(deps({ panes: [{ handle: 't2', rowAt: SINCE }], state: { t2: 'free' } }))
    ).toBe('landed')
    expect(
      await judge(deps({ panes: [{ handle: 't2', rowAt: SINCE + 5 }], state: { t2: 'busy' } }))
    ).toBe('landed')
  })

  it("pending: a surviving shell's remnant row (no live row), an older row, or a tab that is gone never counts", async () => {
    expect(
      await judge(deps({ panes: [{ handle: 't1', rowAt: null }], state: { t1: 'gone' } }))
    ).toBe('pending')
    expect(
      await judge(deps({ panes: [{ handle: 't1', rowAt: SINCE - 1 }], state: { t1: 'free' } }))
    ).toBe('pending')
    expect(
      await judge(deps({ panes: [{ handle: 't1', rowAt: SINCE + 1 }], state: { t1: 'gone' } }))
    ).toBe('pending')
    expect(
      await judge(deps({ panes: [{ handle: 't1', rowAt: SINCE + 1 }], state: { t1: 'other' } }))
    ).toBe('pending')
  })

  it('dead: the tab the start opened is no longer connected, once the grace has passed', async () => {
    expect(await judge(deps({ open: false }), 'term_9', SINCE + DEAD_GRACE_MS)).toBe('dead')
    expect(await judge(deps({ open: false }), 'term_9', SINCE + DEAD_GRACE_MS - 1)).toBe('pending')
    expect(await judge(deps({ open: true }), 'term_9', SINCE + DEAD_GRACE_MS)).toBe('pending')
    expect(await judge(deps({ open: false }), null, SINCE + DEAD_GRACE_MS)).toBe('pending')
  })
})

describe('isStartTimeout', () => {
  it.each([
    ['createTerminal gave no reply', 'Terminal creation timed out', true],
    ['the handle never appeared', 'Timed out waiting for terminal handle after creation', true],
    ['an SSH connect timed out', 'SSH connect timed out', false],
    ['an unrelated failure', 'spawn failed', false]
  ])('%s', (_name, message, expected) => {
    expect(isStartTimeout(new Error(message))).toBe(expected)
  })

  it('is false for a non-Error', () => {
    expect(isStartTimeout('Terminal creation timed out')).toBe(false)
  })
})

describe('the upstream start-timeout messages', () => {
  it.each([
    ['orca-runtime-create-terminal-desktop.ts', 'Terminal creation timed out'],
    [
      'session-tabs/renderer-session-terminal-rescue.ts',
      'Timed out waiting for terminal handle after creation'
    ]
  ])('%s still says "%s"', (file, message) => {
    const source = readFileSync(join(process.cwd(), 'src/main/runtime', file), 'utf8')
    expect(source).toContain(`new Error('${message}')`)
  })
})
