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
      'a shell placeholder in run:',
      `${BASE}steps:\n  - { agent: shell, run: "echo {mr.title} # hi" }\n`,
      `step 1: run can't contain {placeholders}; pass values with env: { NAME: '{mr.title}' } and use "$NAME" in the script`
    ],
    [
      'a script path with a placeholder',
      `${BASE}steps:\n  - { agent: shell, run: "./tools/{mr.iid}.sh" }\n`,
      `step 1: run can't contain {placeholders}; pass values with env: { NAME: '{mr.title}' } and use "$NAME" in the script`
    ],
    [
      'a lowercase env name',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, env: { title: "{mr.title}" } }\n`,
      "step 1: env: title isn't a usable name: capital letters, digits and _, not starting with a digit"
    ],
    ...[
      'PILOT_X',
      'ORCA_X',
      'PATH',
      'IFS',
      'HOME',
      'ENV',
      'BASH_ENV',
      'SHELLOPTS',
      'BASHOPTS',
      'PS4',
      'CDPATH',
      'GLOBIGNORE',
      'AGENT_RUN',
      'LD_PRELOAD',
      'DYLD_INSERT_LIBRARIES'
    ].map((name) => [
      `a reserved env name ${name}`,
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, env: { ${name}: a } }\n`,
      `step 1: env: ${name} is reserved: not PATH, IFS, HOME, ENV, BASH_ENV, SHELLOPTS, BASHOPTS, PS4, CDPATH, GLOBIGNORE, AGENT_RUN, or a name starting PILOT_, ORCA_, LD_ or DYLD_`
    ]),
    [
      'an env value naming a later step',
      `${BASE}steps:\n  - { name: a, agent: shell, run: ./x.sh, env: { X: "{steps.b.out}" } }\n  - { name: b, agent: shell, run: ./y.sh }\n`,
      "steps[0].env.X: {steps.b.out} doesn't name an earlier step"
    ],
    [
      'env on an agent step',
      `${BASE}steps:\n  - { agent: claude, prompt: hi, env: { A: b } }\n`,
      'step 1: only shell steps use env:'
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
      'wait: start on a shell step',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, wait: start }\n`,
      'step 1: wait: start is for an agent step: a shell step ends when its command exits'
    ],
    [
      'wait: start in a job that works in an env',
      `${BASE}${MR}workspace: { env: { worktree: "{worktree.path}", writes: true } }\nsteps:\n  - { agent: claude, prompt: x, wait: start }\n`,
      'step 1: wait: start needs a workspace that outlives its run: an env is deleted when its run ends'
    ],
    [
      'an exit code that is both ok and skip',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, exit_codes: { ok: [0, 3], skip: [3] } }\n`,
      'step 1: exit code 3 is both ok and skip'
    ],
    [
      'a stop code that is also ok',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, exit_codes: { stop: [0] } }\n`,
      'step 1: exit code 0 is both ok and stop'
    ],
    [
      'a stop code that is also skip',
      `${BASE}steps:\n  - { agent: shell, run: ./x.sh, exit_codes: { skip: [3], stop: [3] } }\n`,
      'step 1: exit code 3 is both skip and stop'
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
      'an ask-first job that never gives up',
      `${BASE}start: ask_first\nask_first: { title: t }\ngive_up: never\n${STEP}`,
      'give_up: never: an ask-first job is never retried on its own'
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

  it('normalizes exit_codes with stop beside ok and skip, and stop [] by default', () => {
    const parsed = parseAutomationYaml(
      `${BASE}steps:\n  - { name: context, agent: shell, run: ./x.sh, exit_codes: { skip: [4], stop: [3] } }\n  - { name: tidy, agent: shell, run: ./y.sh }\n`,
      '/a/n.yaml'
    )
    expect(parsed.ok && parsed.definition.steps.map((s) => s.exitCodes)).toEqual([
      { ok: [0], skip: [4], stop: [3] },
      { ok: [0], skip: [], stop: [] }
    ])
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
      'items.kind: Invalid option: expected one of "merge_request"|"worktree"|"pipeline"|"linear_ticket"|"inbox_preparation"|"kept_branch"'
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

describe('a shell run: with no Pilot placeholder', () => {
  it('is accepted whatever shell syntax it holds', () => {
    const run = 'awk \'{print}\' f | jq \'{title}\' # "c"; echo "${HOME}" <<EOF\n$(date)\nEOF'
    const yaml = `${BASE}steps:\n  - { agent: shell, run: ${JSON.stringify(run)} }\n`
    expect(errorsOf(yaml)).toEqual([])
  })
})
