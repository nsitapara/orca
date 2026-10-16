import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { Pilotcli, PilotcliReply } from '../envs/pilotcli'
import { RUN_TIMEOUT_MS } from './act-bridge'
import {
  actionDone,
  actionFailed,
  callerOf,
  type ActionCaller,
  type ActionEntry,
  type ActionResult
} from './types'

export const POST_REVIEW_USAGE = 'post_review { "argv": [<iid>, <review file>, <sha256>] }'
// Job 09's vault folder (vault.job_dir("review-requests")): a Post card's review file is named relative to it.
export const REVIEWS_JOB_FOLDER = '09 · Prepare reviews requested of me'
const IID = /^\d+$/
const SHA256 = /^[0-9a-f]{64}$/
// Enough of a review file to count what a post would leave out; create-thread reads the rest.
const ReviewParts = z.looseObject({ parts: z.array(z.looseObject({ id: z.string() })) })

// The card's args as post-review.py took them: [iid, review file, sha256], then --except <ids> when parts are left out.
export type PinnedReview = { iid: string; path: string; sha256: string; except: string | null }
type Parsed = { review: PinnedReview } | { problem: string } | null

function strings(args: Record<string, unknown>): string[] | null {
  const { argv } = args
  return Object.keys(args).length === 1 &&
    Array.isArray(argv) &&
    argv.every((a): a is string => typeof a === 'string')
    ? argv
    : null
}

function exceptOf(rest: string[]): string | null | undefined {
  if (rest.length === 0) {
    return null
  }
  return rest.length === 2 && rest[0] === '--except' && rest[1] !== '' ? rest[1] : undefined
}

// post-review.py's _parse: the review file must be a .json inside job 09's folder (create-thread no longer checks it).
// Null when the args don't fit the usage; a problem when the file is outside the folder.
function parse(args: Record<string, unknown>, folder: string): Parsed {
  const argv = strings(args)
  if (!argv || argv.length < 3) {
    return null
  }
  const [iid, rel, sha256, ...rest] = argv
  const except = exceptOf(rest)
  if (!IID.test(iid) || !SHA256.test(sha256) || except === undefined) {
    return null
  }
  const path = resolve(folder, rel)
  const inside = relative(folder, path)
  if (
    inside === '' ||
    inside.split(sep)[0] === '..' ||
    isAbsolute(inside) ||
    !path.endsWith('.json')
  ) {
    return { problem: `${rel} isn't a review file in job 09's folder` }
  }
  return { review: { iid, path, sha256, except } }
}

export function createThreadArgs(
  review: PinnedReview,
  folder: string | null,
  dryRun: boolean
): string[] {
  return [
    'gitlab',
    'create-thread',
    review.iid,
    `--review=${review.path}`,
    `--expect-sha256=${review.sha256}`,
    ...(review.except ? [`--except=${review.except}`] : []),
    ...(folder ? [`--dir=${folder}`] : []),
    `--dry-run=${dryRun}`,
    '--format=json'
  ]
}

function count(data: object, key: string): number {
  const value: unknown = key in data ? Reflect.get(data, key) : 0
  return typeof value === 'number' ? value : 0
}

function threadData(data: unknown) {
  const d: object = data && typeof data === 'object' ? data : {}
  const offLine: unknown = 'off_line' in d ? d.off_line : []
  const link: unknown = 'link' in d ? d.link : null
  return {
    posted: count(d, 'posted'),
    of: count(d, 'of'),
    already: count(d, 'already'),
    offLine: Array.isArray(offLine) ? offLine.filter((id) => typeof id === 'string') : [],
    link: typeof link === 'string' && link !== '' ? link : null
  }
}

// post-review.py's detail: "posted k of n findings on !iid", what was already there, and what GitLab put off its line.
function posted(review: PinnedReview, data: ReturnType<typeof threadData>): string {
  const already = data.already ? ` (${data.already} were already on the MR)` : ''
  const offLine = data.offLine.length
    ? `; GitLab put ${data.offLine.join(', ')} on the MR rather than its line`
    : ''
  return `posted ${data.posted} of ${data.of} findings on !${review.iid}${already}${offLine}`
}

