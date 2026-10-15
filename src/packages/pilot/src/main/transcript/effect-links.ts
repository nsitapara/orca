import type { Effect } from '../../shared/visibility-types'

export type LinkBases = { gitlab: string | null; linear: string | null }

const SCP = /^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/
const URL_REMOTE = /^(?:ssh|https?):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/
const GITLAB_PAGE = /^(https:\/\/[^/]+\/.+?)\/-\/(?:merge_requests|pipelines|jobs|tree)\//
const LINEAR_ISSUE = /^(https:\/\/linear\.app\/[^/]+)\/issue\//
const TICKET = /^[A-Z][A-Z0-9]{1,9}-\d+$/
const RETRY = /(?:^|\/)jobs\/(\d+)\/retry$/

// A GitLab remote's web URL: git@host:group/repo.git, ssh://git@host[:port]/group/repo.git or https://host/group/repo.
export function webBase(remote: string): string | null {
  const s = remote.trim()
  const m = SCP.exec(s) ?? URL_REMOTE.exec(s)
  return m ? `https://${m[1]}/${m[2]}` : null
}

// The project a GitLab page URL belongs to, from the first one that has one.
export function gitlabBaseOf(urls: readonly string[]): string | null {
  return urls.map((u) => GITLAB_PAGE.exec(u)?.[1]).find((b) => b !== undefined) ?? null
}

// The Linear workspace an issue URL belongs to, from the first one that has one.
export function linearBaseOf(urls: readonly string[]): string | null {
  return urls.map((u) => LINEAR_ISSUE.exec(u)?.[1]).find((b) => b !== undefined) ?? null
}

function branchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/')
}

function gitlabUrl(e: Effect, target: string, gitlab: string): string | null {
  if (e.kind === 'pushed') {
    return `${gitlab}/-/tree/${branchPath(target)}`
  }
  if (target.startsWith('!')) {
    return `${gitlab}/-/merge_requests/${target.slice(1)}`
  }
  const job = e.kind === 'gitlab_write' ? RETRY.exec(target) : null
  return job ? `${gitlab}/-/jobs/${job[1]}` : null
}

function urlOf(e: Effect, bases: LinkBases): string | null {
  const target = e.target
  if (!target) {
    return null
  }
  if (TICKET.test(target)) {
    return bases.linear ? `${bases.linear}/issue/${target}` : null
  }
  return bases.gitlab ? gitlabUrl(e, target, bases.gitlab) : null
}

// Fills each effect's link the effect didn't bring itself (spec §2 Links). A catalog action keeps act.py's link.
export function linkEffects(effects: readonly Effect[], bases: LinkBases): Effect[] {
  return effects.map((e) => (e.url || e.kind === 'action' ? e : { ...e, url: urlOf(e, bases) }))
}
