import { describe, expect, it } from 'vitest'
import { worktreePathKey } from './worktree-path-key'

describe('worktreePathKey', () => {
  it.each([
    ['/wt//a/', '/wt/a'],
    ['/wt/x/../a/', '/wt/a'],
    ['/wt/./a', '/wt/a'],
    ['/', '/']
  ])('%s -> %s', (path, want) => {
    expect(worktreePathKey(path)).toBe(want)
  })
})
