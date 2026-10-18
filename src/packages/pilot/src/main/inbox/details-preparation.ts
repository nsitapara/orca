import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { parsePatch } from 'diff'
import { DETAILS_LIMITS } from '../../shared/details'
import type {
  ArtifactFile,
  DetailsBundle,
  DetailsSnapshot,
  DiffBlock,
  DiffRow,
  ScreenPair
} from '../../shared/details'
import { DetailsRefused, readCapped } from './details-read'
import type { PreparationRequirement } from '../../shared/preparation'

function recorded(
  files: ArtifactFile[],
  ref: string | null | undefined,
  hash?: string | null
): boolean {
  return Boolean(
    ref &&
    files.some((file) => file.ref === ref && file.bytes > 0 && (!hash || file.sha256 === hash))
  )
}

type PatchStats = NonNullable<ArtifactFile['diff']>
type PatchHunk = { oldStart: number; newStart: number; lines: string[] }

function hunksHash(hunks: DiffRow[][]): string {
  return createHash('sha256').update(JSON.stringify(hunks)).digest('hex')
}

// A hunk's rows as details.py diff_rows writes them: [old line or null, new line or null, ' ' | '+' | '-', text]. A
// "\ No newline" marker is no row. (jsdiff moves a 0-line side's start by one; no row of that side has a number.)
function rowsOf(hunk: PatchHunk): DiffRow[] {
  const rows: DiffRow[] = []
  let old = hunk.oldStart
  let now = hunk.newStart
  for (const line of hunk.lines) {
    const text = line.slice(1)
    if (line.startsWith('+')) {
      rows.push([null, now, '+', text])
      now += 1
    } else if (line.startsWith('-')) {
      rows.push([old, null, '-', text])
      old += 1
    } else if (!line.startsWith('\\')) {
      rows.push([old, now, ' ', text])
      old += 1
      now += 1
    }
  }
  return rows
}

