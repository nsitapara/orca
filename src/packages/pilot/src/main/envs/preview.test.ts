import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import type { PilotcliCall, PilotcliReply } from './pilotcli'
import { previewEnvs } from './preview'

const parsed = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nworkspace: { env: { worktree: "{worktree.path}", writes: true } }\nsteps: [ { agent: claude, prompt: x } ]\n',
  '/a/ci.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const DEF = parsed.definition
const decision = (over: Partial<ItemDecision> = {}): ItemDecision => ({
  key: 'mr:1',
  label: '!1',
  verdict: 'started',
  reason: 'All checks pass',
  checks: [],
  onceKey: '1',
  fields: { 'worktree.path': '/wt/a' },
  ...over
})
const reply = (outcome: PilotcliReply['outcome'], data: unknown, reason = ''): PilotcliReply => ({
  outcome,
  reason,
  data,
  code: 0
})

describe('the dry run’s workspace preview', () => {
  it.each([
    ['in place', reply('ok', { mode: 'in_place', reason: '' }), 'would run in place · stack never'],
    [
      'a throwaway',
      reply('ok', { mode: 'throwaway', reason: 'uncommitted changes' }),
      'would run in a throwaway: uncommitted changes · stack never'
    ],
    [
      'kept',
      reply('ok', { mode: 'kept', reason: 'new branch web-1' }),
      'would run in a kept worktree: new branch web-1 · stack never'
    ],
    [
      'not yet',
      reply('not_yet', null, 'the stack cap is reached'),
      'would wait: the stack cap is reached · stack never'
    ],
    [
      'refused',
      reply('invalid', null, 'not a worktree of a configured project'),
      'workspace check invalid: not a worktree of a configured project · stack never'
    ]
  ])('%s', async (_name, answer, line) => {
    const store = PilotStore.open(':memory:')
    const calls: PilotcliCall[] = []
    const d = decision()
    await previewEnvs(
      {
        runs: store.runs,
        pilotcli: async (c) => {
          calls.push(c)
          return answer
        },
        nameOf: (id) => id,
        now: () => 0
      },
      DEF,
      [d]
    )
    expect(d.workspace).toBe(line)
    expect(d.reason).toBe(`All checks pass · ${line}`)
    expect(calls[0].args).toEqual(expect.arrayContaining(['--dry-run', 'true']))
  })

  it('names a Pilot run holding the worktree with --throwaway, without claiming it', async () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'rv-1',
      automationId: 'review',
      tickId: null,
      itemKey: 'wt',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    const calls: PilotcliCall[] = []
    await previewEnvs(
      {
        runs: store.runs,
        pilotcli: async (c) => {
          calls.push(c)
          return reply('ok', { mode: 'throwaway', reason: 'x' })
        },
        nameOf: (id) => id,
        now: () => 0
      },
      DEF,
      [decision()]
    )
    expect(calls[0].args).toEqual(
      expect.arrayContaining(['--throwaway', 'review is already working in it (Pilot run rv-1)'])
    )
    expect(store.runs.runningInWorktree('/wt/a').map((r) => r.id)).toEqual(['rv-1'])
  })

  it('leaves decisions that start nothing, and says when the subject can’t be filled', async () => {
    const store = PilotStore.open(':memory:')
    const skipped = decision({ verdict: 'skipped', reason: 'Busy' })
    const empty = decision({ key: 'mr:2', fields: {} })
    await previewEnvs(
      {
        runs: store.runs,
        pilotcli: async () => reply('ok', { mode: 'in_place' }),
        nameOf: (id) => id,
        now: () => 0
      },
      DEF,
      [skipped, empty]
    )
    expect(skipped.reason).toBe('Busy')
    expect(skipped.workspace).toBeUndefined()
    expect(empty.workspace).toBe("Can't prepare the workspace for !1: {worktree.path} has no value")
  })

  it.each([
    [
      'a good value: the resolved stack',
      'when-backend',
      'would run in place · stack when_backend',
      1
    ],
    [
      'an empty value: the run’s error, no pilotcli call',
      '',
      "stack resolved to '', expected never|backend|full|when_backend",
      0
    ],
    [
      'a bad value: the same',
      'huge',
      "stack resolved to 'huge', expected never|backend|full|when_backend",
      0
    ]
  ])('a stack from a field, %s', async (_name, value, line, calls) => {
    const stacked = parseAutomationYaml(
      'name: Fix CI\nrepo: r\nschedule: manual\nitems:\n  kind: merge_request\n  fields:\n    stack: { script: ./stack.sh }\n' +
        'workspace: { env: { worktree: "{worktree.path}", stack: "{mr.stack}" } }\nsteps: [ { agent: claude, prompt: x } ]\n',
      '/a/ci.yaml'
    )
    if (!stacked.ok) {
      throw new Error(stacked.errors.join('\n'))
    }
    const store = PilotStore.open(':memory:')
    const made: PilotcliCall[] = []
    const d = decision({ fields: { 'worktree.path': '/wt/a', 'mr.stack': value } })
    await previewEnvs(
      {
        runs: store.runs,
        pilotcli: async (c) => {
          made.push(c)
          return reply('ok', { mode: 'in_place', reason: '' })
        },
        nameOf: (id) => id,
        now: () => 0
      },
      stacked.definition,
      [d]
    )
    expect(d.workspace).toBe(line)
    expect(made).toHaveLength(calls)
  })
})
