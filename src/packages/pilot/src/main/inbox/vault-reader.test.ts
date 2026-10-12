import { describe, expect, it, vi } from 'vitest'
import { readOpenVaultItems } from './vault-reader'

const ROW = { note: '/v/n.md', key: 'abc', kind: 'question', summary: 'Which?', options: [] }

describe('readOpenVaultItems', () => {
  it("runs vault.py export-open as Pilot's own process and reads its JSON", async () => {
    const run = vi.fn().mockResolvedValue({
      code: 0,
      stdout: `[${JSON.stringify(ROW)}]\n`,
      stderr: '',
      timedOut: false
    })
    expect(
      await readOpenVaultItems({
        vaultPy: '/v.py',
        python: 'python3',
        run,
        env: { PATH: '/bin', PILOT_RUN_ID: 'x' }
      })
    ).toEqual([ROW])
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

  it.each([
    ['[1]', 'row 0 is not an object'],
    ['{"a":1}', 'vault.py export-open did not print a list'],
    ['[{"note":"n"}]', 'vault.py is older than Pilot expects: row 0 has no "key"'],
    [
      '[{"note":"n","key":"k","kind":"question","summary":"s","options":"x"}]',
      'row 0: "options" must be a list'
    ]
  ])('refuses %s', async (stdout, message) => {
    const run = vi.fn().mockResolvedValue({ code: 0, stdout, stderr: '', timedOut: false })
    await expect(readOpenVaultItems({ run })).rejects.toThrow(message)
  })
})
