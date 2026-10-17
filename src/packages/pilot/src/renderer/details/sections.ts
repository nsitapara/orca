import type { DetailsBlock, DetailsBundle } from '../../shared/details'
import { partsIn } from '../../shared/details-summary'

// A section of the Details is a bundle block. Its key (type and title) is stable across cards, so a choice
// made on one card holds on the next.
export type Section = { key: string; label: string; count: string }

const DEFAULT_LABEL: Record<DetailsBlock['type'], string> = {
  facts: 'Overview',
  diff: 'Change',
  screens: 'Before / after',
  shots: 'Screenshots',
  code: 'Code',
  review: 'Review',
  report: 'Report',
  thread: 'Thread',
  text: 'Notes',
  missing: 'Missing'
}

export function sectionKey(block: DetailsBlock): string {
  const title = 'title' in block ? (block.title ?? '') : ''
  return `${block.type}:${title}`
}

function labelOf(block: DetailsBlock): string {
  const title = 'title' in block ? block.title : null
  return title?.trim() ? title : DEFAULT_LABEL[block.type]
}

function countOf(block: DetailsBlock, texts: Record<string, string>): string {
  let n = 0
  if (block.type === 'diff') {
    n = block.files.length
  } else if (block.type === 'shots') {
    n = block.shots.length
  } else if (block.type === 'review') {
    n = partsIn(texts[block.file])
  }
  return n > 0 ? String(n) : ''
}

export function sectionsOf(bundle: DetailsBundle, texts: Record<string, string>): Section[] {
  const seen = new Set<string>()
  const sections: Section[] = []
  for (const block of bundle.blocks) {
    const key = sectionKey(block)
    if (!seen.has(key)) {
      seen.add(key)
      sections.push({ key, label: labelOf(block), count: countOf(block, texts) })
    }
  }
  return sections
}
