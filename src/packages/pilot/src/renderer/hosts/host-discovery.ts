import { hasRuntimeRpcErrorCode } from '../../../../../shared/runtime-rpc-error-code'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { PilotStatus } from '../../shared/api-types'
import type { KnownPilotHosts } from './known-hosts'
import { environmentHostKey, LOCAL_PILOT_HOST, type PilotHostEntry } from './pilot-host'

export type EnvironmentContact = 'revoked' | 'unreachable' | 'reachable'

export type DiscoveryDeps = {
  environments: readonly { id: string; name: string }[]
  contact(environmentId: string): EnvironmentContact
  status(target: RuntimeClientTarget): Promise<PilotStatus>
  runtimeMachineName(environmentId: string): string | null
  known: KnownPilotHosts
}

type Identity = { machineName?: string; dataPath?: string }

type Probe = { entry: PilotHostEntry; identity: Identity } | null

function isSameEngine(a: Identity, b: Identity): boolean {
  if (!a.machineName || !a.dataPath || !b.machineName || !b.dataPath) {
    return false
  }
  return a.machineName === b.machineName && a.dataPath === b.dataPath
}

function offlineEntry(env: { id: string }, machineName: string, reason: string): PilotHostEntry {
  return {
    key: environmentHostKey(env.id),
    target: { kind: 'environment', environmentId: env.id },
    machineName,
    local: false,
    state: 'offline',
    reason,
    schedulerOn: null,
    dataPath: null
  }
}

// Loss of contact never proves a host is gone: one seen answering stays listed as offline.
function lostContact(env: { id: string }, deps: DiscoveryDeps, reason: string): Probe {
  const seen = deps.known.get(env.id)
  return seen === null ? null : { entry: offlineEntry(env, seen, reason), identity: {} }
}

async function probeEnvironment(
  env: { id: string; name: string },
  deps: DiscoveryDeps
): Promise<Probe> {
  const contact = deps.contact(env.id)
  if (contact === 'revoked') {
    deps.known.forget(env.id)
    return null
  }
  if (contact === 'unreachable') {
    return lostContact(env, deps, 'Not reachable')
  }
  try {
    const status = await deps.status({ kind: 'environment', environmentId: env.id })
    const machineName = status.machineName ?? deps.runtimeMachineName(env.id) ?? env.name
    const entry: PilotHostEntry = {
      key: environmentHostKey(env.id),
      target: { kind: 'environment', environmentId: env.id },
      machineName,
      local: false,
      state: 'online',
      reason: null,
      schedulerOn: status.schedulerOn ?? null,
      dataPath: status.dataPath ?? null
    }
    return { entry, identity: { machineName: status.machineName, dataPath: status.dataPath } }
  } catch (error) {
    // Stock Orca has no pilot.status: not a Pilot host at all.
    if (hasRuntimeRpcErrorCode(error, 'method_not_found')) {
      deps.known.forget(env.id)
      return null
    }
    return lostContact(env, deps, 'Not reachable')
  }
}

async function probeLocal(
  deps: DiscoveryDeps
): Promise<{ entry: PilotHostEntry; identity: Identity }> {
  try {
    const status = await deps.status({ kind: 'local' })
    return {
      entry: {
        ...LOCAL_PILOT_HOST,
        machineName: status.machineName ?? LOCAL_PILOT_HOST.machineName,
        schedulerOn: status.schedulerOn ?? null,
        dataPath: status.dataPath ?? null
      },
      identity: { machineName: status.machineName, dataPath: status.dataPath }
    }
  } catch {
    return { entry: LOCAL_PILOT_HOST, identity: {} }
  }
}

export async function discoverPilotHosts(deps: DiscoveryDeps): Promise<PilotHostEntry[]> {
  if (deps.environments.length === 0) {
    return [LOCAL_PILOT_HOST]
  }
  const [local, ...probes] = await Promise.all([
    probeLocal(deps),
    ...deps.environments.map((env) => probeEnvironment(env, deps))
  ])
  const hosts = [local.entry]
  const identities = [local.identity]
  for (const [index, probe] of probes.entries()) {
    if (!probe) {
      continue
    }
    const envId = deps.environments[index].id
    // Remembered only once it isn't this engine, so a self-pairing never comes back as an offline copy.
    if (identities.some((seen) => isSameEngine(seen, probe.identity))) {
      deps.known.forget(envId)
      continue
    }
    if (probe.entry.state === 'online') {
      deps.known.remember(envId, probe.entry.machineName)
    }
    hosts.push(probe.entry)
    identities.push(probe.identity)
  }
  return hosts
}