// pilotcli's reply as the catalog's result (spec §7.4): ok is done; skip and invalid are stale, as post-review.py's
// check() was (a changed file, a moved MR, a review of another MR, a part it doesn't have); failed says how far it got.
export function postResult(
  review: PinnedReview,
  reply: PilotcliReply,
  dryRun: boolean
): ActionResult {
  const data = threadData(reply.data)
  if (reply.outcome === 'ok') {
    const detail = dryRun
      ? `would post ${data.of - data.already} of ${data.of} findings on !${review.iid}`
      : posted(review, data)
    return actionDone(detail, data.link)
  }
  if (reply.outcome === 'skip' || reply.outcome === 'invalid') {
    return { outcome: 'stale', detail: reply.reason, link: null, log: null, onYou: false }
  }
  return { ...actionFailed(reply.reason), link: data.link }
}

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// "Post m of n findings on !iid" from the pinned file, Pilot-side; post-review.py's words when it can't be used.
async function describePost(review: PinnedReview): Promise<string> {
  const name = basename(review.path)
  const cant = (why: string) => `Post the review of !${review.iid} (${why})`
  let bytes: Buffer
  try {
    bytes = await readFile(review.path)
  } catch {
    return cant(`${name} is gone`)
  }
  if (sha256Of(bytes) !== review.sha256) {
    return cant(`${name} changed after it was shown`)
  }
  let parts: { id: string }[]
  try {
    parts = ReviewParts.parse(JSON.parse(bytes.toString('utf8'))).parts
  } catch {
    return cant(`${name} is not a review file`)
  }
  const left = new Set((review.except ?? '').split(',').filter(Boolean))
  const posting = parts.filter((part) => !left.has(part.id)).length
  return `Post ${posting} of ${parts.length} findings on !${review.iid}`
}

// The catalog's post_review (power post), post-review.py through pilotcli's create-thread. `reviewsDir` is job 09's
// vault folder, read at each use; `folder` is where pilotcli acts (caller-folder.ts), since Pilot runs it from ~.
export function postReviewEntry(deps: {
  pilotcli: Pilotcli
  binary: () => string | null
  reviewsDir: () => string
  folder: (caller: ActionCaller) => string | null
}): ActionEntry {
  const usage = `usage: ${POST_REVIEW_USAGE}`
  const pinned = (args: Record<string, unknown>) => parse(args, deps.reviewsDir())
  return {
    name: 'post_review',
    power: 'post',
    label: 'Post a prepared review on an MR',
    usage: POST_REVIEW_USAGE,
    checkArgs: (args) => {
      const got = pinned(args)
      if (!got) {
        return usage
      }
      return 'problem' in got ? got.problem : null
    },
    describe: async (args) => {
      const got = pinned(args)
      return got && 'review' in got ? describePost(got.review) : POST_REVIEW_USAGE
    },
    command: (args, caller = { runId: null, inboxItemId: null }) => {
      const got = pinned(args)
      return got && 'review' in got
        ? [deps.binary() ?? 'pilotcli', ...createThreadArgs(got.review, deps.folder(caller), false)]
        : null
    },
    run: async (args, opts) => {
      const got = pinned(args)
      if (!got) {
        return actionFailed(usage)
      }
      if ('problem' in got) {
        return actionFailed(got.problem)
      }
      const folder = deps.folder(callerOf(opts))
      const reply = await deps.pilotcli({
        args: createThreadArgs(got.review, folder, opts.dryRun),
        timeoutMs: RUN_TIMEOUT_MS
      })
      return postResult(got.review, reply, opts.dryRun)
    },
    exceptArgs: (args, leftOut) => ({
      ...args,
      argv: [...(strings(args) ?? []), '--except', leftOut.join(',')]
    })
  }
}
