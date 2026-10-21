import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import { chainOf } from '../../src/shared/run-views/chain'
import { loadPortedAutomation } from './ported'

const { definition } = loadPortedAutomation('merge-back')

// 15 · Merge back kept fixes: one run per kept pilot/<run> branch, queued while the merge can't land, an agent only for a
// conflict, retried until the branch is home, and the branch gone once it is (sources/kept-branches.ts).
describe('15 · Merge back kept fixes: the definition', () => {
  it('takes kept branches, waits in line until the merge can land, and works where env create says', () => {
    expect(definition.items).toMatchObject({ kind: 'kept_branch' })
    expect(definition.checks).toEqual([{ kind: 'kept_ready' }])
    expect(definition.oncePer).toBe('{kept.branch}@{kept.head}')
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

  it('merges, resolves and lands only on a conflict, then forgets the branch', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.when])).toEqual([
      ['merge', 'shell', null],
      ['resolve', 'claude', '{steps.merge.conflict} == true'],
      ['land', 'shell', '{steps.merge.conflict} == true'],
      ['forget', 'shell', null]
    ])
    const [merge, resolve, land] = definition.steps
    expect(merge.run).toContain('merge-back/scripts/merge.sh')
    expect(resolve).toMatchObject({ skill: 'merge-back', mode: 'resolve' })
    expect(land.run).toContain('--merge true --keep-local true')
    const merged = [{ name: 'merge', status: 'done' as const, always: false, error: null }]
    for (const [conflict, runs] of [
      [true, true],
      [false, false]
    ] as const) {
      expect(decideStep(resolve, merged, { 'steps.merge.conflict': conflict })).toMatchObject({
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
