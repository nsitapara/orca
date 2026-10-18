import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Details fixtures in test/fixtures/details: Pilot owns them (they began as copies of ~/.agents samples).
export const DETAILS_FIXTURES = join(import.meta.dirname, '../../../../test/fixtures/details')
const FILES = [
  'F2.json',
  'F2.patch',
  'F2-before.png',
  'F2-after.png',
  'F2-qa.png',
  'sample-review.json'
]

// <top>/Automations is the root; the bundle sits at <root>/job/b/details/r/F2.json with its files, and
// <top>/x.png is an image outside the root.
export type DetailsFixture = { top: string; root: string; dir: string; bundle: string }

export function detailsFixture(): DetailsFixture {
  const top = mkdtempSync(join(tmpdir(), 'pilot-details-'))
  const root = join(top, 'Automations')
  const dir = join(root, 'job', 'b', 'details', 'r')
  mkdirSync(dir, { recursive: true })
  for (const file of FILES) {
    copyFileSync(join(DETAILS_FIXTURES, file), join(dir, file))
  }
  writeFileSync(join(top, 'x.png'), readFileSync(join(DETAILS_FIXTURES, 'F2-qa.png')))
  return { top, root, dir, bundle: join(dir, 'F2.json') }
}

export type FixtureBundle = { version: number; blocks: Record<string, unknown>[] } & Record<
  string,
  unknown
>

// Rewrites a bundle in place (its bytes change, so its sha256 does).
export function rewriteBundle(path: string, change: (bundle: FixtureBundle) => void): void {
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as FixtureBundle
  change(bundle)
  writeFileSync(path, JSON.stringify(bundle))
}

// A copy of F2.json beside it, as another bundle of the same folder.
export function copyBundle(f: DetailsFixture, name: string): string {
  const path = join(f.dir, name)
  copyFileSync(f.bundle, path)
  return path
}

export const REVIEW_BLOCK = { type: 'review', title: 'Review', file: 'sample-review.json' }
