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

// What M1 produced for 05, plus the v2 fields at their defaults: the same automation.
const CI_05_DEFINITION = {
  id: 'fix-failed-ci',
  file: '/a/fix-failed-ci.yaml',
  name: 'Fix failed CI on my MRs',
  repo: 'web-platform',
  schedule: '10 * * * *',
  timezone: 'America/Los_Angeles',
  enabled: true,
  missedRunGraceMs: 3_600_000,
  items: {
    kind: 'merge_request',
    where: { state: 'open', author: { people: ['nish'] }, head_pipeline: 'failed' },
    match: [],
    customFields: []
  },
  firstSeen: 'process',
  oncePer: '{mr.iid}:{mr.pipeline}',
  retryAfterFailureMs: null,
  checks: [
    { kind: 'worktree_exists' },
    { kind: 'worktree_clean' },
    { kind: 'session_none_open', scope: 'automation' },
    { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
  ],
  limits: { perTick: 3, atOnce: null, timeoutMs: null, order: 'listed' },
  start: 'auto',
  askFirst: null,
  workspace: { kind: 'item_worktree' },
  steps: [
    {
      name: 'step1',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      mode: null,
      prompt: 'Fix failed pipeline {mr.pipeline} on !{mr.iid}.\n',
      promptStyle: 'wrapped',
      args: [],
      session: { kind: 'new' },
      run: null,
      env: {},
      exitCodes: { ok: [0], skip: [], stop: [] },
      when: null,
      always: false,
      timeoutMs: null,
      outputs: [],
      holdHome: false
    }
  ],
  answers: null,
  powers: ['commit', 'push'],
  inbox: '{mr.author}',
  runsOn: null,
  job: null
}

const EVERY_KEY = `
name: Review and fix
repo: web-platform
schedule: "0 3 * * *"
timezone: Europe/London
enabled: false
missed_run_grace: 12h
items:
  kind: worktree
  where: { has_mr: true, mr_author: { not: { people: [emil] } } }
  match: ["{worktree.new_commits} > 0"]
  fields:
    failed_specs: { script: ./fields/failed-specs.sh, cache: per_head, timeout: 2m }
first_seen: baseline
once_per: "{worktree.id}:{worktree.head}"
retry_after_failure: 12h
checks:
  - worktree: idle
  - session: { none_open: any }
  - quota: { agent: codex, weekly: 80 }
  - mr: not_approved
  - window: "02:00-05:59"
  - answers: none_pending
  - field: { expr: "{worktree.new_commits} > 0", reason: No new commits }
  - check: { run: ./scripts/check.sh, timeout: 30s }
limits: { per_tick: 1, at_once: 1, timeout: 60m, order: oldest_waiting_first }
start: ask_first
ask_first: { title: "Review {worktree.branch}?", options: ["Review — run the review now", "Skip — not today"] }
workspace: { new_worktree: { base: origin/dev, name: "memo-{run.date}", reuse_existing: true, setup: run } }
steps:
  - name: review
    agent: codex
    skill: review-branch
    mode: review
    prompt: Review it.
    args: ["--full-auto"]
    session: per_worktree
    timeout: 30m
  - name: fix
    agent: claude
    prompt: "Fix {steps.review.findings}"
    prompt_style: raw
    when: "{steps.review.changed} == true"
  - name: cleanup
    agent: shell
    run: ./scripts/teardown.sh
    env: { WORKTREE: "{worktree.path}" }
    exit_codes: { ok: [0], skip: [3] }
    always: true
answers: { resume: never, else: { agent: claude, skill: review-branch, mode: answers } }
powers: [commit, push]
inbox: nish
runs_on: "  Mac mini "
`

describe('parseAutomationYaml', () => {
  it('normalizes automation 05 to the same definition, with the v2 defaults', () => {
    expect(parseAutomationYaml(CI_05, '/a/fix-failed-ci.yaml')).toEqual({
      ok: true,
      definition: CI_05_DEFINITION
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

  it('normalizes every v2 key', () => {
    expect(parseAutomationYaml(EVERY_KEY, '/a/review.yaml')).toEqual({
      ok: true,
      definition: {
        id: 'review',
        file: '/a/review.yaml',
        name: 'Review and fix',
        repo: 'web-platform',
        schedule: '0 3 * * *',
        timezone: 'Europe/London',
        enabled: false,
        missedRunGraceMs: 43_200_000,
        items: {
          kind: 'worktree',
          where: { has_mr: true, mr_author: { not: { people: ['emil'] } } },
          match: ['{worktree.new_commits} > 0'],
          customFields: [
            {
              name: 'failed_specs',
              script: './fields/failed-specs.sh',
              cache: 'per_head',
              timeoutMs: 120_000
            }
          ]
        },
        firstSeen: 'baseline',
        oncePer: '{worktree.id}:{worktree.head}',
        retryAfterFailureMs: 43_200_000,
        checks: [
          { kind: 'worktree_idle' },
          { kind: 'session_none_open', scope: 'any' },
          { kind: 'quota', agent: 'codex', weekly: 80, session: 95 },
          { kind: 'mr', rule: 'not_approved' },
          { kind: 'window', start: '02:00', end: '05:59' },
          { kind: 'answers_none_pending' },
          { kind: 'field', expr: '{worktree.new_commits} > 0', reason: 'No new commits' },
          { kind: 'script', run: './scripts/check.sh', timeoutMs: 30_000 }
        ],
        limits: { perTick: 1, atOnce: 1, timeoutMs: 3_600_000, order: 'oldest_waiting_first' },
        start: 'ask_first',
        askFirst: {
          title: 'Review {worktree.branch}?',
          context: '',
          options: ['Review — run the review now', 'Skip — not today']
        },
        workspace: {
          kind: 'new_worktree',
          base: 'origin/dev',
          name: 'memo-{run.date}',
          reuseExisting: true,
          setup: 'run'
        },
        steps: [
          {
            name: 'review',
            agent: 'codex',
            skill: 'review-branch',
            mode: 'review',
            prompt: 'Review it.',
            promptStyle: 'wrapped',
            args: ['--full-auto'],
            session: { kind: 'per_worktree' },
            run: null,
            env: {},
            exitCodes: { ok: [0], skip: [], stop: [] },
            when: null,
            always: false,
            timeoutMs: 1_800_000,
            outputs: [],
            holdHome: false
          },
          {
            name: 'fix',
            agent: 'claude',
            skill: null,
            mode: null,
            prompt: 'Fix {steps.review.findings}',
            promptStyle: 'raw',
            args: [],
            session: { kind: 'new' },
            run: null,
            env: {},
            exitCodes: { ok: [0], skip: [], stop: [] },
            when: '{steps.review.changed} == true',
            always: false,
            timeoutMs: null,
            outputs: [],
            holdHome: false
          },
          {
            name: 'cleanup',
            agent: 'shell',
            skill: null,
            mode: null,
            prompt: null,
            promptStyle: 'wrapped',
            args: [],
            session: { kind: 'new' },
            run: './scripts/teardown.sh',
            env: { WORKTREE: '{worktree.path}' },
            exitCodes: { ok: [0], skip: [3], stop: [] },
            when: null,
            always: true,
            timeoutMs: null,
            outputs: [],
            holdHome: false
          }
        ],
        answers: {
          resume: 'never',
          else: { agent: 'claude', skill: 'review-branch', mode: 'answers' }
        },
        powers: ['commit', 'push'],
        inbox: 'nish',
        runsOn: 'Mac mini',
        job: null
      }
    })
  })

  it('defaults new_worktree setup to skip and ask_first options to none', () => {
    const result = parseAutomationYaml(
      'name: Memo\nrepo: web-platform\nschedule: manual\nstart: ask_first\nask_first: { title: Go? }\nworkspace: { new_worktree: { base: origin/dev, name: memo } }\nsteps:\n  - agent: shell\n    run: ./x.sh\n',
      '/a/memo.yaml'
    )
    expect(result.ok && [result.definition.workspace, result.definition.askFirst]).toEqual([
      {
        kind: 'new_worktree',
        base: 'origin/dev',
        name: 'memo',
        reuseExisting: false,
        setup: 'skip'
      },
      { title: 'Go?', context: '', options: [] }
    ])
  })

  it('runs a run-once automation in the main checkout by default', () => {
    const result = parseAutomationYaml(
      'name: Pull dev\nrepo: web-platform\nschedule: "0 6 * * *"\nsteps:\n  - agent: shell\n    run: ./pull.sh\n',
      '/a/pull-dev.yaml'
    )
    expect(result.ok && [result.definition.items, result.definition.workspace]).toEqual([
      null,
      { kind: 'main_checkout' }
    ])
  })

  it.each([
    ['claude', 'steps: [ { agent: claude, prompt: x } ]', 'claude'],
    ['codex', 'steps: [ { agent: codex, prompt: x } ]', 'codex'],
    ['shell', 'steps: [ { agent: shell, run: ./x.sh } ]', 'claude']
  ])('reads a bare quota check for %s steps as that agent’s quota', (_label, steps, agent) => {
    const result = parseAutomationYaml(
      `name: q\nrepo: r\nschedule: manual\nchecks: [ quota ]\n${steps}\n`,
      '/a/q.yaml'
    )
    expect(result.ok && result.definition.checks).toEqual([
      { kind: 'quota', agent, weekly: 90, session: 95 }
    ])
  })

  it.each([
    ['multi-step runs', CI_05.replace('steps:\n', 'steps:\n  - agent: codex\n    prompt: x\n')],
    ['precheck scripts', CI_05.replace('  - worktree: exists\n', '  - check: { run: ./x.sh }\n')],
    [
      'custom fields',
      CI_05.replace(
        '  kind: merge_request\n',
        '  kind: merge_request\n  fields: { a: { script: ./a.sh } }\n'
      )
    ],
    [
      'modes',
      CI_05.replace('    skill: fix-gitlab-ci\n', '    skill: fix-gitlab-ci\n    mode: fix\n')
    ],
    ['answers', `${CI_05}\nanswers: { resume: asking_session }\n`],
    ['answers.stack: never', `${CI_05}\nanswers: { stack: never }\n`],
    ['ask_first', `${CI_05}\nstart: ask_first\nask_first: { title: "Fix !{mr.iid}?" }\n`],
    ['retry_after_failure', `${CI_05}\nretry_after_failure: 12h\n`],
    ['a file without items:', CI_05.replace(/items:\n( {2}.*\n)+/, '')]
  ])('accepts %s, which M1 rejected', (_label, yaml) => {
    const result = parseAutomationYaml(yaml, '/a/ci.yaml')
    expect(result.ok ? [] : result.errors).toEqual([])
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
    expect(result.ok ? '' : result.errors[0]).toMatch(/^\/a\/bad\.yaml: YAML error: /)
  })

  it('rejects a bad cron and a bad time zone', () => {
    const yaml = CI_05.replace('"10 * * * *"', '"61 * * * *"').replace(
      'repo: web-platform',
      'repo: web-platform\ntimezone: Mars/Base'
    )
    expect(parseAutomationYaml(yaml, '/a/ci.yaml')).toEqual({
      ok: false,
      errors: [
        '/a/ci.yaml: schedule: minute: 61 is out of range 0-59',
        '/a/ci.yaml: timezone: "Mars/Base" isn\'t an IANA time zone'
      ]
    })
  })

  it.each([
    ['an empty name', 'runs_on: ""'],
    ['two lines', 'runs_on: "a\\nb"'],
    ['a list', 'runs_on: [a, b]']
  ])('rejects runs_on as %s', (_why, line) =>
    expect(parseAutomationYaml(`${MINIMAL}${line}\n${STEP}`, '/a/ci.yaml')).toEqual({
      ok: false,
      errors: ['/a/ci.yaml: runs_on: expected a machine name (one line, at most 255 characters)']
    })
  )

  it('accepts manual schedules', () => {
    expect(parseAutomationYaml(CI_05.replace('"10 * * * *"', 'manual'), '/a/ci.yaml').ok).toBe(true)
  })

  const MINIMAL = 'name: n\nrepo: r\nschedule: manual\n'
  const STEP = 'steps:\n  - agent: claude\n    prompt: x\n'
  it.each([
    [
      'items',
      `${MINIMAL}items:\n  kind: merge_request\n  bogus: 1\n${STEP}`,
      'items: unknown key "bogus"'
    ],
    [
      'items.where',
      `${MINIMAL}items:\n  kind: merge_request\n  where: { bogus: 1 }\n${STEP}`,
      'items.where: unknown key "bogus"'
    ],
    [
      'a step',
      `${MINIMAL}steps:\n  - agent: claude\n    prompt: x\n    bogus: 1\n`,
      'steps.0: unknown key "bogus"'
    ],
    [
      'the author ref',
      `${MINIMAL}items:\n  kind: merge_request\n  where:\n    author: { people: [nish], bogus: 1 }\n${STEP}`,
      'items.where.author: unknown key "bogus"'
    ],
    [
      'a check object',
      `${MINIMAL}checks:\n  - worktree: exists\n    bogus: 1\n${STEP}`,
      'checks.0: unknown key "bogus"'
    ],
    [
      'quota',
      `${MINIMAL}checks:\n  - quota: { weekly: 90, bogus: 1 }\n${STEP}`,
      'checks.0.quota: unknown key "bogus"'
    ],
    [
      "M1's shell: key on a step",
      CI_05.replace('    skill: fix-gitlab-ci\n', '    skill: fix-gitlab-ci\n    shell: ./x.sh\n'),
      'steps.0: unknown key "shell"'
    ]
  ])('rejects an unknown key inside %s and names it', (_level, yaml, message) => {
    expect(parseAutomationYaml(yaml, '/a/ci.yaml')).toEqual({
      ok: false,
      errors: [`/a/ci.yaml: ${message}`]
    })
  })

  it.each([
    [
      'a step with no skill or prompt',
      CI_05.replace(/steps:[\s\S]*?\npowers/, 'steps:\n  - agent: claude\npowers'),
      'step 1 needs a skill or a prompt'
    ],
    [
      'a weekly quota over 100',
      CI_05.replace('weekly: 90%', 'weekly: 150%'),
      'checks[3].quota.weekly: 150 is out of range 0-100'
    ],
    [
      'a negative session quota',
      CI_05.replace('session: 95%', 'session: -5'),
      'checks[3].quota.session: -5 is out of range 0-100'
    ],
    [
      'a once_per with no placeholder',
      CI_05.replace('"{mr.iid}:{mr.pipeline}"', '"daily"'),
      'once_per: no {field} placeholder (write {mr.iid}, without spaces)'
    ],
    [
      'a once_per with one valid and one spaced placeholder',
      CI_05.replace('"{mr.iid}:{mr.pipeline}"', '"{mr.iid}:{ mr.pipeline }"'),
      'once_per: no {field} placeholder (write {mr.iid}, without spaces)'
    ],
    [
      'a once_per with spaces in braces',
      CI_05.replace('"{mr.iid}:{mr.pipeline}"', '"{ mr.iid }"'),
      'once_per: no {field} placeholder (write {mr.iid}, without spaces)'
    ]
  ])('rejects %s', (_label, yaml, message) => {
    expect(parseAutomationYaml(yaml, '/a/ci.yaml')).toEqual({
      ok: false,
      errors: [`/a/ci.yaml: ${message}`]
    })
  })

  it('accepts quota bounds 0 and 100', () => {
    const yaml = CI_05.replace('weekly: 90%', 'weekly: 0').replace('session: 95%', 'session: 100%')
    expect(parseAutomationYaml(yaml, '/a/ci.yaml').ok).toBe(true)
  })
})
