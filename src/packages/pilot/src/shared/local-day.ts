const pad2 = (n: number): string => String(n).padStart(2, '0')

// The local calendar day of a moment (YYYY-MM-DD), as usage.py's _day reads a response's timestamp.
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
