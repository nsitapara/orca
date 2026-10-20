import { basename } from 'node:path'
import type { RunRow } from '../../shared/api-types'
import type { KeptHome } from '../../shared/api-types-env'
import type { InboxAddParams } from '../../shared/inbox-types'
import { addInboxItem } from '../inbox/inbox-add'
import { resolveInboxItem, WAITING, type InboxDeps } from '../inbox/inbox-service'
import { addRunEvent } from '../run/run-close'
import type { PilotStore } from '../store/store'
import { heldFolderReason, holderOf } from './hold'
import type { Pilotcli, PilotcliReply } from './pilotcli'

const MERGE_TIMEOUT_MS = 5 * 60_000
const DELETE_TIMEOUT_MS = 2 * 60_000
const RETRY_CAP_MS = 30 * 60_000
// A branch still waiting this long leaves one notice, so it never waits unseen.
export const WAIT_NOTICE_MS = 6 * 60 * 60_000
// update-branch's skip for a merge it aborted.
const CONFLICT = /^conflicts in /
// delete-branch's skip when the branch is already gone.
const NO_BRANCH = /^no local branch /
export const KEPT_BRANCHES_RULES = '~/.agents/skills/worktree-gate/references/kept-branches.md'

export type KeptCardKind = 'conflict' | 'no_home' | 'waiting'

export type KeptHomeDeps = {
  store: PilotStore
  now(): number
  pilotcli: Pilotcli
  nameOf(automationId: string): string
  // A card on the run (keptCard): a conflict for an agent to resolve, a home that's gone, or a long wait. Its id, or null.
  card(params: InboxAddParams): string | null
  // The branch landed: its card, still waiting, closes.
  cardDone(id: string, outcome: string): void
  log(message: string): void
}
export type KeptHomecoming = {
  start(runId: string): void
  housekeep(): void
  settled(): Promise<void>
}
type Kept = { run: RunRow; branch: string; home: string; was: KeptHome | undefined }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// KeptHomeDeps' cards, through the inbox (read at each call). A card that can't be written or closed is logged, never
// thrown into the sweep.
export function inboxKeptCards(
  inboxOf: () => InboxDeps,
  log: (message: string) => void
): Pick<KeptHomeDeps, 'card' | 'cardDone'> {
  return {
    card(params) {
      try {
        return addInboxItem(inboxOf(), params).id
      } catch (error) {
        log(`[pilot] run ${params.runId}: couldn't leave the kept-branch card: ${messageOf(error)}`)
        return null
      }
    },
    cardDone(id, outcome) {
      const inbox = inboxOf()
      const item = inbox.store.inbox.get(id)
      if (!item || !WAITING.includes(item.status)) {
        return
      }
      try {
        resolveInboxItem(inbox, id, outcome, 'done')
      } catch (error) {
        log(`[pilot] couldn't close kept-branch card ${id}: ${messageOf(error)}`)
      }
    }
  }
}

// The card a kept branch leaves on its run. A conflict is a left_for_you, whose Approve starts the job's answers agent
// to merge it; the others are notices "ok" closes.
export function keptCard(
  run: Pick<RunRow, 'id'>,
  kind: KeptCardKind,
  branch: string,
  home: string,
  reason: string
): InboxAddParams {
  const folder = basename(home)
  if (kind === 'conflict') {
    return {
      runId: run.id,
      type: 'left_for_you',
      title: `Merge ${branch} into ${folder}`,
      context: `${branch} holds commits a Pilot throwaway made for this worktree, and they didn't merge on their own (${reason}). Approve has an agent merge them and resolve the conflicts; Skip leaves them on ${branch}.`,
      suggested: `Merge ${branch} into this worktree's branch and resolve the conflicts by ${KEPT_BRANCHES_RULES}.`
    }
  }
  if (kind === 'no_home') {
    return {
      runId: run.id,
      type: 'flagged',
      title: `${branch} has no worktree to merge into`,
      context: `${branch} holds commits a Pilot throwaway made for ${home}, which can't take them (${reason}). Merge or delete the branch by hand, then answer ok.`
    }
  }
  return {
    runId: run.id,
    type: 'flagged',
    title: `${branch} is waiting for ${folder}`,
    context: `Commits a Pilot throwaway made for ${home} wait on ${branch} (${reason}). Pilot merges them once nothing is in flight there; answer ok to close this.`
  }
}

