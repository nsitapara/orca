import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { parseArgs, switchAutomations } from './switch-automations.mjs'

type Result = { code: number; stdout: string; stderr: string }
type Side = 'orca' | 'pilot'

const ok = (result: unknown): Result => ({
  code: 0,
  stdout: JSON.stringify({ ok: true, result }),
  stderr: ''
})
const noWait = { sleep: () => {}, delayMs: 0 }

// Two moved jobs that ran in Orca, and one you start by hand.
const RECORDS = {
  'o-05': { pilotId: 'p-05', name: '05 · Fix CI', orcaWasEnabled: true },
  'o-12': { pilotId: 'p-12', name: '12 · Apply answers', orcaWasEnabled: true },
  'o-m02': { pilotId: 'p-m02', name: 'M02 · Report', orcaWasEnabled: false }
}

type FakeOpts = {
  // Edits that report success but change nothing, as "<side> <id>".
  noEffect?: string[]
  sameRuntime?: boolean
}

// Each app as an in-memory CLI: `enabled` is keyed by automation id; `calls` records every edit in order.
function apps(enabled: Record<string, boolean>, opts: FakeOpts = {}) {
  const calls: string[] = []
  const cli =
    (side: Side) =>
    (args: string[]): Result => {
      if (args[0] === 'status') {
        return ok({ runtime: { runtimeId: opts.sameRuntime ? 'one' : `${side}-runtime` } })
      }
      const id = args[3]
      if (args[1] === 'show') {
        return ok({ automation: { id, enabled: enabled[id] } })
      }
      const on = args.includes('--enabled')
      calls.push(`${side} ${on ? 'enable' : 'disable'} ${id}`)
      if (!(opts.noEffect ?? []).includes(`${side} ${id}`)) {
        enabled[id] = on
      }
      return ok({ automation: { id, enabled: enabled[id] } })
    }
  return { clis: { orca: cli('orca'), pilot: cli('pilot') }, calls, enabled }
}

function runSwitch(to: Side, apply: boolean, fake: ReturnType<typeof apps>) {
  const lines: string[] = []
  const code = switchAutomations({
    to,
    apply,
    records: RECORDS,
    clis: fake.clis,
    log: (l: string) => lines.push(l),
    readOptions: noWait
  })
  return { code, lines }
}

const inPilot = () => ({
  'o-05': false,
  'o-12': false,
  'o-m02': false,
  'p-05': true,
  'p-12': true,
  'p-m02': false
})
const inOrca = () => ({
  'o-05': true,
  'o-12': true,
  'o-m02': false,
  'p-05': false,
  'p-12': false,
  'p-m02': false
})

describe('switch-automations', () => {
  it.each([
    ['orca', inPilot(), inOrca()],
    ['pilot', inOrca(), inPilot()]
  ] as const)(
    'to %s: off where it leaves before on where it goes; hand-started jobs stay off',
    (to, start, end) => {
      const fake = apps({ ...start })
      expect(runSwitch(to, true, fake).code).toBe(0)
      expect(fake.enabled).toEqual(end)
      const from = to === 'orca' ? 'pilot' : 'orca'
      expect(fake.calls).toEqual([
        `${from} disable ${from[0]}-05`,
        `${to} enable ${to[0]}-05`,
        `${from} disable ${from[0]}-12`,
        `${to} enable ${to[0]}-12`
      ])
    }
  )

  it('dry run changes nothing', () => {
    const fake = apps(inPilot())
    const { code, lines } = runSwitch('orca', false, fake)
    expect(code).toBe(0)
    expect(fake.calls).toEqual([])
    expect(lines).toContain('  05 · Fix CI: would disable in Pilot, then enable in Orca')
  })

  it('leaves a job that already runs in the target app alone', () => {
    const fake = apps(inOrca())
    expect(runSwitch('orca', true, fake).code).toBe(0)
    expect(fake.calls).toEqual([])
  })

  it('never enables the target when disabling the source did not take', () => {
    const fake = apps(inPilot(), { noEffect: ['pilot p-05'] })
    const { code, lines } = runSwitch('orca', true, fake)
    expect(code).toBe(1)
    expect(fake.calls).not.toContain('orca enable o-05')
    expect(fake.enabled['o-05']).toBe(false)
    expect(lines.join('\n')).toMatch(/05 · Fix CI: disabling in Pilot didn't take/)
    expect(fake.enabled['o-12']).toBe(true)
  })

  it('refuses before any edit when both CLIs reach the same app', () => {
    const fake = apps(inPilot(), { sameRuntime: true })
    expect(() => runSwitch('orca', true, fake)).toThrow(/both reach runtime one/)
    expect(fake.calls).toEqual([])
  })

  it.each([[[]], [['--to', 'both']], [['--apply']]])('rejects %j without a valid --to', (argv) => {
    expect(() => parseArgs(argv)).toThrow(/--to orca or --to pilot/)
  })
})
