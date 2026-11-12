import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import {
  pilotdOrigin,
  type PilotdCounts,
  type PilotdHealth
} from '../../shared/automation-engine-settings'

export const PILOTD_TIMEOUT_MS = 2_000

const Address = z.object({ address: z.string().max(512).optional() })

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null
}

// One fixed path on pilotd's origin, its JSON body or why there is none. Never throws.
async function getJson(
  address: string | undefined,
  path: '/health' | '/counts',
  fetchImpl: Fetch
): Promise<{ body: unknown } | { error: string }> {
  const origin = pilotdOrigin(address)
  if (origin === null) {
    return { error: "The pilotd address isn't a web address (http://host:port)." }
  }
  try {
    const res = await fetchImpl(`${origin}${path}`, {
      signal: AbortSignal.timeout(PILOTD_TIMEOUT_MS)
    })
    if (!res.ok) {
      return { error: `pilotd answered ${res.status}.` }
    }
    return { body: await res.json() }
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { error: `pilotd didn't answer within ${PILOTD_TIMEOUT_MS / 1000} s.` }
    }
    return { error: `Nothing answers at ${origin}.` }
  }
}

export async function readPilotdHealth(
  address: string | undefined,
  fetchImpl: Fetch = fetch
): Promise<PilotdHealth> {
  const got = await getJson(address, '/health', fetchImpl)
  if ('error' in got) {
    return { reachable: false, error: got.error }
  }
  const body = got.body
  if (!isRecord(body) || body.ok !== true) {
    return { reachable: false, error: "The server at this address isn't pilotd." }
  }
  const engine = isRecord(body.engine) ? body.engine : {}
  return {
    reachable: true,
    engineRunning: engine.running === true,
    build: typeof body.build === 'string' ? body.build.slice(0, 80) : null
  }
}

export async function readPilotdCounts(
  address: string | undefined,
  fetchImpl: Fetch = fetch
): Promise<PilotdCounts | null> {
  const got = await getJson(address, '/counts', fetchImpl)
  if ('error' in got || !isRecord(got.body) || got.body.ok !== true) {
    return null
  }
  const b = got.body
  const needs = isRecord(b.needsYou) ? b.needsYou : {}
  const running = count(b.running)
  const queued = count(b.queued)
  const cards = count(needs.cards)
  const sessions = count(needs.sessions)
  if (running === null || queued === null || cards === null || sessions === null) {
    return null
  }
  return {
    running,
    queued,
    needsYou: { cards, sessions },
    failedToday: count(b.failedToday) ?? 0,
    gaveUp: count(b.gaveUp) ?? 0,
    engineRunning: isRecord(b.engine) && b.engine.running === true
  }
}

// pilotd's two token-free reads, for the Automations page's frame and the sidebar's counts. The renderer can't read
// them itself (pilotd sends no CORS headers). Only those two paths, only parsed fields; they answer even when Pilot's
// own engine didn't start, since pilotd is what runs then.
export function buildPilotdMethods(fetchImpl: Fetch = fetch) {
  return [
    defineMethod({
      name: 'pilot.pilotd.health',
      permission: 'workspace',
      params: Address,
      handler: (p) => readPilotdHealth(p.address, fetchImpl)
    }),
    defineMethod({
      name: 'pilot.pilotd.counts',
      permission: 'workspace',
      params: Address,
      handler: (p) => readPilotdCounts(p.address, fetchImpl)
    })
  ]
}