// A throwaway's commits that reached neither its home nor origin sit on the branch env delete kept them on. They're
// merged into the home worktree as job 03's merge_back does: only while it's clean and nobody works there, so in-flight
// work is never touched. A conflict goes to an agent (keptCard); a branch merged by hand is then found and deleted.
export function createKeptHomecoming(deps: KeptHomeDeps): KeptHomecoming {
  const { store } = deps
  const inflight = new Map<string, Promise<void>>()

  const record = (runId: string, home: KeptHome): void => store.runs.envs.keptHome(runId, home)
  const deleteBranch = (branch: string, home: string): Promise<PilotcliReply> =>
    deps.pilotcli({
      args: ['git', 'delete-branch', branch, '--kept-in', home, '-C', home],
      timeoutMs: DELETE_TIMEOUT_MS
    })

  function landed(k: Kept, at: number, by: 'pilot' | 'hand'): void {
    record(k.run.id, { ...stateBase(k, at), state: 'merged', reason: null, nextAt: null })
    addRunEvent(store, at, k.run, 'kept_merged', { branch: k.branch, home: k.home, by })
    if (k.was?.cardId) {
      deps.cardDone(k.was.cardId, `${k.branch} is merged into ${k.home}`)
    }
  }

  function stateBase(k: Kept, at: number): KeptHome {
    return {
      state: 'waiting',
      reason: null,
      attempts: (k.was?.attempts ?? 0) + 1,
      nextAt: null,
      since: k.was?.since ?? at,
      noticed: k.was?.noticed ?? false,
      ...(k.was?.cardId ? { cardId: k.was.cardId } : {})
    }
  }

  // Stuck: the conflict waits on an agent or Nish. Only ever checked, never merged again: a branch now in the home is
  // deleted and the run reads merged.
  async function checkStuck(k: Kept): Promise<void> {
    const deleted = await deleteBranch(k.branch, k.home)
    const at = deps.now()
    if (deleted.outcome === 'ok') {
      landed(k, at, 'hand')
      return
    }
    if (deleted.outcome === 'skip' && NO_BRANCH.test(deleted.reason)) {
      record(k.run.id, { ...stateBase(k, at), state: 'dropped', reason: deleted.reason })
      return
    }
    record(k.run.id, {
      ...stateBase(k, at),
      state: 'stuck',
      reason: k.was?.reason ?? null,
      nextAt: at + RETRY_CAP_MS
    })
  }

  function stuck(k: Kept, at: number, kind: KeptCardKind, reason: string): void {
    addRunEvent(store, at, k.run, 'kept_stuck', { branch: k.branch, home: k.home, reason })
    const cardId = deps.card(keptCard(k.run, kind, k.branch, k.home, reason))
    const base = { ...stateBase(k, at), ...(cardId ? { cardId } : {}) }
    record(k.run.id, { ...base, state: 'stuck', reason, nextAt: at + RETRY_CAP_MS, noticed: true })
  }

  async function merge(k: Kept): Promise<void> {
    const holder = holderOf(store.runs, k.home, k.run.id)
    const busy = holder ? ['--busy', heldFolderReason(holder, deps.nameOf, k.home)] : []
    const reply = await deps.pilotcli({
      args: ['git', 'update-branch', k.home, '--merge', 'true', '--to', k.branch, ...busy],
      timeoutMs: MERGE_TIMEOUT_MS
    })
    const at = deps.now()
    if (reply.outcome === 'ok') {
      landed(k, at, 'pilot')
      const deleted = await deleteBranch(k.branch, k.home)
      if (deleted.outcome !== 'ok') {
        deps.log(`[pilot] run ${k.run.id}: ${k.branch} merged but not deleted: ${deleted.reason}`)
      }
      return
    }
    const reason = reply.reason || `update-branch answered ${reply.outcome}`
    if (reply.outcome === 'skip' && CONFLICT.test(reason)) {
      stuck(k, at, 'conflict', reason)
      return
    }
    if (reply.outcome === 'invalid') {
      stuck(k, at, 'no_home', reason)
      return
    }
    const base = stateBase(k, at)
    const wait = Math.min(RETRY_CAP_MS, 60_000 * 2 ** (base.attempts - 1))
    const notice = !base.noticed && at - base.since >= WAIT_NOTICE_MS
    const cardId = notice ? deps.card(keptCard(k.run, 'waiting', k.branch, k.home, reason)) : null
    record(k.run.id, {
      ...base,
      reason,
      nextAt: at + wait,
      noticed: base.noticed || notice,
      ...(cardId ? { cardId } : {})
    })
  }

  async function bringHome(runId: string): Promise<void> {
    const run = store.runs.get(runId)
    const branch = run?.env?.kept
    const home = run?.homePath
    if (!run?.env || !branch || !home) {
      return
    }
    const k = { run, branch, home, was: run.env.keptHome }
    const state = k.was?.state ?? 'waiting'
    if (state === 'waiting') {
      await merge(k)
    } else if (state === 'stuck') {
      await checkStuck(k)
    }
  }

  // One at a time: two merges into the same worktree must not race. One that waits is due on the next poll.
  function start(runId: string): void {
    if (inflight.size > 0) {
      return
    }
    const job = bringHome(runId)
      .catch((error: unknown) =>
        deps.log(`[pilot] run ${runId}: bringing its kept commits home failed: ${messageOf(error)}`)
      )
      .finally(() => inflight.delete(runId))
    inflight.set(runId, job)
  }

  return {
    start,
    housekeep() {
      const due = store.runs.envs.keptDue(deps.now())[0]
      if (due) {
        start(due.id)
      }
    },
    async settled() {
      while (inflight.size > 0) {
        await Promise.all(inflight.values())
      }
    }
  }
}
