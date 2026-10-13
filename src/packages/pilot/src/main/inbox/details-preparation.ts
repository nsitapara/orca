import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { parsePatch } from 'diff'
import { DETAILS_LIMITS } from '../../shared/details'
import type {
  ArtifactFile,
  DetailsBundle,
  DetailsSnapshot,
  DiffBlock,
  ScreenPair
} from '../../shared/details'
import { DetailsRefused, readCapped } from './details-read'
import { ReviewFileSchema } from './details-schema'
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

function changesHash(lines: string[]): string {
  return createHash('sha256').update(JSON.stringify(lines)).digest('hex')
}

export function patchStats(text: string): ArtifactFile['diff'] {
  try {
    const parsed = parsePatch(text)
    if (!parsed.length || parsed.some((file) => !file.hunks.length)) {
      return undefined
    }
    return parsed.map((file) => {
      const lines = file.hunks.flatMap((hunk) => hunk.lines)
      const path = file.newFileName === '/dev/null' ? file.oldFileName : file.newFileName
      return {
        path: (path ?? '').replace(/^[ab]\//, ''),
        added: lines.filter((line) => line.startsWith('+')).length,
        removed: lines.filter((line) => line.startsWith('-')).length,
        changesSha256: changesHash(
          lines.filter((line) => line.startsWith('+') || line.startsWith('-'))
        )
      }
    })
  } catch {
    return undefined
  }
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
    stats.length === block.files.length &&
    block.files.every((file) =>
      stats.some(
        (stat) =>
          stat.path === file.path &&
          stat.added === file.added &&
          stat.removed === file.removed &&
          stat.changesSha256 ===
            changesHash(
              file.hunks.flatMap((hunk) =>
                hunk.filter((row) => row[2] !== ' ').map((row) => row[2] + row[3])
              )
            )
      )
    )
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
  files: ArtifactFile[],
  texts: Record<string, string> = {}
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
  const reviews = bundle.blocks.filter((block) => block.type === 'review')
  if (
    reviews.length &&
    reviews.every((block) => validReview(texts[block.file], block.file, files))
  ) {
    generated.push('review')
  }
  return generated
}

// Called on a freshly loaded snapshot; producer claims never substitute for file-backed evidence.
export function validatePreparationEvidence(
  snapshot: DetailsSnapshot,
  required: PreparationRequirement[]
): string[] {
  const generated = generatedArtifacts(
    snapshot.bundle,
    snapshot.ref.artifacts?.files ?? [],
    snapshot.texts
  )
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
    if (block.type === 'review' && !validReview(snapshot.texts[block.file], block.file, files)) {
      errors.push('Attached review evidence is invalid')
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

function validReview(text: string | undefined, ref: string, files: ArtifactFile[]): boolean {
  if (!text) {
    return false
  }
  try {
    const parsed = ReviewFileSchema.safeParse(JSON.parse(text))
    const hash = createHash('sha256').update(text).digest('hex')
    return (
      parsed.success &&
      Boolean(parsed.data.head_sha.trim() && parsed.data.web_url.trim()) &&
      parsed.data.parts.length > 0 &&
      parsed.data.parts.every((part) => part.comment.trim()) &&
      recorded(files, ref, hash)
    )
  } catch {
    return false
  }
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
