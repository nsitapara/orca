import { describe, expect, it, vi } from 'vitest'
import { actionButton } from '../../shared/answer-actions'
import { buildActionCatalog } from './catalog'
import { markReadyEntry } from './mark-ready'
import { postReviewEntry } from './post-review'
import { pushBranchEntry } from './push-branch'

describe('the answer buttons', () => {
  it('has a name for every action the catalog can run (start_run is the ask-first card’s own)', () => {
    const pilotcli = vi.fn()
    const binary = () => null
    const folder = () => null
    const cards = { branchOf: () => null, worktreeOn: () => null, openOn: () => null }
    const names = buildActionCatalog({
      push: pushBranchEntry({ pilotcli, binary }),
      markReady: markReadyEntry({ pilotcli, binary, folder, cards }),
      postReview: postReviewEntry({ pilotcli, binary, reviewsDir: () => '/vault', folder }),
      linear: null
    })
      .entries()
      .map((e) => e.name)
      .filter((n) => n !== 'start_run')
    expect(names.length).toBeGreaterThanOrEqual(7)
    for (const name of names) {
      expect(actionButton(name).label, name).not.toBe('Approve')
    }
  })
})
