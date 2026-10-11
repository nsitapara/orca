import { describe, expect, it } from 'vitest'
import {
  addQuotaFields,
  cachedQuota,
  cachedQuotas,
  quotaFields,
  readQuotas,
  toQuotaReading
} from './quota'

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

describe('addQuotaFields', () => {
  it('adds the same reading to every item', () => {
    const out = addQuotaFields([{ key: '!1', label: '!1', fields: {} }], {
      weekly: 61,
      session: 38
    })
    expect(out[0].fields).toEqual({ 'quota.claude.weekly_pct': 61, 'quota.claude.session_pct': 38 })
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
