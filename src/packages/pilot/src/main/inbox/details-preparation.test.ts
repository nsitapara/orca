import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { loadDetails, readDetailsImage } from './details-bundle'
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
    // F2.json's sample hunk trims its context; a prepared diff shows the patch's rows exactly.
    ;(diff.files as { hunks: unknown }[])[0].hunks = [
      [
        [194, 194, ' ', '  const pending = useHasEdits()'],
        [195, null, '-', '  useBlocker(true)'],
        [null, 195, '+', '  useBlocker(pending)'],
        [196, 196, ' ', '  return routing'],
        [197, 197, ' ', '}']
      ]
    ]
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

// details.py trims a big diff: past its row cap (4,000 rows shown so far) a file keeps its counts but loses its hunks
// (`omitted`), and past its file cap (60) the rest are dropped and counted in `more_files`. The patch has them all.
// This patch: f0 (1 row), f1 (4,001 rows: past the cap, omitted), f2..f59 (1 row each), and f60 (dropped).
const newFile = (name: string, rows: number) => [
  `diff --git a/${name} b/${name}`,
  'new file mode 100644',
  '--- /dev/null',
  `+++ b/${name}`,
  `@@ -0,0 +1,${rows} @@`,
  ...Array.from({ length: rows }, (_, n) => `+line ${n}`)
]
const NAMES = Array.from({ length: 61 }, (_, n) => `f${n}.ts`)
const TRIMMED_PATCH = [...NAMES.flatMap((name, n) => newFile(name, n === 1 ? 4001 : 1)), ''].join(
  '\n'
)
type ShownFile = {
  path: string
  added: number
  removed: number
  hunks: unknown[]
  omitted?: boolean
  old_path?: string
}
function trimmed(change: (diff: { files: ShownFile[]; more_files?: number }) => void = () => {}) {
  const f = prepared()
  writeFileSync(join(f.dir, 'F2.patch'), TRIMMED_PATCH)
  const patch = hash(TRIMMED_PATCH)
  rewriteBundle(f.bundle, (bundle) => {
    const diff = bundle.blocks.find((block) => block.type === 'diff')!
    diff.patch_sha256 = patch
    diff.check_records = (diff.check_records as { patch_sha256: string }[]).map((check) => ({
      ...check,
      patch_sha256: patch
    }))
    diff.files = NAMES.slice(0, 60).map((path, n): ShownFile => {
      if (n === 1) {
        return { path, added: 4001, removed: 0, hunks: [], omitted: true }
      }
      return { path, added: 1, removed: 0, hunks: [[[null, 1, '+', 'line 0']]] }
    })
    diff.more_files = 1
    change(diff as never)
  })
  return f
}

describe('a trimmed diff (details.py past its row or file cap)', () => {
  it('passes when its shown files, omitted counts and more_files all match the hashed patch', () => {
    const f = trimmed()
    expect(
      validatePreparationEvidence(loadDetails(f.root, f.bundle, { prepared: true }), [
        'context',
        'diff',
        'checks'
      ])
    ).toEqual([])
  })

  it.each<[string, (diff: { files: ShownFile[]; more_files?: number }) => void]>([
    ['an omitted file whose count lies', (diff) => void (diff.files[1].added = 5)],
    ['a lying more_files', (diff) => void (diff.more_files = 2)],
    [
      'a hidden extra file (no more_files for a dropped one)',
      (diff) => void delete diff.more_files
    ],
    [
      'a shown file the patch does not have',
      (diff) =>
        void (diff.files[5] = { path: 'd.ts', added: 1, removed: 0, hunks: [], omitted: true })
    ],
    ['a file shown twice', (diff) => void (diff.files[3] = { ...diff.files[2] })],
    ['a shown file with no hunks', (diff) => void (diff.files[0].hunks = [])],
    [
      'a mismatched hunk on a shown file (its text)',
      (diff) => void ((diff.files[0].hunks as unknown[][][])[0][0][3] = 'not the patch')
    ],
    [
      'a mismatched hunk on a shown file (its line numbers)',
      (diff) => void ((diff.files[0].hunks as unknown[][][])[0][0][1] = 7)
    ],
    ['a shown rename the patch does not make', (diff) => void (diff.files[0].old_path = 'x.ts')],
    [
      'a small file omitted inside the row cap',
      (diff) => void (diff.files[2] = { ...diff.files[2], hunks: [], omitted: true })
    ],
    [
      'files dropped before the file cap',
      (diff) => {
        diff.files.pop()
        diff.more_files = 2
      }
    ],
    [
      'shown files out of the patch order',
      (diff) => void ([diff.files[2], diff.files[3]] = [diff.files[3], diff.files[2]])
    ]
  ])('refuses %s', (_name, change) => {
    const f = trimmed(change)
    expect(
      validatePreparationEvidence(loadDetails(f.root, f.bundle, { prepared: true }), ['diff'])
    ).not.toEqual([])
  })
})

describe('preparation evidence', () => {
  it('records artifact roles, content hashes, run provenance and tags from verified files', () => {
    const f = prepared()
    const snapshot = loadDetails(f.root, f.bundle, { prepared: true })
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
        expect(
          validatePreparationEvidence(loadDetails(f.root, f.bundle, { prepared: true }), [
            'context'
          ])
        ).toEqual([])
      }
      expect(
        validatePreparationEvidence(loadDetails(f.root, f.bundle, { prepared: true }), [
          'diff',
          'screens',
          'checks'
        ]).length
      ).toBeGreaterThan(0)
    }
  )

  it.each(['diff', 'screens', 'checks'] as const)(
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
      })
      expect(
        validatePreparationEvidence(loadDetails(f.root, f.bundle, { prepared: true }), ['context'])
      ).not.toEqual([])
    }
  )

  it('reviews a committed range without granting approval to apply it again', () => {
    const f = prepared()
    rewriteBundle(f.bundle, (bundle) => {
      const diff = bundle.blocks.find((block) => block.type === 'diff')!
      diff.patch_kind = 'committed'
      diff.head = '8'.repeat(40)
    })
    const snapshot = loadDetails(f.root, f.bundle, { prepared: true })
    expect(validatePreparationEvidence(snapshot, ['diff', 'checks'])).toEqual([])
    expect(snapshot.ref.drafted).toBe(false)
    expect(snapshot.ref.summary).not.toContain('drafted fix')
  })

  it('refuses images changed after validation while retaining legacy snapshot compatibility', () => {
    const f = prepared()
    const snapshot = loadDetails(f.root, f.bundle, { prepared: true })
    writeFileSync(join(f.dir, 'F2-before.png'), 'different bytes')
    expect(() => readDetailsImage(f.root, snapshot, 'F2-before.png')).toThrow(
      'changed after context was prepared'
    )
  })
})
