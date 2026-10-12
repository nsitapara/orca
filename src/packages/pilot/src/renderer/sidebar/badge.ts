import type { WorktreeTimeline } from '../../shared/api-types'

export type ActivityBadge =
  | { kind: 'none' }
  | { kind: 'dot' }
  | { kind: 'count'; count: number; label: string }

function countLabel(n: number): string {
  if (n > 9) {
    return '9+'
  }
  return String(n)
}

// What waits on you here outranks a run going here; an asking run already has its card in `waiting`.
export function badgeFor(t: WorktreeTimeline | null): ActivityBadge {
  if (!t) {
    return { kind: 'none' }
  }
  const waiting = t.waiting.length
  if (waiting > 0) {
    return { kind: 'count', count: waiting, label: countLabel(waiting) }
  }
  if (t.now.some((r) => r.status === 'running')) {
    return { kind: 'dot' }
  }
  return { kind: 'none' }
}
