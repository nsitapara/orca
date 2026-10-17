import { describe, expect, it } from 'vitest'
import { gitInFlight, quotaHold, worktreeHold, type HoldDeps } from '../../src/main/answers/holds'
import { chooseSession, type SessionProbe } from '../../src/main/answers/sessions'
import { worktreeBusy, type BusyTerminal } from '../../src/main/fields/worktree-busy'
import { PilotStore } from '../../src/main/store/store'
import { routeAnswer, type Route } from '../../src/shared/answers/route'
import type { InboxItemRow, InboxType } from '../../src/shared/api-types'
import { parseAutomationYaml } from '../../src/shared/definition/parse'

type Part = { id: string; label: string; run?: string }
type RouteCase = { kind: InboxType; answer: string; run?: string; parts?: Part[] }

const CLEANUP: Part[] = [
  { id: '1', label: 'web-1474 !1402', run: 'remove-worktree /wt/a aaa' },
  { id: '2', label: 'web-2077 !1499', run: 'remove-worktree /wt/b bbb' },
  { id: '3', label: 'web-1513 !1513', run: 'remove-worktree /wt/c ccc' }
]
const REVIEW: Part[] = [
  { id: 'F1', label: 'Null check in TreeNode' },
  { id: 'F2', label: 'Naming in Filters' }
]
const POST = 'post-review 1579 f.json 9f'

// apply.py's own cases (test_apply.py Routing), so both sides answer the same questions.
const ROUTES: RouteCase[] = [
  { kind: 'question', answer: 'Keep it' },
  { kind: 'question', answer: 'no' },
  { kind: 'default', answer: 'keep' },
  { kind: 'flagged', answer: 'OK.' },
  { kind: 'flagged', answer: 'revert it' },
  { kind: 'action', answer: 'approve', run: 'remove-worktree /wt/x abc' },
  { kind: 'action', answer: 'Do it', run: 'remove-worktree /wt/x abc' },
  { kind: 'action', answer: 'skip', run: 'remove-worktree /wt/x abc' },
  { kind: 'action', answer: "don't", run: 'remove-worktree /wt/x abc' },
  { kind: 'action', answer: 'revise: drop finding 2', run: POST },
  { kind: 'action', answer: 'drop finding 2', run: POST },
  { kind: 'action', answer: 'approve' },
  { kind: 'bug', answer: 'approve' },
  { kind: 'left_for_you', answer: 'keep the old value on Escape too' },
  { kind: 'bug', answer: 'skip' },
  { kind: 'action', answer: 'approve', parts: CLEANUP },
  { kind: 'action', answer: 'keep: web-1513', parts: CLEANUP },
  { kind: 'action', answer: 'keep: !1499, 3', parts: CLEANUP },
  { kind: 'action', answer: 'keep: 1 2 3', parts: CLEANUP },
  { kind: 'action', answer: 'keep: web-9999', parts: CLEANUP },
  {
    kind: 'action',
    answer: 'keep: web',
    parts: [
      { id: '1', label: 'web a', run: 'x 1' },
      { id: '2', label: 'web b', run: 'x 2' }
    ]
  },
  { kind: 'action', answer: 'approve except: F2', run: POST, parts: REVIEW },
  { kind: 'action', answer: 'part F2: make this a question', run: POST, parts: REVIEW },
  { kind: 'action', answer: 'revise: leave out F1; part F2: soften it', run: POST, parts: REVIEW }
]

type HoldCase = {
  name: string
  inFlight?: string
  tab?: { state: 'idle' | 'working' | 'waiting' | 'blocked'; typing?: boolean }
  quotaOut?: boolean
  claimedBy?: string
  jobWide?: boolean
}
const HOLDS: HoldCase[] = [
  { name: 'nothing holds it' },
  { name: 'uncommitted changes', inFlight: 'uncommitted changes' },
  { name: 'a merge in progress', inFlight: 'MERGE_HEAD present' },
  { name: 'someone typing in an agent tab', tab: { state: 'idle', typing: true } },
  { name: 'an agent working', tab: { state: 'working' } },
  { name: 'an agent asking for input', tab: { state: 'waiting' } },
  { name: 'an agent blocked on a prompt', tab: { state: 'blocked' } },
  { name: 'quota out', quotaOut: true },
  { name: 'another job holds the claim', claimedBy: 'mr-feedback' },
  {
    name: 'work in flight is reported before typing',
    inFlight: 'uncommitted changes',
    tab: { state: 'idle', typing: true }
  },
  { name: 'quota is checked before the claim', quotaOut: true, claimedBy: 'mr-feedback' },
  {
    name: 'job-wide items skip the worktree checks',
    jobWide: true,
    inFlight: 'uncommitted changes',
    tab: { state: 'working' }
  }
]

