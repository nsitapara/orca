import { describe, expect, it } from 'vitest'
import type { ActionRunRow } from '../../shared/api-types-actions'
import type { ParsedEntry } from './claude-log'
import { linkEffects } from './effect-links'
import { actionEffects, stepEffects } from './effects'

function entry(over: Partial<ParsedEntry> & { id: string }): ParsedEntry {
  return {
    kind: 'tool',
    at: 1,
    tool: 'Bash',
    title: '',
    status: 'ok',
    summary: null,
    links: [],
    use: { offset: 0, length: 0 },
    result: null,
    command: null,
    git: null,
    ids: [],
    branch: null,
    ...over
  } as ParsedEntry
}

describe('stepEffects', () => {
  it('reads pushes, MRs and tickets from commands and gitOperation, once per entry and merged per step', () => {
    const mr = 'https://gitlab.com/g/p/-/merge_requests/9'
    const effects = stepEffects(
      [
        entry({ id: 'a', command: 'git push origin web-1', git: { push: { branch: 'web-1' } } }),
        entry({ id: 'b', command: 'git push origin web-1', at: 5 }),
        entry({
          id: 'c',
          command: 'glab mr create --fill',
          links: [mr],
          git: { pr: { number: 9, url: mr, action: 'created' } }
        }),
        entry({
          id: 'd',
          command: 'orca linear create --json',
          ids: ['WEB-7'],
          links: ['https://linear.app/acme/issue/WEB-7/x']
        }),
        entry({ id: 'e', command: 'git push origin web-2', status: 'error' }),
        entry({ id: 'f', tool: 'Read', command: null }),
        {
          kind: 'text',
          id: 'g',
          at: 1,
          title: 'git push',
          use: { offset: 0, length: 0 },
          result: null,
          command: null,
          git: null,
          ids: [],
          branch: null
        }
      ],
      1
    )
    expect(effects).toEqual([
      { kind: 'pushed', target: 'web-1', url: null, count: 2, stepIdx: 1, at: 1 },
      { kind: 'mr_opened', target: '!9', url: mr, count: 1, stepIdx: 1, at: 1 },
      {
        kind: 'ticket_created',
        target: 'WEB-7',
        url: 'https://linear.app/acme/issue/WEB-7/x',
        count: 1,
        stepIdx: 1,
        at: 1
      }
    ])
  })

  it('reads an MR marked ready and an MR edited from gitOperation alone', () => {
    const effects = stepEffects(
      [
        entry({ id: 'a', command: 'some-script', git: { pr: { number: 3, action: 'ready' } } }),
        entry({ id: 'b', command: 'other', git: { pr: { number: 3, action: 'edited' } } })
      ],
      0
    )
    expect(effects.map((e) => [e.kind, e.target])).toEqual([
      ['mr_ready', '!3'],
      ['mr_updated', '!3']
    ])
  })
})

describe('stepEffects fixes', () => {
  it('counts same-kind effects with different targets in one command, and merges gitOperation with the command', () => {
    const two = stepEffects(
      [entry({ id: 'a', command: 'git push origin a && git push origin b' })],
      0
    )
    expect(two.map((e) => [e.kind, e.target])).toEqual([
      ['pushed', 'a'],
      ['pushed', 'b']
    ])
    const one = stepEffects(
      [entry({ id: 'a', command: 'git push origin web-1', git: { push: { branch: 'web-1' } } })],
      0
    )
    expect(one.map((e) => [e.kind, e.target, e.count])).toEqual([['pushed', 'web-1', 1]])
  })

  it.each([
    ['git push', 'web-9', null, 'web-9'],
    ['pilotcli git push-branch "$CURRENT"', 'web-9', null, 'web-9'],
    ['git push', 'HEAD', null, null],
    ['git push', '', null, null],
    ['git push', 'web-9', 'web-1', 'web-1'],
    ['git push origin web-2', 'web-9', null, 'web-2']
  ])(
    "takes a push's branch from %s, else its record's gitBranch %j (gitOperation %j)",
    (command, branch, pushed, target) => {
      const git = pushed ? { push: { branch: pushed } } : null
      const effects = stepEffects([entry({ id: 'a', command, branch, git })], 0)
      expect(effects.map((e) => e.target)).toEqual([target])
    }
  )

  it("links a push to its record's branch's tree", () => {
    const effects = stepEffects([entry({ id: 'a', command: 'git push', branch: 'web-9' })], 0)
    expect(linkEffects(effects, { gitlab: 'https://gitlab.com/g/p', linear: null })[0].url).toBe(
      'https://gitlab.com/g/p/-/tree/web-9'
    )
  })

  it('does not take WEB-70 for WEB-7', () => {
    const effects = stepEffects(
      [
        entry({
          id: 'a',
          command: 'orca linear create --json',
          ids: ['WEB-7'],
          links: ['https://linear.app/a/issue/WEB-70/x']
        })
      ],
      0
    )
    expect(effects[0].url).toBeNull()
  })
})

describe('actionEffects', () => {
  const row = (over: Partial<ActionRunRow>): ActionRunRow => ({
    id: 1,
    inboxItemId: null,
    runId: 'r',
    action: 'linear_create',
    args: {},
    digest: 'd',
    phase: 'do',
    status: 'done',
    output: JSON.stringify({
      outcome: 'done',
      detail: 'created WEB-2179',
      link: 'https://linear.app/acme/issue/WEB-2179'
    }),
    dryRun: false,
    startedAt: 5,
    finishedAt: 6,
    ...over
  })

  it("lists the run's catalog actions that did their work", () => {
    expect(
      actionEffects([
        row({}),
        row({ status: 'refused' }),
        row({ phase: 'check' }),
        row({ dryRun: true }),
        row({ action: 'push', output: 'not json', finishedAt: null })
      ])
    ).toEqual([
      {
        kind: 'action',
        target: 'created WEB-2179',
        url: 'https://linear.app/acme/issue/WEB-2179',
        count: 1,
        stepIdx: null,
        at: 6
      },
      { kind: 'action', target: 'push', url: null, count: 1, stepIdx: null, at: 5 }
    ])
  })

  it('leaves out start_run, and says only which ticket linear_attach linked', () => {
    const attach = JSON.stringify({
      detail: 'attached Some title to WEB-3',
      link: 'https://x.test/a'
    })
    expect(
      actionEffects([
        row({ action: 'start_run', output: JSON.stringify({ detail: 'started run x' }) }),
        row({
          action: 'linear_attach',
          args: { issue: 'WEB-3', title: 'Some title' },
          output: attach
        }),
        row({ action: 'linear_attach', args: { issue: 'issue-uuid' }, output: attach })
      ]).map((e) => [e.target, e.url])
    ).toEqual([
      ['attached a link to WEB-3', 'https://x.test/a'],
      ['attached a link', 'https://x.test/a']
    ])
  })

  it('keeps only http(s) links', () => {
    const out = JSON.stringify({ detail: 'x', link: 'javascript:alert(1)' })
    expect(actionEffects([row({ output: out })])[0].url).toBeNull()
  })
})
