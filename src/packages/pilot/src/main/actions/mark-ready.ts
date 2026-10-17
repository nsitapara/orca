import type { Pilotcli, PilotcliReply } from '../envs/pilotcli'
import { RUN_TIMEOUT_MS } from './act-bridge'
import { noFolder } from './caller-folder'
import {
  actionDone,
  actionFailed,
  callerOf,
  type ActionCaller,
  type ActionEntry,
  type ActionResult
} from './types'

export const MARK_READY_USAGE = 'mark_ready { "argv": [<iid>, <head sha>] }'
// mark-ready.py's _parse: a whole-number iid and the head as 7 to 40 hex characters, as stored cards carry it.
const IID = /^\d+$/
const PIN = /^[0-9a-f]{7,40}$/

export type MarkReadyPin = { iid: string; sha: string }

export function markReadyPin(args: Record<string, unknown>): MarkReadyPin | null {
  const { argv } = args
  if (Object.keys(args).length !== 1 || !Array.isArray(argv) || argv.length !== 2) {
    return null
  }
  const [iid, sha] = argv
  return typeof iid === 'string' && typeof sha === 'string' && IID.test(iid) && PIN.test(sha)
    ? { iid, sha }
    : null
}

// What mark_ready reads of Pilot's own store (mr-branch.ts, mr-open-cards.ts): pilotcli can't read Pilot's cards.
export type MarkReadyCards = {
  // The MR's source branch as the store knows it, or null.
  branchOf(iid: number, caller: ActionCaller): string | null
  // A worktree on the branch whose folder is there, for check-mr's unpushed count, or null.
  worktreeOn(branch: string): string | null
  // The open cards from jobs 03–06 on the branch, as mark-ready.py's blocker, or null.
  openOn(iid: number, branch: string, caller: ActionCaller): string | null
}

function dirArgs(folder: string | null): string[] {
  return folder ? [`--dir=${folder}`] : []
}

// Spec §7.4's order: sha= before ready=true, so a moved head is a skip, not not_yet; active=true before it, so a merged
// MR is a skip, not a recurring not_yet; author=me refuses a teammate's !iid on my branch. -C (--dir) also lets
// ready=true count the commits the worktree hasn't pushed. Read-only, so a dry run asks the same.
export function checkReadyArgs(pin: MarkReadyPin, folder: string | null): string[] {
  return [
    'gitlab',
    'check-mr',
    pin.iid,
    'mine=true',
    'active=true',
    'author=me',
    `sha=${pin.sha}`,
    'ready=true',
    ...dirArgs(folder),
    '--format=json'
  ]
}

// Read-only: the MR's source branch, when Pilot's store doesn't know it.
export function getMrArgs(pin: MarkReadyPin, folder: string): string[] {
  return ['gitlab', 'get-mr', pin.iid, `--dir=${folder}`, '--format=json']
}

export function updateMrArgs(pin: MarkReadyPin, folder: string | null, dryRun: boolean): string[] {
  return [
    'gitlab',
    'update-mr',
    pin.iid,
    'draft=false',
    `--expect-sha=${pin.sha}`,
    ...dirArgs(folder),
    `--dry-run=${dryRun}`,
    '--format=json'
  ]
}

function stale(reason: string): ActionResult {
  return { outcome: 'stale', detail: reason, link: null, log: null, onYou: false }
}

// A blocker lasts until someone acts on it (a thread, a failed pipeline, a card), so the card waits on Nish.
function notYet(reason: string): ActionResult {
  return { outcome: 'not_yet', detail: reason, link: null, log: null, onYou: true }
}

function failed(reply: PilotcliReply): ActionResult {
  return actionFailed(
    reply.outcome === 'invalid' ? `pilotcli refused mark_ready: ${reply.reason}` : reply.reason
  )
}

// check-mr's reply: null to go on to update-mr, else the result (spec §7.4: skip is stale, not_yet waits on Nish).
function checked(reply: PilotcliReply): ActionResult | null {
  if (reply.outcome === 'ok') {
    return null
  }
  if (reply.outcome === 'skip') {
    return stale(reply.reason)
  }
  if (reply.outcome === 'not_yet') {
    return notYet(reply.reason)
  }
  return failed(reply)
}

