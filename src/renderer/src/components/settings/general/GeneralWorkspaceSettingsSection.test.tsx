// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import { GeneralWorkspaceSettingsSection } from './GeneralWorkspaceSettingsSection'
import type { ReactNode } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'

vi.mock('./WorkspaceDirectorySetting', () => ({ WorkspaceDirectorySetting: () => null }))
vi.mock('./OpenInMenuSetting', () => ({ OpenInMenuEditor: () => null }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderSection(updateSettings: (updates: Partial<GlobalSettings>) => void): void {
  act(() => {
    root.render(
      <GeneralWorkspaceSettingsSection
        page="folder"
        openInDraft={{} as never}
        settings={getDefaultSettings('/home/user')}
        updateSettings={updateSettings}
      />
    )
  })
}

describe('GeneralWorkspaceSettingsSection empty workspace surface', () => {
  it('defaults to the default agent and saves a Terminal pick', async () => {
    const updateSettings = vi.fn()
    renderSection(updateSettings)
    const radios = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Opening an Empty Workspace"] [role="radio"]'
      )
    ]
    const checked = radios.find((radio) => radio.getAttribute('aria-checked') === 'true')
    const terminal = radios.find((radio) => radio.textContent === 'Terminal')

    expect(checked?.textContent).toBe('Default agent')
    await act(async () => {
      terminal?.click()
    })

    expect(updateSettings).toHaveBeenCalledWith({ emptyWorkspaceOpenSurface: 'terminal' })
  })
})
