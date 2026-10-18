import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliHarness } from './__fixtures__/cli-harness'
import { copyBundle, rewriteBundle } from './__fixtures__/details-fixture'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

type Listed = {
  items: { id: string; details: { path: string; sha256: string } | null }[]
}

describe('a Details bundle through the CLI, the store and the details RPCs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('round-trips: add, list, details, image, then a re-add with a new bundle from a run step', async () => {
    // An add with a bundle needs a step of the card's automation (ruling 4).
    vi.stubEnv('PILOT_RUN_ID', 'run-1')
    vi.stubEnv('PILOT_STEP_IDX', '0')
    vi.stubEnv('PILOT_AUTOMATION_ID', '')
    vi.stubEnv('PILOT_ITEM_KEY', '')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { f, rpc, cli } = cliHarness()
    await cli([
      'inbox',
      'add',
      '--type',
      'question',
      '--title',
      'Keep the guard?',
      '--details-bundle',
      f.bundle,
      '--automation',
      'ci',
      '--item',
      'mr:1'
    ])

    const { items } = rpc('pilot.inbox.list', {}) as Listed
    expect(items).toHaveLength(1)
    const { id, details } = items[0]
    expect(details?.path).toBe(realpathSync(f.bundle))
    expect(details?.sha256).toBe(sha256(readFileSync(f.bundle)))

    const first = rpc('pilot.inbox.details', { id }) as {
      digest: string
      snapshot: { bundle: unknown }
    }
    expect(first.snapshot.bundle).toEqual(JSON.parse(readFileSync(f.bundle, 'utf8')))

    for (const file of ['F2-before.png', 'F2-after.png', 'F2-qa.png']) {
      const bytes = readFileSync(join(f.dir, file))
      expect(rpc('pilot.inbox.image', { id, digest: first.digest, file })).toEqual({
        mime: 'image/png',
        base64: bytes.toString('base64'),
        bytes: bytes.length
      })
    }
    expect(() => rpc('pilot.inbox.image', { id, digest: first.digest, file: 'F2.patch' })).toThrow(
      /^Details bundle refused: /
    )

    const versionBefore = (rpc('pilot.inbox.get', { id }) as { version: number }).version
    const changed = copyBundle(f, 'F2-v2.json')
    rewriteBundle(changed, (b) => {
      b.blocks[0].rows = [['Applies', 'a different fact']]
    })
    await cli([
      'inbox',
      'add',
      '--type',
      'question',
      '--title',
      'Keep the guard?',
      '--details-bundle',
      changed,
      '--automation',
      'ci',
      '--item',
      'mr:1'
    ])
    const second = rpc('pilot.inbox.details', { id }) as {
      digest: string
      snapshot: {
        bundle: { blocks: { rows: string[][] }[] }
        ref: { path: string }
      }
    }
    expect((rpc('pilot.inbox.get', { id }) as { version: number }).version).toBeGreaterThan(
      versionBefore
    )
    expect(second.digest).not.toBe(first.digest)
    expect(second.snapshot.bundle.blocks[0].rows).toEqual([['Applies', 'a different fact']])
    expect(second.snapshot.ref.path).toBe(realpathSync(changed))
  })
})
