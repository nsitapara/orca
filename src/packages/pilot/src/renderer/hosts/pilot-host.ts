import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

export type PilotHostRef = {
  key: string
  target: RuntimeClientTarget
  machineName: string
  local: boolean
}

export type PilotHostEntry = PilotHostRef & {
  state: 'online' | 'offline'
  reason: string | null
  schedulerOn: boolean | null
  dataPath: string | null
}

export const LOCAL_PILOT_HOST: PilotHostEntry = {
  key: 'local',
  target: { kind: 'local' },
  machineName: 'This machine',
  local: true,
  state: 'online',
  reason: null,
  schedulerOn: null,
  dataPath: null
}

export type Hosted<T> = T & { host: PilotHostRef }

export function hostOf(value: { host?: PilotHostRef }): PilotHostRef {
  return value.host ?? LOCAL_PILOT_HOST
}

// Local ids stay bare so existing keys and persisted state keep working.
export function hostedKey(host: Pick<PilotHostRef, 'key' | 'local'>, id: string): string {
  return host.local ? id : `${host.key}/${id}`
}

export function environmentHostKey(environmentId: string): string {
  return `env:${environmentId}`
}
