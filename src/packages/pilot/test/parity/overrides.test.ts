import { describe, expect, it } from 'vitest'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { failed, mrFields, ok, parityFixture, withListing, withScripts } from './overrides'

const deps = {
  sources: { list: async () => ({ items: [], warnings: ['real'] }), scope: () => null },
  fields: { runScript: async () => ok('real') }
} as unknown as TickDeps

describe('parity overrides', () => {
  it('withListing replaces the listing only', async () => {
    const swapped = withListing(deps, [])
    expect(await swapped.sources.list({} as never, {} as never)).toEqual({
      items: [],
      warnings: []
    })
    expect(swapped.sources.scope).toBe(deps.sources.scope)
  })

  it('withScripts answers what it knows and runs the real script for null', async () => {
    const swapped = withScripts(deps, (req) => (req.command === 'known' ? failed('no') : null))
    const ask = (command: string) => swapped.fields.runScript({ command } as never)
    expect(await ask('known')).toMatchObject({ code: 1, stderr: 'no\n' })
    expect(await ask('other')).toMatchObject({ code: 0, stdout: 'real' })
  })

  it('mrFields gives gate.py’s reasons: owner, finished, then approvals', () => {
    expect(mrFields({ iid: 7, state: 'opened', author: 'alex' })).toMatchObject({
      'mr.owner_block': "!7 is alex's MR",
      'mr.review_block': "!7 is alex's MR"
    })
    expect(mrFields({ iid: 7, state: 'merged', author: 'nish8' })).toMatchObject({
      'mr.finished_block': '!7 merged',
      'mr.review_block': '!7 merged'
    })
    expect(
      mrFields({ iid: 7, state: 'opened', author: 'nish8', approvedBy: ['a', 'b'] })[
        'mr.review_block'
      ]
    ).toBe('!7 approved by a, b')
    expect(
      mrFields({ iid: 7, state: 'opened', author: 'nish8', approvalError: 'down' })[
        'mr.review_block'
      ]
    ).toBe('MR approval unknown: down')
  })

  it('parityFixture lists the worktrees and reads their git facts', () => {
    const f = parityFixture('13', 'c', 5, {
      worktrees: [{ id: 'w', path: '/wt/a', branch: 'a' }],
      porcelain: { '/wt/a': ' M x\n' }
    })
    const status = f.reads.find((r) => r.argv.join(' ') === 'git -C /wt/a status --porcelain')
    expect(status?.stdout).toBe(' M x\n')
    expect(f.exists['/parity/gitdirs/wt/a/index.lock']).toBe(false)
    expect(f.exists['/wt/a']).toBe(true)
  })
})
