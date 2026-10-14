import { describe, expect, it, vi } from 'vitest'
import type { ActBridge } from './act-bridge'
import { EVIDENCE_ACTIONS } from '../../shared/evidence'
import { buildActionCatalog } from './catalog'
import { pushBranchEntry } from './push-branch'
import type { ActionEntry } from './types'

const act: ActBridge = {
  run: vi
    .fn()
    .mockResolvedValue({ outcome: 'done', detail: 'ok', link: null, log: null, onYou: false }),
  describe: vi.fn().mockResolvedValue('Post 2 findings on !1579'),
  refresh: vi.fn().mockResolvedValue(null),
  command: (script, argv) => ['python3', '/act.py', script, 'run', ...argv]
}

const push = pushBranchEntry({ pilotcli: vi.fn(), binary: () => '/bin/pilotcli' })

describe('buildActionCatalog', () => {
  it.each([
    ['mark_ready', 'mark-ready', 'mark_ready'],
    ['post_review', 'post-review', 'post']
  ])('%s runs act.py %s and needs %s', async (name, script, power) => {
    const entry = buildActionCatalog({ act, push, linear: null }).get(name)!
    expect(entry.power).toBe(power)
    await entry.run({ argv: ['a'] }, { dryRun: false, runId: 'r' })
    expect(act.run).toHaveBeenCalledWith(script, ['a'], { dryRun: false, runId: 'r' })
  })

  // R-P5's evidence-needing actions (shared/evidence.ts) are the catalog's own push and post_review.
  it('names real catalog entries as the evidence-needing actions', () => {
    const catalog = buildActionCatalog({ act, push, linear: null })
    expect([...EVIDENCE_ACTIONS].map((name) => catalog.get(name)?.name)).toEqual([
      'push',
      'post_review'
    ])
  })

  it("runs push through pilotcli's entry, never act.py", async () => {
    const catalog = buildActionCatalog({ act, push, linear: null })
    expect(catalog.get('push')).toBe(push)
    vi.mocked(act.run).mockClear()
    await catalog.get('push')!.run({ argv: ['x'] }, { dryRun: false, runId: null })
    expect(act.run).not.toHaveBeenCalled()
  })

  it('fails an act.py entry whose args are not { argv: string[] }', async () => {
    const entry = buildActionCatalog({ act, push, linear: null }).get('mark_ready')!
    expect(await entry.run({ argv: 'a' }, { dryRun: false, runId: null })).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('usage: mark_ready')
    })
  })

  it("takes an act.py entry's { argv: string[] }", () => {
    const entry = buildActionCatalog({ act, push, linear: null }).get('mark_ready')!
    expect(entry.checkArgs({ argv: ['1579', 'aaaa'] })).toBeNull()
  })

  it.each([[{ argv: 'a' }], [{ argv: ['a', 1] }], [{ argv: ['a'], write_id: 'x' }], [{}]])(
    "says why an act.py entry's args %j don't fit",
    (args) => {
      const entry = buildActionCatalog({ act, push, linear: null }).get('mark_ready')!
      expect(entry.checkArgs(args)).toMatch(/^usage: mark_ready /)
    }
  )

  it('hands a refreshed pinning back as args', async () => {
    vi.mocked(act.refresh).mockResolvedValueOnce({
      argv: ['1579', 'ffff'],
      changed: 'the head moved to ffff'
    })
    const entry = buildActionCatalog({ act, push, linear: null }).get('mark_ready')!
    expect(await entry.refresh!({ argv: ['1579', 'aaaa'] })).toEqual({
      args: { argv: ['1579', 'ffff'] },
      changed: 'the head moved to ffff'
    })
  })

  it('passes parts left out of a review as --except', () => {
    const entry = buildActionCatalog({ act, push, linear: null }).get('post_review')!
    expect(entry.exceptArgs!({ argv: ['1579', 'f.json', 'abc'] }, ['F2', 'F4'])).toEqual({
      argv: ['1579', 'f.json', 'abc', '--except', 'F2,F4']
    })
    expect(buildActionCatalog({ act, push, linear: null }).get('push')!.exceptArgs).toBeUndefined()
  })

  it('knows the Linear entries and extra ones, and nothing else', () => {
    const extra = { name: 'start_run', power: null } as ActionEntry
    const catalog = buildActionCatalog({ act, push, linear: null, extra: [extra] })
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
      buildActionCatalog({ act, push, linear: null, extra: [{ name: 'push' } as ActionEntry] })
    ).toThrow('Two catalog entries are named "push"')
  })
})
