import type Database from '../../../../../main/sqlite/sync-database'
import type { InboxItemRow, InboxStatus } from '../../shared/api-types'
import type { InboxPreparation } from '../../shared/preparation'
import { PREPARATION_HOLD_MAX_MS, PREPARATION_LEASE_MS } from '../../shared/preparation'
import type { InboxStore } from './store-inbox'

export type PreparationClaim = { runId: string; stepIdx: number; revision: number; attempt: number }
// pilotcli reads a refusal that starts with this as a skip (pilotCLI internal/pilot/pilot.go); the reason follows it.
export const PREPARATION_STALE = 'Preparation claim is stale'

// Why a run can't take or keep a card's preparation. `nothingToDo`: nothing is left for that run (the card was
// answered, prepared, or went to another run or a newer request); false when the card still needs a person.
export class PreparationStaleError extends Error {
  constructor(
    readonly reason: string,
    readonly nothingToDo = true
  ) {
    super(`${PREPARATION_STALE}: ${reason}`)
  }
}

const CLOSED: Record<Exclude<InboxStatus, 'open'>, string> = {
  answered: 'the card was already answered',
  done: 'the card was already answered',
  dismissed: 'the card was dismissed',
  obsolete: 'the card is obsolete',
  stale: 'the card went stale'
}

function preparedBy(p: InboxPreparation, runId: string): string {
  if (p.runId === runId) {
    return 'this run already prepared this card'
  }
  if (p.runId) {
    return `run ${p.runId} already prepared this card`
  }
  return 'the card is already prepared'
}

// What stops every run bound to `revision`: a closed card, a newer request, or a preparation that has ended.
function endedRefusal(
  item: InboxItemRow | null | undefined,
  revision: number,
  runId: string
): PreparationStaleError | null {
  if (!item) {
    return new PreparationStaleError('the card is gone')
  }
  if (item.status !== 'open') {
    return new PreparationStaleError(CLOSED[item.status])
  }
  if (item.answer) {
    return new PreparationStaleError(CLOSED.answered)
  }
  const p = item.preparation
  if (!p) {
    return new PreparationStaleError('the card no longer asks for context')
  }
  if (p.revision !== revision) {
    return new PreparationStaleError('the card was queued again since this run took it')
  }
  if (p.state === 'ready') {
    return new PreparationStaleError(preparedBy(p, runId))
  }
  if (p.state === 'cancelled') {
    return new PreparationStaleError('its preparation was cancelled')
  }
  if (p.state === 'blocked') {
    return new PreparationStaleError(
      'its preparation is blocked until you Retry it on the card',
      false
    )
  }
  return null
}

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
  // only once it has lapsed AND that step no longer runs. Past claimedAt + PREPARATION_HOLD_MAX_MS nothing holds it,
  // even a step that still reports running. An attempt claimed before claimedAt was recorded holds by its lease alone.
  holds(p: InboxPreparation, at: number): boolean {
    const claimedAt = p.claimedAt ?? null
    if (claimedAt !== null && at >= claimedAt + PREPARATION_HOLD_MAX_MS) {
      return false
    }
    return (p.leaseUntil ?? 0) > at || (claimedAt !== null && this.stepAlive(p.runId, p.stepIdx))
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

  private ownsLiveClaim(p: InboxPreparation, runId: string, stepIdx: number, at: number): boolean {
    return (
      p.state === 'generating' && p.runId === runId && p.stepIdx === stepIdx && this.holds(p, at)
    )
  }

  // Why this run's step can't claim the card's preparation now, or null when it can (its own live claim included).
  claimRefusal(
    id: string,
    revision: number,
    runId: string,
    stepIdx: number,
    at: number
  ): PreparationStaleError | null {
    const item = this.inbox.get(id)
    const p = item?.preparation
    const ended = endedRefusal(item, revision, runId)
    if (ended || !p || this.ownsLiveClaim(p, runId, stepIdx, at)) {
      return ended
    }
    if (p.state === 'generating' && this.holds(p, at)) {
      return new PreparationStaleError(`run ${p.runId} is preparing this card`)
    }
    if (p.attempt >= p.maxAttempts) {
      return new PreparationStaleError(
        `every attempt is used (${p.attempt} of ${p.maxAttempts}) until you Retry it on the card`,
        false
      )
    }
    return null
  }

  claim(id: string, revision: number, runId: string, stepIdx: number, at: number): InboxItemRow {
    const refused = this.claimRefusal(id, revision, runId, stepIdx, at)
    const item = this.inbox.get(id)
    const p = item?.preparation
    if (refused || !item || !p) {
      throw refused ?? new PreparationStaleError('the card is gone')
    }
    if (this.ownsLiveClaim(p, runId, stepIdx, at)) {
      return item
    }
    const next: InboxPreparation = {
      ...p,
      state: 'generating',
      attempt: p.attempt + 1,
      runId,
      stepIdx,
      leaseUntil: at + PREPARATION_LEASE_MS,
      claimedAt: at,
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
    const ended = endedRefusal(item, claim.revision, claim.runId)
    if (ended || !item || !p) {
      throw ended ?? new PreparationStaleError('the card is gone')
    }
    if (p.state !== 'generating') {
      throw new PreparationStaleError("this attempt's claim expired")
    }
    if (p.runId !== claim.runId || p.stepIdx !== claim.stepIdx || p.attempt !== claim.attempt) {
      throw new PreparationStaleError(`a newer attempt by run ${p.runId} took the card over`)
    }
    if (!this.holds(p, at)) {
      throw new PreparationStaleError("this attempt's claim expired")
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
