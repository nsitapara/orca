import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync
} from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  DETAILS_LIMITS,
  DETAILS_REFUSED,
  IMAGE_TYPES,
  imageRefs,
  type ArtifactFile,
  type DetailsBundle,
  type DetailsRef,
  type DetailsSnapshot
} from '../../shared/details'
import { subjectOf, summaryOf } from '../../shared/details-summary'
import { generatedArtifacts, patchStats, validImageBytes } from './details-preparation'
import { isPromptControl } from './card'
import { BLOCK_TYPES, BundleSchema, firstIssue, ReviewFileSchema } from './details-schema'

// Every refusal fails closed: nothing of the bundle is kept, and the message says why.
export class DetailsRefused extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`${DETAILS_REFUSED}: ${reason}`)
    this.name = 'DetailsRefused'
    this.reason = reason
  }
}

type RefKind = ArtifactFile['role']

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const NOFOLLOW = constants.O_NOFOLLOW ?? 0

function realRoot(root: string | null): string {
  if (root === null) {
    throw new DetailsRefused('Pilot has no Automations folder to read Details from')
  }
  try {
    return realpathSync(root)
  } catch {
    throw new DetailsRefused(`the Automations folder ${root} doesn't exist`)
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

// <path> with every symlink followed, which must land inside the root.
function realInside(root: string, path: string, label: string): string {
  let real: string
  try {
    real = realpathSync(path)
  } catch {
    throw new DetailsRefused(`${label} doesn't exist`)
  }
  if (!isInside(root, real)) {
    throw new DetailsRefused(`${label} is outside the Automations folder`)
  }
  return real
}

// A regular file's bytes through one descriptor, opened without following a last symlink, checked with
// fstat before anything is read, and never more than it said. Accepted race: O_NOFOLLOW covers only the
// last path part, so a parent folder swapped for a symlink between realInside's check and this open could
// lead outside the root. That needs write access to the vault already, and reaches only a file of the
// same name (a .json bundle or review, or an image), still capped and type-checked here.
function readCapped(real: string, max: number, label: string): Buffer {
  let fd: number
  try {
    fd = openSync(real, constants.O_RDONLY | NOFOLLOW)
  } catch {
    throw new DetailsRefused(`${label} can't be opened`)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      throw new DetailsRefused(`${label} is not a file`)
    }
    if (stat.size > max) {
      throw new DetailsRefused(`${label} is over ${max} bytes`)
    }
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < stat.size) {
      const n = readSync(fd, buffer, read, stat.size - read, read)
      if (n === 0) {
        break
      }
      read += n
    }
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

function hasExtension(paths: string[], allowed: (ext: string) => boolean): boolean {
  return paths.every((p) => allowed(extname(p).toLowerCase()))
}
const isImage = (ext: string): boolean => Object.hasOwn(IMAGE_TYPES, ext)
const isJson = (ext: string): boolean => ext === '.json'

// An unknown block type is refused by name (ruling 9), before the shape is checked.
function refuseUnknownTypes(raw: unknown): void {
  const blocks = (raw as { blocks?: unknown } | null)?.blocks
  if (!Array.isArray(blocks)) {
    return
  }
  blocks.forEach((block, at) => {
    const type = (block as { type?: unknown } | null)?.type
    if (typeof type === 'string' && !(BLOCK_TYPES as readonly string[]).includes(type)) {
      throw new DetailsRefused(`block ${at + 1} has the unknown type "${type}"`)
    }
  })
}

function parseBundle(bytes: Buffer, label: string): DetailsBundle {
  let raw: unknown
  try {
    raw = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new DetailsRefused(`${label} is not JSON`)
  }
  refuseUnknownTypes(raw)
  const parsed = BundleSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DetailsRefused(`${label}: ${firstIssue(parsed.error)}`)
  }
  return parsed.data
}

// Every file a bundle names (details.py _refs), in block order; empty refs name nothing.
function bundleRefs(bundle: DetailsBundle): { kind: RefKind; ref: string }[] {
  const refs: { kind: RefKind; ref: string | null | undefined }[] = []
  for (const block of bundle.blocks) {
    if (block.type === 'diff') {
      refs.push({ kind: 'patch', ref: block.patch })
      refs.push(
        ...(block.check_records ?? []).map((check) => ({
          kind: 'check' as const,
          ref: check.output
        }))
      )
    } else if (block.type === 'review') {
      refs.push({ kind: 'review', ref: block.file })
    } else if (block.type === 'screens') {
      for (const pair of block.pairs) {
        refs.push({ kind: 'before', ref: pair.before }, { kind: 'after', ref: pair.after })
      }
    } else if (block.type === 'shots') {
      refs.push(...block.shots.map((s) => ({ kind: 'screenshot' as const, ref: s.file })))
    }
  }
  return refs.filter((r): r is { kind: RefKind; ref: string } => Boolean(r.ref))
}

// A ref resolved (absolute as is, relative against the bundle's real folder): a regular file inside the
// root, of an image type for screens and shots, and JSON for a review.
function refFile(root: string, dir: string, kind: RefKind, ref: string): string {
  const label = `${kind} ref "${ref}"`
  const real = realInside(root, isAbsolute(ref) ? ref : resolve(dir, ref), label)
  const images = kind === 'before' || kind === 'after' || kind === 'screenshot'
  if (images && !hasExtension([ref, real], isImage)) {
    throw new DetailsRefused(`${label} is not an image (${Object.keys(IMAGE_TYPES).join(', ')})`)
  }
  if (kind === 'review' && !hasExtension([ref, real], isJson)) {
    throw new DetailsRefused(`${label} is not a .json file`)
  }
  if (!statSync(real).isFile()) {
    throw new DetailsRefused(`${label} is not a file`)
  }
  return real
}

function readReview(real: string, ref: string): string {
  const label = `review ref "${ref}"`
  const text = readCapped(real, DETAILS_LIMITS.reviewBytes, label).toString('utf8')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new DetailsRefused(`${label} is not JSON`)
  }
  const parsed = ReviewFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DetailsRefused(`${label}: ${firstIssue(parsed.error)}`)
  }
  return text
}

