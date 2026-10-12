import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedQuota, cachedQuotas, quotaFields, readQuotas, toQuotaReading } from './quota'

describe('cachedQuota', () => {
  it('reads once per ttl and falls back to the last good reading on error', async () => {
    let calls = 0
    let fail = false
    let t = 0
    const read = cachedQuota(
      async () => {
        calls++
        if (fail) {
          throw new Error('offline')
        }
        return { weekly: 61, session: 38 }
      },
      1000,
      () => t
    )
    expect(await read()).toEqual({ weekly: 61, session: 38 })
    t = 500
    await read()
    expect(calls).toBe(1)
    t = 2000
    fail = true
    expect(await read()).toEqual({ weekly: 61, session: 38 })
  })

  it('returns nulls when nothing was ever read', async () => {
    const read = cachedQuota(async () => {
      throw new Error('offline')
    })
    expect(await read()).toEqual({ weekly: null, session: null })
  })
})

describe('cachedQuota failures and sharing', () => {
  const GOOD = { weekly: 61, session: 38 }
  const NONE = { weekly: null, session: null }

  it('does not retry a failed read within the ttl, and keeps the last good reading under an hour', async () => {
    let calls = 0
    let t = 0
    let fail = false
    const read = cachedQuota(
      async () => {
        calls++
        if (fail) {
          throw new Error('offline')
        }
        return GOOD
      },
      300_000,
      () => t
    )
    await read()
    t = 400_000
    fail = true
    expect(await read()).toEqual(GOOD)
    t = 600_000
    expect(await read()).toEqual(GOOD)
    expect(calls).toBe(2)
    t = 800_000
    await read()
    expect(calls).toBe(3)
  })

  it('reads null once the last good reading is an hour old, and still waits the ttl between failures', async () => {
    let calls = 0
    let t = 0
    let fail = false
    const read = cachedQuota(
      async () => {
        calls++
        if (fail) {
          throw new Error('offline')
        }
        return GOOD
      },
      300_000,
      () => t
    )
    await read()
    fail = true
    t = 3_700_000
    expect(await read()).toEqual(NONE)
    t = 3_800_000
    expect(await read()).toEqual(NONE)
    expect(calls).toBe(2)
  })

  it('shares one in-flight read between concurrent callers', async () => {
    let calls = 0
    let release: (v: typeof GOOD) => void = () => {}
    const read = cachedQuota(() => {
      calls++
      return new Promise<typeof GOOD>((resolve) => {
        release = resolve
      })
    })
    const both = Promise.all([read(), read()])
    release(GOOD)
    expect(await both).toEqual([GOOD, GOOD])
    expect(calls).toBe(1)
  })
})

describe('toQuotaReading', () => {
  const window = (usedPercent: number) => ({ usedPercent }) as never

  it('reads the used percentages from an ok result', () => {
    const limits = { status: 'ok' as const, weekly: window(61), session: window(38) }
    expect(toQuotaReading(limits)).toEqual({ weekly: 61, session: 38 })
  })

  it('throws on an error result, which Orca returns instead of throwing', () => {
    expect(() => toQuotaReading({ status: 'error', weekly: null, session: null })).toThrow('error')
  })

  it('lets cachedQuota keep the last good reading across an error result', async () => {
    let t = 0
    let ok = true
    const read = cachedQuota(
      async () =>
        toQuotaReading({
          status: ok ? 'ok' : 'error',
          weekly: ok ? window(61) : null,
          session: ok ? window(38) : null
        }),
      1000,
      () => t
    )
    await read()
    ok = false
    t = 2000
    expect(await read()).toEqual({ weekly: 61, session: 38 })
  })
})

describe('per-agent quota', () => {
  it('reads both agents and leaves an unreadable one null (fail-open)', async () => {
    const readings = await readQuotas({
      claude: async () => ({ weekly: 61, session: 38 }),
      codex: async () => {
        throw new Error('codex app-server down')
      }
    })
    expect(quotaFields(readings)).toEqual({
      'quota.claude.weekly_pct': 61,
      'quota.claude.session_pct': 38,
      'quota.codex.weekly_pct': null,
      'quota.codex.session_pct': null
    })
  })

  it('caches each agent on its own, and an agent without a reader reads null', async () => {
    let calls = 0
    const quotas = cachedQuotas({
      claude: async () => {
        calls += 1
        return { weekly: 1, session: 2 }
      }
    })
    await quotas.claude()
    await quotas.claude()
    expect(calls).toBe(1)
    expect(await quotas.codex()).toEqual({ weekly: null, session: null })
  })
})

describe('cachedQuota timeout', () => {
  afterEach(() => vi.useRealTimers())

  it('treats a read that never settles as a failed read, for every caller sharing it', async () => {
    vi.useFakeTimers()
    let calls = 0
    const read = cachedQuota(() => {
      calls++
      return new Promise(() => {})
    }, 300_000)
    const first = read()
    const second = read()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await first).toEqual({ weekly: null, session: null })
    expect(await second).toEqual({ weekly: null, session: null })
    expect(await read()).toEqual({ weekly: null, session: null })
    expect(calls).toBe(1)
  })
})
