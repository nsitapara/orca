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
