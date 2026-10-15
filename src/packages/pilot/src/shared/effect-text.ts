import type { Effect, EffectKind } from './visibility-types'

const VERB: Record<Exclude<EffectKind, 'action' | 'mr_ready' | 'gitlab_write'>, string> = {
  pushed: 'pushed',
  mr_opened: 'opened',
  mr_updated: 'updated',
  mr_commented: 'commented on',
  ticket_created: 'created',
  ticket_commented: 'commented on',
  ticket_updated: 'updated'
}
const NO_TARGET: Record<EffectKind, string> = {
  pushed: 'pushed a branch',
  mr_opened: 'opened an MR',
  mr_updated: 'updated an MR',
  mr_ready: 'marked an MR ready',
  mr_commented: 'commented on an MR',
  gitlab_write: 'wrote to GitLab',
  ticket_created: 'created a ticket',
  ticket_commented: 'commented on a ticket',
  ticket_updated: 'updated a ticket',
  action: 'ran an action'
}
const RETRY = /(?:^|\/)jobs\/(\d+)\/retry$/

function withTarget(kind: EffectKind, target: string): string {
  if (kind === 'action') {
    return target
  }
  if (kind === 'mr_ready') {
    return `marked ${target} ready`
  }
  if (kind === 'gitlab_write') {
    const job = RETRY.exec(target)
    return job ? `retried job ${job[1]}` : `GitLab write ${target}`
  }
  return `${VERB[kind]} ${target}`
}

// One effect as a short phrase ("opened !1631", "pushed web-1 ×2"), for a run's What it changed and its Activity row.
export function effectText(e: Effect): string {
  const text = e.target ? withTarget(e.kind, e.target) : NO_TARGET[e.kind]
  return e.count > 1 ? `${text} ×${e.count}` : text
}
