import { createServer, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LinearClientForWorkspace } from './client'
import { LINEAR_READ_TIMEOUT_MS, withLinearRead } from './linear-read-deadline'
import { acquire, release } from './linear-request-concurrency'
import { loadLinearSdk } from './linear-sdk'

// Real SDK clients against a local server that never answers: the abort has to reach the socket.
vi.mock('./client', () => {
  const client = (apiKey: string, signal: AbortSignal) =>
    new (loadLinearSdk().LinearClient)({ apiKey, signal })
  return {
    getClients: vi.fn(),
    getStatus: vi.fn(),
    isAuthError: () => false,
    getClientWithSignal: (entry: LinearClientForWorkspace, signal: AbortSignal) =>
      client(entry.apiKey, signal),
    getPublicFileUrlClient: (entry: LinearClientForWorkspace, signal: AbortSignal) =>
      client(entry.apiKey, signal)
  }
})
vi.mock('./linear-token-store', () => ({ clearToken: vi.fn() }))

const entry: LinearClientForWorkspace = {
  workspace: {
    id: 'workspace',
    organizationId: 'workspace',
    organizationName: 'Acme',
    displayName: 'Brennan',
    email: null
  },
  client: new (loadLinearSdk().LinearClient)({ apiKey: 'probe-only' }),
  apiKey: 'probe-only'
}

let server: Server
let stalled: ServerResponse[]
let received: () => void
let deadlines: (() => void)[]
const nativeSetTimeout = globalThis.setTimeout
const nativeFetch = globalThis.fetch

beforeEach(async () => {
  stalled = []
  received = () => {}
  deadlines = []
  server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.flushHeaders()
      stalled.push(response)
      received()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address')
  }
  const apiUrl = `http://127.0.0.1:${address.port}/graphql`
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => nativeFetch(apiUrl, init))
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay === LINEAR_READ_TIMEOUT_MS) {
      deadlines.push(() => callback(...args))
    }
    return nativeSetTimeout(callback, delay, ...args)
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  const closed = new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  server.closeAllConnections()
  await closed
})

function read(): Promise<unknown> {
  return withLinearRead(entry, (client) =>
    client.client.rawRequest('query Probe { viewer { id } }')
  )
}

function waitForRequests(count: number): Promise<void> {
  return new Promise((resolve) => {
    received = () => {
      if (stalled.length === count) {
        resolve()
      }
    }
  })
}

const timedOut = expect.objectContaining({
  code: 'linear_timeout',
  message: 'Linear did not answer within 30s, so the read was cancelled.'
})

// Why: `linear issue` reads shared four app-wide slots with no deadline, so a stalled request
// kept its slot after the CLI gave up, and four of them stopped every Linear call in the app.
it('cancels stalled reads at the deadline, answers linear_timeout, and frees their slots', async () => {
  const started = waitForRequests(4)
  const reads = Array.from({ length: 4 }, () => read().catch((error: unknown) => error))
  await started
  let admitted = false
  const nextAdmission = acquire().then(() => {
    admitted = true
    release()
  })
  await Promise.resolve()
  expect(admitted).toBe(false)
  expect(deadlines).toHaveLength(4)
  for (const deadline of deadlines) {
    deadline()
  }
  expect(await Promise.all(reads)).toEqual([timedOut, timedOut, timedOut, timedOut])
  await nextAdmission
  expect(admitted).toBe(true)
})

it('cancels a read still queued behind full slots without taking or freeing a slot', async () => {
  await Promise.all(Array.from({ length: 4 }, () => acquire()))
  try {
    const queued = read().catch((error: unknown) => error)
    expect(deadlines).toHaveLength(1)
    deadlines[0]()
    expect(await queued).toEqual(timedOut)
    expect(stalled).toEqual([])
    let admitted = false
    const fifth = acquire().then(() => {
      admitted = true
    })
    await Promise.resolve()
    expect(admitted).toBe(false)
    release()
    await fifth
    release()
  } finally {
    for (let index = 0; index < 3; index++) {
      release()
    }
  }
})
