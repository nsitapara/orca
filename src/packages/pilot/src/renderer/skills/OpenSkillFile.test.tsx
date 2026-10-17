// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerPilotStore, type PilotStoreState } from '../store'
import { OpenSkillFile, skillDocument } from './OpenSkillFile'

const SKILL = '/Users/me/.agents/skills/fix-gitlab-ci/SKILL.md'
const store: PilotStoreState = { rightSidebarOpen: false, setRightSidebarOpen: () => {} }

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.unstubAllGlobals()
})

describe('OpenSkillFile', () => {
  it("opens the skill's SKILL.md, then closes the details", async () => {
    registerPilotStore({ getState: () => store })
    const open = vi.fn(async () => {})
    const onOpened = vi.fn()
    render(<OpenSkillFile filePath={SKILL} onOpened={onOpened} open={open} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    })
    expect(open).toHaveBeenCalledWith(SKILL)
    expect(onOpened).toHaveBeenCalledTimes(1)
  })

  it('is not there without Pilot', () => {
    const { container } = render(<OpenSkillFile filePath={SKILL} onOpened={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('is not there in the browser version, which reads no files outside a worktree', () => {
    registerPilotStore({ getState: () => store })
    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    const { container } = render(<OpenSkillFile filePath={SKILL} onOpened={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it("names the tab after the skill's folder", () => {
    expect(skillDocument(SKILL)).toEqual({
      filePath: SKILL,
      relativePath: 'fix-gitlab-ci/SKILL.md'
    })
  })
})
