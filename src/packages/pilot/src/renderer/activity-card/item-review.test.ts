import { describe, expect, it } from 'vitest'
import { reviewChipLabel } from './WorktreeLinkStrip'
import { reviewFromItemFields } from './item-review'

const MR = {
  'mr.iid': 1633,
  'mr.title': 'Ticket priority',
  'mr.web_url': 'https://gitlab.com/g/p/-/merge_requests/1633',
  'mr.state': 'open',
  'mr.draft': false,
  'mr.pipeline_status': 'success'
}

describe('reviewFromItemFields', () => {
  it.each([
    ['an open MR with a passed pipeline', MR, 'GitLab MR !1633 · Open · Pipeline passed'],
    ['a draft', { ...MR, 'mr.draft': true }, 'GitLab MR !1633 · Draft · Pipeline passed'],
    [
      'a failed pipeline',
      { ...MR, 'mr.pipeline_status': 'failed' },
      'GitLab MR !1633 · Open · Pipeline failed'
    ],
    [
      'a running pipeline',
      { ...MR, 'mr.pipeline_status': 'running' },
      'GitLab MR !1633 · Open · Pipeline in progress'
    ],
    ['a cancelled pipeline', { ...MR, 'mr.pipeline_status': 'canceled' }, 'GitLab MR !1633 · Open'],
    ['a merged MR', { ...MR, 'mr.state': 'merged' }, 'GitLab MR !1633 · Merged'],
    ['an MR with no pipeline', { ...MR, 'mr.pipeline_status': null }, 'GitLab MR !1633 · Open']
  ])('%s', (_case, fields, label) => {
    const review = reviewFromItemFields(fields)!
    expect(reviewChipLabel(review)).toBe(label)
    expect(review.url).toBe(MR['mr.web_url'])
  })

  it.each([
    ['no MR', { 'worktree.branch': 'web-1' }],
    ['no link', { ...MR, 'mr.web_url': null }]
  ])('is null for an item with %s', (_case, fields) => {
    expect(reviewFromItemFields(fields)).toBeNull()
  })
})
