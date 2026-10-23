import { describe, expect, it } from 'vitest'
import { defaultScheduler, desktopEntry, paths } from './install-linux.mjs'

describe('install-linux', () => {
  it('keeps the window from ticking when this machine runs the headless engine', () => {
    expect(defaultScheduler('/h', (p: string) => p === paths('/h').engineUnit)).toBe('off')
    expect(defaultScheduler('/h', () => false)).toBeNull()
  })

  it('launches the installed app, with the scheduler setting when there is one', () => {
    const entry = desktopEntry({ app: '/h/.local/share/pilot-desktop/app', scheduler: 'off' })
    expect(entry).toContain(
      'Exec=env PILOT_SCHEDULER=off "/h/.local/share/pilot-desktop/app/pilot" %U'
    )
    expect(entry).toContain('StartupWMClass=pilot')
    expect(entry).toContain('MimeType=x-scheme-handler/pilot;')
    expect(desktopEntry({ app: '/a', scheduler: null })).toContain('Exec="/a/pilot" %U')
  })

  it("never takes the engine's `pilot` command", () => {
    expect(paths('/h').link).toBe('/h/.local/bin/pilot-desktop')
  })
})
