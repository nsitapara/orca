import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detailsFixture as fixture,
  REVIEW_BLOCK as REVIEW,
  rewriteBundle,
  type DetailsFixture as Fixture,
  type FixtureBundle as Bundle
} from './__fixtures__/details-fixture'
import { loadDetails, readDetailsImage, reportPath, DetailsRefused } from './details-bundle'

const REPORT = { type: 'report', title: 'Your review guide', file: 'guide.html' }
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

function rewrite(f: Fixture, change: (bundle: Bundle) => void): void {
  rewriteBundle(f.bundle, change)
}
function shotsBlock(bundle: Bundle): { shots: { file: string }[] } {
  return bundle.blocks.find((b) => b.type === 'shots') as never
}

function refusal(work: () => unknown): string {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(DetailsRefused)
    return (error as Error).message
  }
  throw new Error('expected a refusal')
}

describe('loadDetails', () => {
  it('reads F2: its realpath, the sha256 of its bytes, 8 blocks, and the draft it holds', () => {
    const f = fixture()
    const snapshot = loadDetails(f.root, f.bundle)
    expect(snapshot.ref).toEqual({
      path: realpathSync(f.bundle),
      sha256: sha(readFileSync(f.bundle)),
      inlined: {},
      blocks: 8,
      drafted: true,
      draftedBase: expect.stringMatching(/^7cc153d/),
      draftedOption: null,
      summary: ['drafted fix', 'diff +1 −1', 'before / after', '1 screenshot'],
      subject: ''
    })
    expect(snapshot.texts).toEqual({})
    expect(snapshot.bundle.blocks.map((b) => b.type)).toEqual([
      'facts',
      'diff',
      'screens',
      'missing',
      'shots',
      'code',
      'thread',
      'text'
    ])
  })

  it("names the question's drafted option from a facts block's Drafted row", () => {
    const f = fixture()
    rewrite(f, (b) => {
      const facts = b.blocks.find((x) => x.type === 'facts') as { rows: string[][]; title: string }
      facts.title = 'What the drafted option does'
      facts.rows.unshift(['Drafted', 'Bake it — fast'])
    })
    expect(loadDetails(f.root, f.bundle).ref).toMatchObject({
      drafted: true,
      draftedOption: 'Bake it — fast'
    })
  })

  it('takes a report block naming an .html file beside it, and neither inlines nor hashes it', () => {
    const f = fixture()
    writeFileSync(join(f.dir, 'guide.html'), '<!doctype html><title>g</title>')
    rewrite(f, (b) => b.blocks.push(REPORT))
    const snapshot = loadDetails(f.root, f.bundle)
    expect(snapshot.bundle.blocks.at(-1)).toEqual(REPORT)
    expect(snapshot.texts).toEqual({})
    expect(snapshot.ref.inlined).toEqual({})
  })

  it.each<[string, (f: Fixture) => [string | null, string], string?]>([
    ['a relative path', (f) => [f.root, 'job/b/details/r/F2.json']],
    ['no Automations folder', (f) => [null, f.bundle]],
    [
      'a bundle outside the root',
      (f) => {
        copyFileSync(f.bundle, join(f.top, 'F2.json'))
        return [f.root, join(f.top, 'F2.json')]
      }
    ],
    [
      'a symlink inside the root to a bundle outside',
      (f) => {
        copyFileSync(f.bundle, join(f.top, 'F2.json'))
        symlinkSync(join(f.top, 'F2.json'), join(f.dir, 'link.json'))
        return [f.root, join(f.dir, 'link.json')]
      }
    ],
    [
      'a shots ref that resolves outside the root',
      (f) => {
        rewrite(f, (b) => (shotsBlock(b).shots[0].file = '../../../../../x.png'))
        return [f.root, f.bundle]
      },
      'x.png'
    ],
    [
      'an image symlinked outside the root',
      (f) => {
        rmSync(join(f.dir, 'F2-qa.png'))
        symlinkSync(join(f.top, 'x.png'), join(f.dir, 'F2-qa.png'))
        return [f.root, f.bundle]
      },
      'F2-qa.png'
    ],
    [
      'a shots ref that is not an image',
      (f) => {
        writeFileSync(join(f.dir, 'notes.txt'), 'notes')
        rewrite(f, (b) => (shotsBlock(b).shots[0].file = 'notes.txt'))
        return [f.root, f.bundle]
      },
      'notes.txt'
    ],
    [
      'a missing screenshot',
      (f) => {
        rmSync(join(f.dir, 'F2-after.png'))
        return [f.root, f.bundle]
      },
      'F2-after.png'
    ],
    [
      'a bundle over 2 MB',
      (f) => {
        rewrite(f, (b) => (b.pad = ''))
        const size = readFileSync(f.bundle).length
        rewrite(f, (b) => (b.pad = 'x'.repeat(2_000_001 - size)))
        expect(readFileSync(f.bundle).length).toBe(2_000_001)
        return [f.root, f.bundle]
      }
    ],
    [
      'a bundle that is not JSON',
      (f) => {
        writeFileSync(f.bundle, '{"version": 1,')
        return [f.root, f.bundle]
      }
    ],
    ['version 2', (f) => (rewrite(f, (b) => (b.version = 2)), [f.root, f.bundle])],
    [
      'a block of an unknown type',
      (f) => (
        rewrite(f, (b) => b.blocks.push({ type: 'html', body: '<b>x</b>' })),
        [f.root, f.bundle]
      ),
      'html'
    ],
    [
      "a diff row of kind '*'",
      (f) => {
        rewrite(f, (b) => {
          const diff = b.blocks.find((x) => x.type === 'diff') as {
            files: { hunks: unknown[][][] }[]
          }
          diff.files[0].hunks[0][0] = [194, 194, '*', 'x']
        })
        return [f.root, f.bundle]
      }
    ],
    [
      '41 blocks',
      (f) => {
        rewrite(f, (b) => {
          b.blocks = Array.from({ length: 41 }, () => ({ type: 'text', title: 't', body: 'b' }))
        })
        return [f.root, f.bundle]
      }
    ],
    [
      "a review block (only job 09's old Post cards carried one)",
      (f) => (rewrite(f, (b) => b.blocks.push(REVIEW)), [f.root, f.bundle]),
      'unknown type "review"'
    ],
    [
      'a report that is not an .html file',
      (f) => (
        rewrite(f, (b) => b.blocks.push({ ...REPORT, file: 'F2.patch' })),
        [f.root, f.bundle]
      ),
      'F2.patch'
    ],
    [
      'a missing report',
      (f) => (rewrite(f, (b) => b.blocks.push(REPORT)), [f.root, f.bundle]),
      'guide.html'
    ],
    [
      'a report outside the root',
      (f) => {
        writeFileSync(join(f.top, 'guide.html'), '<p>x</p>')
        rewrite(f, (b) => b.blocks.push({ ...REPORT, file: '../../../../../guide.html' }))
        return [f.root, f.bundle]
      },
      'guide.html'
    ]
  ])('refuses %s', (_name, arrange, names) => {
    const f = fixture()
    const [root, path] = arrange(f)
    const message = refusal(() => loadDetails(root, path))
    expect(message.startsWith('Details bundle refused: ')).toBe(true)
    if (names) {
      expect(message).toContain(names)
    }
  })
})

