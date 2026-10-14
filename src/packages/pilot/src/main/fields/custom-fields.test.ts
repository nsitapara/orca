import { describe, expect, it, vi } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { PassFetchCache } from '../sources/fetch-cache'
import type { Item } from '../sources/types'
import { memoryFieldCache, TEST_ENGINE_ENV, testItem } from './__fixtures__/field-deps'
import { addCustomFields, parseFieldOutput, type CustomFieldDeps } from './custom-fields'
import type { ScriptRequest, ScriptResult } from './script-runner'

const passOf = (passId: string) => ({ passId }) as unknown as PassFetchCache
const field = {
  name: 'failed_specs',
  script: './fields/failed-specs.sh',
  cache: 'per_head' as const,
  timeoutMs: 30_000
}
const def = testDefinition({
  id: 'fix-ci',
  file: '/auto/fix-ci.yaml',
  items: { kind: 'merge_request', where: {}, match: [], customFields: [field] }
})
const withCache = (cache: 'per_tick' | 'per_head') =>
  testDefinition({
    ...def,
    items: { kind: 'merge_request', where: {}, match: [], customFields: [{ ...field, cache }] }
  })
const ok = (stdout: string): ScriptResult => ({ code: 0, stdout, stderr: '', timedOut: false })

function depsWith(result: (req: ScriptRequest) => ScriptResult | Promise<ScriptResult>) {
  const runScript = vi.fn(async (req: ScriptRequest) => result(req))
  const deps: CustomFieldDeps = {
    cache: memoryFieldCache(),
    runScript,
    engineEnv: TEST_ENGINE_ENV,
    now: () => 7
  }
  return { deps, runScript }
}
const opts = (pass = 'p1', inScope: (item: Item) => boolean = () => true) => ({
  inScope,
  repoPath: '/repo',
  pass: passOf(pass)
})

describe('parseFieldOutput', () => {
  it.each<[string, unknown]>([
    ['3\n', 3],
    [' true ', true],
    ['null', null],
    ['"a b"', 'a b'],
    ['spec/a.ts spec/b.ts', 'spec/a.ts spec/b.ts'],
    ['{"a":1}', '{"a":1}'],
    ['', '']
  ])('%j → %j', (stdout, value) => {
    expect(parseFieldOutput(stdout)).toEqual(value)
  })
})

