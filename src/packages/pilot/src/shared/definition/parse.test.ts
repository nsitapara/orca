import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from './parse'

const CI_05 = `
name: Fix failed CI on my MRs
repo: web-platform
schedule: "10 * * * *"
items:
  kind: merge_request
  where:
    state: open
    author: { people: [nish] }
    head_pipeline: failed
once_per: "{mr.iid}:{mr.pipeline}"
checks:
  - worktree: exists
  - worktree: clean
  - session: none_open
  - quota: { weekly: 90%, session: 95% }
limits: { per_tick: 3 }
steps:
  - agent: claude
    skill: fix-gitlab-ci
    prompt: |
      Fix failed pipeline {mr.pipeline} on !{mr.iid}.
powers: [commit, push]
inbox: "{mr.author}"
`

describe('parseAutomationYaml', () => {
  it('normalizes automation 05', () => {
    const result = parseAutomationYaml(CI_05, '/a/fix-failed-ci.yaml')
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.definition).toEqual({
      id: 'fix-failed-ci',
      file: '/a/fix-failed-ci.yaml',
      name: 'Fix failed CI on my MRs',
      repo: 'web-platform',
      schedule: '10 * * * *',
      timezone: 'America/Los_Angeles',
      enabled: true,
      items: {
        kind: 'merge_request',
        where: { state: 'open', author: { people: ['nish'] }, head_pipeline: 'failed' }
      },
      firstSeen: 'process',
      oncePer: '{mr.iid}:{mr.pipeline}',
      checks: [
        { kind: 'worktree_exists' },
        { kind: 'worktree_clean' },
        { kind: 'session_none_open' },
        { kind: 'quota', weekly: 90, session: 95 }
      ],
      limits: { perTick: 3, atOnce: null },
      steps: [
        {
          name: 'step1',
          agent: 'claude',
          skill: 'fix-gitlab-ci',
          mode: null,
          prompt: 'Fix failed pipeline {mr.pipeline} on !{mr.iid}.\n'
        }
      ],
      powers: ['commit', 'push'],
      inbox: '{mr.author}'
    })
  })

  it.each([
    ['a flat file name', '/a/fix-failed-ci.yaml', 'fix-failed-ci'],
    ['a .yml file name', '/a/fix-failed-ci.yml', 'fix-failed-ci'],
    ['a nested path', 'some/dir/fix-failed-ci.yml', 'fix-failed-ci']
  ])('derives the id from %s', (_label, file, id) => {
    const result = parseAutomationYaml(CI_05, file)
    expect(result.ok && result.definition.id).toBe(id)
  })

  it('rejects a misspelled key and names it and the file (Review Focus 1)', () => {
    const result = parseAutomationYaml(CI_05.replace('per_tick', 'per_tic'), '/a/ci.yaml')
    expect(result).toEqual({ ok: false, errors: ['/a/ci.yaml: limits: unknown key "per_tic"'] })
  })

  it('rejects an unknown top-level key', () => {
    const result = parseAutomationYaml(`${CI_05}\nonceper: x\n`, '/a/ci.yaml')
    expect(result).toEqual({ ok: false, errors: ['/a/ci.yaml: unknown key "onceper"'] })
  })

  it('reports YAML syntax errors with the file', () => {
    const result = parseAutomationYaml('name: [unclosed', '/a/bad.yaml')
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.errors[0]).toMatch(/^\/a\/bad\.yaml: YAML error: /)
  })

  it.each([
    [
      'multi-step runs',
      CI_05.replace('steps:\n', 'steps:\n  - agent: codex\n    prompt: x\n'),
      'steps: multi-step runs arrive in M3'
    ],
    [
      'precheck scripts',
      CI_05.replace('  - worktree: exists\n', '  - check: ./x.sh\n'),
      'checks: precheck scripts (check:) arrive in M3'
    ],
    [
      'custom fields',
      CI_05.replace('  kind: merge_request\n', '  kind: merge_request\n  fields: { a: ./a.sh }\n'),
      'items.fields: custom fields arrive in M4'
    ],
    [
      'other item kinds',
      CI_05.replace('kind: merge_request', 'kind: worktree'),
      'items.kind: "worktree" arrives in M3 (M1 supports merge_request)'
    ],
    [
      'modes',
      CI_05.replace('    skill: fix-gitlab-ci\n', '    skill: fix-gitlab-ci\n    mode: fix\n'),
      'steps[0].mode: skill modes arrive in M3'
    ],
    [
      'answers',
      `${CI_05}\nanswers: { resume: asking_session }\n`,
      'answers: answer routing arrives in M2'
    ]
  ])('rejects %s with the milestone that brings them', (_label, yaml, message) => {
    expect(parseAutomationYaml(yaml, '/a/ci.yaml')).toEqual({
      ok: false,
      errors: [`/a/ci.yaml: ${message}`]
    })
  })
})
