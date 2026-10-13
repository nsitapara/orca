import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { loadDetails, readDetailsImage } from './details-bundle'
import { ReviewFileSchema } from './details-schema'
import { validatePreparationEvidence } from './details-preparation'

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
function prepared() {
  const fixture = detailsFixture()
  const patch = hash(readFileSync(join(fixture.dir, 'F2.patch')))
  writeFileSync(join(fixture.dir, 'checks.log'), 'Tests: 3 passed')
  rewriteBundle(fixture.bundle, (bundle) => {
    bundle.provenance = {
      originatingRunId: 'origin',
      preparingRunId: 'worker',
      itemId: 'item',
      attempt: 1
    }
    bundle.blocks = bundle.blocks.filter((block) => block.type !== 'missing')
    const diff = bundle.blocks.find((block) => block.type === 'diff')!
    diff.patch_sha256 = patch
    diff.check_records = [
      {
        command: 'pnpm test',
        exit_code: 0,
        output: 'checks.log',
        output_sha256: hash('Tests: 3 passed'),
        base: diff.base,
        patch_sha256: patch
      }
    ]
  })
  return fixture
}

describe('preparation evidence', () => {
  it('records artifact roles, content hashes, run provenance and tags from verified files', () => {
    const f = prepared()
    const snapshot = loadDetails(f.root, f.bundle)
    expect(validatePreparationEvidence(snapshot, ['context', 'diff', 'screens', 'checks'])).toEqual(
      []
    )
    expect(snapshot.ref.artifacts).toMatchObject({
      provenance: {
        originatingRunId: 'origin',
        preparingRunId: 'worker',
        itemId: 'item',
        attempt: 1
      },
      generated: ['context', 'diff', 'screens', 'checks'],
      tags: ['drafted fix', 'diff +1 −1', 'before / after', '1 screenshot'],
      files: expect.arrayContaining([
        expect.objectContaining({ role: 'patch', ref: 'F2.patch' }),
        expect.objectContaining({ role: 'before', ref: 'F2-before.png' }),
        expect.objectContaining({ role: 'after', ref: 'F2-after.png' }),
        expect.objectContaining({
          role: 'check',
          ref: 'checks.log',
          sha256: hash('Tests: 3 passed')
        })
      ])
    })
  })

  it.each(['patch', 'checks', 'displayed diff', 'screenshot pair', 'missing slot'] as const)(
    'rejects incomplete or mismatched %s',
    (kind) => {
      const f = prepared()
      if (kind === 'patch') {
        writeFileSync(join(f.dir, 'F2.patch'), 'changed')
      }
      if (kind === 'checks') {
        writeFileSync(join(f.dir, 'checks.log'), 'Tests failed')
      }
      rewriteBundle(f.bundle, (bundle) => {
        if (kind === 'displayed diff') {
          bundle.blocks.find((block) => block.type === 'diff')!.files = []
        }
        if (kind === 'screenshot pair') {
          bundle.blocks.find((block) => block.type === 'screens')!.pairs = [
            { before: 'F2-before.png' }
          ]
        }
        if (kind === 'missing slot') {
          bundle.blocks.push({
            type: 'missing',
            slot: 'screens',
            what: 'Dark mode',
            why: 'Not captured'
          })
        }
      })
      if (kind === 'missing slot') {
        expect(validatePreparationEvidence(loadDetails(f.root, f.bundle), ['context'])).toEqual([])
      }
      expect(
        validatePreparationEvidence(loadDetails(f.root, f.bundle), ['diff', 'screens', 'checks'])
          .length
      ).toBeGreaterThan(0)
    }
  )

  it.each(['diff', 'screens', 'checks', 'review'] as const)(
    'rejects invalid attached %s even when only context was required',
    (kind) => {
      const f = prepared()
      rewriteBundle(f.bundle, (bundle) => {
        if (kind === 'diff') {
          bundle.blocks.find((block) => block.type === 'diff')!.patch_sha256 = '0'.repeat(64)
        }
        if (kind === 'screens') {
          bundle.blocks.find((block) => block.type === 'screens')!.pairs = [
            { before: 'F2-before.png' }
          ]
        }
        if (kind === 'checks') {
          bundle.blocks.find((block) => block.type === 'diff')!.check_records = []
        }
        if (kind === 'review') {
          bundle.blocks.push({ type: 'review', file: 'sample-review.json' })
        }
      })
      if (kind === 'review') {
        const path = join(f.dir, 'sample-review.json')
        const review = ReviewFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
        writeFileSync(
          path,
          JSON.stringify({
            ...review,
            parts: review.parts.map((part) => ({ ...part, comment: '' }))
          })
        )
      }
      expect(validatePreparationEvidence(loadDetails(f.root, f.bundle), ['context'])).not.toEqual(
        []
      )
    }
  )

  it('requires the exact validated review comments and rejects a narrative-only substitute', () => {
    const f = prepared()
    const narrative = loadDetails(f.root, f.bundle)
    expect(validatePreparationEvidence(narrative, ['review'])).not.toEqual([])
    rewriteBundle(f.bundle, (bundle) =>
      bundle.blocks.push({ type: 'review', file: 'sample-review.json' })
    )
    const snapshot = loadDetails(f.root, f.bundle)
    expect(validatePreparationEvidence(snapshot, ['review'])).toEqual([])
    snapshot.texts['sample-review.json'] = '{}'
    expect(validatePreparationEvidence(snapshot, ['review'])).not.toEqual([])
  })

  it('reviews a committed range without granting approval to apply it again', () => {
    const f = prepared()
    rewriteBundle(f.bundle, (bundle) => {
      const diff = bundle.blocks.find((block) => block.type === 'diff')!
      diff.patch_kind = 'committed'
      diff.head = '8'.repeat(40)
    })
    const snapshot = loadDetails(f.root, f.bundle)
    expect(validatePreparationEvidence(snapshot, ['diff', 'checks'])).toEqual([])
    expect(snapshot.ref.drafted).toBe(false)
    expect(snapshot.ref.summary).not.toContain('drafted fix')
  })

  it('refuses images changed after validation while retaining legacy snapshot compatibility', () => {
    const f = prepared()
    const snapshot = loadDetails(f.root, f.bundle)
    writeFileSync(join(f.dir, 'F2-before.png'), 'different bytes')
    expect(() => readDetailsImage(f.root, snapshot, 'F2-before.png')).toThrow(
      'changed after context was prepared'
    )
  })
})
