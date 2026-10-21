import type { ItemFields } from '../../shared/api-types'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'

type ReviewStatus = WorktreeCardPrDisplay['status']

// GitLab's pipeline statuses as the review chip draws them; the rest (canceled, skipped, manual) draw none.
const PIPELINE: Record<string, ReviewStatus> = {
  success: 'success',
  failed: 'failure',
  running: 'pending',
  pending: 'pending',
  created: 'pending',
  preparing: 'pending',
  waiting_for_resource: 'pending',
  scheduled: 'pending'
}

function reviewState(fields: ItemFields): WorktreeCardPrDisplay['state'] {
  const state = fields['mr.state']
  if (state === 'open') {
    return fields['mr.draft'] === true ? 'draft' : 'open'
  }
  return state === 'merged' || state === 'closed' ? state : undefined
}

// An item's GitLab MR (sources/merge-requests.ts, branch-facts.ts) as the review chip shows it; null with no link.
export function reviewFromItemFields(fields: ItemFields): WorktreeCardPrDisplay | null {
  const iid = fields['mr.iid']
  const url = fields['mr.web_url']
  if (typeof iid !== 'number' || typeof url !== 'string') {
    return null
  }
  const pipeline = fields['mr.pipeline_status']
  const title = fields['mr.title']
  return {
    provider: 'gitlab',
    number: iid,
    title: typeof title === 'string' ? title : '',
    state: reviewState(fields),
    url,
    status: typeof pipeline === 'string' ? PIPELINE[pipeline] : undefined
  }
}