const bare = (name: string | undefined): string => (name ?? '').replace(/^[ab]\//, '')

// Each file of a patch: its path, the path it was renamed from (null unless renamed), its +/- counts, and the hash
// of its hunks' rows, line numbers and text included.
export function patchStats(text: string): ArtifactFile['diff'] {
  try {
    const parsed = parsePatch(text)
    if (!parsed.length || parsed.some((file) => !file.hunks.length)) {
      return undefined
    }
    return parsed.map((file) => {
      const hunks = file.hunks.map(rowsOf)
      const rows = hunks.flat()
      const gone = file.newFileName === '/dev/null'
      const path = bare(gone ? file.oldFileName : file.newFileName)
      const from = bare(file.oldFileName)
      return {
        path,
        oldPath: file.oldFileName === '/dev/null' || from === path ? null : from,
        rows: rows.length,
        added: rows.filter((row) => row[2] === '+').length,
        removed: rows.filter((row) => row[2] === '-').length,
        hunksSha256: hunksHash(hunks)
      }
    })
  } catch {
    return undefined
  }
}

// The diff shown against the hashed patch, exactly, trimmed only as details.py trims (its caps are DETAILS_LIMITS'):
// the shown files are the patch's first files in order, more_files the rest, and a dropped file only past the file
// cap; a file is omitted (counts, no hunks) only when its rows would take the rows shown so far past the row cap.
// Every shown file has its rename and counts, and its hunks are the patch's row for row.
function shownMatchesPatch(block: DiffBlock, stats: PatchStats): boolean {
  const dropped = block.more_files ?? 0
  if (stats.length !== block.files.length + dropped) {
    return false
  }
  if (dropped > 0 && block.files.length !== DETAILS_LIMITS.diffFiles) {
    return false
  }
  let shownRows = 0
  return block.files.every((file, n) => {
    const stat = stats[n]
    const renamedFrom = file.old_path && file.old_path !== file.path ? file.old_path : null
    if (stat.path !== file.path || stat.oldPath !== renamedFrom) {
      return false
    }
    if (stat.added !== file.added || stat.removed !== file.removed) {
      return false
    }
    const fits = shownRows + stat.rows <= DETAILS_LIMITS.diffRows
    if (file.omitted) {
      return !fits && file.hunks.length === 0
    }
    shownRows += stat.rows
    return stat.hunksSha256 === hunksHash(file.hunks)
  })
}

function validDiff(block: DiffBlock, files: ArtifactFile[]): boolean {
  const patch = files.find((file) => file.ref === block.patch)
  const stats = patch?.diff
  return Boolean(
    block.base?.trim() &&
    (block.patch_kind !== 'committed' || block.head?.trim()) &&
    block.files.length &&
    /^[a-f0-9]{64}$/.test(block.patch_sha256 ?? '') &&
    recorded(files, block.patch, block.patch_sha256) &&
    stats?.length &&
    shownMatchesPatch(block, stats)
  )
}

function validChecks(block: DiffBlock, files: ArtifactFile[]): boolean {
  const checks = block.check_records ?? []
  return (
    validDiff(block, files) &&
    checks.length > 0 &&
    checks.every(
      (check) =>
        check.command.trim() &&
        check.exit_code === 0 &&
        check.base === block.base &&
        check.patch_sha256 === block.patch_sha256 &&
        recorded(files, check.output, check.output_sha256)
    )
  )
}

function validScreens(pairs: ScreenPair[], files: ArtifactFile[]): boolean {
  return (
    pairs.length > 0 &&
    pairs.every((pair) =>
      Boolean(
        pair.before !== pair.after &&
        pair.route?.trim() &&
        pair.viewport?.trim() &&
        recorded(files, pair.before) &&
        recorded(files, pair.after)
      )
    )
  )
}

export function generatedArtifacts(
  bundle: DetailsBundle,
  files: ArtifactFile[]
): PreparationRequirement[] {
  const generated: PreparationRequirement[] = []
  if (
    bundle.blocks.some(
      (block) =>
        (block.type === 'text' && block.body.trim()) ||
        (block.type === 'facts' && block.rows.some(([key, value]) => key.trim() && value.trim()))
    )
  ) {
    generated.push('context')
  }
  const diffs = bundle.blocks.filter((block) => block.type === 'diff')
  if (diffs.length && diffs.every((block) => validDiff(block, files))) {
    generated.push('diff')
  }
  const screens = bundle.blocks.filter((block) => block.type === 'screens')
  if (screens.length && screens.every((block) => validScreens(block.pairs, files))) {
    generated.push('screens')
  }
  if (diffs.length && diffs.every((block) => validChecks(block, files))) {
    generated.push('checks')
  }
  return generated
}

// Called on a freshly loaded snapshot; producer claims never substitute for file-backed evidence.
export function validatePreparationEvidence(
  snapshot: DetailsSnapshot,
  required: PreparationRequirement[]
): string[] {
  const generated = generatedArtifacts(snapshot.bundle, snapshot.ref.artifacts?.files ?? [])
  const errors = required
    .filter((kind) => !generated.includes(kind))
    .map((kind) => `Required ${kind} evidence is missing or invalid`)
  const files = snapshot.ref.artifacts?.files ?? []
  for (const block of snapshot.bundle.blocks) {
    if (block.type === 'diff') {
      if (!validDiff(block, files)) {
        errors.push('Attached diff evidence is invalid')
      }
      if (block.check_records !== undefined && !validChecks(block, files)) {
        errors.push('Attached checks evidence is invalid')
      }
    }
    if (block.type === 'screens' && !validScreens(block.pairs, files)) {
      errors.push('Attached screens evidence is invalid')
    }
    if (block.type === 'missing' && required.some((kind) => kind === block.slot)) {
      errors.push(`Required ${block.slot} evidence is unavailable: ${block.why}`)
    }
  }
  return errors
}

export function validImageBytes(bytes: Buffer, extension: string): boolean {
  if (extension === '.png') {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  }
  if (extension === '.gif') {
    return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
  }
  if (extension === '.webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  return false
}

// One file a prepared bundle names, read and hashed for its artifact manifest (an image must hold image bytes).
export function artifactOf(file: string, kind: ArtifactFile['role'], ref: string): ArtifactFile {
  const cap =
    kind === 'patch' || kind === 'check' ? DETAILS_LIMITS.bundleBytes : DETAILS_LIMITS.imageBytes
  const asset = readCapped(file, cap, `${kind} ref ${ref}`)
  const image = kind === 'before' || kind === 'after' || kind === 'screenshot'
  if (image && !validImageBytes(asset, extname(file).toLowerCase())) {
    throw new DetailsRefused(`${kind} ref ${ref} does not contain a supported image`)
  }
  return {
    ref,
    role: kind,
    sha256: createHash('sha256').update(asset).digest('hex'),
    bytes: asset.length,
    ...(kind === 'patch' ? { diff: patchStats(asset.toString('utf8')) } : {})
  }
}
