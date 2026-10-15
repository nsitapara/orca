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

// Reads Claude transcripts under one root, in place: each file is parsed once and then only what was appended, and
// the newest `max` parses stay in memory. Nothing is written anywhere.
export class LogReader {
  private readonly cache = new Map<string, LogState>()

  constructor(
    private readonly root: string,
    private readonly max = 20
  ) {}

  async read(path: string): Promise<LogState> {
    const real = await this.confined(path)
    const size = (await stat(real)).size
    const had = this.cache.get(real)
    const state = had && size >= had.offset ? had : emptyLog()
    if (size > state.offset) {
      feed(state, await readAt(real, state.offset, size - state.offset))
    }
    this.cache.delete(real)
    this.cache.set(real, state)
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
