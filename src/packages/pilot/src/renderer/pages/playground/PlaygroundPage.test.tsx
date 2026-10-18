// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAYLOAD } from '../../../shared/__fixtures__/telemetry'
import type { PlaygroundProject, PlaygroundStatus } from '../../../shared/playground-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { PlaygroundPage } from './PlaygroundPage'

const PROJECTS: PlaygroundProject[] = [
  { path: '/r/web', name: 'web-platform', project: 'web-platform' },
  { path: '/r/pilot', name: 'pilot', project: 'pilot' }
]
const URL = 'http://127.0.0.1:4567/?token=abc'
const STOPPED: PlaygroundStatus = { state: 'stopped', repoPath: null, reason: null }
const RUNNING: PlaygroundStatus = { state: 'running', repoPath: '/r/pilot', url: URL }

// Answers each method from `answers`, and the Telemetry tab with PAYLOAD; a function answer is called with the params.
function answer(answers: Record<string, unknown>): void {
  const all: Record<string, unknown> = { 'pilot.telemetry.get': PAYLOAD, ...answers }
  pilotRpc.mockImplementation(async (method: string, params?: unknown) => {
    const a = all[method]
    if (a instanceof Error) {
      throw a
    }
    return typeof a === 'function' ? a(params) : a
  })
}

async function shown(): Promise<void> {
  render(<PlaygroundPage />)
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  vi.unstubAllGlobals()
})

