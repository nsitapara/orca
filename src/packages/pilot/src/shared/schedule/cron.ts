export type CronSpec = {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domAll: boolean
  dowAll: boolean
}

const FIELDS = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['month', 1, 12],
  ['weekday', 0, 7]
] as const

function num(text: string, name: string): number {
  if (!/^\d+$/.test(text)) {
    throw new Error(`${name}: "${text}" is not a number`)
  }
  return Number(text)
}

function parseField(text: string, name: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : num(stepText, name)
    if (step < 1) {
      throw new Error(`${name}: step must be at least 1`)
    }
    let lo = min
    let hi = max
    if (range !== '*') {
      const bounds = range.split('-')
      if (bounds.length > 2) {
        throw new Error(`${name}: bad range ${range}`)
      }
      lo = num(bounds[0], name)
      hi = bounds[1] === undefined ? lo : num(bounds[1], name)
      if (bounds.length === 1 && stepText !== undefined) {
        throw new Error(`${name}: write ${lo}-${max}/${stepText} instead of ${lo}/${stepText}`)
      }
      if (lo > hi) {
        throw new Error(`${name}: range ${lo}-${hi} starts after it ends`)
      }
    }
    for (const v of [lo, hi]) {
      if (v < min || v > max) {
        throw new Error(`${name}: ${v} is out of range ${min}-${max}`)
      }
    }
    for (let v = lo; v <= hi; v += step) {
      out.add(name === 'weekday' && v === 7 ? 0 : v)
    }
  }
  return out
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`expected 5 fields (minute hour day month weekday), got ${parts.length}`)
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) =>
    parseField(p, FIELDS[i][0], FIELDS[i][1], FIELDS[i][2])
  )
  return { minute, hour, dom, month, dow, domAll: parts[2] === '*', dowAll: parts[4] === '*' }
}

type WallClock = { minute: number; hour: number; day: number; month: number; weekday: number }
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short'
    })
    formatters.set(timeZone, f)
  }
  return f
}

function wallClock(date: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  )
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour) % 24,
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAY[parts.weekday]
  }
}

function matches(spec: CronSpec, w: WallClock): boolean {
  if (!spec.minute.has(w.minute) || !spec.hour.has(w.hour) || !spec.month.has(w.month)) {
    return false
  }
  const domOk = spec.dom.has(w.day)
  const dowOk = spec.dow.has(w.weekday)
  if (spec.domAll || spec.dowAll) {
    return domOk && dowOk
  }
  return domOk || dowOk // standard cron: both restricted means either
}

const MINUTE = 60_000
const SEARCH_MINUTES = 60 * 24 * 366

// Walks real minutes, so DST repeats fire twice and skipped wall-clock minutes never fire.
export function nextTickAfter(expr: string, timeZone: string, after: Date): Date | null {
  const spec = parseCron(expr)
  let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE
  for (let i = 0; i < SEARCH_MINUTES; i++, t += MINUTE) {
    if (matches(spec, wallClock(new Date(t), timeZone))) {
      return new Date(t)
    }
  }
  return null
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// "HH:MM" on the automation's wall clock (the window check).
export function localTimeOfDay(at: number, timeZone: string): string {
  const w = wallClock(new Date(at), timeZone)
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}
