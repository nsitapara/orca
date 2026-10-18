import type { ArtifactFile, DetailsBlock, DetailsBundle } from './details'

const MAX_CHIPS = 4
const MAX_LABEL = 40

function clip(label: string): string {
  return label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`
}

function diffChip(blocks: DetailsBlock[], artifacts?: ArtifactFile[]): string | null {
  let found = false
  let added = 0
  let removed = 0
  for (const b of blocks) {
    if (b.type !== 'diff') {
      continue
    }
    const actual = artifacts?.find((artifact) => artifact.ref === b.patch)?.diff
    for (const f of actual ?? b.files) {
      found = true
      added += f.added ?? 0
      removed += f.removed ?? 0
    }
  }
  return found ? `diff +${added} −${removed}` : null
}

function screensChip(blocks: DetailsBlock[]): string | null {
  let pairs = 0
  for (const b of blocks) {
    if (b.type === 'screens') {
      pairs += b.pairs.filter((pair) => pair.before && pair.after).length
    }
  }
  if (pairs === 0) {
    return null
  }
  return pairs === 1 ? 'before / after' : `${pairs} before / after`
}

function shotsChip(blocks: DetailsBlock[]): string | null {
  let shots = 0
  for (const b of blocks) {
    if (b.type === 'shots') {
      shots += b.shots.filter((shot) => shot.file).length
    }
  }
  return shots === 0 ? null : plural(shots, 'screenshot', 'screenshots')
}

// The findings in a review block's inlined text. New bundles can't hold a review block; the Details of the cards
// stored with one (job 09's old Post cards) still count theirs.
export function partsIn(text: string | undefined): number {
  if (!text) {
    return 0
  }
  try {
    const parts = (JSON.parse(text) as { parts?: unknown }).parts
    return Array.isArray(parts) ? parts.length : 0
  } catch {
    return 0
  }
}

function factsChip(blocks: DetailsBlock[]): string | null {
  for (const b of blocks) {
    if (b.type !== 'facts') {
      continue
    }
    const severity = b.rows.find(([k]) => k === 'Severity')
    const status = b.rows.find(([k]) => k === 'Status')
    if (severity && status) {
      return `${severity[1].toLowerCase()} · ${status[1].toLowerCase()}`
    }
  }
  return null
}

// The short labels on a card's Details bar (derived from the bundle; never part of the card's digest).
export function summaryOf(
  bundle: DetailsBundle,
  drafted: boolean,
  artifacts?: ArtifactFile[]
): string[] {
  const blocks = bundle.blocks
  const chips = [
    drafted ? 'drafted fix' : null,
    diffChip(blocks, artifacts),
    screensChip(blocks),
    shotsChip(blocks),
    factsChip(blocks)
  ]
  return chips
    .filter((c): c is string => c !== null)
    .slice(0, MAX_CHIPS)
    .map(clip)
}

// What the card is about, from the facts block's MR row ("!1579 web-2107-improve-…"), or null.
export function subjectOf(bundle: DetailsBundle): string | null {
  for (const b of bundle.blocks) {
    if (b.type === 'facts') {
      const row = b.rows.find(([key]) => key === 'MR')
      if (row?.[1]?.trim()) {
        return row[1].trim()
      }
    }
  }
  return null
}
