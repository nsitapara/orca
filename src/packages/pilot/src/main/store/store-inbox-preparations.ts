import type Database from '../../../../../main/sqlite/sync-database'
import type { InboxItemRow } from '../../shared/api-types'
import type { InboxPreparation } from '../../shared/preparation'
import { PREPARATION_LEASE_MS } from '../../shared/preparation'
import type { InboxStore } from './store-inbox'

export type PreparationClaim = { runId: string; stepIdx: number; revision: number; attempt: number }
export const PREPARATION_STALE =
  'Preparation claim is stale, expired, or the item has been answered'

export class InboxPreparationStore {
  constructor(
    private readonly db: Database,
    private readonly inbox: InboxStore
  ) {}

  // Is the claiming step (starting or running) still alive?
  private stepAlive(runId: string | null, stepIdx: number | null): boolean {
    if (runId === null || stepIdx === null) {
      return false
    }
    const row = this.db
      .prepare('SELECT status FROM steps WHERE run_id = ? AND idx = ?')
      .get(runId, stepIdx) as { status: string } | undefined
    return row?.status === 'starting' || row?.status === 'running'
  }

  // A generating attempt's claim holds while its lease runs or while its claiming step is alive: the lease has expired
  // only once it has lapsed AND that step no longer runs (its timeout ends a worker that hangs).
  holds(p: InboxPreparation, at: number): boolean {
    return (p.leaseUntil ?? 0) > at || this.stepAlive(p.runId, p.stepIdx)
  }

  write(id: string, preparation: InboxPreparation): void {
    this.db
      .prepare('UPDATE inbox_items SET preparation_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(preparation), preparation.updatedAt, id)
  }

  listEligible(now: number): InboxItemRow[] {
    return this.inbox.list({ status: ['open'] }).filter((item) => {
      const p = item.preparation
      if (!p || item.answer || p.attempt >= p.maxAttempts) {
        return false
      }
      return p.state === 'queued' || (p.state === 'generating' && !this.holds(p, now))
    })
  }

  claim(id: string, revision: number, runId: string, stepIdx: number, at: number): InboxItemRow {
    const item = this.inbox.get(id)
    const p = item?.preparation
    if (!item || item.status !== 'open' || item.answer || !p || p.revision !== revision) {
      throw new Error(PREPARATION_STALE)
    }
    if (
      p.state === 'generating' &&
      p.runId === runId &&
      p.stepIdx === stepIdx &&
      this.holds(p, at)
    ) {
      return item
    }
    if (
      p.attempt >= p.maxAttempts ||
      (p.state !== 'queued' && !(p.state === 'generating' && !this.holds(p, at)))
    ) {
      throw new Error(PREPARATION_STALE)
    }
    const next: InboxPreparation = {
      ...p,
      state: 'generating',
      attempt: p.attempt + 1,
      runId,
      stepIdx,
      leaseUntil: at + PREPARATION_LEASE_MS,
      progress: 'Generating context',
      error: null,
      updatedAt: at
    }
    this.write(id, next)
    return { ...item, preparation: next }
  }

  requireClaim(
    id: string,
    claim: PreparationClaim,
    at: number
  ): InboxItemRow & { preparation: InboxPreparation } {
    const item = this.inbox.get(id)
    const p = item?.preparation
    if (
      !item ||
      item.status !== 'open' ||
      item.answer ||
      !p ||
      p.state !== 'generating' ||
      p.revision !== claim.revision ||
      p.attempt !== claim.attempt ||
      p.runId !== claim.runId ||
      p.stepIdx !== claim.stepIdx ||
      !this.holds(p, at)
    ) {
      throw new Error(PREPARATION_STALE)
    }
    return { ...item, preparation: p }
  }

  progress(id: string, claim: PreparationClaim, message: string, at: number): InboxItemRow {
    const item = this.requireClaim(id, claim, at)
    const preparation = {
      ...item.preparation,
      progress: message,
      leaseUntil: at + PREPARATION_LEASE_MS,
      updatedAt: at
    }
    this.write(id, preparation)
    return { ...item, preparation }
  }

  fail(
    id: string,
    claim: PreparationClaim,
    error: string,
    retry: boolean,
    at: number
  ): InboxItemRow {
    const item = this.requireClaim(id, claim, at)
    const p = item.preparation
    const state = retry && p.attempt < p.maxAttempts ? 'queued' : 'blocked'
    const preparation: InboxPreparation = {
      ...p,
      state,
      error,
      progress: error,
      leaseUntil: null,
      updatedAt: at
    }
    this.write(id, preparation)
    return { ...item, preparation }
  }

  cancel(id: string, at: number): void {
    const p = this.inbox.get(id)?.preparation
    if (!p || p.state === 'ready' || p.state === 'cancelled') {
      return
    }
    this.write(id, {
      ...p,
      state: 'cancelled',
      leaseUntil: null,
      progress: 'Answered before context was ready',
      updatedAt: at
    })
  }

  recoverExpired(now: number): void {
    for (const item of this.inbox.list({ status: ['open'] })) {
      const p = item.preparation
      if (p?.state !== 'generating' || this.holds(p, now)) {
        continue
      }
      const state = p.attempt < p.maxAttempts ? 'queued' : 'blocked'
      this.write(item.id, {
        ...p,
        state,
        leaseUntil: null,
        error: 'Preparation lease expired',
        progress: 'Preparation lease expired',
        updatedAt: now
      })
    }
  }
}
