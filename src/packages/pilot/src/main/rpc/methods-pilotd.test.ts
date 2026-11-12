import { describe, expect, it, vi } from 'vitest'
import { buildPilotdMethods, readPilotdCounts, readPilotdHealth } from './methods-pilotd'

const answering = (status: number, body: unknown) =>
  vi.fn(
    async (_url: string, _init: { signal: AbortSignal }) =>
      new Response(JSON.stringify(body), { status })
  )
const failing = (error: Error) =>
  vi.fn(async (_url: string, _init: { signal: AbortSignal }): Promise<Response> => {
    throw error
  })
const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })

const COUNTS = {
  ok: true,
  running: 2,
  queued: 1,
  needsYou: { cards: 3, sessions: 1 },
  failedToday: 4,
  gaveUp: 0,
  engine: { running: true }
}

describe("pilotd's reads", () => {
  it('asks only /health at the origin of the saved address, the default when blank', async () => {
    const fetch = answering(200, { ok: true, build: 'b1', engine: { running: true, pid: 1 } })
    expect(await readPilotdHealth(undefined, fetch)).toEqual({
      reachable: true,
      engineRunning: true,
      build: 'b1'
    })
    await readPilotdHealth('http://mini.tail:9000/somewhere?x=1', fetch)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8787/health',
      'http://mini.tail:9000/health'
    ])
  })

  it.each([
    [
      'nothing listening',
      undefined,
      failing(new TypeError('fetch failed')),
      'Nothing answers at http://127.0.0.1:8787.'
    ],
    ['no answer in time', undefined, failing(timeout), "pilotd didn't answer within 2 s."],
    ['an error status', undefined, answering(500, {}), 'pilotd answered 500.'],
    [
      'another server',
      undefined,
      answering(200, { hello: 'world' }),
      "The server at this address isn't pilotd."
    ],
    [
      'not a web address',
      'file:///etc/passwd',
      answering(200, { ok: true }),
      "The pilotd address isn't a web address (http://host:port)."
    ]
  ])('unreachable when %s, and never throws', async (_case, address, fetch, error) => {
    expect(await readPilotdHealth(address, fetch)).toEqual({ reachable: false, error })
  })

  it('reads the counts, and none from a build without /counts or a failed read', async () => {
    expect(await readPilotdCounts(undefined, answering(200, COUNTS))).toEqual({
      running: 2,
      queued: 1,
      needsYou: { cards: 3, sessions: 1 },
      failedToday: 4,
      gaveUp: 0,
      engineRunning: true
    })
    const notFound = { ok: false, error: { code: 'not_found', message: 'No such path' } }
    expect(await readPilotdCounts(undefined, answering(404, notFound))).toBeNull()
    expect(
      await readPilotdCounts(undefined, answering(200, { ...COUNTS, running: 'two' }))
    ).toBeNull()
    expect(await readPilotdCounts(undefined, failing(timeout))).toBeNull()
  })

  it('answers as two workspace methods', () => {
    expect(buildPilotdMethods().map((m) => [m.name, m.permission])).toEqual([
      ['pilot.pilotd.health', 'workspace'],
      ['pilot.pilotd.counts', 'workspace']
    ])
  })
})
