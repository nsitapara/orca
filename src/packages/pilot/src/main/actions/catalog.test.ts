import { describe, expect, it, vi } from 'vitest'
import type { ActBridge } from './act-bridge'
import { buildActionCatalog } from './catalog'
import type { ActionEntry } from './types'

const act: ActBridge = {
  run: vi
    .fn()
    .mockResolvedValue({ outcome: 'done', detail: 'ok', link: null, log: null, onYou: false }),
  describe: vi.fn().mockResolvedValue('Post 2 findings on !1579'),
  refresh: vi.fn().mockResolvedValue(null),
  command: (script, argv) => ['python3', '/act.py', script, 'run', ...argv]
}

describe('buildActionCatalog', () => {
  it.each([
    ['push', 'push', 'push'],
    ['mark_ready', 'mark-ready', 'mark_ready'],
    ['post_review', 'post-review', 'post']
  ])('%s runs act.py %s and needs %s', async (name, script, power) => {
    const entry = buildActionCatalog({ act, linear: null }).get(name)!
    expect(entry.power).toBe(power)
    await entry.run({ argv: ['a'] }, { dryRun: false, runId: 'r' })
    expect(act.run).toHaveBeenCalledWith(script, ['a'], { dryRun: false, runId: 'r' })
  })

  it('fails an act.py entry whose args are not { argv: string[] }', async () => {
    const entry = buildActionCatalog({ act, linear: null }).get('push')!
    expect(await entry.run({ argv: 'a' }, { dryRun: false, runId: null })).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('usage: push')
    })
  })

  it("takes an act.py entry's { argv: string[] }", () => {
    const push = buildActionCatalog({ act, linear: null }).get('push')!
    expect(push.checkArgs({ argv: ['/wt', 'b', 'aaa', 'bbb'] })).toBeNull()
  })

  it.each([[{ argv: 'a' }], [{ argv: ['a', 1] }], [{ argv: ['a'], write_id: 'x' }], [{}]])(
    "says why an act.py entry's args %j don't fit",
    (args) => {
      const push = buildActionCatalog({ act, linear: null }).get('push')!
      expect(push.checkArgs(args)).toMatch(/^usage: push /)
    }
  )

  it('hands a refreshed pinning back as args', async () => {
    vi.mocked(act.refresh).mockResolvedValueOnce({
      argv: ['1579', 'ffff'],
      changed: 'the head moved to ffff'
    })
    const entry = buildActionCatalog({ act, linear: null }).get('mark_ready')!
    expect(await entry.refresh!({ argv: ['1579', 'aaaa'] })).toEqual({
      args: { argv: ['1579', 'ffff'] },
      changed: 'the head moved to ffff'
    })
  })

  it('passes parts left out of a review as --except', () => {
    const entry = buildActionCatalog({ act, linear: null }).get('post_review')!
    expect(entry.exceptArgs!({ argv: ['1579', 'f.json', 'abc'] }, ['F2', 'F4'])).toEqual({
      argv: ['1579', 'f.json', 'abc', '--except', 'F2,F4']
    })
    expect(buildActionCatalog({ act, linear: null }).get('push')!.exceptArgs).toBeUndefined()
  })

  it('knows the Linear entries and extra ones, and nothing else', () => {
    const extra = { name: 'start_run', power: null } as ActionEntry
    const catalog = buildActionCatalog({ act, linear: null, extra: [extra] })
    expect(catalog.entries().map((e) => e.name)).toEqual([
      'push',
      'mark_ready',
      'post_review',
      'linear_create',
      'linear_comment',
      'linear_set_state',
      'linear_attach',
      'start_run'
    ])
    expect(catalog.get('deploy')).toBeNull()
    expect(catalog.get('constructor')).toBeNull()
  })

  it('refuses two entries with one name', () => {
    expect(() =>
      buildActionCatalog({ act, linear: null, extra: [{ name: 'push' } as ActionEntry] })
    ).toThrow('Two catalog entries are named "push"')
  })
})
