// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceIndex } from '../../shared/source-types'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const openFloating = vi.fn(async (_path: string) => {})
vi.mock('../skills/OpenSkillFile', () => ({
  openInFloatingWorkspace: (path: string) => openFloating(path)
}))

import { resetSourceIndex, SourceLink } from './SourceLink'

const INDEX: SourceIndex = {
  pilotcli: {
    root: '/src/pilotCLI',
    commands: { 'git push-branch': { file: 'internal/modules/git/push_branch.go', line: 84 } }
  },
  skillsDir: '/home/.agents/skills'
}

// pilot.sourceIndex.get answers the index; files.open answers or fails.
function serve(filesOpen: () => Promise<unknown>): void {
  pilotRpc.mockImplementation(async (method: string) =>
    method === 'pilot.sourceIndex.get' ? INDEX : filesOpen()
  )
}

async function click(part: { skill: string | null; runs: string }): Promise<void> {
  render(<SourceLink part={part} />)
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  openFloating.mockClear()
  resetSourceIndex()
  vi.unstubAllGlobals()
})

describe('SourceLink', () => {
  it("opens a pilotcli step's command at its line in the pilotCLI worktree", async () => {
    serve(async () => ({}))
    await click({ skill: null, runs: 'pilotcli git push-branch --checkout .' })
    expect(pilotRpc).toHaveBeenCalledWith('files.open', {
      worktree: 'path:/src/pilotCLI',
      relativePath: 'internal/modules/git/push_branch.go',
      line: 84
    })
    expect(openFloating).not.toHaveBeenCalled()
  })

  // source_root is where main is checked out now (pilotcli 7feb434); a click reads it again, so a link drawn before
  // main moved opens main's new worktree, not the old one.
  it('opens where the index says at the click, not where it said when the link was drawn', async () => {
    let root = '/src/pilotCLI-old'
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.sourceIndex.get' ? { ...INDEX, pilotcli: { ...INDEX.pilotcli!, root } } : {}
    )
    render(<SourceLink part={{ skill: null, runs: 'pilotcli git push-branch' }} />)
    await act(async () => {})
    root = '/src/pilotCLI'
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    })
    expect(pilotRpc).toHaveBeenCalledWith('files.open', {
      worktree: 'path:/src/pilotCLI',
      relativePath: 'internal/modules/git/push_branch.go',
      line: 84
    })
  })

  it('opens the file on its own when Pilot has no worktree there', async () => {
    serve(async () => {
      throw new Error('no worktree')
    })
    await click({ skill: null, runs: 'pilotcli git push-branch' })
    expect(openFloating).toHaveBeenCalledWith('/src/pilotCLI/internal/modules/git/push_branch.go')
  })

  it("opens an agent step's SKILL.md", async () => {
    serve(async () => ({}))
    await click({ skill: 'fix-gitlab-ci', runs: 'Claude · fix-gitlab-ci' })
    expect(openFloating).toHaveBeenCalledWith('/home/.agents/skills/fix-gitlab-ci/SKILL.md')
  })

  it('is not there for a step without known code, or without an index, or in the browser version', async () => {
    serve(async () => ({}))
    render(<SourceLink part={{ skill: null, runs: 'python3 sweep_envs.py' }} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull()
    cleanup()
    resetSourceIndex()
    pilotRpc.mockResolvedValue(null)
    render(<SourceLink part={{ skill: 'fix-gitlab-ci', runs: '' }} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull()
    cleanup()
    resetSourceIndex()
    pilotRpc.mockReset()
    serve(async () => ({}))
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    render(<SourceLink part={{ skill: null, runs: 'pilotcli git push-branch' }} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull()
    expect(pilotRpc).not.toHaveBeenCalled()
  })
})
