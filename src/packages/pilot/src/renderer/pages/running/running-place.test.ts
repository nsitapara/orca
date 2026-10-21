import { describe, expect, it } from 'vitest'
import type { RunHome, RunPlace } from '../../../shared/api-types-capacity'
import { finishedHomeText, placeBadgeText, placeReasonText } from './running-place'

const throwaway: RunPlace = { mode: 'throwaway', reason: 'uncommitted changes', stack: false }
const inPlace: RunPlace = { mode: 'in_place', reason: 'nothing in flight', stack: false }

describe('placeBadgeText and placeReasonText', () => {
  it.each<[string, RunPlace, string, string | null]>([
    ['your worktree, with no why', inPlace, 'In your worktree', null],
    ['a throwaway and why', throwaway, 'In a throwaway', 'Why a throwaway: uncommitted changes'],
    [
      'a throwaway with its own stack',
      { mode: 'throwaway', reason: 'needs its own stack', stack: true },
      'In a throwaway · own stack',
      'Why a throwaway: needs its own stack'
    ],
    ['a kept worktree', { mode: 'kept', reason: null, stack: false }, 'In a kept worktree', null]
  ])('%s', (_name, place, badge, reason) => {
    expect([placeBadgeText(place), placeReasonText(place)]).toEqual([badge, reason])
  })
})

describe('finishedHomeText', () => {
  it.each<[string, { place?: RunPlace; home?: RunHome }, string | null]>([
    [
      'a throwaway pushed and merged back',
      {
        place: throwaway,
        home: { pushed: { ok: true, reason: null }, mergedBack: { ok: true, reason: null } }
      },
      'Worked in a throwaway. Pushed. Merged back into your worktree.'
    ],
    [
      'a skipped merge back whose commits were kept',
      {
        place: throwaway,
        home: {
          pushed: { ok: false, reason: 'the branch is not on origin' },
          mergedBack: { ok: false, reason: 'uncommitted changes' },
          kept: 'pilot/review-1'
        }
      },
      'Worked in a throwaway. Not pushed: the branch is not on origin. Merge back skipped: uncommitted changes. Kept on pilot/review-1 for job 15 to merge back.'
    ],
    [
      'your worktree, pushed',
      { place: inPlace, home: { pushed: { ok: true, reason: null } } },
      'Worked in your worktree. Pushed.'
    ],
    ['a refusal with no reason', { home: { pushed: { ok: false, reason: null } } }, 'Not pushed.'],
    ['a run with neither, from an older Pilot', {}, null]
  ])('%s', (_name, run, text) => {
    expect(finishedHomeText(run)).toBe(text)
  })

  it('says where the kept branch stands now, when the host says', () => {
    const run = { place: throwaway, home: { kept: 'pilot/review-1' } }
    expect(finishedHomeText(run, 'Merged pilot/review-1 into your worktree')).toBe(
      'Worked in a throwaway. Merged pilot/review-1 into your worktree.'
    )
  })
})
