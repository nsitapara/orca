import type { QuotaReading } from '../../src/main/fields/quota'
import type { AgentKind } from '../../src/shared/definition/types'
import type { FrozenOldSide } from './old-side'

// A recorded case and the reads it answers: the leaf every fixture module builds on (no import cycle).
export type FixtureRead = {
  argv: string[]
  code?: number | null
  stdout?: string
  json?: unknown
  stderr?: string
  timeout?: boolean
}
export type ParityFixture = {
  job: string
  case: string
  recordedAt: string
  now: number
  repo: { id: string; path: string; name: string; project: string; host: string }
  quota?: Partial<Record<AgentKind, QuotaReading>>
  reads: FixtureRead[]
  state: Record<string, unknown>
  exists: Record<string, boolean>
  // The old side's verdicts, frozen into the case when its code was deleted (13, 09): old-side.ts frozenOldSide.
  old?: FrozenOldSide
}

export class NotInFixture extends Error {
  constructor(what: string) {
    super(
      `Not in the fixture: ${what}. Re-record the case, or add the read to the job adapter's record_extras.`
    )
    this.name = 'NotInFixture'
  }
}

// Every read each fixture couldn't answer. Pilot's field reads fail soft (the field reads unknown),
// so a miss can still end in the old side's verdict: parity-case.ts fails a case on any miss.
const MISSES = new WeakMap<ParityFixture, Set<string>>()

export function miss(f: ParityFixture, what: string): NotInFixture {
  const seen = MISSES.get(f) ?? new Set<string>()
  seen.add(what)
  MISSES.set(f, seen)
  return new NotInFixture(what)
}

export function fixtureMisses(f: ParityFixture): string[] {
  return [...(MISSES.get(f) ?? [])]
}

export function stdoutOf(read: FixtureRead): string {
  if (read.stdout !== undefined) {
    return read.stdout
  }
  if (read.json !== undefined) {
    return JSON.stringify(read.json)
  }
  return ''
}

export function fixtureRead(f: ParityFixture, argv: string[]): FixtureRead {
  const found = f.reads.find(
    (r) => r.argv.length === argv.length && r.argv.every((a, i) => a === argv[i])
  )
  if (!found) {
    throw miss(f, argv.join(' '))
  }
  return found
}

export function orcaResult<T>(f: ParityFixture, args: string[]): T {
  return (JSON.parse(stdoutOf(fixtureRead(f, ['orca', ...args, '--json']))) as { result: T }).result
}
