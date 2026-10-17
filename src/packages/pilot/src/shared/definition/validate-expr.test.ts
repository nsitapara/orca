import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from './parse'

const BASE = 'name: n\nrepo: r\nschedule: manual\n'
const TWO = (review: string, fix: string): string =>
  `${BASE}steps:\n  - { name: review, agent: claude, ${review} }\n  - { name: fix, agent: claude, ${fix} }\n`

function errorsOf(yaml: string): string[] {
  const result = parseAutomationYaml(yaml, '/a/n.yaml')
  return result.ok ? [] : result.errors.map((e) => e.replace('/a/n.yaml: ', ''))
}

describe('expression and step-reference validation', () => {
  it.each([
    [
      'an items.match that does not parse',
      `${BASE}items:\n  kind: merge_request\n  match: ["{mr.iid} >"]\nsteps: [ { agent: claude, prompt: x } ]\n`,
      ['items.match[0]: expected a value at the end']
    ],
    [
      'a field check that reads a step',
      `${BASE}checks:\n  - field: { expr: "{steps.review.found} > 0", reason: r }\nsteps: [ { name: review, agent: claude, prompt: x } ]\n`,
      ["checks[0].field.expr: {steps.review.found} isn't known before a run starts"]
    ],
    [
      'a when that names a misspelt step (Review Focus)',
      TWO('prompt: x', 'prompt: y, when: "{steps.reveiw.changed} == true"'),
      ["steps[1].when: {steps.reveiw.changed} doesn't name an earlier step"]
    ],
    [
      'a when that names a later step',
      TWO('prompt: x, when: "{steps.fix.done}"', 'prompt: y'),
      ["steps[0].when: {steps.fix.done} doesn't name an earlier step"]
    ],
    [
      'a when that reads its own step',
      TWO('prompt: x', 'prompt: y, when: "{steps.fix.done}"'),
      ["steps[1].when: {steps.fix.done} doesn't name an earlier step"]
    ],
    [
      'a when that does not parse',
      TWO('prompt: x', 'prompt: y, when: "{steps.review.changed} = true"'),
      ['steps[1].when: unexpected "=" at 24']
    ],
    [
      'previous in the first step',
      TWO('prompt: "Go {previous.found}"', 'prompt: y'),
      ['steps[0].prompt: {previous.found} has no previous step in the first step']
    ],
    [
      'previous without an output',
      TWO('prompt: x', 'prompt: "{previous}"'),
      ['steps[1].prompt: {previous} needs an output name, like {previous.changed}']
    ],
    [
      'a step without an output',
      TWO('prompt: x', 'prompt: "Fix {steps.review}"'),
      ['steps[1].prompt: {steps.review} needs a step and an output, like {steps.review.changed}']
    ],
    [
      'a once_per that reads a step',
      `${BASE}once_per: "{steps.review.x}"\nsteps: [ { name: review, agent: claude, prompt: x } ]\n`,
      ["once_per: {steps.review.x} isn't known before a run starts"]
    ],
    [
      'a shell run that reads a later step',
      `${BASE}steps:\n  - { name: a, agent: shell, run: ./x.sh, env: { X: "{steps.b.found}" } }\n  - { name: b, agent: claude, prompt: y }\n`,
      ["steps[0].env.X: {steps.b.found} doesn't name an earlier step"]
    ],
    [
      'an optional env placeholder on a later step',
      `${BASE}steps:\n  - { name: a, agent: shell, run: ./x.sh, env: { X: "{steps.b.found?}" } }\n  - { name: b, agent: claude, prompt: y }\n`,
      ["steps[0].env.X: {steps.b.found} doesn't name an earlier step"]
    ],
    [
      'an optional env placeholder on an earlier step',
      `${BASE}steps:\n  - { name: a, agent: claude, prompt: y }\n  - { name: b, agent: shell, run: ./x.sh, env: { X: "{steps.a.outcome?}" } }\n`,
      []
    ],
    [
      'a when, a prompt and a run that read earlier steps',
      `${BASE}steps:\n  - { name: review, agent: claude, prompt: x }\n  - { name: fix, agent: claude, prompt: "Fix {steps.review.findings}", when: "{previous.changed} == true and {steps.review.exit_code} == null" }\n  - { agent: shell, run: ./notify.sh, env: { S: "{steps.fix.status} {run.id}" } }\n`,
      []
    ]
  ])('%s', (_label, yaml, errors) => {
    expect(errorsOf(yaml)).toEqual(errors)
  })
})
