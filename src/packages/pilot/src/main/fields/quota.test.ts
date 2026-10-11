import { describe, expect, it } from 'vitest'
import { addQuotaFields, cachedQuota } from './quota'

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

describe('addQuotaFields', () => {
  it('adds the same reading to every item', () => {
    const out = addQuotaFields([{ key: '!1', label: '!1', fields: {} }], {
      weekly: 61,
      session: 38
    })
    expect(out[0].fields).toEqual({ 'quota.claude.weekly_pct': 61, 'quota.claude.session_pct': 38 })
  })
})