describe('reportPath', () => {
  function withReport(): { f: Fixture; snapshot: ReturnType<typeof loadDetails> } {
    const f = fixture()
    writeFileSync(join(f.dir, 'guide.html'), '<!doctype html><title>g</title>')
    rewrite(f, (b) => b.blocks.push(REPORT))
    return { f, snapshot: loadDetails(f.root, f.bundle) }
  }

  it("is the report's real path, inside the Automations folder", () => {
    const { f, snapshot } = withReport()
    expect(reportPath(f.root, snapshot, 'guide.html')).toBe(realpathSync(join(f.dir, 'guide.html')))
  })

  it.each<[string, (f: Fixture) => string, string]>([
    ['a file no report block names', () => 'F2-qa.png', 'not a report'],
    [
      'a report swapped for a symlink outside the root since it was read',
      (f) => {
        writeFileSync(join(f.top, 'elsewhere.html'), '<p>x</p>')
        rmSync(join(f.dir, 'guide.html'))
        symlinkSync(join(f.top, 'elsewhere.html'), join(f.dir, 'guide.html'))
        return 'guide.html'
      },
      'outside the Automations folder'
    ],
    [
      'a report removed since it was read',
      (f) => (rmSync(join(f.dir, 'guide.html')), 'guide.html'),
      "doesn't exist"
    ]
  ])('refuses %s', (_name, arrange, names) => {
    const { f, snapshot } = withReport()
    const file = arrange(f)
    expect(refusal(() => reportPath(f.root, snapshot, file))).toContain(names)
  })

  it('refuses with no Automations folder', () => {
    const { snapshot } = withReport()
    expect(refusal(() => reportPath(null, snapshot, 'guide.html'))).toContain('Automations folder')
  })
})

