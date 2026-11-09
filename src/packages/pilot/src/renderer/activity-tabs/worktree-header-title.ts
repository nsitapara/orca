function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A worktree's name without the Linear ID its chip already shows: "WEB-2637 Use the same…" → "Use the same…". */
export function titleWithoutIssueId(name: string, identifier: string | null | undefined): string {
  if (!identifier) {
    return name
  }
  const prefix = new RegExp(`^\\s*${escapeRegExp(identifier)}(?:\\s*[:·–—-]\\s*|\\s+)`, 'i')
  const rest = name.replace(prefix, '')
  return rest !== name && rest.trim().length > 0 ? rest : name
}

function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Whether a branch says only what the header's Linear chip and title already say: the issue ID, then
 * the title's words or (Linear cuts a long name short) the first of them. A prefix such as "feat/" is ignored.
 */
export function branchRepeatsHeader(
  branch: string,
  name: string,
  identifier: string | null | undefined
): boolean {
  const last = branch.split('/').at(-1) ?? ''
  const id = identifier ? letters(identifier) : ''
  const all = letters(last)
  const rest = id && all.startsWith(id) ? all.slice(id.length) : all
  return letters(titleWithoutIssueId(name, identifier)).startsWith(rest)
}

/** A worktree's folder name, the last part of its path. */
export function worktreeFolderName(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path
}
