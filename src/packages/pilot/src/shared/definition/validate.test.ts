import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from './parse'

const BASE = 'name: n\nrepo: r\nschedule: manual\n'
const STEP = 'steps:\n  - { agent: claude, prompt: x }\n'
const MR = 'items:\n  kind: merge_request\n'

function errorsOf(yaml: string): string[] {
  const result = parseAutomationYaml(yaml, '/a/n.yaml')
  return result.ok ? [] : result.errors.map((e) => e.replace('/a/n.yaml: ', ''))
}

describe('definition validation', () => {
  it.each([
    [
      'a shell step without run',
      `${BASE}steps:\n  - { agent: shell }\n`,
      'step 1: a shell step needs run:'
    ],
    [
      'a shell step with agent keys',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, skill: s, prompt: hi }\n`,
      "step 1: shell steps don't take skill:, prompt:"
    ],
    [
      'an agent step with shell keys',
      `${BASE}steps:\n  - { agent: claude, prompt: hi, run: ./x.sh, exit_codes: { ok: [0] } }\n`,
      'step 1: only shell steps use run:, exit_codes:'
    ],
    [
      'an agent step with neither skill nor prompt',
      `${BASE}steps:\n  - { agent: codex }\n`,
      'step 1 needs a skill or a prompt'
    ],
    [
      'a mode without a skill',
      `${BASE}steps:\n  - { agent: claude, prompt: hi, mode: fix }\n`,
      'step 1: mode: needs a skill'
    ],
    [
      'a raw prompt style without a prompt',
      `${BASE}steps:\n  - { agent: claude, skill: s, prompt_style: raw }\n`,
      'step 1: prompt_style: raw needs a prompt'
    ],
    [
      'an exit code that is both ok and skip',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, exit_codes: { ok: [0, 3], skip: [3] } }\n`,
      'step 1: exit code 3 is both ok and skip'
    ],
    [
      'a session that continues a later step',
      `${BASE}steps:\n  - { name: a, agent: claude, prompt: x, session: { continue: b } }\n  - { name: b, agent: claude, prompt: y }\n`,
      'step 1: session.continue: "b" isn\'t an earlier step'
    ],
    [
      'a session that continues another agent',
      `${BASE}steps:\n  - { name: a, agent: codex, prompt: x }\n  - { name: b, agent: claude, prompt: y, session: { continue: a } }\n`,
      'step 2: session.continue: "a" ran codex; only a codex step can continue it'
    ],
    [
      'two steps with one name',
      `${BASE}steps:\n  - { name: a, agent: claude, prompt: x }\n  - { name: a, agent: shell, run: ./x.sh }\n`,
      'steps: more than one step is named "a"'
    ],
    [
      'a default name a named step took',
      `${BASE}steps:\n  - { name: step2, agent: claude, prompt: x }\n  - { agent: claude, prompt: y }\n`,
      'steps: more than one step is named "step2"'
    ],
    [
      'item_worktree without items',
      `${BASE}workspace: item_worktree\n${STEP}`,
      'workspace: item_worktree needs items: (a run-once automation uses main_checkout or new_worktree)'
    ],
    [
      'baseline without items',
      `${BASE}first_seen: baseline\n${STEP}`,
      'first_seen: baseline needs items:'
    ],
    [
      'a retry with nothing to retry',
      `${BASE}retry_after_failure: 1h\n${STEP}`,
      'retry_after_failure: a run-once automation without once_per: runs every tick, so it has nothing to retry'
    ],
    [
      'ask_first with no card',
      `${BASE}start: ask_first\n${STEP}`,
      'ask_first: start: ask_first needs ask_first: { title: … }'
    ],
    [
      'a card without start: ask_first',
      `${BASE}ask_first: { title: t }\n${STEP}`,
      'ask_first: only used with start: ask_first'
    ],
    [
      'a window ending at a time that does not exist',
      `${BASE}checks:\n  - window: "22:00-24:30"\n${STEP}`,
      'checks[0].window: "24:30" isn\'t a time between 00:00 and 23:59'
    ],
    [
      'an empty window',
      `${BASE}checks:\n  - window: "02:00-02:00"\n${STEP}`,
      'checks[0].window: starts and ends at the same time'
    ],
    [
      'a custom field name with a dash',
      `${BASE}${MR}  fields: { failed-specs: { script: ./x.sh } }\n${STEP}`,
      'items.fields: "failed-specs" isn\'t a field name (lower-case letters, digits and _, starting with a letter or _)'
    ],
    [
      'an answers mode without a skill',
      `${BASE}answers: { else: { agent: claude, mode: answers } }\n${STEP}`,
      'answers.else: mode: needs a skill'
    ]
  ])('rejects %s', (_label, yaml, message) => {
    expect(errorsOf(yaml)).toEqual([message])
  })

  it.each([
    [
      'a duration without a unit',
      `${BASE}missed_run_grace: 12 hours\n${STEP}`,
      'missed_run_grace: expected a duration like 30s, 10m, 12h or 2d'
    ],
    [
      'an unknown power',
      `${BASE}powers: [deploy]\n${STEP}`,
      'powers.0: Invalid option: expected one of "commit"|"push"|"post"|"reply"|"mark_ready"|"create_ticket"|"update_ticket"|"remove_worktree"|"close_session"'
    ],
    [
      'a check value that does not exist',
      `${BASE}checks: [ { worktree: dirty } ]\n${STEP}`,
      'checks.0.worktree: Invalid option: expected one of "exists"|"clean"|"idle"'
    ],
    [
      'a check Pilot does not know',
      `${BASE}checks: [ { worktre: exists } ]\n${STEP}`,
      'checks.0: not a check Pilot knows (worktree, session, quota, mr, window, answers, field or check)'
    ],
    [
      'a people ref that is a bare name',
      `${BASE}${MR}  where: { author: nish }\n${STEP}`,
      'items.where.author: expected anyone, { people: [...] }, { group: <id> } or { not: { people: [...] } }'
    ],
    [
      'an unknown key inside a not ref',
      `${BASE}${MR}  where: { author: { not: { people: [nish], bogus: 1 } } }\n${STEP}`,
      'items.where.author.not: unknown key "bogus"'
    ],
    [
      'a where clause of another kind',
      `${BASE}items:\n  kind: worktree\n  where: { author: anyone }\n${STEP}`,
      'items.where: unknown key "author"'
    ],
    [
      'a pipeline without its ref',
      `${BASE}items:\n  kind: pipeline\n${STEP}`,
      'items.where.ref: Invalid input: expected string, received undefined'
    ],
    [
      'a step name a placeholder cannot read',
      `${BASE}steps:\n  - { name: re-view, agent: claude, prompt: x }\n`,
      'steps.0.name: re-view must use only letters, digits and _ so {steps.<name>.…} can name it'
    ],
    [
      'an unknown item kind',
      `${BASE}items: { kind: issue }\n${STEP}`,
      'items.kind: Invalid option: expected one of "merge_request"|"worktree"|"pipeline"|"linear_ticket"'
    ],
    [
      'a session that is none of the three',
      `${BASE}steps:\n  - { agent: claude, prompt: x, session: forever }\n`,
      'steps.0.session: expected new, per_worktree or { continue: <step name> }'
    ]
  ])('explains %s in plain words', (_label, yaml, message) => {
    expect(errorsOf(yaml)).toEqual([message])
  })
})
