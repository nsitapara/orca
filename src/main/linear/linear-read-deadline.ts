import type { LinearClient } from '@linear/sdk'
import { acquire, release } from './linear-request-concurrency'
import { clearToken } from './linear-token-store'
import {
  getClientWithSignal,
  getPublicFileUrlClient,
  isAuthError,
  type LinearClientForWorkspace
} from './client'
import {
  type LinearAgentAccessError,
  linearError,
  toLinearAccessError
} from './issue-context/errors'

// Why below the CLI's 60s wait: a stalled read holds one of the app's four Linear slots until it
// settles, so it is cancelled in time to free the slot and give the caller a real answer.
export const LINEAR_READ_TIMEOUT_MS = 30_000

function linearReadTimedOut(): LinearAgentAccessError {
  return linearError(
    'linear_timeout',
    `Linear did not answer within ${LINEAR_READ_TIMEOUT_MS / 1000}s, so the read was cancelled.`,
    { nextSteps: ['Retry; if Linear keeps timing out, check the network and status.linear.app.'] }
  )
}

/** Runs one Linear read in a concurrency slot, with a client that the read's deadline aborts.
 *  `publicFileUrls` signs inline upload URLs, which body reads (issue, comments, children) need.
 *  `signal` is the caller's cancellation; it aborts the read alongside the deadline. */
export async function withLinearRead<T>(
  entry: LinearClientForWorkspace,
  read: (client: LinearClient) => Promise<T>,
  options: { publicFileUrls?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), LINEAR_READ_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal
  try {
    try {
      await acquire(signal)
    } catch (error) {
      if (deadline.signal.aborted) {
        throw linearReadTimedOut()
      }
      throw error
    }
    try {
      options.signal?.throwIfAborted()
      const client = options.publicFileUrls
        ? getPublicFileUrlClient(entry, signal)
        : getClientWithSignal(entry, signal)
      return await read(client)
    } catch (error) {
      if (deadline.signal.aborted) {
        throw linearReadTimedOut()
      }
      if (isAuthError(error)) {
        clearToken(entry.workspace.id)
        throw linearError('linear_auth_expired', 'Linear authentication expired.', {
          nextSteps: ['Reconnect Linear from Orca settings.']
        })
      }
      throw toLinearAccessError(error)
    } finally {
      release()
    }
  } finally {
    clearTimeout(timer)
  }
}
