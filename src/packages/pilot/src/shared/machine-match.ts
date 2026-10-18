// A runs_on value names a machine trimmed and in any case.
export function sameMachine(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
