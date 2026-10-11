// How a timeout reads to people: seconds under 2 minutes, minutes under 2 hours, else hours.
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 120) {
    return `${seconds}s`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) {
    return `${minutes}m`
  }
  return `${Math.round(minutes / 60)}h`
}
