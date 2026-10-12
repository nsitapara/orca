import { describe, expect, it, vi } from 'vitest'
import { readOpenVaultItems } from './vault-reader'

describe('readOpenVaultItems', () => {
  it("runs vault.py export-open as Pilot's own process and reads its JSON", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: '[{"key":"abc"}]\n', stderr: '', timedOut: false })
    expect(
      await readOpenVaultItems({
        vaultPy: '/v.py',
        python: 'python3',
        run,
        env: { PATH: '/bin', PILOT_RUN_ID: 'x' }
      })
    ).toEqual([{ key: 'abc' }])
    expect(run).toHaveBeenCalledWith({
      program: 'python3',
      args: ['/v.py', 'export-open'],
      env: { PATH: '/bin', PILOT_BRIDGE: '1', AGENT_RUN: 'pilot' },
      timeoutMs: 120_000
    })
  })

  it('says why when vault.py fails', async () => {
    const run = vi.fn().mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'Traceback: no module vault',
      timedOut: false
    })
    await expect(readOpenVaultItems({ run })).rejects.toThrow(
      'vault.py export-open failed (exit 1): Traceback: no module vault'
    )
  })
})