// The option a question's draft implements: the first facts block's Drafted row (item-details SKILL.md step 4).
function draftedOptionOf(bundle: DetailsBundle): string | null {
  for (const block of bundle.blocks) {
    if (block.type === 'facts') {
      const row = block.rows.find(([key]) => key === 'Drafted')
      if (row) {
        return row[1]
      }
    }
  }
  return null
}

// drafts.py _drafted_base: the base of the first drafted diff, else of a no-draft verdict in the diff slot.
function draftOf(
  bundle: DetailsBundle
): Pick<DetailsRef, 'drafted' | 'draftedBase' | 'draftedOption'> {
  const blocks = bundle.blocks
  const drafted = blocks.find(
    (b) => b.type === 'diff' && b.patch_kind !== 'committed' && Boolean(b.patch)
  )
  const verdict = blocks.find((b) => b.type === 'missing' && b.slot === 'diff')
  const base = drafted && 'base' in drafted ? drafted.base : null
  const judged = verdict && 'base' in verdict ? verdict.base : null
  const draftedBase = base || judged || null
  return { drafted: drafted !== undefined, draftedBase, draftedOption: draftedOptionOf(bundle) }
}

// The bundle's path goes into an answer run's prompt in quotes: none of '"', '\\' or a control character
// (C0, DEL, C1, or a Unicode line break) may close the quote or start a new line there.
function unsafeForPrompt(path: string): boolean {
  for (const ch of path) {
    if (isPromptControl(ch.codePointAt(0) ?? 0) || ch === '"' || ch === '\\') {
      return true
    }
  }
  return false
}

function checkPromptSafe(path: string): void {
  if (unsafeForPrompt(path)) {
    throw new DetailsRefused(
      `the bundle path ${JSON.stringify(path)} has a quote, backslash or control character`
    )
  }
}