// update-mr's reply, in mark-ready.py's words. An MR already ready is done, as mark-ready.py's do() said, so a second
// run never does it twice; any other skip (a moved head, not mine, merged) is stale.
function updated(pin: MarkReadyPin, reply: PilotcliReply, dryRun: boolean): ActionResult {
  const data: object = reply.data && typeof reply.data === 'object' ? reply.data : {}
  const url = 'web_url' in data ? data.web_url : null
  const link = typeof url === 'string' && url !== '' ? url : null
  if (reply.outcome === 'ok') {
    const did = dryRun ? 'would mark' : 'marked'
    return actionDone(`${did} !${pin.iid} ready for review`, link)
  }
  if (reply.outcome === 'skip' && 'draft' in data && data.draft === false) {
    return actionDone(`!${pin.iid} is already ready for review`, link)
  }
  return checked(reply) ?? failed(reply)
}

function sourceBranch(reply: PilotcliReply): string | null {
  const data: object = reply.data && typeof reply.data === 'object' ? reply.data : {}
  const branch = 'source_branch' in data ? data.source_branch : null
  return reply.outcome === 'ok' && typeof branch === 'string' && branch !== '' ? branch : null
}

// The catalog's mark_ready (power mark_ready), mark-ready.py through pilotcli. It learns the MR's branch (Pilot's store,
// else pilotcli get-mr) and waits while that branch has open cards from jobs 03–06; with no branch it fails closed.
// Then check-mr ready=true and update-mr draft=false at the pinned head, from the worktree on the branch when there is
// one, else the card's folder (caller-folder.ts). No refresh, as in Python: a stale card closes.
export function markReadyEntry(deps: {
  pilotcli: Pilotcli
  binary: () => string | null
  folder: (caller: ActionCaller) => string | null
  cards: MarkReadyCards
}): ActionEntry {
  const usage = `usage: ${MARK_READY_USAGE}`
  const call = (args: string[]) => deps.pilotcli({ args, timeoutMs: RUN_TIMEOUT_MS })
  // The folder check-mr and update-mr act in: the worktree on the MR's branch, else the card's.
  const dirFor = (branch: string | null, caller: ActionCaller) =>
    (branch ? deps.cards.worktreeOn(branch) : null) ?? deps.folder(caller)
  const branchOf = async (
    pin: MarkReadyPin,
    caller: ActionCaller
  ): Promise<{ branch: string } | ActionResult> => {
    const known = deps.cards.branchOf(Number(pin.iid), caller)
    if (known) {
      return { branch: known }
    }
    const folder = deps.folder(caller)
    if (!folder) {
      return actionFailed(noFolder(pin.iid))
    }
    const reply = await call(getMrArgs(pin, folder))
    const branch = sourceBranch(reply)
    const why = reply.reason ? `: ${reply.reason}` : ''
    return branch ? { branch } : notYet(`can't tell which cards are on !${pin.iid}'s branch${why}`)
  }
  return {
    name: 'mark_ready',
    power: 'mark_ready',
    label: 'Mark a draft MR ready for review',
    usage: MARK_READY_USAGE,
    checkArgs: (args) => (markReadyPin(args) ? null : usage),
    describe: async (args) => {
      const pin = markReadyPin(args)
      return pin
        ? `Mark !${pin.iid} ready for review on GitLab (head ${pin.sha.slice(0, 8)})`
        : MARK_READY_USAGE
    },
    // The Run line is the write the approval makes; the check before it only reads.
    command: (args, caller = { runId: null, inboxItemId: null }) => {
      const pin = markReadyPin(args)
      if (!pin) {
        return null
      }
      const dir = dirFor(deps.cards.branchOf(Number(pin.iid), caller), caller)
      return [deps.binary() ?? 'pilotcli', ...updateMrArgs(pin, dir, false)]
    },
    run: async (args, opts) => {
      const pin = markReadyPin(args)
      if (!pin) {
        return actionFailed(usage)
      }
      const caller = callerOf(opts)
      const learned = await branchOf(pin, caller)
      if (!('branch' in learned)) {
        return learned
      }
      const cards = deps.cards.openOn(Number(pin.iid), learned.branch, caller)
      if (cards) {
        return notYet(cards)
      }
      const dir = dirFor(learned.branch, caller)
      if (!dir) {
        return actionFailed(noFolder(pin.iid))
      }
      const check = checked(await call(checkReadyArgs(pin, dir)))
      if (check) {
        return check
      }
      return updated(pin, await call(updateMrArgs(pin, dir, opts.dryRun)), opts.dryRun)
    }
  }
}
