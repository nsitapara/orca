import { describe, expect, it } from 'vitest'
import { WHERE_SCHEMAS } from '../../shared/definition/where'
import { mergeRequestSource } from './merge-requests'
import { itemSource } from './registry'

describe('itemSource', () => {
  it('gives the merge request source, which reads the same where schema parsing checks', () => {
    expect(itemSource('merge_request')).toBe(mergeRequestSource)
    expect(mergeRequestSource.whereSchema).toBe(WHERE_SCHEMAS.merge_request)
  })

  it.each([
    ['worktree', "Pilot can't list worktree items yet"],
    ['pipeline', "Pilot can't list pipelines yet"],
    ['linear_ticket', "Pilot can't list Linear tickets yet"]
  ] as const)('refuses %s until its source lands', (kind, message) => {
    expect(() => itemSource(kind)).toThrow(message)
  })
})