describe('addCustomFields', () => {
  it.each<[string, ScriptResult, string]>([
    [
      'its last line, stdout first',
      { code: 3, stdout: 'checking\npipeline still running\n', stderr: 'warn\n', timedOut: false },
      'pipeline still running'
    ],
    [
      'stderr when stdout is empty',
      { code: 3, stdout: '', stderr: 'no backend change yet\n', timedOut: false },
      'no backend change yet'
    ],
    [
      'a plain reason when it said nothing',
      { code: 3, stdout: '', stderr: '', timedOut: false },
      "Field mr.failed_specs isn't due now (exit 3)"
    ]
  ])(
    'exit 3 marks the item not due now, with %s: no warning, no value, nothing cached',
    async (_n, res, reason) => {
      const { deps, runScript } = depsWith(() => res)
      const item = testItem({ key: 'mr:1', label: '!1', fields: { 'mr.head_sha': 'abc' } })
      const out = await addCustomFields(def, [item], opts('p1'), deps)
      expect(out.notDue).toEqual(new Map([['mr:1', reason]]))
      expect(out.warnings).toEqual([])
      expect(out.items[0].fields['mr.failed_specs']).toBeNull()
      await addCustomFields(def, [item], opts('p2'), deps)
      expect(runScript).toHaveBeenCalledTimes(2)
    }
  )

  it("runs no later field script for an item that isn't due", async () => {
    const two = testDefinition({
      ...def,
      items: {
        kind: 'merge_request',
        where: {},
        match: [],
        customFields: [{ ...field, name: 'stack' }, field]
      }
    })
    const { deps, runScript } = depsWith(() => ({
      code: 3,
      stdout: 'not yet\n',
      stderr: '',
      timedOut: false
    }))
    const out = await addCustomFields(two, [testItem({ key: 'mr:1' })], opts(), deps)
    expect(runScript).toHaveBeenCalledTimes(1)
    expect(out.notDue.get('mr:1')).toBe('not yet')
  })

  it('runs the script in the main checkout with the item on stdin, and names the field by kind', async () => {
    const { deps, runScript } = depsWith(() => ok('2'))
    const item = testItem({
      key: 'mr:1561',
      label: '!1561',
      fields: { 'mr.iid': 1561, 'mr.head_sha': 'abc' }
    })
    const out = await addCustomFields(def, [item], opts(), deps)
    expect(out.items[0].fields['mr.failed_specs']).toBe(2)
    const [req] = runScript.mock.calls[0]
    expect(req).toMatchObject({
      command: "'/auto/fields/failed-specs.sh'",
      cwd: '/repo',
      timeoutMs: 30_000,
      env: {
        PATH: expect.stringMatching(/^\/pilot\/bin:/),
        ORCA_USER_DATA_PATH: '/pilot/data',
        PILOT_AUTOMATION_ID: 'fix-ci',
        PILOT_ITEM_KEY: 'mr:1561',
        PILOT_FIELD: 'mr.failed_specs'
      }
    })
    expect(JSON.parse(req.stdin)).toEqual({
      key: 'mr:1561',
      label: '!1561',
      fields: { 'mr.iid': 1561, 'mr.head_sha': 'abc' }
    })
  })

  it.each<[string, 'per_tick' | 'per_head', [string, string], [string, string], number]>([
    [
      'per_head reuses the value while the head is unchanged',
      'per_head',
      ['abc', 'abc'],
      ['p1', 'p2'],
      1
    ],
    ['per_head runs again on a new head', 'per_head', ['abc', 'def'], ['p1', 'p1'], 2],
    ['per_tick reuses the value within one pass', 'per_tick', ['abc', 'def'], ['p1', 'p1'], 1],
    ['per_tick runs again in the next pass', 'per_tick', ['abc', 'abc'], ['p1', 'p2'], 2]
  ])('%s', async (_name, cache, heads, passes, runs) => {
    const { deps, runScript } = depsWith(() => ok('1'))
    for (const i of [0, 1]) {
      await addCustomFields(
        withCache(cache),
        [testItem({ fields: { 'mr.head_sha': heads[i] } })],
        opts(passes[i]),
        deps
      )
    }
    expect(runScript).toHaveBeenCalledTimes(runs)
  })

  it('keys per_head on the worktree head when the MR has none, and never caches without a head', async () => {
    const { deps, runScript } = depsWith(() => ok('1'))
    const onWorktree = testItem({ fields: { 'worktree.head': 'h1' } })
    await addCustomFields(def, [onWorktree], opts('p1'), deps)
    await addCustomFields(def, [onWorktree], opts('p2'), deps)
    expect(runScript).toHaveBeenCalledTimes(1)
    const headless = testItem({ key: 'mr:2', fields: {} })
    await addCustomFields(def, [headless], opts('p1'), deps)
    await addCustomFields(def, [headless], opts('p1'), deps)
    expect(runScript).toHaveBeenCalledTimes(3)
  })

  it("gives null and a warning when the script fails, and doesn't cache the failure", async () => {
    let code = 2
    const { deps, runScript } = depsWith(() => ({
      code,
      stdout: '',
      stderr: 'glab: 401\n',
      timedOut: false
    }))
    const item = testItem({ label: '!1561', fields: { 'mr.head_sha': 'abc' } })
    const first = await addCustomFields(def, [item], opts('p1'), deps)
    expect(first.items[0].fields['mr.failed_specs']).toBeNull()
    expect(first.warnings).toEqual(['Field mr.failed_specs for !1561 exited 2: glab: 401'])
    code = 0
    const second = await addCustomFields(def, [item], opts('p2'), deps)
    expect(runScript).toHaveBeenCalledTimes(2)
    expect(second.warnings).toEqual([])
  })

  it.each<[string, ScriptResult | Error, string]>([
    [
      'times out',
      { code: null, stdout: '', stderr: '', timedOut: true },
      'Field mr.failed_specs for !1 timed out after 30s'
    ],
    [
      "can't start",
      new Error('spawn /bin/sh ENOENT'),
      "Field mr.failed_specs for !1 couldn't start: spawn /bin/sh ENOENT"
    ]
  ])('warns when the script %s', async (_name, result, warning) => {
    const { deps } = depsWith(() => {
      if (result instanceof Error) {
        throw result
      }
      return result
    })
    const out = await addCustomFields(def, [testItem({ label: '!1' })], opts(), deps)
    expect(out.warnings).toEqual([warning])
  })

  it('leaves out-of-scope items without custom fields', async () => {
    const { deps } = depsWith(() => ok('1'))
    const items = [testItem({ key: 'mr:1' }), testItem({ key: 'mr:2' })]
    const out = await addCustomFields(
      def,
      items,
      opts('p1', (i) => i.key === 'mr:1'),
      deps
    )
    expect(out.items.map((i) => i.fields['mr.failed_specs'])).toEqual([1, undefined])
  })
})
