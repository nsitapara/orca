// "5 min ago", "in 2 h", "just now": a time near now, for the pages and the job page's arrows.
export function relativeTime(ms: number, now: number): string {
  const delta = now - ms
  const abs = Math.abs(delta)
  let text = `${Math.round(abs / 3_600_000)} h`
  if (abs < 60_000) {
    return 'just now'
  }
  if (abs < 3_600_000) {
    text = `${Math.round(abs / 60_000)} min`
  }
  if (delta < 0) {
    return `in ${text}`
  }
  return `${text} ago`
}
