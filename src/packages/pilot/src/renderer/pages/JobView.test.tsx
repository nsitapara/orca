// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary,
  HandoverRow
} from '../../shared/api-types'
import { detail, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { JobView } from './JobView'

const STAGE_1: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix',
  name: '13 · Fix red hourly e2e on dev',
  enabled: false,
  schedule: '5,35 * * * *',
  itemKind: 'Pipelines',
  powers: ['create_ticket', 'update_ticket'],
  job: {
    id: '13',
    name: 'Fix red hourly e2e on dev',
    stage: 1,
    label: 'Open or update the ticket',
    feeds: [
      {
        to: 'dev-e2e-fix-start',
        pass: null,
        run: 'next_schedule',
        when: 'success',
        caption: 'the tickets it opens',
        trust: 'shell'
      }
    ]
  }
}
const STAGE_2: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix-start',
  name: '13 · Start fix sessions for red e2e tickets',
  enabled: false,
  schedule: '6,36 * * * *',
  itemKind: 'Linear tickets',
  job: {
    id: '13',
    name: null,
    stage: 2,
    label: 'Start a fix session per ticket',
    feeds: []
  }
}
const YAML: Record<string, string> = {
  'dev-e2e-fix': '# A red hourly e2e run on dev opens one Linear ticket.\nname: one\n',
  'dev-e2e-fix-start': '# Each open ticket gets one Claude session.\nname: two\n'
}
function tick(
  id: number,
  automationId: string,
  minute: number,
  over: Partial<ActivityTick> = {}
): ActivityTick {
  return {
    id,
    automationId,
    startedAt: Date.UTC(2026, 9, 13, 17, minute),
    finishedAt: Date.UTC(2026, 9, 13, 17, minute, 5),
    status: 'ok',
    error: null,
    counts: {},
    items: [],
    runs: [],
    ...over
  }
}
const OUTSIDE = {
  tickId: 8,
  itemKey: 'linear:WEB-50',
  label: 'WEB-50',
  verdict: 'out_of_scope' as const,
  reason: 'Team is OPS',
  checks: [],
  fields: {},
  runId: null
}
const TICKS: Record<string, ActivityTick[]> = {
  'dev-e2e-fix': [
    tick(7, 'dev-e2e-fix', 44, { counts: { notdue: 1 } }),
    tick(3, 'dev-e2e-fix', 14)
  ],
  'dev-e2e-fix-start': [
    tick(8, 'dev-e2e-fix-start', 45, { counts: { out_of_scope: 1 }, items: [OUTSIDE] })
  ]
}

function serve(
  stages: AutomationSummary[],
  over: Record<string, (p: { id: string }) => unknown> = {}
) {
  const list: AutomationListPayload = {
    automations: [{ ...summary, id: 'docker-prune' }, ...stages],
    errors: [],
    peopleError: null,
    missingDirs: []
  }
  pilotRpc.mockImplementation(async (method: string, params: { id: string }) => {
    if (over[method]) {
      return over[method](params)
    }
    if (method === 'pilot.automations.list') {
      return list
    }
    if (method === 'pilot.automations.get') {
      const s = stages.find((x) => x.id === params.id)!
      return {
        ...detail,
        summary: s,
        yaml: YAML[s.id],
        checkNames: ['Quota']
      } satisfies AutomationDetailPayload
    }
    if (method === 'pilot.automations.activity') {
      return TICKS[params.id] ?? []
    }
    throw new Error(`unexpected ${method}`)
  })
}
const calls = (method: string) => pilotRpc.mock.calls.filter((c) => c[0] === method)

