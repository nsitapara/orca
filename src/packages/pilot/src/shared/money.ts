export function money(usd: number | null): string {
  if (usd === null) {
    return '—'
  }
  return `$${usd.toFixed(2)}`
}

const UNITS: [string, number][] = [
  ['B', 1e9],
  ['M', 1e6],
  ['k', 1e3]
]

// usage.py's fmt_tokens: one decimal in the biggest unit that fits.
export function fmtTokens(n: number): string {
  for (const [unit, size] of UNITS) {
    if (n >= size) {
      return `${(n / size).toFixed(1)}${unit}`
    }
  }
  return String(Math.trunc(n))
}
