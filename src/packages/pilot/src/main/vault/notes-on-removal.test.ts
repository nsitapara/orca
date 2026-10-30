import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pilotcli, PilotcliReply } from '../envs/pilotcli'
import {
  archiveVaultNotesOnRemoval,
  archiveWhenGone,
  attachVaultNotesOnRemoval,
  type NotesOnRemovalDeps
} from './notes-on-removal'

const PATH = '/Users/me/Documents/worktrees/web-platform/web-2393-collect'

function deps(reply: Partial<PilotcliReply> = {}, existsFor = 0) {
  let polls = 0
  const pilotcli = vi
    .fn<Pilotcli>()
    .mockResolvedValue({ outcome: 'ok', reason: '', data: null, code: 0, ...reply })
  const d: NotesOnRemovalDeps = {
    pilotcli,
    exists: () => polls++ < existsFor,
    sleep: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn() }
  }
  return { d, pilotcli }
}

afterEach(() => attachVaultNotesOnRemoval(null))

describe('archiving a removed worktree’s vault notes', () => {
  it('runs delete-notes on the gone checkout, after waiting for it to go', async () => {
    const { d, pilotcli } = deps({}, 2)
    expect(await archiveWhenGone(d, PATH)).toBe('archived')
    expect(d.sleep).toHaveBeenCalledTimes(2)
    expect(pilotcli).toHaveBeenCalledWith({
      args: ['vault', 'delete-notes', PATH, '--format', 'json'],
      timeoutMs: 30_000
    })
  })

  it('leaves a checkout that stays (a Forget) alone', async () => {
    const { d, pilotcli } = deps({}, Infinity)
    expect(await archiveWhenGone(d, PATH)).toBe('kept')
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it.each([
    ['skip', 'skipped', false],
    ['invalid', 'failed', true],
    ['failed', 'failed', true]
  ] as const)('a %s from pilotcli is %s', async (outcome, result, warns) => {
    const { d } = deps({ outcome, reason: 'why' })
    expect(await archiveWhenGone(d, PATH)).toBe(result)
    expect(vi.mocked(d.log.warn).mock.calls.length > 0).toBe(warns)
  })

  it.each([
    ['a local removal', `repo-1::${PATH}`, undefined, 'worktree-removal', true],
    ['the local host named', `repo-1::${PATH}`, 'local', 'worktree-removal', true],
    ['a folder workspace', `repo-1::${PATH}`, undefined, 'folder-removal', false],
    ['another host', `repo-1::${PATH}`, 'ssh:box', 'worktree-removal', false],
    ['an id without a path', 'repo-1', undefined, 'worktree-removal', false]
  ] as const)('the hook on %s archives: %s', async (_, id, host, entry, runs) => {
    const { d, pilotcli } = deps()
    attachVaultNotesOnRemoval(d)
    archiveVaultNotesOnRemoval(id, host, entry)
    await vi.waitFor(() => expect(pilotcli.mock.calls.length > 0).toBe(runs))
  })

  it('does nothing before Pilot attaches it', () => {
    expect(() =>
      archiveVaultNotesOnRemoval(`repo-1::${PATH}`, undefined, 'worktree-removal')
    ).not.toThrow()
  })
})
