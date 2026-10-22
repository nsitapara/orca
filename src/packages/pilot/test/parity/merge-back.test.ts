import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import { chainOf } from '../../src/shared/run-views/chain'
import { loadPortedAutomation } from './ported'

const { definition } = loadPortedAutomation('merge-back')

// 15 · Merge back kept fixes: one run per kept pilot/<run> branch, queued while the merge can't land, Claude for every
// merge but a plain fast-forward, retried until the branch is home, and the branch gone once it is
// (sources/kept-branches.ts).
describe('15 · Merge back kept fixes: the definition', () => {
  it('takes kept branches, waits in line until the merge can land, and works where env create says', () => {
    expect(definition.items).toMatchObject({ kind: 'kept_branch' })
    expect(definition.checks).toEqual([{ kind: 'kept_ready' }])
    expect(definition.oncePer).toBe('{kept.branch}@{kept.head}:{kept.tries}')
    expect(definition.workspace).toMatchObject({ kind: 'env', writes: true, stack: 'never' })
  })

  it('never asks and never gives up: a failed merge is tried again until the branch is home', () => {
    expect(definition.giveUp).toBe('never')
    expect(definition.steps.find((s) => s.name === 'forget')?.exitCodes).toEqual({
      ok: [0],
      skip: [],
      stop: []
    })
  })

  it('fast-forwards only a branch on my HEAD; Claude merges and lands every other, forgets the branch, and aborts a merge left unfinished', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.when])).toEqual([
      ['fast_forward', 'shell', null],
      ['merge', 'claude', '{steps.fast_forward.merged} == false'],
      ['land', 'shell', '{steps.fast_forward.merged} == false'],
      ['forget', 'shell', null],
      ['abort_unfinished', 'shell', null]
    ])
    const [fastForward, merge, land, , abort] = definition.steps
    expect(fastForward.run).toContain('merge-back/scripts/fast-forward.sh')
    // A merge step that times out, crashes or is stopped never leaves its folder mid-merge.
    expect(abort).toMatchObject({ always: true })
    expect(abort.run).toContain('merge --abort')
    expect(merge).toMatchObject({ skill: 'merge-back', mode: 'merge' })
    expect(land.run).toContain('--merge true --keep-local true')
    const tried = [{ name: 'fast_forward', status: 'done' as const, always: false, error: null }]
    for (const [merged, runs] of [
      [false, true],
      [true, false]
    ] as const) {
      expect(decideStep(merge, tried, { 'steps.fast_forward.merged': merged })).toMatchObject({
        run: runs
      })
    }
  })

  it('has no Merge back step of its own; the jobs that use throwaways name it in theirs', () => {
    const review = loadPortedAutomation('review-branch-code').definition
    expect(chainOf(definition, [definition]).some((p) => p.kind === 'merge_back')).toBe(false)
    expect(
      chainOf(review, [review, definition]).find((p) => p.kind === 'merge_back')?.runs
    ).toContain('15 · Merge back kept fixes merges it into your worktree')
  })
})