const DAY = 86_400_000
const NOW = Date.parse('2026-10-12T16:00:00Z')
const ASKER = { agent: 'claude' as const, sessionId: '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
type SessionCase = {
  launchArgs?: string[] | null
  name: string
  asking: typeof ASKER | null
  liveIdle: boolean
  transcript: { bytes: number; ageMs: number } | null
}
const SESSIONS: SessionCase[] = [
  {
    name: 'the asking session is open and idle: resume it',
    asking: ASKER,
    liveIdle: true,
    transcript: { bytes: 1000, ageMs: DAY }
  },
  {
    name: 'busy or closed, small fresh transcript: fork it',
    asking: ASKER,
    liveIdle: false,
    transcript: { bytes: 1000, ageMs: DAY }
  },
  {
    name: 'a transcript over 8,000,000 bytes: a new session',
    asking: ASKER,
    liveIdle: false,
    transcript: { bytes: 8_000_001, ageMs: DAY }
  },
  {
    name: 'a transcript older than 3 days: a new session',
    asking: ASKER,
    liveIdle: false,
    transcript: { bytes: 1000, ageMs: 4 * DAY }
  },
  { name: 'no transcript: a new session', asking: ASKER, liveIdle: false, transcript: null },
  {
    name: 'no asking session on the card: a new session',
    asking: null,
    liveIdle: true,
    transcript: { bytes: 1000, ageMs: DAY }
  }
]

function routeWord(route: Route): string {
  if (route.kind === 'tick') {
    return `tick:${route.outcome}`
  }
  if (route.kind === 'script') {
    return `script:${route.leaveOut.join(',')}`
  }
  if (route.kind === 'agent') {
    return route.revise ? 'agent:revise' : 'agent'
  }
  return `reask:${route.reason}`
}

// apply.py's hold texts → the dispatcher's hold codes (apply.py's "work in flight" is in_flight).
function holdOf(word: string): string | null {
  if (word === 'go') {
    return null
  }
  if (word === 'QUOTA') {
    return 'quota'
  }
  if (word === 'claimed') {
    return 'claimed'
  }
  if (word.startsWith('someone is typing')) {
    return 'typing'
  }
  if (word === 'uncommitted changes' || word.endsWith(' present')) {
    return 'in_flight'
  }
  return 'worktree_busy' // <tab> is working, <tab> is asking for input
}

const TAB: BusyTerminal = {
  handle: 't1',
  title: 'Review cycle · claude',
  connected: true,
  agentIdentity: 'claude',
  worktreePath: '/wt/a',
  tabId: 'tab',
  leafId: 'leaf'
}

// The dispatcher's ladder in apply.py's order: the worktree (in flight, then its tabs), then quota, then the claim.
async function pilotHoldFor(c: HoldCase): Promise<{ code: string; detail: string } | null> {
  const deps: HoldDeps = {
    exists: () => true,
    runsIn: () => [],
    inFlight: gitInFlight({
      gitStatus: async () => ({
        dirty: c.inFlight === 'uncommitted changes' ? 1 : 0,
        untracked: 0
      }),
      gitOperation: async () => (c.inFlight?.endsWith(' present') ? 'merge' : null)
    }),
    activity: (path) =>
      worktreeBusy(path, c.tab ? [TAB] : [], {
        draft: async () => (c.tab?.typing ? 'a half-typed answer' : ''),
        agentStates: async () => new Map(c.tab ? [['tab:leaf', c.tab.state]] : []),
        tabBusy: async () => false
      })
  }
  const worktree = await worktreeHold(c.jobWide ? null : '/wt/a', deps)
  if (worktree) {
    return { code: worktree.holdReason, detail: worktree.holdDetail }
  }
  const quota = quotaHold(
    'claude',
    c.quotaOut ? { weekly: 95, session: 40 } : { weekly: 10, session: 10 }
  )
  if (quota) {
    return { code: quota.holdReason, detail: quota.holdDetail }
  }
  const store = PilotStore.open(':memory:')
  if (c.claimedBy) {
    store.queue.claim('/wt/a', c.claimedBy, NOW + 900_000, NOW)
  }
  return store.queue.claim('/wt/a', 'review-cycles', NOW + 900_000, NOW)
    ? null
    : { code: 'claimed', detail: '' }
}

const DEFINITION =
  'name: Apply\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, skill: fix-gitlab-ci, prompt: x } ]\ninbox: nish\n'

async function sessionKind(c: SessionCase): Promise<string> {
  const parsed = parseAutomationYaml(DEFINITION, '/a/apply.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const store = PilotStore.open(':memory:')
  let items = [{ id: 'in_a', runId: null, stepIdx: null, createdAt: 5 }] as InboxItemRow[]
  if (c.asking) {
    store.runs.create({
      id: 'run-1',
      automationId: 'apply',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'fix',
      agent: c.asking.agent,
      skill: 'fix-gitlab-ci',
      startedAt: 1
    })
    store.runs.updateStep('run-1', 0, {
      status: 'done',
      terminalHandle: 'term-1',
      paneKey: 'tab:leaf',
      sessionId: c.asking.sessionId,
      launchArgs: c.launchArgs === undefined ? [] : c.launchArgs
    })
    items = [{ id: 'in_a', runId: 'run-1', stepIdx: 0, createdAt: 5 }] as InboxItemRow[]
  }
  const probe: SessionProbe = {
    terminalState: async () => (c.liveIdle ? 'free' : 'busy'),
    transcript: () =>
      c.transcript ? { size: c.transcript.bytes, mtimeMs: NOW - c.transcript.ageMs } : null
  }
  return (await chooseSession(parsed.definition, items, store, probe, NOW)).kind
}

// apply.py's word → the dispatcher's wording where the two differ on purpose (a git merge marker is named by the operation).
const KNOWN_HOLD_WORDS: Record<string, string> = { 'MERGE_HEAD present': 'merge in progress' }

// "keep: ," names no part: apply.py approved in full (empty refs matched nothing, so nothing was left out); Pilot revises.
const KNOWN_ROUTES = [
  {
    n: 0,
    why: '"keep: ," has no parsed refs: revise, not a full approval',
    kind: 'action' as InboxType,
    answer: 'keep: ,',
    parts: CLEANUP,
    apply: 'script:',
    pilot: 'agent:revise'
  },
  {
    n: 1,
    why: '"approve except: ," has no parsed refs: revise, not a full approval',
    kind: 'action' as InboxType,
    answer: 'approve except: ,',
    parts: REVIEW,
    apply: 'script:',
    pilot: 'agent:revise'
  }
]

// apply.py's answers for ROUTES, HOLDS, SESSIONS and KNOWN_ROUTES (in order): the old plan (worktree-gate/apply.py
// route, busy and session_route) on those cases, recorded with /opt/homebrew/bin/python3 3.15.0 on 2026-10-16, before
// apply.py was deleted.
const FROZEN_ROUTES = [
  'agent', // 0: question "Keep it"
  'agent', // 1: question "no"
  'tick:kept', // 2: default "keep"
  'tick:kept', // 3: flagged "OK."
  'agent', // 4: flagged "revert it"
  'script:', // 5: action "approve"
  'script:', // 6: action "Do it"
  'tick:skipped', // 7: action "skip"
  'tick:skipped', // 8: action "don't"
  'agent:revise', // 9: action "revise: drop finding 2"
  'agent:revise', // 10: action "drop finding 2"
  'agent', // 11: action "approve" with nothing to run
  'agent', // 12: bug "approve"
  'agent', // 13: left_for_you, a note
  'tick:skipped', // 14: bug "skip"
  'script:', // 15: parts "approve"
  'script:3', // 16: parts "keep: web-1513"
  'script:2,3', // 17: parts "keep: !1499, 3"
  'tick:skipped', // 18: parts "keep: 1 2 3"
  'agent:revise', // 19: parts "keep: web-9999"
  'agent:revise', // 20: parts "keep: web" (two parts match)
  'script:F2', // 21: parts "approve except: F2"
  'agent:revise', // 22: parts "part F2: …"
  'agent:revise' // 23: parts "revise: …; part F2: …"
]
const FROZEN_HOLDS = [
  'go', // 0: nothing holds it
  'uncommitted changes', // 1: uncommitted changes
  'MERGE_HEAD present', // 2: a merge in progress
  'someone is typing in Review cycle · claude', // 3: someone typing in an agent tab
  'Review cycle · claude is working', // 4: an agent working
  'Review cycle · claude is asking for input', // 5: an agent asking for input
  'Review cycle · claude is asking for input', // 6: an agent blocked on a prompt
  'QUOTA', // 7: quota out
  'claimed', // 8: another job holds the claim
  'uncommitted changes', // 9: work in flight is reported before typing
  'QUOTA', // 10: quota is checked before the claim
  'go' // 11: job-wide items skip the worktree checks
]
const FROZEN_SESSIONS = [
  'resume', // 0: the asking session is open and idle
  'fork', // 1: busy or closed, small fresh transcript
  'new', // 2: a transcript over 8,000,000 bytes
  'new', // 3: a transcript older than 3 days
  'new', // 4: no transcript
  'new' // 5: no asking session on the card
]
const FROZEN_KNOWN = ['script:', 'script:']
// apply.py resumed the asking session even without its launch arguments (SESSIONS[0] with none).
const FROZEN_KNOWN_SESSION = 'resume'

function frozenOld(): Map<string, string> {
  return new Map([
    ...FROZEN_ROUTES.map((w, n) => [`route:${n}`, w] as const),
    ...FROZEN_HOLDS.map((w, n) => [`hold:${n}`, w] as const),
    ...FROZEN_SESSIONS.map((w, n) => [`session:${n}`, w] as const),
    ...FROZEN_KNOWN.map((w, n) => [`known:${n}`, w] as const),
    ['known-session:0', FROZEN_KNOWN_SESSION]
  ])
}

// apply.py's answers are frozen above, so neither python3 nor apply.py is needed and nothing skips.
describe('12 · Apply my answers is retired: Pilot routes answers as apply.py did (frozen)', () => {
  const old = frozenOld()

  it.each(ROUTES.map((c, n) => [n, c] as const))('route %i: %j', (n, c) => {
    const parts = Object.fromEntries((c.parts ?? []).map((p) => [p.id, p.label]))
    const runnable = Boolean(c.run) || (c.parts ?? []).some((p) => p.run)
    const route = routeAnswer({
      type: c.kind,
      action: c.run ? c.run.split(' ')[0] : null,
      runnable,
      parts,
      text: c.answer
    })
    expect(routeWord(route)).toBe(old.get(`route:${n}`))
  })

  // Codes always agree; the plain words agree too for worktree holds, except where KNOWN_HOLD_WORDS says why not.
  it.each(HOLDS.map((c, n) => [n, c] as const))('hold %i', async (n, c) => {
    const word = old.get(`hold:${n}`) ?? 'missing'
    const hold = await pilotHoldFor(c)
    expect(hold?.code ?? null).toBe(holdOf(word))
    // apply.py's QUOTA and claimed holds are bare words (its log line carries the quota text from gate.QuotaOut, not a
    // reason string the card shows), so only Pilot's own wording is pinned for them.
    if (hold?.code === 'quota') {
      expect(hold.detail).toMatch(/^claude (weekly|session) limit at \d+%/)
    }
    if (hold && ['in_flight', 'typing', 'worktree_busy'].includes(hold.code)) {
      expect(hold.detail).toBe(KNOWN_HOLD_WORDS[word] ?? word)
    }
  })

  // DELIBERATE differences from apply.py (Tasks 23-24), each with its reason. Pilot is never changed to match.
  it.each(KNOWN_ROUTES)('known route difference: $why', (c) => {
    const parts = Object.fromEntries((c.parts ?? []).map((p) => [p.id, p.label]))
    const route = routeAnswer({
      type: c.kind,
      action: null,
      runnable: true,
      parts,
      text: c.answer
    })
    expect(routeWord(route)).toBe(c.pilot)
    expect(old.get(`known:${c.n}`)).toBe(c.apply)
  })

  it('known session difference: a resume needs the asking process args (one process per session)', async () => {
    expect(await sessionKind({ ...SESSIONS[0], launchArgs: null })).toBe('fork')
    expect(old.get('known-session:0')).toBe('resume')
  })

  it.each(SESSIONS.map((c, n) => [n, c] as const))('session %i', async (n, c) => {
    expect(await sessionKind(c)).toBe(old.get(`session:${n}`))
  })
})
