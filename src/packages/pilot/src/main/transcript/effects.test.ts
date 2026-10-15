import { describe, expect, it } from 'vitest'
import type { ActionRunRow } from '../../shared/api-types-actions'
import type { ParsedEntry } from './claude-log'
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
          ids: []
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
})
