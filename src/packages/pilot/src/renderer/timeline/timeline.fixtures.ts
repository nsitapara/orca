import type {
  InboxItemSummary,
  StepRow,
  TimelineRun,
  WorktreeTimeline
} from '../../shared/api-types'

const NOON = new Date(2026, 9, 11, 12, 0).getTime()

export function stepRow(over: Partial<StepRow> = {}): StepRow {
  return {
    runId: 'r1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'fix-gitlab-ci',
    status: 'done',
    terminalHandle: 'term_1',
    paneKey: 'tab:leaf',
    sessionId: 's1',
    transcriptPath: null,
    costUsd: 1.2,
    tokens: 1000,
    startedAt: NOON - 600_000,
    finishedAt: NOON - 60_000,
    error: null,
    kind: 'agent',
    mode: 'fix',
    model: 'claude-opus-5-5',
    outputs: { found_bugs: 3 },
    whenExpr: null,
    exitCode: null,
    outputTail: null,
    sessionPinned: true,
    detached: false,
    launchArgs: null,
    result: null,
    ...over
  }
}

export function inboxItem(over: Partial<InboxItemSummary> = {}): InboxItemSummary {
  return {
    id: 'i1',
    automationId: 'fix-ci',
    runId: 'r1',
    stepIdx: 0,
    itemKey: 'mr:1561',
    worktreePath: '/wt/a',
    person: 'nish',
    type: 'question',
    title: 'Push the fix?',
    context: '',
    status: 'open',
    createdAt: NOON,
    ...over
  }
}

export function timelineRun(over: Partial<TimelineRun> = {}): TimelineRun {
  return {
    id: 'r1',
    automationId: 'fix-ci',
    tickId: 7,
    itemKey: 'mr:1561',
    itemLabel: '!1561 web-1493',
    worktreePath: '/wt/a',
    status: 'done',
    outcome: 'Fixed lint, pushed 9c1e2f0',
    startedAt: NOON - 600_000,
    finishedAt: NOON - 60_000,
    costUsd: 1.2,
    tokens: 1000,
    worktreeId: 'repo::/wt/a',
    trigger: 'schedule',
    parentRunId: null,
    imported: false,
    automationName: 'Fix failed CI on my MRs',
    steps: [
      stepRow(),
      stepRow({
        idx: 1,
        name: 'cleanup',
        agent: 'shell',
        kind: 'shell',
        mode: null,
        status: 'skipped',
        sessionId: null,
        costUsd: null,
        outputs: {},
        exitCode: 3
      })
    ],
    inbox: [],
    ...over
  }
}

export function worktreeTimeline(over: Partial<WorktreeTimeline> = {}): WorktreeTimeline {
  return {
    next: [],
    now: [],
    earlier: [],
    waiting: [],
    spentTodayUsd: 0,
    unpricedBuckets: 0,
    ...over
  }
}
