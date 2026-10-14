import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from './parse'

const BASE = 'name: n\nrepo: r\nschedule: manual\nsteps:\n  - { agent: claude, prompt: x }\n'
const MR = 'items: { kind: merge_request }\n'
const TICKET = 'items: { kind: linear_ticket }\n'
const PIPELINE = 'items: { kind: pipeline, where: { ref: dev } }\n'
const ws = (env: string) => `workspace: { env: { ${env} } }\n`

function errorsOf(yaml: string): string[] {
  const result = parseAutomationYaml(yaml, '/a/n.yaml')
  return result.ok ? [] : result.errors.map((e) => e.replace('/a/n.yaml: ', ''))
}

function workspaceOf(yaml: string) {
  const result = parseAutomationYaml(yaml, '/a/n.yaml')
  if (!result.ok) {
    throw new Error(result.errors.join('\n'))
  }
  return result.definition.workspace
}

describe('workspace: { env } refuses', () => {
  it.each([
    [
      'no subject',
      `${BASE}${MR}${ws('writes: true')}`,
      'workspace.env: name one subject: worktree, branch (with at) or new_branch (with from)'
    ],
    [
      'two subjects',
      `${BASE}${MR}${ws('worktree: "{worktree.path}", branch: "{mr.branch}", at: "{mr.head_sha}"')}`,
      'workspace.env: worktree, branch are alternatives; name one'
    ],
    [
      'branch without at',
      `${BASE}${MR}${ws('branch: "{mr.branch}"')}`,
      'workspace.env.branch needs at: the commit to check out'
    ],
    [
      'new_branch without from',
      `${BASE}${TICKET}${ws('new_branch: "{ticket.branch}"')}`,
      'workspace.env.new_branch needs from: the ref it starts from'
    ],
    [
      'at with new_branch',
      `${BASE}${TICKET}${ws('new_branch: "{ticket.branch}", from: origin/dev, at: abc')}`,
      'workspace.env.at: only with worktree or branch'
    ],
    [
      'from without new_branch',
      `${BASE}${MR}${ws('worktree: "{worktree.path}", from: origin/dev')}`,
      'workspace.env.from: only with new_branch'
    ],
    [
      'keep without new_branch',
      `${BASE}${MR}${ws('worktree: "{worktree.path}", keep: true')}`,
      'workspace.env.keep: only with new_branch'
    ],
    [
      'a field pipelines lack',
      `${BASE}${PIPELINE}${ws('worktree: "{worktree.path}"')}`,
      "workspace.env.worktree: {worktree.path} isn't a field of pipeline items (they have pipeline.*, repo.*, run.*)"
    ],
    [
      'mr fields on tickets',
      `${BASE}${TICKET}${ws('branch: "{mr.branch}", at: "{mr.head_sha}"')}`,
      "workspace.env.branch: {mr.branch} isn't a field of linear_ticket items (they have ticket.*, worktree.*, repo.*, run.*)"
    ],
    [
      'the head 14 names',
      `${BASE}items: { kind: inbox_preparation }\n${ws('worktree: "{worktree.path}", at: "{card.head}"')}`,
      "workspace.env.at: {card.head} isn't a field of inbox_preparation items (they have preparation.*, worktree.*, repo.*, run.*)"
    ],
    [
      'a step output',
      `${BASE}${MR}${ws('worktree: "{steps.a.path}"')}`,
      "workspace.env.worktree: {steps.a.path} isn't known before a run starts"
    ],
    [
      'a spaced placeholder',
      `${BASE}${MR}${ws('worktree: "{ worktree.path }"')}`,
      'workspace.env.worktree: write placeholders without spaces, like {worktree.path}'
    ]
  ])('%s', (_name, yaml, error) => {
    expect(errorsOf(yaml)).toContain(error)
  })

  it.each([
    [
      'an unknown key',
      ws('worktree: "{worktree.path}", wait_orca: true'),
      'workspace.env: unknown key "wait_orca"'
    ]
  ])('%s', (_name, env, error) => {
    expect(errorsOf(`${BASE}${MR}${env}`).some((e) => e.startsWith(error))).toBe(true)
  })
})

