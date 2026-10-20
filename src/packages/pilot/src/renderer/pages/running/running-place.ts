import type { HomeStep, RunHome, RunPlace } from '../../../shared/api-types-capacity'

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

// The badge on a running row: where its env put it.
export function placeBadgeText(place: RunPlace): string {
  if (place.mode === 'in_place') {
    return 'In your worktree'
  }
  if (place.mode === 'kept') {
    return 'In a kept worktree'
  }
  return place.stack ? 'In a throwaway · own stack' : 'In a throwaway'
}

// Why a run isn't in your worktree, in pilotcli's words; null for one that is, or with no reason given.
export function placeReasonText(place: RunPlace): string | null {
  if (place.mode === 'in_place' || !place.reason) {
    return null
  }
  return `Why a throwaway: ${place.reason}`
}

function workedText(place: RunPlace): string {
  if (place.mode === 'in_place') {
    return 'Worked in your worktree.'
  }
  if (place.mode === 'kept') {
    return 'Worked in a kept worktree.'
  }
  return place.stack ? 'Worked in a throwaway with its own stack.' : 'Worked in a throwaway.'
}

function stepText(step: HomeStep, done: string, skipped: string): string {
  if (step.ok) {
    return done
  }
  return sentence(step.reason ? `${skipped}: ${step.reason}` : skipped)
}

function keptText(branch: string, keptHome: RunHome['keptHome']): string {
  if (keptHome?.state === 'merged') {
    return `Kept on ${branch}, then merged into your worktree.`
  }
  if (keptHome?.state === 'stuck') {
    return sentence(
      `Kept on ${branch}; it needs a merge by hand: ${keptHome.reason ?? 'see its card'}`
    )
  }
  if (keptHome?.state === 'dropped') {
    return `Kept on ${branch}, since deleted.`
  }
  return `Kept on ${branch}; merging into your worktree once it's free.`
}

// What a finished run did with its work, from its env and outward steps; null when it carries neither.
export function finishedHomeText(run: { place?: RunPlace; home?: RunHome }): string | null {
  const { place, home } = run
  const parts: string[] = []
  if (place) {
    parts.push(workedText(place))
  }
  if (home?.pushed) {
    parts.push(stepText(home.pushed, 'Pushed.', 'Not pushed'))
  }
  if (home?.mergedBack) {
    parts.push(stepText(home.mergedBack, 'Merged back into your worktree.', 'Merge back skipped'))
  }
  if (home?.kept) {
    parts.push(keptText(home.kept, home.keptHome))
  }
  return parts.length > 0 ? parts.join(' ') : null
}
