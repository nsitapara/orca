import { describe, expect, it } from 'vitest'
import { parsePsTable, treeRssBytes, type ProcessRow } from './process-tree-memory'

const KIB = 1024

describe('parsePsTable', () => {
  it('reads pid, ppid and RSS in bytes, skipping lines that are not three numbers', () => {
    expect(parsePsTable('  101     1  2048\n  102   101   512\nbogus line\n')).toEqual([
      { pid: 101, ppid: 1, rssBytes: 2048 * KIB },
      { pid: 102, ppid: 101, rssBytes: 512 * KIB }
    ])
  })
})

describe('treeRssBytes', () => {
  // 10 ─┬─ 11 ── 13
  //     └─ 12
  // 20 ── 21          30 (unrelated)
  const rows: ProcessRow[] = [
    { pid: 10, ppid: 1, rssBytes: 100 },
    { pid: 11, ppid: 10, rssBytes: 10 },
    { pid: 12, ppid: 10, rssBytes: 20 },
    { pid: 13, ppid: 11, rssBytes: 5 },
    { pid: 20, ppid: 1, rssBytes: 200 },
    { pid: 21, ppid: 20, rssBytes: 7 },
    { pid: 30, ppid: 1, rssBytes: 999 }
  ]

  it.each([
    ['a root and every descendant', [10], 135],
    ['several roots', [10, 20], 342],
    ['an overlapping root once', [10, 11], 135],
    ['a subtree on its own', [11], 15],
    ['nothing for a root that has exited', [99], 0],
    ['nothing for no roots', [], 0]
  ])('sums %s', (_name, roots, expected) => {
    expect(treeRssBytes(rows, roots)).toBe(expected)
  })
})