describe('JobView: a job of several automations on one page', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows each stage as a card, joined by the arrow its feeds draw, with the hands_over caption', async () => {
    serve([STAGE_2, STAGE_1])
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    expect(
      await screen.findByRole('heading', { name: '13 · Fix red hourly e2e on dev' })
    ).toBeTruthy()
    expect(screen.getByText('Stage 1 · Pipelines')).toBeTruthy()
    expect(screen.getByText('Stage 2 · Linear tickets')).toBeTruthy()
    expect(screen.getByText('A red hourly e2e run on dev opens one Linear ticket.')).toBeTruthy()
    expect(screen.getByText('create_ticket, update_ticket')).toBeTruthy()
    const arrow = screen.getByRole('img', { name: 'Stage 1 hands stage 2 the tickets it opens' })
    expect(arrow.textContent).toContain('the tickets it opens')
  })

  it('shows the most recent handover on the arrow, and how its receiving tick went', async () => {
    const handedAt = Date.now() - 5 * 60_000
    serve([STAGE_1, STAGE_2], {
      'pilot.automations.get': ({ id }) => {
        const s = [STAGE_1, STAGE_2].find((x) => x.id === id)!
        const rows: HandoverRow[] = [
          {
            id: 1,
            senderId: 'dev-e2e-fix',
            senderRunId: 'run-1',
            receiverId: 'dev-e2e-fix-start',
            itemId: 'WEB-2123',
            createdAt: handedAt,
            state: 'consumed',
            consumedAt: handedAt,
            tickId: 8,
            verdict: 'started',
            reason: 'Started',
            runId: 'r9'
          }
        ]
        return {
          ...detail,
          summary: s,
          yaml: YAML[s.id],
          checkNames: [],
          handovers: id === 'dev-e2e-fix' ? [{ to: 'dev-e2e-fix-start', rows }] : []
        } satisfies AutomationDetailPayload
      }
    })
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    expect(await screen.findByText('Last: WEB-2123 started · 5 min ago')).toBeTruthy()
  })

  it('draws no arrow between stages that feed nothing', async () => {
    serve([{ ...STAGE_1, job: { ...STAGE_1.job!, feeds: [] } }, STAGE_2])
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    await screen.findByText('Stage 2 · Linear tickets')
    expect(screen.queryByRole('img', { name: /hands stage/ })).toBeNull()
  })

  it('merges every stage’s activity newest first, each tick tagged with its stage, out-of-scope items hidden', async () => {
    serve([STAGE_1, STAGE_2])
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    await screen.findByText('Stage 1 · Pipelines')
    await waitFor(() => expect(screen.getAllByText(/^Stage \d$/)).toHaveLength(3))
    expect(screen.getAllByText(/^Stage \d$/).map((t) => t.textContent)).toEqual([
      'Stage 2',
      'Stage 1',
      'Stage 1'
    ])
    expect(screen.queryByText('WEB-50')).toBeNull()
    expect(screen.getAllByText('0 checked')).toHaveLength(2)
  })

  it('shows each stage’s YAML in its own tab', async () => {
    serve([STAGE_1, STAGE_2])
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stage 2 YAML' }))
    expect(screen.getByText(/Each open ticket gets one Claude session\.\s+name: two/)).toBeTruthy()
  })

  it('Dry run all dry-runs each stage in stage order, shows each, and never ticks for real', async () => {
    serve([STAGE_2, STAGE_1], {
      'pilot.automations.dryRun': ({ id }) => ({
        tickId: null,
        status: 'ok',
        error: null,
        decisions: [],
        handover:
          id === 'dev-e2e-fix'
            ? {
                read: [],
                feeds: [
                  {
                    to: 'dev-e2e-fix-start',
                    output: 'ticket',
                    run: 'now',
                    when: 'success',
                    starts: 1
                  }
                ]
              }
            : { read: ['WEB-2123'], feeds: [] }
      })
    })
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dry run all' }))
    const panels = (await screen.findAllByText('Nothing was started or saved.')).map(
      (el) => el.closest('section') as HTMLElement
    )
    expect(panels.map((p) => within(p).getByText(/^Stage \d$/).textContent)).toEqual([
      'Stage 1',
      'Stage 2'
    ])
    // What would be handed over: dry runs write no handover and trigger nothing.
    expect(
      within(panels[0]).getByText(
        '1 run would hand stage 2 its ticket output if it succeeds; stage 2 then ticks at once'
      )
    ).toBeTruthy()
    expect(within(panels[1]).getByText('Reads 1 handed-over id: WEB-2123')).toBeTruthy()
    expect(calls('pilot.automations.dryRun').map((c) => c[1])).toEqual([
      { id: 'dev-e2e-fix' },
      { id: 'dev-e2e-fix-start' }
    ])
    expect(calls('pilot.automations.tickNow')).toEqual([])
  })

  it('Turn on asks first, then enables each paused stage in stage order, through the same call as one automation', async () => {
    serve([STAGE_1, STAGE_2], { 'pilot.automations.setEnabled': (p) => p })
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    expect(calls('pilot.automations.setEnabled')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls('pilot.automations.setEnabled')).toHaveLength(2))
    // No caller binding is sent: Pilot decides who is calling, as for a single automation.
    expect(calls('pilot.automations.setEnabled').map((c) => c[1])).toEqual([
      { id: 'dev-e2e-fix', enabled: true },
      { id: 'dev-e2e-fix-start', enabled: true }
    ])
  })

  const REFUSAL =
    "An agent in a Pilot run can't tick, enable or pause an automation; Nish does that in Pilot"

  it('Turn off asks every enabled stage, and says which were refused and what state the job is in', async () => {
    serve(
      [
        { ...STAGE_1, enabled: true },
        { ...STAGE_2, enabled: true }
      ],
      {
        'pilot.automations.setEnabled': () => {
          throw new Error(REFUSAL)
        }
      }
    )
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText(`Stage 1: refused: ${REFUSAL}`)).toBeTruthy()
    expect(screen.getByText(`Stage 2: refused: ${REFUSAL}`)).toBeTruthy()
    expect(screen.getByText('Job 13 is on.')).toBeTruthy()
    expect(calls('pilot.automations.setEnabled').map((c) => c[1])).toEqual([
      { id: 'dev-e2e-fix', enabled: false },
      { id: 'dev-e2e-fix-start', enabled: false }
    ])
  })

  it('a partial Turn on says which stages changed and which were refused, and rolls nothing back', async () => {
    serve([STAGE_1, STAGE_2], {
      'pilot.automations.setEnabled': (p) => {
        if (p.id === 'dev-e2e-fix-start') {
          throw new Error(REFUSAL)
        }
        return p
      }
    })
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Stage 1: turned on')).toBeTruthy()
    expect(screen.getByText(`Stage 2: refused: ${REFUSAL}`)).toBeTruthy()
    expect(screen.getByText('Job 13 is partly on: stage 1 on, stage 2 off.')).toBeTruthy()
    expect(calls('pilot.automations.setEnabled').map((c) => c[1])).toEqual([
      { id: 'dev-e2e-fix', enabled: true },
      { id: 'dev-e2e-fix-start', enabled: true }
    ])
  })

  it.each([
    ['every stage off', false, false, ['Turn on']],
    ['every stage on', true, true, ['Turn off']],
    ['one stage on', true, false, ['Turn on', 'Turn off']]
  ])(
    'offers Turn on while a stage is off and Turn off while one is on: %s',
    async (_n, one, two, offered) => {
      serve([
        { ...STAGE_1, enabled: one },
        { ...STAGE_2, enabled: two }
      ])
      render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
      await screen.findByRole('button', { name: 'Dry run all' })
      const toggles = screen
        .getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => t === 'Turn on' || t === 'Turn off')
      expect(toggles).toEqual(offered)
    }
  )

  it('Turn off in a partly-on job pauses only the stages that are on', async () => {
    serve([{ ...STAGE_1, enabled: true }, STAGE_2], { 'pilot.automations.setEnabled': (p) => p })
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
    expect(await screen.findByText('Stage 1: turned off')).toBeTruthy()
    expect(calls('pilot.automations.setEnabled').map((c) => c[1])).toEqual([
      { id: 'dev-e2e-fix', enabled: false }
    ])
  })

  it('opens a stage’s own page from its card, and says when no automation has the job', async () => {
    serve([STAGE_1, STAGE_2])
    const onOpenStage = vi.fn()
    render(<JobView jobId="13" onBack={() => {}} onOpenStage={onOpenStage} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start a fix session per ticket' }))
    expect(onOpenStage).toHaveBeenCalledWith('dev-e2e-fix-start')
    cleanup()
    render(<JobView jobId="99" onBack={() => {}} onOpenStage={() => {}} />)
    expect(await screen.findByText('No automation is part of job 99.')).toBeTruthy()
  })
})
