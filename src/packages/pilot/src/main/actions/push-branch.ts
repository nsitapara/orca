import { isAbsolute } from 'node:path'
import type { Pilotcli, PilotcliReply } from '../envs/pilotcli'
import { OBJECT_ID } from '../inbox/push-range'
import {
  actionDone,
  actionFailed,
  RUN_TIMEOUT_MS,
  type ActionEntry,
  type ActionResult
} from './types'

export const PUSH_USAGE = 'push { "argv": [<worktree path>, <branch>, <commit>, <origin commit>] }'
// A branch as act.py's push took it. No `=` (push-branch reads `a=b` as an MR condition) and no leading `-`.
const BRANCH = /^[\w./-]+$/
// pilotcli's skip when origin already has the pinned commit (push_branch.go): a retry after a push that landed.
const PUBLISHED = 'already published at '

export type PinnedPush = { worktree: string; branch: string; head: string; base: string }
type PushPlan = { from?: string | null; to?: string; commits?: number }
type PushData = PushPlan & { would?: PushPlan; output?: unknown }

// The card's args as act.py's push took them, so stored cards, card.py push and R-P5 (push-range.ts) read them as
// they are. Every value is checked before it reaches a command line: an absolute worktree, a plain branch, and full
// commit ids.
export function pinnedPush(args: Record<string, unknown>): PinnedPush | null {
  const { argv } = args
  if (Object.keys(args).length !== 1 || !Array.isArray(argv) || argv.length !== 4) {
    return null
  }
  if (!argv.every((a): a is string => typeof a === 'string')) {
    return null
  }
  const [worktree, branch, head, base] = argv
  const fits =
    isAbsolute(worktree) &&
    BRANCH.test(branch) &&
    !branch.startsWith('-') &&
    OBJECT_ID.test(head) &&
    OBJECT_ID.test(base)
  return fits ? { worktree, branch, head, base } : null
}

// One pinned push of exactly <origin commit>..<commit>: pilotcli fetches, checks both pins, pushes only a
// fast-forward, never forces and verifies. --dir names the worktree, since Pilot runs pilotcli from ~. Every value
// goes as --flag=value.
export function pushBranchArgs(push: PinnedPush, dryRun: boolean): string[] {
  return [
    'git',
    'push-branch',
    push.branch,
    `--expect-head=${push.head}`,
    `--expect-sha=${push.base}`,
    `--dir=${push.worktree}`,
    `--dry-run=${dryRun}`,
    '--format=json'
  ]
}

function short(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : 'nothing'
}

function commitsWord(n: number): string {
  return n === 1 ? '1 commit' : `${n} commits`
}

function pushed(push: PinnedPush, data: PushData): ActionResult {
  if (data.would) {
    const { from, to, commits } = data.would
    return actionDone(
      `would push ${push.branch} ${short(from)} → ${short(to)}, ${commitsWord(commits ?? 0)}`
    )
  }
  const to = data.to ?? push.head
  const commits = data.commits ?? 0
  return actionDone(
    `pushed ${push.branch} ${short(data.from)} → ${short(to)}, ${commitsWord(commits)}`,
    null,
    { from: data.from ?? '', to, commits: String(commits) }
  )
}

function skipped(push: PinnedPush, reason: string): ActionResult {
  if (reason.startsWith(PUBLISHED)) {
    return actionDone(`${push.branch} is ${reason}`)
  }
  return {
    outcome: 'stale',
    detail: `not pushed: ${reason}`,
    link: null,
    log: null,
    onYou: false,
    keepOpen: true
  }
}

// git's last lines (pilotcli redacts them) say why a push or its hook failed.
function failedPush(reason: string, data: PushData): ActionResult {
  const lines = Array.isArray(data.output)
    ? data.output.filter((line): line is string => typeof line === 'string')
    : []
  const tail = lines.slice(-3).join(' · ')
  return actionFailed(tail ? `${reason} · ${tail}` : reason)
}

// pilotcli's reply as the catalog's result (spec E): ok is done; "already published" is done too (a retry after a
// push that landed); any other skip re-asks the card with why it wasn't pushed; not_yet (uncommitted changes, a merge
// in progress) waits on Nish, and its detail names the branch and worktree to clean up; invalid and failed fail with pilotcli's reason.
export function pushResult(push: PinnedPush, reply: PilotcliReply): ActionResult {
  const data = (reply.data ?? {}) as PushData
  if (reply.outcome === 'ok') {
    return pushed(push, data)
  }
  if (reply.outcome === 'skip') {
    return skipped(push, reply.reason)
  }
  if (reply.outcome === 'not_yet') {
    return {
      outcome: 'not_yet',
      detail: `${reply.reason} (${push.branch} in ${push.worktree})`,
      link: null,
      log: null,
      onYou: true
    }
  }
  if (reply.outcome === 'invalid') {
    return actionFailed(`pilotcli refused the push: ${reply.reason}`)
  }
  return failedPush(reply.reason, data)
}

// The catalog's push (power push). Pilot's own gates (powers, R-P5's prepared and ready card, the answer lock) run
// before an entry's run, as for every entry. `binary` is the one pilotcli lookup the Run line and the call share.
export function pushBranchEntry(deps: {
  pilotcli: Pilotcli
  binary: () => string | null
}): ActionEntry {
  const usage = `usage: ${PUSH_USAGE}`
  return {
    name: 'push',
    power: 'push',
    label: 'Push a branch to origin at a pinned commit',
    usage: PUSH_USAGE,
    checkArgs: (args) => (pinnedPush(args) ? null : usage),
    describe: async (args) => {
      const push = pinnedPush(args)
      return push
        ? `Push ${push.branch} to origin, ${short(push.base)} → ${short(push.head)}`
        : PUSH_USAGE
    },
    command: (args) => {
      const push = pinnedPush(args)
      return push ? [deps.binary() ?? 'pilotcli', ...pushBranchArgs(push, false)] : null
    },
    run: async (args, { dryRun }) => {
      const push = pinnedPush(args)
      if (!push) {
        return actionFailed(usage)
      }
      const reply = await deps.pilotcli({
        args: pushBranchArgs(push, dryRun),
        timeoutMs: RUN_TIMEOUT_MS
      })
      return pushResult(push, reply)
    }
  }
}
