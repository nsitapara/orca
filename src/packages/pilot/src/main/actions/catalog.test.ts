import { describe, expect, it, vi } from 'vitest'
import { EVIDENCE_ACTIONS } from '../../shared/evidence'
import { buildActionCatalog } from './catalog'
import { markReadyEntry } from './mark-ready'
import { postReviewEntry } from './post-review'
import { pushBranchEntry } from './push-branch'
import type { ActionEntry } from './types'

const pilotcli = vi.fn()
const binary = () => '/bin/pilotcli'
const push = pushBranchEntry({ pilotcli, binary })
const markReady = markReadyEntry({ pilotcli, binary, folder: () => null, openCards: () => null })
const postReview = postReviewEntry({
  pilotcli,
  binary,
  reviewsDir: () => '/vault/09',
  folder: () => null
})
const deps = { push, markReady, postReview, linear: null }

describe('buildActionCatalog', () => {
  it.each([
    ['push', push, 'push'],
    ['mark_ready', markReady, 'mark_ready'],
    ['post_review', postReview, 'post']
  ])("runs %s through pilotcli's own entry, needing %s", (name, entry, power) => {
    const got = buildActionCatalog(deps).get(name)
    expect(got).toBe(entry)
    expect(got?.power).toBe(power)
  })

  // R-P5's evidence-needing actions (shared/evidence.ts) are the catalog's own push and post_review.
  it('names real catalog entries as the evidence-needing actions', () => {
    const catalog = buildActionCatalog(deps)
    expect([...EVIDENCE_ACTIONS].map((name) => catalog.get(name)?.name)).toEqual([
      'push',
      'post_review'
    ])
  })

  it('lets only post_review leave parts out', () => {
    const catalog = buildActionCatalog(deps)
    expect(
      catalog
        .entries()
        .filter((e) => e.exceptArgs)
        .map((e) => e.name)
    ).toEqual(['post_review'])
  })

  it('knows the Linear entries and extra ones, and nothing else', () => {
    const extra: ActionEntry = { ...push, name: 'start_run', power: null }
    const catalog = buildActionCatalog({ ...deps, extra: [extra] })
    expect(catalog.entries().map((e) => e.name)).toEqual([
      'push',
      'mark_ready',
      'post_review',
      'linear_create',
      'linear_comment',
      'linear_set_state',
      'linear_attach',
      'start_run'
    ])
    expect(catalog.get('deploy')).toBeNull()
    expect(catalog.get('constructor')).toBeNull()
  })

  it('refuses two entries with one name', () => {
    expect(() => buildActionCatalog({ ...deps, extra: [{ ...markReady, name: 'push' }] })).toThrow(
      'Two catalog entries are named "push"'
    )
  })
})
