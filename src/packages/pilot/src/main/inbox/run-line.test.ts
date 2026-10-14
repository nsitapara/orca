import { describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import { actBridge, type ProcessRun } from '../actions/act-bridge'
import { buildActionCatalog } from '../actions/catalog'
import { pushBranchEntry } from '../actions/push-branch'
import type { Pilotcli } from '../envs/pilotcli'
import { approvedArgs } from '../actions/powers'
import { cardRunLine, shellWord } from './run-line'

const DONE = { code: 0, stdout: '{"outcome":"done"}', stderr: '', timedOut: false }
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
const HEAD = '9c1e2f04'.padEnd(40, 'a')
const BASE = '1a2b3c4d'.padEnd(40, 'b')

// The real catalog over a real act bridge and the real push entry, whose runners only record what they would spawn.
function catalog() {
  const spawned: { program: string; args: string[] }[] = []
  const run: ProcessRun = vi.fn(async (spec) => {
    spawned.push({ program: spec.program, args: spec.args })
    return DONE
  })
  const act = actBridge({ actPy: '/skills/worktree-gate/act.py', python: 'python3', run, env: {} })
  const pilotcli: Pilotcli = vi.fn(async (call) => {
    spawned.push({ program: '/bin/pilotcli', args: [...call.args] })
    return {
      outcome: 'ok' as const,
      reason: '',
      data: { from: BASE, to: HEAD, commits: 1 },
      code: 0
    }
  })
  const push = pushBranchEntry({ pilotcli, binary: () => '/bin/pilotcli' })
  return { catalog: buildActionCatalog({ act, push, linear: null }), spawned }
}

function card(over: Partial<InboxItemRow>): InboxItemRow {
  return {
    id: 'in_1',
    automationId: 'ci',
    runId: 'run-1',
    stepIdx: 0,
    itemKey: 'mr:1',
    worktreePath: '/wt',
    person: 'nish',
    type: 'action',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: 'push',
    actionArgs: { argv: ['/wt/web-1493', 'web-1493-a', HEAD, BASE] },
    parts: {},
    switchWords: [],
    digest: 'd1',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  }
}

describe("an action card's Run line", () => {
  it('is the exact command Approve spawns, built by the same code', async () => {
    const { catalog: c, spawned } = catalog()
    const item = card({})
    const line = cardRunLine(c, item)
    expect(line).toEqual({
      digest: 'd1',
      text: `/bin/pilotcli git push-branch web-1493-a --expect-head=${HEAD} --expect-sha=${BASE} --dir=/wt/web-1493 --dry-run=false --format=json`
    })
    const entry = c.get('push')!
    await entry.run(item.actionArgs!, { dryRun: false, runId: 'run-1' })
    const ran = [spawned[0].program, ...spawned[0].args]
    expect(line?.text).toBe(ran.map(shellWord).join(' '))
  })

  it('shows the args after the parts left out, as the approval runs them', async () => {
    const { catalog: c, spawned } = catalog()
    const item = card({
      action: 'post_review',
      actionArgs: { argv: ['1588', '/r/review.md', 'f00d'] },
      parts: { a: 'Nit on line 3', b: 'Rename' },
      answer: {
        option: null,
        text: 'approve except: a',
        digest: 'd1',
        via: 'page',
        callerKind: 'desktop'
      },
      status: 'answered'
    })
    const line = cardRunLine(c, item)
    expect(line?.text).toBe(
      'python3 /skills/worktree-gate/act.py post-review run 1588 /r/review.md f00d --except a'
    )
    const args = approvedArgs(c.get('post_review')!, item, ['a'])
    if ('problem' in args) {
      throw new Error(args.problem)
    }
    await c.get('post_review')!.run(args.args, { dryRun: false, runId: 'run-1' })
    for (const word of spawned[0].args) {
      expect(line?.text).toContain(shellWord(word))
    }
  })

  it.each<[string, string, string]>([
    ['an RLO-reversed branch name', 'web-‮abc', "$'web-\\u202Eabc'"],
    ['an isolate and a mark', 'a⁦b‏c', "$'a\\u2066b\\u200Fc'"],
    ['zero-width characters', 'ma​in﻿', "$'ma\\u200Bin\\uFEFF'"],
    ['a newline and a tab', 'a\nb\tc', "$'a\\nb\\tc'"],
    ['C0 and C1 controls', 'a\u0007b\u0085c', "$'a\\u0007b\\u0085c'"],
    ['an Arabic letter mark', 'x؜y', "$'x\\u061Cy'"],
    ['a Cyrillic homoglyph', 'mаin', "$'m\\u0430in'"],
    ['a quote and a backslash with them', "it's\\‮", "$'it\\'s\\\\\\u202E'"],
    ['a plain space', 'a b', "'a b'"],
    ['an empty word', '', "''"]
  ])('shows %s visibly, never raw', (_name, branch, shown) => {
    const { catalog: c } = catalog()
    const text = cardRunLine(
      c,
      card({ action: 'mark_ready', actionArgs: { argv: [branch, 'abc'] } })
    )!.text
    expect(text).toContain(` ${shown} `)
    expect(text).toMatch(PRINTABLE_ASCII)
  })

  it('shows any other args as JSON that is printable ASCII, escapes and all', () => {
    const { catalog: c } = catalog()
    const item = card({
      action: 'linear_set_state',
      actionArgs: { issue: 'WEB-1‮', to: 'In\nReview Р' }
    })
    const text = cardRunLine(c, item)!.text
    expect(text).toBe('linear_set_state {"issue":"WEB-1\\u202E","to":"In\\nReview \\u0420"}')
    expect(text).toMatch(PRINTABLE_ASCII)
    expect(JSON.parse(text.slice('linear_set_state '.length))).toEqual(item.actionArgs)
  })

  it('shows the write id a Linear write is pinned with, the one the approval runs with', () => {
    const { catalog: c } = catalog()
    const item = card({ action: 'linear_comment', actionArgs: { issue: 'WEB-1', body: 'Hi' } })
    const shown = JSON.parse(cardRunLine(c, item)!.text.slice('linear_comment '.length))
    const approved = approvedArgs(c.get('linear_comment')!, item, [])
    expect(shown).toEqual('args' in approved ? approved.args : null)
    expect(shown.write_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each<[string, Partial<InboxItemRow>, string]>([
    ['args that do not fit', { actionArgs: { argv: 'x' } }, 'usage: push'],
    ['an action not in the catalog', { action: 'deploy', actionArgs: {} }, 'no action "deploy"']
  ])('says why Approve could not run instead of a line: %s', (_name, over, why) => {
    const text = cardRunLine(catalog().catalog, card(over))!.text
    expect(text).toMatch(/^Approve can't run: /)
    expect(text).toContain(why)
  })

  it('has no line on a card without an action', () => {
    expect(cardRunLine(catalog().catalog, card({ action: null, actionArgs: null }))).toBeNull()
  })
})
