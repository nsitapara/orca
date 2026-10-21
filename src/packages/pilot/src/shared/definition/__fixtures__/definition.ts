import type { AutomationDefinition, StepDef } from '../types'

export function testStep(over: Partial<StepDef> = {}): StepDef {
  return {
    name: 'step1',
    agent: 'claude',
    skill: null,
    mode: null,
    prompt: 'Do it',
    promptStyle: 'wrapped',
    wait: 'finish',
    args: [],
    session: { kind: 'new' },
    run: null,
    env: {},
    exitCodes: { ok: [0], skip: [], stop: [] },
    when: null,
    always: false,
    timeoutMs: null,
    outputs: [],
    ...over
  }
}

export function testDefinition(over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    id: 'auto',
    file: '/auto/auto.yaml',
    name: 'Auto',
    repo: 'web-platform',
    schedule: 'manual',
    timezone: 'America/Los_Angeles',
    enabled: true,
    missedRunGraceMs: 60 * 60_000,
    items: { kind: 'merge_request', where: {}, match: [], customFields: [] },
    firstSeen: 'process',
    oncePer: null,
    retryAfterFailureMs: null,
    giveUp: 'after_retries',
    checks: [],
    limits: { perTick: null, atOnce: null, timeoutMs: null, order: 'listed' },
    start: 'auto',
    askFirst: null,
    workspace: { kind: 'item_worktree' },
    steps: [testStep()],
    answers: null,
    powers: [],
    inbox: '{mr.author}',
    runsOn: null,
    job: null,
    ...over
  }
}
