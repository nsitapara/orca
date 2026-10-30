import type {
  AgentArtifact,
  ArtifactContribution,
  ArtifactRole
} from '../../shared/api-types-artifacts'
import { ARTIFACT_ROLES } from '../../shared/api-types-artifacts'

export function artifactRole(role: string): ArtifactRole {
  return ARTIFACT_ROLES.find((known) => known === role) ?? 'interactive'
}

const ROLE_LABELS: Record<ArtifactRole, string> = {
  interactive: 'Interactive',
  'sub-issue-worker': 'Sub-issue worker',
  'mockup-keeper': 'Mockup keeper',
  drive: 'Drive',
  job: 'Pilot job'
}

// The role tags take Pilot's state hues (sky, violet, amber), each with its light and dark text.
const ROLE_DOT: Record<ArtifactRole, string> = {
  interactive: 'bg-muted-foreground',
  'sub-issue-worker': 'bg-sky-500',
  'mockup-keeper': 'bg-violet-500',
  drive: 'bg-emerald-500',
  job: 'bg-amber-500'
}

const ROLE_TAG: Record<ArtifactRole, string> = {
  interactive: 'bg-muted text-muted-foreground',
  'sub-issue-worker': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'mockup-keeper': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  drive: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  job: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
}

/** "Sub-issue worker", or "Job 03 · Review and fix branch code" for a Pilot job's session. */
export function roleLabel(contribution: Pick<ArtifactContribution, 'role' | 'job'>): string {
  const role = artifactRole(contribution.role)
  return role === 'job' && contribution.job ? `Job ${contribution.job}` : ROLE_LABELS[role]
}

export function roleDotClass(role: string): string {
  return ROLE_DOT[artifactRole(role)]
}

export function roleTagClass(role: string): string {
  return ROLE_TAG[artifactRole(role)]
}

/** The roles that built an artifact, once each, in the order they first published. */
export function artifactRoles(artifact: AgentArtifact): ArtifactRole[] {
  const ordered = [...artifact.contributions].sort((a, b) => a.first.localeCompare(b.first))
  return [...new Set(ordered.map((c) => artifactRole(c.role)))]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "2 sessions · 1 worktree". */
export function builtBySummary(artifact: AgentArtifact): string {
  const sessions = new Set(artifact.contributions.map((c) => c.session_id)).size
  const worktrees = new Set(artifact.contributions.map((c) => c.worktree).filter(Boolean)).size
  return `${plural(sessions, 'session', 'sessions')} · ${plural(worktrees, 'worktree', 'worktrees')}`
}

/** "WEB-1982 +1", or null without a ticket. */
export function ticketSummary(tickets: readonly string[]): string | null {
  const [first] = tickets
  if (!first) {
    return null
  }
  return tickets.length > 1 ? `${first} +${tickets.length - 1}` : first
}

/** A path's last folder or file name. */
export function baseName(path: string): string {
  return (
    path
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .at(-1) ?? path
  )
}

/** A vault report's name: its file, or the folder holding an index.html. */
export function localReportName(artifact: AgentArtifact): string {
  if (artifact.title) {
    return artifact.title
  }
  const parts = artifact.id.split('/')
  const file = parts.at(-1) ?? artifact.id
  if (file === 'index.html' && parts.length > 1) {
    return parts.at(-2) ?? file
  }
  return file.replace(/\.html?$/i, '')
}

export function artifactTitle(artifact: AgentArtifact): string {
  if (artifact.source === 'local') {
    return localReportName(artifact)
  }
  return artifact.title || artifact.description.split(/[.:;]/)[0]?.trim() || artifact.id
}

// A session's scratchpad (Claude Code's /tmp folder per session) is removed when the session ends.
export function isScratchpadPath(path: string): boolean {
  return /[/\\]scratchpad[/\\]/.test(path) || /^\/(private\/)?tmp\//.test(path)
}

/** "10-22", or "10-15 – 10-29" across days. */
export function publishDates(first: string, last: string): string {
  const day = (iso: string) => iso.slice(5, 10)
  if (!first) {
    return day(last)
  }
  return first.slice(0, 10) === last.slice(0, 10) ? day(first) : `${day(first)} – ${day(last)}`
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `claude --resume <id>` to paste in a shell, or null unless the id is a UUID: anything else could run as a command. */
export function resumeCommand(sessionId: string): string | null {
  return SESSION_ID.test(sessionId) ? `claude --resume ${sessionId}` : null
}
