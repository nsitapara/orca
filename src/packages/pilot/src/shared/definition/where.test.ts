import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from './parse'
import type { ItemKind } from './types'
import { WHERE_SCHEMAS, linearTicketWhereSchema, worktreeWhereSchema } from './where'

describe('WHERE_SCHEMAS', () => {
  const valid: [ItemKind, Record<string, unknown>][] = [
    ['merge_request', {}],
    [
      'merge_request',
      {
        state: 'open',
        author: { people: ['nish'] },
        reviewer: { not: { group: 'web' } },
        head_pipeline: 'failed',
        draft: false,
        approved_by: 'none',
        target_branch: 'dev'
      }
    ],
    ['merge_request', { approved_by: { group: 'web' }, author: 'anyone' }],
    [
      'worktree',
      { has_mr: true, mr_author: { people: ['nish'] }, mr_state: 'open', branch_owner: 'anyone' }
    ],
    [
      'pipeline',
      {
        ref: 'dev',
        status: 'failed',
        select: 'newest_suite_running',
        marker_jobs: ['notify-slack']
      }
    ],
    [
      'linear_ticket',
      { assignee: { people: ['nish'] }, state_type: ['unstarted'], team: 'WEB', has_branch: false }
    ]
  ]
  it.each(valid)('accepts a %s where block %j', (kind, where) => {
    expect(WHERE_SCHEMAS[kind].safeParse(where)).toMatchObject({ success: true, data: where })
  })

  const invalid: [ItemKind, Record<string, unknown>][] = [
    ['merge_request', { author: 'nish' }],
    ['merge_request', { author: { not: { people: ['nish'], bogus: 1 } } }],
    ['merge_request', { approved_by: 'nobody' }],
    ['merge_request', { has_mr: true }],
    ['worktree', { author: 'anyone' }],
    ['pipeline', {}],
    ['pipeline', { ref: 'dev', select: 'oldest' }],
    ['linear_ticket', { state_type: 'started' }]
  ]
  it.each(invalid)('rejects a %s where block %j', (kind, where) => {
    expect(WHERE_SCHEMAS[kind].safeParse(where).success).toBe(false)
  })
})

describe('worktreeWhereSchema commits clause', () => {
  it.each([
    ['an ignore_trailer', { commits: { ignore_trailer: 'Agent-Loop: standards' } }, true],
    ['first_sight: baseline', { commits: { first_sight: 'baseline' } }, true],
    ['first_sight: test_recent', { commits: { first_sight: 'test_recent' } }, true],
    ['an empty clause', { commits: {} }, true],
    ['paths', { commits: { paths: ['apps/', 'api/'] } }, true],
    ['no paths', { commits: { paths: [] } }, false],
    ['a path that is a string', { commits: { paths: 'apps/' } }, false],
    ['a duration instead of a mode', { commits: { first_sight: '7d' } }, false],
    ['the old exclude key', { commits: { exclude: 'Agent-Loop:' } }, false]
  ])('%s', (_name, where, ok) => {
    expect(worktreeWhereSchema.safeParse(where).success).toBe(ok)
  })
})

describe('linear_ticket where.ids_from', () => {
  const file = (where: string, kind = 'linear_ticket') =>
    `name: n\nrepo: r\nschedule: manual\nitems:\n  kind: ${kind}\n  where:\n${where}steps:\n  - { agent: claude, prompt: x }\n`
  const errorsOf = (yaml: string): string[] => {
    const result = parseAutomationYaml(yaml, '/a/n.yaml')
    return result.ok ? [] : result.errors.map((e) => e.replace('/a/n.yaml: ', ''))
  }

  it('accepts a command with a field, env values and a timeout, and keeps them as written', () => {
    const where = {
      ids_from: {
        run: "python3 '/a b/pilot_mode.py' list-fix-tickets",
        field: 'identifier',
        env: { LOOP: 'dev-e2e' },
        timeout: '30s'
      },
      team: 'WEB'
    }
    expect(linearTicketWhereSchema.safeParse(where)).toMatchObject({ success: true, data: where })
    expect(linearTicketWhereSchema.safeParse({ ids_from: { run: 'list-ids' } }).success).toBe(true)
  })

  it('accepts the ids an earlier stage hands over (feed: true), alone or with a command as its fallback', () => {
    for (const ids_from of [{ feed: true }, { feed: true, run: 'list-ids', field: 'identifier' }]) {
      expect(linearTicketWhereSchema.safeParse({ ids_from })).toMatchObject({
        success: true,
        data: { ids_from }
      })
    }
  })

  it.each([
    [
      'a Pilot placeholder in run',
      '    ids_from: { run: "tool {ticket.id}" }\n',
      "items.where.ids_from.run: ids_from runs before there is any item, so it can't contain {placeholders}"
    ],
    [
      'shell syntax in run',
      '    ids_from: { run: "tool | head -1" }\n',
      'items.where.ids_from.run: "|" is shell syntax; ids_from runs its command without a shell'
    ],
    [
      'an expansion in run',
      '    ids_from: { run: "tool $HOME" }\n',
      'items.where.ids_from.run: "$" is never allowed'
    ],
    [
      'a reserved env name',
      '    ids_from: { run: tool, env: { LD_PRELOAD: x } }\n',
      'items.where.ids_from.env: LD_PRELOAD is reserved'
    ],
    [
      'a placeholder in an env value',
      '    ids_from: { run: tool, env: { ID: "{ticket.id}" } }\n',
      "items.where.ids_from.env: ID's value is plain text here: ids_from runs before there is any item"
    ],
    [
      'a field that is not a key name',
      '    ids_from: { run: tool, field: "issue.identifier" }\n',
      'items.where.ids_from.field: expected a key name'
    ],
    [
      'a bad timeout',
      '    ids_from: { run: tool, timeout: soon }\n',
      'items.where.ids_from.timeout: expected a duration like 30s, 10m, 12h or 2d'
    ],
    [
      'an unknown key',
      '    ids_from: { run: tool, shell: true }\n',
      'items.where.ids_from: unknown key "shell"'
    ],
    [
      'neither a command nor a feed',
      '    ids_from: { field: identifier }\n',
      'items.where.ids_from: needs run: (a command printing ids), feed: true (the ids an earlier stage hands over), or both'
    ],
    ['feed: false', '    ids_from: { feed: false, run: tool }\n', 'items.where.ids_from.feed'],
    [
      'a field for a feed alone',
      '    ids_from: { feed: true, field: identifier }\n',
      "items.where.ids_from.field: only with run: (it reads the command's output)"
    ],
    [
      'a feed in an automation that is no stage of a job',
      '    ids_from: { feed: true }\n',
      'items.where.ids_from.feed: only a stage of a job (job:) is fed ids'
    ]
  ])('refuses %s', (_name, where, error) => {
    expect(errorsOf(file(where)).join('\n')).toContain(error)
  })

  it('is a linear_ticket clause only, for now', () => {
    expect(errorsOf(file('    ids_from: { run: tool }\n', 'merge_request'))).toContain(
      'items.where: unknown key "ids_from"'
    )
  })
})
