// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getInboxViewPrefs,
  INBOX_VIEW_PREFS_KEY,
  resetInboxViewPrefs,
  setInboxViewPrefs
} from './inbox-view-prefs'

const DEFAULTS = { group: 'worktree', sort: 'kind', view: 'cards' }

beforeEach(() => {
  window.localStorage.clear()
  resetInboxViewPrefs()
})
afterEach(() => vi.restoreAllMocks())

describe('inbox view prefs', () => {
  it('defaults when storage is empty', () => {
    expect(getInboxViewPrefs()).toEqual(DEFAULTS)
  })

  it('reads a saved partial value back with the other defaults, dropping the old status tab', () => {
    window.localStorage.setItem(
      INBOX_VIEW_PREFS_KEY,
      JSON.stringify({ tab: 'preparing', view: 'rows' })
    )
    expect(getInboxViewPrefs()).toEqual({ ...DEFAULTS, view: 'rows' })
  })

  it('falls back field by field on invalid values', () => {
    window.localStorage.setItem(
      INBOX_VIEW_PREFS_KEY,
      JSON.stringify({ group: 'branch', sort: 'oldest' })
    )
    expect(getInboxViewPrefs()).toEqual({ ...DEFAULTS, sort: 'oldest' })
  })

  it('persists a patch', () => {
    setInboxViewPrefs({ group: 'job' })
    resetInboxViewPrefs()
    expect(getInboxViewPrefs().group).toBe('job')
  })

  it('uses defaults and still sets in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getInboxViewPrefs()).toEqual(DEFAULTS)
    setInboxViewPrefs({ view: 'focus' })
    expect(getInboxViewPrefs()).toEqual({ ...DEFAULTS, view: 'focus' })
  })
})
