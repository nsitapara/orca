import type { CapacityPayload, FinishedRun, QueuedRun } from '../../../../shared/api-types-capacity'

const GIB = 1024 ** 3

// The item waiting in capacity()'s line: Run now queued it, and it names no hold, as an older Pilot's slot waiter.
export function waitingItem(over: Partial<QueuedRun> = {}): QueuedRun {
  return {
    automationId: 'ci',
    automationName: '05 Fix failed CI',
    itemKey: 'mr:9',
    itemLabel: '!9 web-9',
    queuedAt: Date.now() - 3 * 60_000,
    byHand: true,
    ...over
  }
}

// The Running page's payload as a machine answers it: one run running, one waiting, nothing finished.
export function capacity(over: Partial<CapacityPayload> = {}): CapacityPayload {
  const now = Date.now()
  return {
    limit: 2,
    running: [
      {
        id: 'r1',
        automationId: 'review',
        automationName: '03 Review and fix',
        itemLabel: '!1655 web-2235',
        startedAt: now - 5 * 60_000,
        memoryBytes: 1.5 * GIB,
        peakBytes: 2 * GIB,
        counted: true
      }
    ],
    queued: [waitingItem()],
    finished: [],
    memory: { totalBytes: 24 * GIB, availableBytes: 9 * GIB },
    suggestion: { limit: 3, budgetBytes: 6.5 * GIB, perJobBytes: 2 * GIB, measured: true },
    heaviest: {
      automationId: 'review',
      automationName: '03 Review and fix',
      peakBytes: 2 * GIB,
      measured: true
    },
    ...over
  }
}

// A failed run in Recently finished, with the card it made.
export function finishedRun(over: Partial<FinishedRun> = {}): FinishedRun {
  const now = Date.now()
  return {
    id: 'f1',
    automationId: 'review',
    automationName: '03 Review and fix',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt/web-1',
    status: 'failed',
    outcome: 'Merge conflict in api/models.py',
    startedAt: now - 10 * 60_000,
    finishedAt: now - 60_000,
    costUsd: 0.4,
    tokens: null,
    worktreeId: null,
    trigger: 'schedule',
    parentRunId: null,
    imported: false,
    queuedAt: now - 14 * 60_000,
    steps: [],
    inbox: [
      {
        id: 'c1',
        automationId: 'review',
        runId: 'f1',
        stepIdx: 0,
        itemKey: 'mr:1',
        worktreePath: '/wt/web-1',
        person: 'nish',
        type: 'question',
        title: 'Resolve the conflict?',
        context: '',
        status: 'open',
        createdAt: now - 60_000
      }
    ],
    fields: { 'mr.web_url': 'https://gitlab.example/mr/1' },
    peakBytes: 2 * GIB,
    ...over
  }
}
