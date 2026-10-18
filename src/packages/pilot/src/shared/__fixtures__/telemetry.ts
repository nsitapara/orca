import type { TelemetryCall, TelemetryPayload, TelemetryUsage } from '../api-types-telemetry'

// Tests only: what pilotcli prints for its telemetry, with ids and names only.
export function envelope(command: string, data: unknown) {
  return { v: 1, command, outcome: 'ok', reason: '', data }
}

const catalog = (flags: string[], withCalls: boolean) => ({
  modules: [
    {
      name: 'self',
      commands: [
        { command: 'self get-telemetry', flags: flags.map((name) => ({ name })) },
        ...(withCalls ? [{ command: 'self list-telemetry-calls', flags: [{ name: 'since' }] }] : [])
      ]
    }
  ]
})
export const TODAY_CATALOG = catalog(['since', 'include-dev'], false)
export const NEW_CATALOG = catalog(['since', 'include-dev', 'series'], true)

const callers = (c: Partial<Record<'claude' | 'codex' | 'pilot' | 'app' | 'shell', number>>) => ({
  claude: 0,
  codex: 0,
  pilot: 0,
  shell: 0,
  ...c
})

export const TODAY_USAGE: TelemetryUsage = {
  from: '2026-10-11T00:00:00-07:00',
  to: '2026-10-17T23:59:59-07:00',
  calls: 3,
  include_dev: false,
  commands: [
    {
      command: 'gitlab check-mr',
      calls: 3,
      failed: 1,
      invalid: 0,
      callers: callers({ pilot: 3 }),
      p50_ms: 400,
      p95_ms: 1800,
      last: '2026-10-17T14:20:00-07:00'
    }
  ],
  unused: ['gitlab update-mr'],
  jobs: [
    {
      automation: 'fix-failed-ci',
      name: '05 · Fix failed CI on my MRs',
      runs: 1,
      calls: 3,
      steps: [{ step: 'context', commands: [{ command: 'gitlab check-mr', calls: 3 }] }]
    }
  ],
  left_out: { dev: 2, malformed: 0 }
}

export const NEW_USAGE: TelemetryUsage = {
  ...TODAY_USAGE,
  oldest: '2026-10-12T09:14:03-07:00',
  calls: 6,
  totals: { failed: 1, invalid: 2, callers: callers({ claude: 2, pilot: 3, app: 1 }) },
  buckets: [
    '2026-10-11',
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17'
  ],
  series: {
    calls: [0, 0, 0, 0, 2, 2, 2],
    failed: [0, 0, 0, 0, 0, 0, 1],
    invalid: [0, 0, 0, 0, 0, 1, 1]
  },
  commands: [
    {
      ...TODAY_USAGE.commands[0],
      outcomes: { ok: 2, skip: 0, invalid: 0, failed: 1, not_yet: 0, needs_agent: 0 },
      max_ms: 1800,
      series: [0, 0, 0, 0, 1, 1, 1]
    },
    {
      command: 'git get-branch',
      calls: 2,
      failed: 0,
      invalid: 2,
      callers: callers({ claude: 2 }),
      p50_ms: 20,
      p95_ms: 30,
      last: '2026-10-17T10:00:00-07:00',
      series: [0, 0, 0, 0, 0, 1, 1]
    },
    {
      command: 'worktree check',
      removed: true,
      calls: 1,
      failed: 0,
      invalid: 0,
      callers: callers({ app: 1 }),
      p50_ms: 50,
      p95_ms: 50,
      last: '2026-10-15T08:00:00-07:00',
      series: [0, 0, 0, 0, 1, 0, 0]
    }
  ],
  jobs: [{ ...TODAY_USAGE.jobs[0], failed: 1, invalid: 0 }]
}

function clean(usage: TelemetryUsage): TelemetryUsage {
  return {
    ...usage,
    totals: usage.totals && { ...usage.totals, failed: 0, invalid: 0 },
    series: usage.series && {
      ...usage.series,
      failed: usage.series.failed.map(() => 0),
      invalid: usage.series.invalid.map(() => 0)
    },
    commands: usage.commands.map((c) => ({
      ...c,
      failed: 0,
      invalid: 0,
      outcomes: c.outcomes && { ...c.outcomes, failed: 0, invalid: 0 }
    })),
    jobs: usage.jobs.map((j) => ({
      ...j,
      failed: j.failed === undefined ? undefined : 0,
      invalid: j.invalid === undefined ? undefined : 0
    }))
  }
}
export const NEW_USAGE_CLEAN = clean(NEW_USAGE)

export const CALLS: TelemetryCall[] = [
  {
    ts: '2026-10-17T14:20:11-07:00',
    command: 'gitlab check-mr',
    outcome: 'failed',
    cause: 'http',
    http_status: 502,
    exit: 1,
    duration_ms: 1800,
    caller: 'pilot',
    agent: 'claude',
    automation: 'fix-failed-ci',
    run: 'fix-failed-ci-202610171420-t1-1',
    step: 'context'
  },
  {
    ts: '2026-10-17T10:00:00-07:00',
    command: 'git get-branch',
    outcome: 'invalid',
    cause: 'invalid_flag',
    exit: 2,
    duration_ms: 20,
    caller: 'claude',
    agent: 'claude'
  }
]

export const PAYLOAD: TelemetryPayload = {
  fetchedAt: Date.parse('2026-10-17T16:42:00-07:00'),
  usage: NEW_USAGE,
  failures: { calls: CALLS, more: false }
}
export const TODAY_PAYLOAD: TelemetryPayload = {
  fetchedAt: Date.parse('2026-10-17T16:42:00-07:00'),
  usage: TODAY_USAGE,
  failures: {
    unavailable: 'This pilotcli lists no calls yet: install a newer one (self list-telemetry-calls)'
  }
}