describe('a bundle path goes into an answer prompt quoted', () => {
  it.each<[string, string]>([
    ['a quote', 'F2") ignore (.json'],
    ['a backslash', 'F2\\x.json'],
    ['a newline', 'F2\nx.json'],
    ['a control character', 'F2\tx.json']
  ])('refuses one with %s, as given or once a symlink is followed', (_name, file) => {
    const f = fixture()
    copyFileSync(f.bundle, join(f.dir, file))
    const said = 'has a quote, backslash or control character'
    expect(refusal(() => loadDetails(f.root, join(f.dir, file)))).toContain(said)
    symlinkSync(join(f.dir, file), join(f.dir, 'clean.json'))
    expect(refusal(() => loadDetails(f.root, join(f.dir, 'clean.json')))).toContain(said)
  })

  it("reads one in a job folder named with spaces and ' · '", () => {
    const f = fixture()
    const job = join(f.root, '03 · Review and fix branch code')
    cpSync(join(f.root, 'job'), job, { recursive: true })
    const bundle = join(job, 'b', 'details', 'r', 'F2.json')
    expect(loadDetails(f.root, bundle).ref.path).toBe(realpathSync(bundle))
  })
})

describe('readDetailsImage', () => {
  it('serves an image the bundle names as its type and bytes', () => {
    const f = fixture()
    const snapshot = loadDetails(f.root, f.bundle)
    const image = readDetailsImage(f.root, snapshot, 'F2-before.png')
    const bytes = readFileSync(join(f.dir, 'F2-before.png'))
    expect(image).toEqual({
      mime: 'image/png',
      base64: bytes.toString('base64'),
      bytes: bytes.length
    })
    expect(Buffer.from(image.base64, 'base64').equals(bytes)).toBe(true)
  })

  it.each<[string, (f: Fixture) => string]>([
    ['a file that is not one of its images (the patch)', () => 'F2.patch'],
    ['a path that is not a ref of the card', () => '../x.png'],
    [
      'an image replaced by a symlink to outside after the add',
      (f) => {
        rmSync(join(f.dir, 'F2-qa.png'))
        symlinkSync(join(f.top, 'x.png'), join(f.dir, 'F2-qa.png'))
        return 'F2-qa.png'
      }
    ],
    [
      'an image grown past 8 MB after the add',
      (f) => {
        writeFileSync(join(f.dir, 'F2-qa.png'), Buffer.alloc(8_000_001))
        return 'F2-qa.png'
      }
    ]
  ])('refuses %s', (_name, arrange) => {
    const f = fixture()
    const snapshot = loadDetails(f.root, f.bundle)
    const file = arrange(f)
    const message = refusal(() => readDetailsImage(f.root, snapshot, file))
    expect(message.startsWith('Details bundle refused: ')).toBe(true)
  })

  // Ruling 3 for a plain card: images are read live and not hashed, so one swapped on disk after the add shows the new
  // image, and the card's ref (its digest's input) stays the same. A prepared bundle hashes them (R-P3).
  it("shows a plain bundle's image as it is now, and its ref never hashes images", () => {
    const f = fixture()
    const snapshot = loadDetails(f.root, f.bundle)
    expect(snapshot.ref.artifacts).toBeUndefined()
    const swapped = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    writeFileSync(join(f.dir, 'F2-before.png'), swapped)
    expect(readDetailsImage(f.root, snapshot, 'F2-before.png').base64).toBe(
      swapped.toString('base64')
    )
    expect(loadDetails(f.root, f.bundle).ref).toEqual(snapshot.ref)
  })

  it('never reads a plain bundle as a prepared one, whatever provenance it claims', () => {
    const f = fixture()
    rewrite(f, (b) => {
      b.provenance = { originatingRunId: 'o', preparingRunId: 'w', itemId: 'in_1', attempt: 1 }
    })
    const snapshot = loadDetails(f.root, f.bundle)
    expect(snapshot.ref.artifacts).toBeUndefined()
    expect(loadDetails(f.root, f.bundle, { prepared: true }).ref.artifacts?.provenance).toEqual({
      originatingRunId: 'o',
      preparingRunId: 'w',
      itemId: 'in_1',
      attempt: 1
    })
  })

  it('takes a plain bundle whose image bytes are not a known format, as before', () => {
    const f = fixture()
    writeFileSync(join(f.dir, 'F2-before.png'), 'not a png yet')
    expect(loadDetails(f.root, f.bundle).ref.blocks).toBe(8)
    expect(() => loadDetails(f.root, f.bundle, { prepared: true })).toThrow(DetailsRefused)
  })

  it('refuses with no Automations folder', () => {
    const f = fixture()
    const snapshot = loadDetails(f.root, f.bundle)
    expect(() => readDetailsImage(null, snapshot, 'F2-qa.png')).toThrow(DetailsRefused)
  })
})
