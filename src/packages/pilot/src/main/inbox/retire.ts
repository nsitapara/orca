import type { InboxItemRow } from '../../shared/api-types'
import type { GlabApi } from '../sources/gitlab-api'
import type { PilotStore } from '../store/store'
import { resolveInboxItem, WAITING, type InboxDeps } from './inbox-service'
import { mrBlock, targetKey, type MrBlock, type MrTarget } from './mr-state'
import { branchOfRun } from './run-fields'

export const MR_CACHE_MS = 10 * 60_000

export type RetireDeps = {
  inbox: InboxDeps
  // The automation's `repo:`, or null when its file is gone.
  repoOf(automationId: string): string | null
  gitlab(repo: string): Promise<GlabApi>
  cacheMs?: number
  log(message: string): void
}

// What a card is about on GitLab: its MR (item key mr:<iid>), else its run's branch. A job-wide card
// (no MR, no worktree) has none and is never retired.
export function retireTarget(store: PilotStore, item: InboxItemRow): MrTarget | null {
  const iid = /^mr:(\d+)$/.exec(item.itemKey ?? '')
  if (iid) {
    return { iid: Number(iid[1]) }
  }
  if (!item.worktreePath || !item.runId) {
    return null
  }
  const branch = branchOfRun(store, item.runId)
  return branch ? { branch } : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class InboxRetirer {
  private readonly cache = new Map<string, { at: number; block: MrBlock }>()

  constructor(private readonly deps: RetireDeps) {}

  private keyOf(item: InboxItemRow): { key: string; repo: string; target: MrTarget } | null {
    const target = retireTarget(this.deps.inbox.store, item)
    const repo = this.deps.repoOf(item.automationId)
    if (!target || !repo) {
      return null
    }
    return { key: `${repo}|${targetKey(target)}`, repo, target }
  }

  // The last answer GitLab gave for this card's MR; null for a job-wide card or one not checked yet.
  blockFor(item: InboxItemRow): MrBlock | null {
    const found = this.keyOf(item)
    return found ? (this.cache.get(found.key)?.block ?? null) : null
  }

  private async check(item: InboxItemRow, at: number): Promise<MrBlock | null> {
    const found = this.keyOf(item)
    if (!found) {
      return null
    }
    const cached = this.cache.get(found.key)
    if (cached && at - cached.at < (this.deps.cacheMs ?? MR_CACHE_MS)) {
      return cached.block
    }
    let block: MrBlock
    try {
      block = await mrBlock(await this.deps.gitlab(found.repo), found.target)
    } catch (error) {
      block = { unknown: `MR state unknown: ${messageOf(error)}` }
    }
    this.cache.set(found.key, { at, block })
    return block
  }

  // Every waiting card whose MR merged or closed is ticked obsolete. Returns how many.
  async pass(): Promise<number> {
    const { store, now } = this.deps.inbox
    let retired = 0
    for (const item of store.inbox.list({ status: WAITING })) {
      const block = await this.check(item, now())
      if (block && 'finished' in block && block.finished) {
        resolveInboxItem(this.deps.inbox, item.id, `obsolete: ${block.finished}`, 'obsolete')
        this.deps.log(`[pilot] retire ${item.automationId} ${item.id}: obsolete, ${block.finished}`)
        retired += 1
      }
    }
    return retired
  }
}
