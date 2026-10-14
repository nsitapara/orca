import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationSummary
} from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'

export const summary: AutomationSummary = {
  id: 'fix-ci',
  name: 'Fix failed CI',
  file: '/a/fix-ci.yaml',
  enabled: true,
  schedule: 'manual',
  timezone: 'America/Los_Angeles',
  itemKind: 'merge_request',
  agent: 'claude',
  powers: [],
  inbox: '{mr.author}',
  nextTickAt: null,
  lastTick: null,
  job: null
}

export const detail: AutomationDetailPayload = {
  summary,
  yaml: 'name: Fix failed CI\nschedule: manual\n',
  checkNames: ['Clean'],
  steps: [
    {
      name: 'fix',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      mode: 'fix',
      prompt: 'Fix it.',
      promptStyle: 'wrapped',
      args: [],
      session: { kind: 'new' },
      env: {},
      run: null,
      exitCodes: { ok: [0], skip: [], stop: [] },
      when: null,
      always: false,
      timeoutMs: null,
      outputs: []
    } satisfies StepDef
  ]
}

export const failedRunTick: ActivityTick = {
  id: 9,
  automationId: 'fix-ci',
  startedAt: Date.UTC(2026, 9, 10, 19, 10),
  finishedAt: Date.UTC(2026, 9, 10, 19, 11),
  status: 'ok',
  error: null,
  counts: { started: 1 },
  items: [],
  runs: [
    {
      id: 'fix-ci-3',
      automationId: 'fix-ci',
      tickId: 9,
      itemKey: '!1',
      itemLabel: '!1 web-1',
      worktreePath: null,
      status: 'failed',
      outcome: "Couldn't start: no such repo",
      startedAt: 1,
      finishedAt: 2,
      costUsd: null,
      tokens: null,
      worktreeId: null,
      trigger: 'schedule' as const,
      parentRunId: null,
      imported: false,
      steps: [],
      inbox: []
    }
  ]
}