describe('PlaygroundPage', () => {
  it('starts the playground for the chosen project and shows its page', async () => {
    answer({
      'pilot.playground.projects': PROJECTS,
      'pilot.playground.status': STOPPED,
      'pilot.playground.start': () => RUNNING
    })
    await shown()
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.queryByTitle('pilotcli playground')).toBeNull()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '/r/pilot' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    })
    expect(pilotRpc).toHaveBeenCalledWith('pilot.playground.start', { repoPath: '/r/pilot' })
    expect(screen.getByTitle('pilotcli playground').getAttribute('src')).toBe(URL)
    expect(screen.getByRole('link', { name: 'Open in browser' }).getAttribute('href')).toBe(URL)
    expect(screen.getByLabelText('Project')).toHaveProperty('disabled', true)
  })

  it('stops it', async () => {
    answer({
      'pilot.playground.projects': PROJECTS,
      'pilot.playground.status': RUNNING,
      'pilot.playground.stop': () => ({ state: 'stopped', repoPath: '/r/pilot', reason: null })
    })
    await shown()
    expect(screen.getByRole('tab', { name: 'Commands', selected: true })).toBeTruthy()
    expect(screen.getByLabelText('Project')).toHaveProperty('value', '/r/pilot')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    })
    expect(pilotRpc).toHaveBeenCalledWith('pilot.playground.stop')
    expect(screen.queryByTitle('pilotcli playground')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
  })

  it.each([
    [
      'why it stopped',
      {
        'pilot.playground.projects': PROJECTS,
        'pilot.playground.status': {
          state: 'stopped',
          repoPath: '/r/web',
          reason: 'pilotcli playground exited (exit 2): no project'
        }
      },
      'pilotcli playground exited (exit 2): no project'
    ],
    [
      'that no open repo is a pilotcli project',
      { 'pilot.playground.projects': [], 'pilot.playground.status': STOPPED },
      'None of the repos in Pilot is a project pilotcli knows.'
    ],
    [
      "the playground isn't in this process",
      {
        'pilot.playground.projects': new Error("The playground runs in Pilot's desktop app"),
        'pilot.playground.status': STOPPED
      },
      "The playground runs in Pilot's desktop app"
    ]
  ])('says %s', async (_name, answers, text) => {
    answer(answers)
    await shown()
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('says why a start failed', async () => {
    answer({
      'pilot.playground.projects': PROJECTS,
      'pilot.playground.status': STOPPED,
      'pilot.playground.start': new Error("/r/web isn't a project pilotcli knows")
    })
    await shown()
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    })
    expect(screen.getByText("/r/web isn't a project pilotcli knows")).toBeTruthy()
  })

  it('in the browser version shows Telemetry, and says Commands run where Pilot runs', async () => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    answer({ 'pilot.telemetry.get': PAYLOAD })
    await shown()
    expect(screen.getByRole('heading', { name: 'Playground' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Commands' })).toBeTruthy()
    expect(pilotRpc.mock.calls.map(([m]) => m)).toEqual(['pilot.telemetry.get'])
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.getByText(/runs only on the machine Pilot runs on/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByText(/Try it|View source/)).toBeNull()
  })

  it('opens on Telemetry when no playground runs, and a running one survives a tab switch', async () => {
    answer({
      'pilot.playground.projects': PROJECTS,
      'pilot.playground.status': STOPPED,
      'pilot.playground.start': () => RUNNING,
      'pilot.telemetry.get': PAYLOAD
    })
    await shown()
    const telemetry = screen.getByRole('tab', { name: 'Telemetry', selected: true })
    expect(screen.getByRole('tabpanel', { name: 'Telemetry' }).id).toBe(
      telemetry.getAttribute('aria-controls')
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    })
    const frame = screen.getByTitle('pilotcli playground')
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
    expect(screen.getByTitle('pilotcli playground')).toBe(frame) // still mounted, inside the hidden panel
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.getByTitle('pilotcli playground')).toBe(frame)
    expect(pilotRpc).not.toHaveBeenCalledWith('pilot.playground.stop')
  })

  it('Try it from Telemetry selects Commands and points the playground at the command', async () => {
    answer({
      'pilot.playground.projects': PROJECTS,
      'pilot.playground.status': RUNNING
    })
    await shown()
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(screen.getByRole('tab', { name: 'Commands', selected: true })).toBeTruthy()
    expect(screen.getByTitle('pilotcli playground').getAttribute('src')).toBe(
      `${URL}#pilotcli-gitlab-check-mr`
    )
  })

  it('Try it again goes to the command again, and a tab switch leaves the page where it is', async () => {
    answer({ 'pilot.playground.projects': PROJECTS, 'pilot.playground.status': RUNNING })
    await shown()
    const tryIt = async (): Promise<void> => {
      fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
      fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
      await act(async () => {})
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    await tryIt()
    const first = screen.getByTitle('pilotcli playground')
    await tryIt()
    const again = screen.getByTitle('pilotcli playground')
    expect(again).not.toBe(first)
    expect(again.getAttribute('src')).toBe(`${URL}#pilotcli-gitlab-check-mr`)
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.getByTitle('pilotcli playground')).toBe(again)
    expect(again.getAttribute('src')).toBe(`${URL}#pilotcli-gitlab-check-mr`)
  })

  it.each([
    [
      'says to start the playground',
      PROJECTS,
      'Start the playground to try pilotcli gitlab check-mr.'
    ],
    [
      'still says no repo is a pilotcli project',
      [],
      'None of the repos in Pilot is a project pilotcli knows.'
    ]
  ])('when Try it finds none running, %s', async (_name, projects, text) => {
    answer({ 'pilot.playground.projects': projects, 'pilot.playground.status': STOPPED })
    await shown()
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(screen.getByRole('tab', { name: 'Commands', selected: true })).toBeTruthy()
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('forgets a Try it once Nish picks a tab himself', async () => {
    answer({ 'pilot.playground.projects': PROJECTS, 'pilot.playground.status': STOPPED })
    await shown()
    fireEvent.click(screen.getByRole('button', { name: 'gitlab check-mr' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Telemetry' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(screen.queryByText(/Start the playground to try/)).toBeNull()
    expect(screen.getByText(/Pick a project and Start/)).toBeTruthy()
  })

  it('moves between the tabs with the arrow keys', async () => {
    answer({ 'pilot.playground.projects': PROJECTS, 'pilot.playground.status': STOPPED })
    await shown()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Telemetry' }), { key: 'ArrowRight' })
    const commands = screen.getByRole('tab', { name: 'Commands', selected: true })
    expect(document.activeElement).toBe(commands)
    fireEvent.keyDown(commands, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Telemetry', selected: true })).toBeTruthy()
  })
})
