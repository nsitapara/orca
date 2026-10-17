import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadDefinitions } from '../../src/main/definitions/loader'
import type { AutomationDefinition } from '../../src/shared/definition/types'
import { chainOf } from '../../src/shared/run-views/chain'
import { portedAutomationsDir } from './ported'

// Every key a live YAML may use, and whether the chain draws it (spec §1). A key in neither list fails: a new key is
// either drawn on the rail or named here as not drawn.
const SHOWN = {
  top: [
    'schedule',
    'timezone',
    'items',
    'once_per',
    'limits',
    'checks',
    'start',
    'ask_first',
    'workspace',
    'steps',
    'answers',
    'job'
  ],
  step: [
    'name',
    'agent',
    'skill',
    'mode',
    'prompt',
    'prompt_style',
    'run',
    'when',
    'always',
    'outputs'
  ],
  items: ['kind', 'where', 'match', 'fields']
}
// In the page's facts header or nowhere: none changes which parts run or who runs them.
const NOT_SHOWN = {
  top: [
    'name',
    'repo',
    'enabled',
    'missed_run_grace',
    'first_seen',
    'retry_after_failure',
    'powers',
    'inbox'
  ],
  step: ['env', 'timeout', 'exit_codes', 'hold_home', 'session', 'args'],
  items: [] as string[]
}
type KeyKind = keyof typeof SHOWN

const dir = portedAutomationsDir()
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.yaml') && f !== 'people.yaml')
  .sort()
const loaded = loadDefinitions([dir])

function byId(id: string): AutomationDefinition {
  const def = loaded.definitions.find((d) => d.id === id)
  if (!def) {
    throw new Error(`${id} isn't loaded`)
  }
  return def
}

const rows = (id: string): string[] =>
  chainOf(byId(id), loaded.definitions).map((p) => `${p.sub ? '↳' : ''}${p.name}:${p.who}`)

function unknownKeys(keys: string[], kind: KeyKind): string[] {
  return keys.filter((k) => !SHOWN[kind].includes(k) && !NOT_SHOWN[kind].includes(k))
}

describe('the chain of every live automation', () => {
  it('loads every file', () => {
    expect(loaded.errors).toEqual([])
  })

  it.each(files)('%s uses only keys the chain knows', (file) => {
    const raw = parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>
    const steps = (raw.steps as Record<string, unknown>[] | undefined) ?? []
    const items = typeof raw.items === 'object' && raw.items !== null ? Object.keys(raw.items) : []
    expect([
      ...unknownKeys(Object.keys(raw), 'top'),
      ...unknownKeys(
        steps.flatMap((s) => Object.keys(s)),
        'step'
      ),
      ...unknownKeys(items, 'items')
    ]).toEqual([])
  })

  it.each(files.map((f) => f.replace(/\.yaml$/, '')))(
    '%s shows every step, field script, check script and ask',
    (id) => {
      const def = byId(id)
      const parts = chainOf(def, loaded.definitions)
      expect(parts.filter((p) => p.kind === 'step').map((p) => [p.name, p.who])).toEqual(
        def.steps.map((s) => [s.name, s.agent === 'shell' ? 'script' : 'agent'])
      )
      expect(parts.filter((p) => p.kind === 'field').map((p) => p.runs)).toEqual(
        def.items?.customFields.map((f) => f.script) ?? []
      )
      expect(parts.filter((p) => p.kind === 'check').map((p) => p.runs)).toEqual(
        def.checks.flatMap((c) => (c.kind === 'script' ? [c.run] : []))
      )
      expect(parts.some((p) => p.kind === 'ask')).toBe(def.start === 'ask_first')
    }
  )

  it.each<[string, string[]]>([
    [
      'review-requests',
      [
        'Starts:pilot',
        'Picks:pilot',
        '↳head8:script',
        '↳card_context:script',
        'Asks you:you',
        'Workspace:pilot',
        'still_due:script',
        'checkout:script',
        'env:script',
        'prepare:agent',
        'guide:script',
        'teardown:script',
        'forget_guide:script',
        'Answers:you'
      ]
    ],
    [
      'dev-e2e-fix',
      [
        'Starts:pilot',
        'Picks:pilot',
        'Gates:pilot',
        'Workspace:pilot',
        'ticket:script',
        'Hands over:pilot'
      ]
    ],
    [
      'dev-e2e-fix-start',
      [
        'Starts:pilot',
        'Picks:pilot',
        '↳ids:script',
        'Gates:pilot',
        '↳Check pilotcli:script',
        'Workspace:pilot',
        'fix:agent',
        'Answers:you'
      ]
    ],
    [
      'fix-failed-ci',
      [
        'Starts:pilot',
        'Picks:pilot',
        'Gates:pilot',
        'Workspace:pilot',
        'context:script',
        'flag:script',
        'catch_up:script',
        'fix:agent',
        'push:script',
        'merge_back:script',
        'card:script',
        'forget_branch:script',
        'flag_failed:script',
        'Answers:you'
      ]
    ]
  ])('%s runs in this order', (id, expected) => {
    expect(rows(id)).toEqual(expected)
  })
})
