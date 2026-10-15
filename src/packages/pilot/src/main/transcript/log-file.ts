import { open, realpath, stat } from 'node:fs/promises'
import { sep } from 'node:path'
import { emptyLog, feed, type LogState, type Span } from './claude-log'

export const NOT_UNDER_ROOT =
  "The transcript isn't under Claude's projects folder, so Pilot doesn't read it"

async function readAt(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, offset)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const HEAD_BYTES = 1024

// The file's first bytes still match what was read before (the shorter of the two is the prefix to compare).
function sharesHead(before: Buffer, now: Buffer): boolean {
  const n = Math.min(before.length, now.length)
  return before.subarray(0, n).equals(now.subarray(0, n))
}

type Cached = { state: LogState; ino: number; head: Buffer }

// Reads Claude transcripts under one root, in place: each file is parsed once and then only what was appended, and
// the newest `max` parses stay in memory. Nothing is written anywhere.
export class LogReader {
  private readonly cache = new Map<string, Cached>()
  private readonly pending = new Map<string, Promise<LogState>>()

  constructor(
    private readonly root: string,
    private readonly max = 20
  ) {}

  // Reads of one file run one after another, so two callers never feed the same bytes twice.
  async read(path: string): Promise<LogState> {
    const real = await this.confined(path)
    const previous = this.pending.get(real) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.load(real))
    this.pending.set(real, next)
    try {
      return await next
    } finally {
      if (this.pending.get(real) === next) {
        this.pending.delete(real)
      }
    }
  }

  private async load(real: string): Promise<LogState> {
    const { size, ino } = await stat(real)
    const head = await readAt(real, 0, Math.min(HEAD_BYTES, size))
    const had = this.cache.get(real)
    const same =
      had !== undefined && had.ino === ino && size >= had.state.offset && sharesHead(had.head, head)
    const state = same ? had.state : emptyLog()
    if (size > state.offset) {
      feed(state, await readAt(real, state.offset, size - state.offset))
    }
    this.cache.delete(real)
    this.cache.set(real, { state, ino, head })
    while (this.cache.size > this.max) {
      this.cache.delete(this.cache.keys().next().value as string)
    }
    return state
  }

  // One record's line, for an entry's full input or output.
  async span(path: string, s: Span): Promise<string> {
    return (await readAt(await this.confined(path), s.offset, s.length)).toString('utf8')
  }

  private async confined(path: string): Promise<string> {
    const [real, root] = await Promise.all([realpath(path), realpath(this.root)])
    if (!real.startsWith(`${root}${sep}`)) {
      throw new Error(NOT_UNDER_ROOT)
    }
    return real
  }
}
