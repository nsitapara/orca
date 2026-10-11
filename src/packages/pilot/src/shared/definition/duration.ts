import { z } from 'zod'

const DURATION = /^([1-9]\d*)(s|m|h|d)$/
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

// "<n>s|m|h|d" in milliseconds (contract §1); null when the text isn't one.
export function durationMs(text: string): number | null {
  const match = DURATION.exec(text)
  if (!match) {
    return null
  }
  return Number(match[1]) * UNIT_MS[match[2]]
}

export const durationSchema = z
  .string()
  .regex(DURATION, 'expected a duration like 30s, 10m, 12h or 2d')
  .transform((text) => durationMs(text) ?? 0)
