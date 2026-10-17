// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, PilotStatus } from '../../shared/api-types'
import {
  setPilotAutomationsView,
  setPilotOpenAutomation,
  setPilotOpenJob
} from './automations-view'
import { resetAutomationsFeed } from '../run-views/automations-feed'
import { detail, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const orcaPage = vi.hoisted(() => vi.fn(() => null))
vi.mock('../../../../../renderer/src/components/automations/AutomationsPage', () => ({
  default: () => orcaPage()
}))

import PilotAutomationsPage from './PilotAutomationsPage'

const status: PilotStatus = {
  version: '0.1.0',
  process: 'main',
  dataPath: '/tmp/pilot',
  automationDirs: ['/a'],
  missingDirs: [],
  peopleError: null,
  error: null,
  loopStartedAt: null,
  lastLoopFinishedAt: null,
  orcaAutomationsOff: true
}
const list: AutomationListPayload = {
  automations: [summary],
  errors: [],
  peopleError: null,
  missingDirs: []
}

function serve(payload: AutomationListPayload): void {
  pilotRpc.mockImplementation(async (method: string, params?: { id: string }) => {
    if (method === 'pilot.automations.list') {
      return payload
    }
    if (method === 'pilot.automations.get') {
      return { ...detail, summary: payload.automations.find((a) => a.id === params?.id) ?? summary }
    }
    if (method === 'pilot.automations.activity') {
      return []
    }
    if (method === 'pilot.inbox.list') {
      return { items: [], people: [], groups: [], automations: [] }
    }
    if (method === 'pilot.activity.list') {
      return { live: [], ticks: [], loose: [], reach: null }
    }
    if (method === 'pilot.queue.list') {
      return { entries: [] }
    }
    if (method === 'pilot.playground.projects') {
      return []
    }
    if (method === 'pilot.playground.status') {
      return { state: 'stopped', repoPath: null, reason: null }
    }
    if (method === 'pilot.capacity.get') {
      return {
        limit: null,
        running: [],
        queued: [],
        memory: null,
        suggestion: { limit: 2, budgetBytes: 0, perJobBytes: 1, measured: false },
        heaviest: null
      }
    }
    return status
  })
}

describe('PilotAutomationsPage', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    pilotRpc.mockReset()
    setPilotOpenAutomation(null)
    setPilotOpenJob(null)
    setPilotAutomationsView('automations')
  })

  it('opens Activity across automations from the list header, and goes back from its crumb', async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(
      await screen.findByText('Each automation is a YAML file in an automation folder.')
    ).toBeTruthy()
  })

  it('opens a job of several automations as one page; a stage opens from it, and its crumbs lead to the job and the list', async () => {
    const stage = (id: string, n: number) => ({
      ...summary,
      id,
      name: `13 · stage ${n}`,
      job: {
        id: '13',
        name: n === 1 ? 'Fix red hourly e2e on dev' : null,
        stage: n,
        label: `Stage label ${n}`,
        feeds: [],
        handsOver: null
      }
    })
    serve({ ...list, automations: [summary, stage('one', 1), stage('two', 2)] })
    render(<PilotAutomationsPage />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Job 13 · Fix red hourly e2e on dev, 2 stages' })
    )
    expect(
      await screen.findByRole('heading', { name: '13 · Fix red hourly e2e on dev' })
    ).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Stage label 2' }))
    expect(
      await screen.findByRole('heading', { name: 'Stage 2 of 2 · Stage label 2' })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '13 · Fix red hourly e2e on dev' }))
    expect(
      await screen.findByRole('heading', { name: '13 · Fix red hourly e2e on dev' })
    ).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Stage label 2' }))
    await screen.findByRole('heading', { name: 'Stage 2 of 2 · Stage label 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(await screen.findByRole('button', { name: /Fix failed CI/ })).toBeTruthy()
  })

  it('lists the YAML automations only, and opens one full page', async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    expect(screen.getByRole('heading', { name: 'Automations' })).toBeTruthy()
    expect(screen.queryByText('YAML automations')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /Fix failed CI/ }))
    expect(await screen.findByRole('tab', { name: 'How it runs', selected: true })).toBeTruthy()
  })

  it('shows no Inbox, Running or Playground tab; the sub-views render them', async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    await screen.findByRole('button', { name: /Fix failed CI/ })
    expect(screen.queryByText('Inbox')).toBeNull()
    act(() => setPilotAutomationsView('inbox'))
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy()
    act(() => setPilotAutomationsView('running'))
    expect(await screen.findByRole('heading', { name: 'Running' })).toBeTruthy()
    act(() => setPilotAutomationsView('playground'))
    expect(await screen.findByRole('heading', { name: 'Playground' })).toBeTruthy()
    act(() => setPilotAutomationsView('automations'))
    expect(await screen.findByRole('button', { name: /Fix failed CI/ })).toBeTruthy()
  })

  it('returns to the list after a visit to Inbox', async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Fix failed CI/ }))
    expect(await screen.findByRole('tab', { name: 'How it runs', selected: true })).toBeTruthy()
    act(() => setPilotAutomationsView('inbox'))
    await screen.findByRole('heading', { name: 'Inbox' })
    act(() => setPilotAutomationsView('automations'))
    expect(await screen.findByRole('button', { name: /Fix failed CI/ })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'How it runs' })).toBeNull()
  })

  it("never loads Orca's own Automations page", async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    await screen.findByRole('button', { name: /Fix failed CI/ })
    expect(orcaPage).not.toHaveBeenCalled()
  })

  it('shows bad files, a people notice and missing folders above the table', async () => {
    serve({
      automations: [summary],
      errors: [
        { file: '/a/bad.yaml', errors: ['/a/bad.yaml: YAML error at line 2'] },
        { file: '/a/two.yaml', errors: ['/a/two.yaml: no steps', '/a/two.yaml: bad schedule'] }
      ],
      peopleError: 'people.yaml and people.yml both exist',
      missingDirs: ['/gone']
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('/a/bad.yaml: YAML error at line 2')).toBeTruthy()
    expect(screen.getByText('/a/two.yaml: no steps · bad schedule')).toBeTruthy()
    expect(screen.getByText('People: people.yaml and people.yml both exist')).toBeTruthy()
    expect(screen.getByText('Folder not found: /gone')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Fix failed CI/ })).toBeTruthy()
  })

  it('shows a warning, such as a feeds arrow it cannot draw, without marking the file bad', async () => {
    serve({
      ...list,
      warnings: [
        {
          file: '/a/one.yaml',
          warnings: [`/a/one.yaml: job.feeds: no automation "c"; its arrow isn't drawn`]
        }
      ]
    })
    render(<PilotAutomationsPage />)
    const note = await screen.findByText(
      `/a/one.yaml: job.feeds: no automation "c"; its arrow isn't drawn`
    )
    expect(note.className).not.toContain('text-destructive')
  })

  it('says so when there are no automations', async () => {
    serve({ ...list, automations: [] })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('No automations found.')).toBeTruthy()
  })

  it("degraded: shows the list error and why Pilot couldn't start", async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.status') {
        return { ...status, error: 'database is locked' }
      }
      throw new Error("Pilot isn't running: database is locked")
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText("Pilot isn't running: database is locked")).toBeTruthy()
    expect(await screen.findByText("Pilot couldn't start: database is locked")).toBeTruthy()
  })

  it('degraded without a status error still shows the list error', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.status') {
        return status
      }
      throw new Error('timed out')
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('timed out')).toBeTruthy()
    expect(screen.queryByText(/couldn't start/)).toBeNull()
  })
})
