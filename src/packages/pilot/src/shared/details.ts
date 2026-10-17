// A card's Details bundle (worktree-gate/details.py): the JSON file a job writes beside its note, which
// Pilot's main process reads, checks and keeps as a snapshot of the card version it belongs to.

// Every refusal's message starts `${DETAILS_REFUSED}: `.
export const DETAILS_REFUSED = 'Details bundle refused'
// A card's Details are markdown or a bundle, never both (the CLI and the server say the same).
export const DETAILS_EITHER =
  'Give Details as markdown (--details-file) or as a bundle (--details-bundle), not both'
export const DETAILS_LIMITS = {
  bundleBytes: 2_000_000,
  reviewBytes: 1_000_000,
  imageBytes: 8_000_000,
  blocks: 40,
  listItems: 60,
  diffFiles: 60,
  diffRows: 4000,
  codeRows: 400,
  reviews: 2,
  refChars: 1024
} as const
// The images a bundle may name, by extension (answers.py IMAGE_TYPES).
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

// [old line or null, new line or null, ' ' | '+' | '-', text] (details.py diff_rows).
export type DiffRow = [number | null, number | null, ' ' | '+' | '-', string]

type Titled = { title?: string | null }
export type FactsBlock = Titled & { type: 'facts'; rows: [string, string][] }
export type DiffFile = {
  path: string
  old_path?: string | null
  added?: number
  removed?: number
  hunks: DiffRow[][]
  // Past the row cap a file keeps its header and counts only.
  omitted?: boolean
}
export type DiffBlock = Titled & {
  type: 'diff'
  files: DiffFile[]
  more_files?: number
  base?: string | null
  head?: string | null
  // A drafted change: the patch file Approve applies, pinned by its SHA-256.
  patch?: string | null
  patch_kind?: 'draft' | 'committed'
  patch_sha256?: string | null
  checks?: string[]
  check_records?: CheckRecord[]
}
export type CheckRecord = {
  command: string
  exit_code: number
  output: string
  output_sha256: string
  base: string
  patch_sha256: string
}
export type ArtifactProvenance = {
  originatingRunId: string | null
  preparingRunId: string
  itemId: string
  attempt: number
}
export type ArtifactFile = {
  ref: string
  role: 'patch' | 'review' | 'before' | 'after' | 'screenshot' | 'check' | 'report'
  sha256: string
  bytes: number
  // The patch's files, read from its bytes: rename source (null unless renamed), counts, and the hash of the rows.
  diff?: {
    path: string
    oldPath: string | null
    // Its rows as details.py counts them (context and changes), for the row cap a trimmed diff is judged by.
    rows: number
    added: number
    removed: number
    hunksSha256: string
  }[]
}
export type ArtifactManifest = {
  provenance?: ArtifactProvenance
  files: ArtifactFile[]
  expected: string[]
  generated: string[]
  tags: string[]
}
export type ScreenPair = {
  before?: string | null
  after?: string | null
  caption?: string | null
  route?: string | null
  theme?: string | null
  viewport?: string | null
  note?: string | null
}
export type ScreensBlock = Titled & { type: 'screens'; pairs: ScreenPair[] }
export type Shot = { file?: string | null; caption?: string | null }
export type ShotsBlock = Titled & { type: 'shots'; shots: Shot[] }
export type CodeBlock = Titled & {
  type: 'code'
  path: string
  sha?: string | null
  anchor?: number | null
  rows: [number, string][]
}
export type ThreadNote = { author?: string | null; at?: string | null; body?: string | null }
export type ThreadBlock = Titled & { type: 'thread'; notes: ThreadNote[]; url?: string | null }
export type TextBlock = Titled & { type: 'text'; body: string }
// Where a section should have shown something and can't, placed in <slot>'s place. A no-draft verdict
// in the diff slot records the head it was judged at as `base`.
export type MissingBlock = Titled & {
  type: 'missing'
  what: string
  why: string
  slot?: string | null
  base?: string | null
}
export type ReviewBlock = Titled & { type: 'review'; file: string }
// A page to read outside Pilot (job 09's review guide): an .html file in the Automations folder, opened by Open.
export type ReportBlock = Titled & { type: 'report'; file: string }
export type DetailsBlock =
  | FactsBlock
  | DiffBlock
  | ScreensBlock
  | ShotsBlock
  | CodeBlock
  | ThreadBlock
  | TextBlock
  | MissingBlock
  | ReviewBlock
  | ReportBlock
export type DetailsBundle = {
  version: 1
  item: string
  built?: string | null
  by?: string | null
  blocks: DetailsBlock[]
  provenance?: ArtifactProvenance
}

// A review file (review-requests/preview.py): the comments as GitLab will show them.
export type ReviewPart = {
  id: string
  hash?: string
  file: string
  line?: number | null
  side?: string | null
  severity?: string | null
  title: string
  body?: string | null
  in_diff: boolean
  comment: string
  context: DiffRow[]
}
export type ReviewFile = {
  iid: number
  title?: string
  web_url: string
  project: string
  head_sha: string
  reviewer: { name: string; username: string }
  parts: ReviewPart[]
}

// What a card carries (the list's light ref): the bundle's real path and SHA-256, the SHA-256 of each
// review file inlined into the snapshot, and whether it holds a drafted patch (and at which head).
export type DetailsRef = {
  path: string
  sha256: string
  inlined: Record<string, string>
  blocks: number
  drafted: boolean
  draftedBase: string | null
  // On a question, the label of the option the draft implements (the facts block's Drafted row); absent on
  // refs stored before it was read.
  draftedOption?: string | null
  // The short labels on the Details bar (shared/details-summary.ts). Derived, so never part of the digest;
  // absent on refs stored before it existed (the list fills it in from the snapshot).
  summary?: string[]
  // What the card is about, from the facts block's MR row ('' when it names none). Derived like `summary`.
  subject?: string
  artifacts?: ArtifactManifest
}
// The whole of it, read once through pilot.inbox.details: the bundle, and each inlined review file's text
// by the ref the bundle names it with.
export type DetailsSnapshot = {
  ref: DetailsRef
  bundle: DetailsBundle
  texts: Record<string, string>
}

// The image files a bundle names: each screens pair's before and after, then each shot, in block order.
export function imageRefs(bundle: DetailsBundle): string[] {
  const refs: (string | null | undefined)[] = []
  for (const block of bundle.blocks) {
    if (block.type === 'screens') {
      for (const pair of block.pairs) {
        refs.push(pair.before, pair.after)
      }
    } else if (block.type === 'shots') {
      refs.push(...block.shots.map((s) => s.file))
    }
  }
  return refs.filter((r): r is string => typeof r === 'string' && r !== '')
}