describe('workspace.env.stack at load: a literal, or one {field} the kind can have', () => {
  const WITH_FIELD = 'items:\n  kind: merge_request\n  fields:\n    stack: { script: ./stack.sh }\n'
  const NOT_A_STACK = (value: string) =>
    `workspace.env.stack: "${value}" isn't never, backend, full or when_backend, or a single {field} holding one`
  it.each([
    ['a literal', 'stack: backend', []],
    ['a placeholder naming a custom field', 'stack: "{mr.stack}"', []],
    ['a literal that is no stack', 'stack: huge', [NOT_A_STACK('huge')]],
    ["the flag's spelling as a literal", 'stack: when-backend', [NOT_A_STACK('when-backend')]],
    [
      'an unknown field: one the kind can’t have',
      'stack: "{ticket.stack}"',
      [
        "workspace.env.stack: {ticket.stack} isn't a field of merge_request items (they have mr.*, worktree.*, repo.*, run.*)"
      ]
    ],
    [
      'an unknown field: no prefix',
      'stack: "{stack}"',
      [
        "workspace.env.stack: {stack} isn't a field of merge_request items (they have mr.*, worktree.*, repo.*, run.*)"
      ]
    ],
    ['more than one placeholder', 'stack: "{mr.a}{mr.b}"', [NOT_A_STACK('{mr.a}{mr.b}')]],
    ['text around a placeholder', 'stack: "x-{mr.stack}"', [NOT_A_STACK('x-{mr.stack}')]],
    [
      'a step output',
      'stack: "{steps.a.stack}"',
      ["workspace.env.stack: {steps.a.stack} isn't known before a run starts"]
    ]
  ])('%s', (_name, stack, errors) => {
    expect(errorsOf(`${BASE}${WITH_FIELD}${ws(`worktree: "{worktree.path}", ${stack}`)}`)).toEqual(
      errors
    )
  })

  it('reads a placeholder as the field it names', () => {
    expect(
      workspaceOf(`${BASE}${WITH_FIELD}${ws('worktree: "{worktree.path}", stack: "{mr.stack}"')}`)
    ).toMatchObject({ stack: { field: 'mr.stack' } })
  })
})

describe('workspace: { env } reads', () => {
  it.each([
    [
      'the item worktree',
      `${MR}${ws('worktree: "{worktree.path}", writes: true, stack: when_backend')}`,
      {
        kind: 'env',
        subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
        writes: true,
        stack: 'when_backend'
      }
    ],
    [
      'a worktree at a commit',
      `${MR}${ws('worktree: "{worktree.path}", at: "{mr.head_sha}"')}`,
      {
        kind: 'env',
        subject: { kind: 'worktree', worktree: '{worktree.path}', at: '{mr.head_sha}' },
        writes: false,
        stack: 'never'
      }
    ],
    [
      'a teammate branch',
      `${MR}${ws('branch: "{mr.branch}", at: "{mr.head_sha}"')}`,
      {
        kind: 'env',
        subject: { kind: 'branch', branch: '{mr.branch}', at: '{mr.head_sha}' },
        writes: false,
        stack: 'never'
      }
    ],
    [
      'a kept new branch',
      `${TICKET}${ws('new_branch: "{ticket.branch}", from: origin/dev, keep: true, stack: full')}`,
      {
        kind: 'env',
        subject: {
          kind: 'new_branch',
          newBranch: '{ticket.branch}',
          from: 'origin/dev',
          keep: true
        },
        writes: false,
        stack: 'full'
      }
    ],
    [
      'a run-once new branch',
      ws('new_branch: "memo-{run.id}", from: origin/dev, keep: true'),
      {
        kind: 'env',
        subject: { kind: 'new_branch', newBranch: 'memo-{run.id}', from: 'origin/dev', keep: true },
        writes: false,
        stack: 'never'
      }
    ],
    [
      "14 at its card's head",
      `items: { kind: inbox_preparation }\n${ws('worktree: "{worktree.path}", at: "{preparation.head}", stack: when_backend')}`,
      {
        kind: 'env',
        subject: { kind: 'worktree', worktree: '{worktree.path}', at: '{preparation.head}' },
        writes: false,
        stack: 'when_backend'
      }
    ]
  ])('%s', (_name, yaml, expected) => {
    expect(workspaceOf(`${BASE}${yaml}`)).toEqual(expected)
  })
})

describe('hold_home', () => {
  const HEAD = 'name: n\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\n'
  const ENV = ws('worktree: "{worktree.path}", writes: true')
  it.each([
    [
      'a shell step of an env run',
      `${HEAD}${ENV}steps:\n  - { name: merge_back, agent: shell, run: ./merge-back.sh, hold_home: true }\n`,
      []
    ],
    [
      'an agent step',
      `${HEAD}${ENV}steps:\n  - { agent: claude, prompt: x, hold_home: true }\n`,
      ['step 1: only shell steps use hold_home:']
    ],
    [
      'a step of an item_worktree run',
      `${HEAD}steps:\n  - { agent: shell, run: ./merge-back.sh, hold_home: true }\n`,
      [
        'step 1: hold_home: only with workspace: { env } (other workspaces hold their worktree for the whole run)'
      ]
    ]
  ])('%s', (_name, yaml, errors) => {
    expect(errorsOf(yaml)).toEqual(errors)
  })

  it('reads it onto the step', () => {
    const parsed = parseAutomationYaml(
      `${HEAD}${ENV}steps:\n  - { agent: shell, run: ./m.sh, hold_home: true }\n  - { agent: shell, run: ./n.sh }\n`,
      '/a/n.yaml'
    )
    expect(parsed.ok && parsed.definition.steps.map((s) => s.holdHome)).toEqual([true, false])
  })
})
