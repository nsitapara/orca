import { describe, expect, it } from 'vitest'
import { inboxItem, timelineRun, worktreeTimeline } from '../timeline/timeline.fixtures'
import { badgeFor } from './badge'

const items = (n: number) => Array.from({ length: n }, (_, i) => inboxItem({ id: `i${i}` }))

describe('badgeFor', () => {
  it.each([
    ['no timeline yet', null, { kind: 'none' }],
    ['nothing here', worktreeTimeline(), { kind: 'none' }],
    [
      'a run going',
      worktreeTimeline({ now: [timelineRun({ status: 'running' })] }),
      { kind: 'dot' }
    ],
    [
      'a run only asking',
      worktreeTimeline({ now: [timelineRun({ status: 'asking' })] }),
      { kind: 'none' }
    ],
    [
      'two waiting, outranking a run',
      worktreeTimeline({ waiting: items(2), now: [timelineRun({ status: 'running' })] }),
      { kind: 'count', count: 2, label: '2' }
    ],
    [
      'more than nine waiting',
      worktreeTimeline({ waiting: items(12) }),
      { kind: 'count', count: 12, label: '9+' }
    ]
  ])('%s', (_name, t, expected) => {
    expect(badgeFor(t)).toEqual(expected)
  })
})
