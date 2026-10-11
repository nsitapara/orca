import { lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { EMPTY_PEOPLE } from '../../shared/people'
import type { LoadedDefinitions } from '../definitions/loader'
import type { PilotContext } from '../pilot-services'
import { PilotStore } from '../store/store'
import { setAutomationEnabled, setEnabledInYaml } from './automation-files'

const VALID =
  'name: Fix failed CI\nrepo: web-platform\nschedule: "10 * * * *"   # hourly\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: Fix it } ]\n'

describe('setEnabledInYaml', () => {
  it.each([
    [
      'flips the enabled line and keeps its comment',
      'name: x\nschedule: manual\nenabled: true   # parked later\nsteps: []\n',
      false,
      'name: x\nschedule: manual\nenabled: false   # parked later\nsteps: []\n'
    ],
    [
      'adds enabled under schedule when there is none',
      VALID,
      false,
      VALID.replace('# hourly\n', '# hourly\nenabled: false\n')
    ],
    [
      'leaves a file that already says so unchanged',
      'name: x\nschedule: manual\nenabled: false\n',
      false,
      'name: x\nschedule: manual\nenabled: false\n'
    ],
    [
      'never edits an indented enabled',
      'name: x\nschedule: manual\nitems:\n  enabled: true\n',
      false,
      'name: x\nschedule: manual\nenabled: false\nitems:\n  enabled: true\n'
    ]
  ])('%s', (_n, text, enabled, expected) => expect(setEnabledInYaml(text, enabled)).toBe(expected))
})

// The context reads the one file the way the loader does, so a reload sees the new text.
function setup(text: string, opts: { link?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-enable-'))
  const target = join(dir, 'real-fix-ci.yaml')
  writeFileSync(target, text)
  const file = join(dir, 'fix-ci.yaml')
  if (opts.link) {
    symlinkSync(target, file)
  } else {
    writeFileSync(file, text)
  }
  const load = (): LoadedDefinitions => {
    const parsed = parseAutomationYaml(readFileSync(file, 'utf8'), file)
    return {
      definitions: parsed.ok ? [parsed.definition] : [],
      errors: [],
      people: EMPTY_PEOPLE,
      peopleError: null,
      missingDirs: []
    } as LoadedDefinitions
  }
  let loaded = load()
  const ctx = {
    processKind: 'main',
    store: PilotStore.open(join(dir, 'db.sqlite')),
    dirs: [dir],
    loaded: () => loaded,
    reload: () => (loaded = load()),
    scheduler: { nextTickAt: () => null }
  } as unknown as PilotContext
  return { ctx, file, target }
}

describe('setAutomationEnabled', () => {
  it('writes enabled: false into the file, reloads, and returns the new summary', () => {
    const { ctx, file } = setup(VALID)
    expect(setAutomationEnabled(ctx, 'fix-ci', false)).toMatchObject({
      id: 'fix-ci',
      enabled: false
    })
    expect(readFileSync(file, 'utf8')).toContain('# hourly\nenabled: false\n')
  })

  it("refuses, leaving the file alone, when the edit wouldn't parse", () => {
    const flow =
      '{ name: X, repo: r, schedule: manual, items: { kind: merge_request }, steps: [ { agent: claude, prompt: x } ] }\n'
    const { ctx, file } = setup(flow)
    expect(() => setAutomationEnabled(ctx, 'fix-ci', false)).toThrow(
      `Couldn't set enabled: false in ${file}; edit it by hand`
    )
    expect(readFileSync(file, 'utf8')).toBe(flow)
  })

  it('follows a linked file: the link stays, its target changes', () => {
    const { ctx, file, target } = setup(VALID, { link: true })
    setAutomationEnabled(ctx, 'fix-ci', false)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('enabled: false')
  })
})
