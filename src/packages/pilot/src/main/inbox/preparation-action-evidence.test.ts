import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot, DiffBlock } from '../../shared/details'
import { validatePreparationAction } from './preparation-action-evidence'

// The catalog's push: { "argv": [<worktree path>, <branch>, <commit>, <origin commit>] } (act.py push: the head it
// pushes, and the origin commit it must fast-forward). Its evidence is that exact committed range.
const HEAD = 'a'.repeat(40)
const ORIGIN = 'b'.repeat(40)
const push = (argv: unknown) =>
  ({ action: 'push', actionArgs: { argv }, parts: {} }) as unknown as InboxItemRow
const diff = (over: Partial<DiffBlock>): DiffBlock => ({
  type: 'diff',
  files: [],
  patch_kind: 'committed',
  base: ORIGIN,
  head: HEAD,
  ...over
})
const snapshot = (...blocks: DiffBlock[]) =>
  ({ ref: {}, bundle: { version: 1, blocks }, texts: {} }) as unknown as DetailsSnapshot

describe('a prepared push binds its evidence to the pinned range', () => {
  const ARGV = ['/wt', 'web-1', HEAD, ORIGIN]

  it('takes a committed diff from the pinned origin commit to the pinned head', () => {
    expect(validatePreparationAction(push(ARGV), snapshot(diff({})))).toEqual([])
  })

  it.each<[string, unknown, DiffBlock[]]>([
    ['a different head', ARGV, [diff({ head: 'c'.repeat(40) })]],
    ['a different base', ARGV, [diff({ base: 'c'.repeat(40) })]],
    ['a drafted (not committed) diff', ARGV, [diff({ patch_kind: 'draft' })]],
    ['a second diff of another range', ARGV, [diff({}), diff({ head: 'c'.repeat(40) })]],
    ['no diff at all', ARGV, []],
    ['argv that is not the catalog push', ['/wt', 'web-1', HEAD], [diff({})]]
  ])('refuses %s', (_name, argv, blocks) => {
    expect(validatePreparationAction(push(argv), snapshot(...blocks))).not.toEqual([])
  })
})
