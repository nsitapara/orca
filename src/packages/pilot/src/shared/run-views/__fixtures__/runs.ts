import type { HandoverRow, InboxItemSummary, StepRow, StepStatus } from '../../api-types'
import type { ActivityRun } from '../../api-types-runs'

export function testStepRow(over: Partial<StepRow> = {}): StepRow {
  return {
    runId: 'r1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: null,
    status: 'done',
    terminalHandle: null,
    paneKey: null,
    sessionId: 's1',
    transcriptPath: null,
    costUsd: null,
    tokens: null,
    startedAt: 1,
    finishedAt: 2,
    error: null,
    kind: 'agent',
    mode: null,
    model: null,
    outputs: {},
    whenExpr: null,
    exitCode: null,
    outputTail: null,
    sessionPinned: false,
    detached: false,
    launchArgs: null,
    result: null,
    ...over
  }
}

// A step row as paintRun reads it: its index, name and status.
export function stepAt(idx: number, name: string, status: StepStatus): StepRow {
  return testStepRow({ idx, name, status })
}

export function testRun(over: Partial<ActivityRun> = {}): ActivityRun {
  return {
    id: 'r1',
    automationId: 'job',
    tickId: 7,
    itemKey: '!1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt/a',
    status: 'running',
    outcome: null,
    startedAt: 1,
    finishedAt: null,
    costUsd: null,
    tokens: null,
    worktreeId: null,
    trigger: 'schedule',
    parentRunId: null,
    imported: false,
    steps: [],
    inbox: [],
    ...over
  }
}

export function testCard(over: Partial<InboxItemSummary> = {}): InboxItemSummary {
  return {
    id: 'i1',
    automationId: 'job',
    runId: 'r1',
    stepIdx: 1,
    itemKey: '!1',
    worktreePath: '/wt/a',
    person: 'nish',
    type: 'question',
    title: 'Push it?',
    context: '',
    status: 'open',
    createdAt: 1,
    ...over
  }
}

export function testHandover(over: Partial<HandoverRow> = {}): HandoverRow {
  return {
    id: 1,
    senderId: 'job',
    senderRunId: 'r1',
    receiverId: 'next',
    itemId: 'WEB-1',
    createdAt: 1,
    state: 'consumed',
    consumedAt: 2,
    tickId: 9,
    verdict: 'started',
    reason: '',
    runId: 'r9',
    ...over
  }
}
