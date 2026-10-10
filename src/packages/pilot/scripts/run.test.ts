import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { runInherit } from './run.mjs'

describe('runInherit', () => {
  it('resolves the exit code of a command that exits normally', async () => {
    expect(await runInherit('sh', ['-c', 'exit 0'])).toBe(0)
    expect(await runInherit('sh', ['-c', 'exit 3'])).toBe(3)
  })

  it('treats a command killed by a signal as a failure', async () => {
    const stderr: string[] = []
    const realWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      expect(await runInherit('sh', ['-c', 'kill -TERM $$'])).not.toBe(0)
    } finally {
      process.stderr.write = realWrite
    }
    expect(stderr.join('')).toContain('sh was stopped by SIGTERM')
  })
})
