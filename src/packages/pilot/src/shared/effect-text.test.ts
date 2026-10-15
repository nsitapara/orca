import { describe, expect, it } from 'vitest'
import type { Effect } from './visibility-types'
import { effectText } from './effect-text'

const effect = (kind: Effect['kind'], target: string | null, count = 1): Effect => ({
  kind,
  target,
  url: null,
  count,
  stepIdx: 0,
  at: 1
})

describe('effectText', () => {
  it.each([
    [effect('pushed', 'web-1', 2), 'pushed web-1 ×2'],
    [effect('pushed', null), 'pushed a branch'],
    [effect('mr_opened', '!9'), 'opened !9'],
    [effect('mr_updated', '!9'), 'updated !9'],
    [effect('mr_ready', '!9'), 'marked !9 ready'],
    [effect('mr_commented', '!9'), 'commented on !9'],
    [effect('gitlab_write', 'projects/1/jobs/77/retry'), 'retried job 77'],
    [
      effect('gitlab_write', 'projects/1/merge_requests/2/notes'),
      'GitLab write projects/1/merge_requests/2/notes'
    ],
    [effect('ticket_created', 'WEB-7'), 'created WEB-7'],
    [effect('ticket_created', null), 'created a ticket'],
    [effect('ticket_commented', 'WEB-7'), 'commented on WEB-7'],
    [effect('ticket_updated', 'WEB-7'), 'updated WEB-7'],
    [effect('action', 'created WEB-2179'), 'created WEB-2179']
  ])('%o', (e, text) => {
    expect(effectText(e)).toBe(text)
  })
})