// A card's bundle, read from an absolute path inside the Automations folder and checked whole: its shape,
// and every file it names. Review files are inlined (their text is part of what Approve binds to); the
// patch, image and check bytes are hashed into the artifact manifest inside the root.
export function loadDetails(root: string | null, bundlePath: string): DetailsSnapshot {
  const top = realRoot(root)
  if (!isAbsolute(bundlePath) || bundlePath.includes('\0')) {
    throw new DetailsRefused(`${bundlePath} is not an absolute path`)
  }
  checkPromptSafe(bundlePath)
  const label = `the bundle ${bundlePath}`
  const real = realInside(top, bundlePath, label)
  checkPromptSafe(real)
  if (!hasExtension([real], isJson)) {
    throw new DetailsRefused(`${label} is not a .json file`)
  }
  const bytes = readCapped(real, DETAILS_LIMITS.bundleBytes, label)
  const bundle = parseBundle(bytes, label)
  const texts: [string, string][] = []
  const files: ArtifactFile[] = []
  for (const { kind, ref } of bundleRefs(bundle)) {
    const file = refFile(top, dirname(real), kind, ref)
    if (kind === 'review') {
      texts.push([ref, readReview(file, ref)])
    }
    const cap =
      kind === 'patch' || kind === 'check' ? DETAILS_LIMITS.bundleBytes : DETAILS_LIMITS.imageBytes
    const asset = readCapped(file, cap, `${kind} ref ${ref}`)
    const image = kind === 'before' || kind === 'after' || kind === 'screenshot'
    if (image && !validImageBytes(asset, extname(file).toLowerCase())) {
      throw new DetailsRefused(`${kind} ref ${ref} does not contain a supported image`)
    }
    files.push({
      ref,
      role: kind,
      sha256: sha256(asset),
      bytes: asset.length,
      ...(kind === 'patch' ? { diff: patchStats(asset.toString('utf8')) } : {})
    })
  }
  const textsByRef = Object.fromEntries(texts)
  const draft = draftOf(bundle)
  const summary = summaryOf(bundle, textsByRef, draft.drafted, files)
  return {
    ref: {
      path: real,
      sha256: sha256(bytes),
      inlined: Object.fromEntries(texts.map(([ref, text]) => [ref, sha256(text)])),
      blocks: bundle.blocks.length,
      ...draft,
      summary,
      artifacts: {
        files,
        ...(bundle.provenance ? { provenance: bundle.provenance } : {}),
        expected: [],
        generated: generatedArtifacts(bundle, files, textsByRef),
        tags: summary
      },
      subject: subjectOf(bundle) ?? ''
    },
    bundle,
    texts: textsByRef
  }
}

// One image a card's bundle names, read now: the path is checked again (inside the root, an image type),
// and the file is opened and measured before a byte is read.
export function readDetailsImage(
  root: string | null,
  snapshot: DetailsSnapshot,
  file: string
): { mime: string; base64: string; bytes: number } {
  const top = realRoot(root)
  const label = `image "${file}"`
  if (!imageRefs(snapshot.bundle).includes(file)) {
    throw new DetailsRefused(`${label} is not an image of this card's Details`)
  }
  const path = isAbsolute(file) ? file : resolve(dirname(snapshot.ref.path), file)
  const real = realInside(top, path, label)
  if (!hasExtension([file, real], isImage)) {
    throw new DetailsRefused(`${label} is not an image`)
  }
  const bytes = readCapped(real, DETAILS_LIMITS.imageBytes, label)
  const recorded = snapshot.ref.artifacts?.files.find((asset) => asset.ref === file)
  if (snapshot.ref.artifacts && (!recorded || recorded.sha256 !== sha256(bytes))) {
    throw new DetailsRefused(`${label} changed after context was prepared`)
  }
  return {
    mime: IMAGE_TYPES[extname(real).toLowerCase()],
    base64: bytes.toString('base64'),
    bytes: bytes.length
  }
}
