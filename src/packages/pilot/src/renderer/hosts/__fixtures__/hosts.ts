import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from '../pilot-host'

export const LOCAL_NAMED: PilotHostEntry = {
  ...LOCAL_PILOT_HOST,
  machineName: 'MacBook',
  schedulerOn: true,
  dataPath: '/data/macbook'
}

export const MINI: PilotHostEntry = {
  key: 'env:mini',
  target: { kind: 'environment', environmentId: 'mini' },
  machineName: 'Mac mini',
  local: false,
  state: 'online',
  reason: null,
  schedulerOn: true,
  dataPath: '/data/mini'
}

export const MINI_OFFLINE: PilotHostEntry = {
  ...MINI,
  state: 'offline',
  reason: 'Not reachable',
  schedulerOn: null,
  dataPath: null
}

type Answer = (method: string, params?: unknown) => unknown

// Answers each pilotRpc call for its host: `local`, or the environment id.
export function byHost(
  answers: Record<string, Answer>
): (method: string, params?: unknown, opts?: { target?: RuntimeClientTarget }) => Promise<unknown> {
  return async (method, params, opts) => {
    const target = opts?.target ?? { kind: 'local' }
    const key = target.kind === 'local' ? 'local' : target.environmentId
    const answer = Object.hasOwn(answers, key) ? answers[key] : undefined
    if (!answer) {
      throw new Error(`No answer for host ${key}`)
    }
    return answer(method, params)
  }
}
