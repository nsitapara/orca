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
  classifyLinearError,
  linearError,
  linearMessage
} from './issue-context-errors'

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
 *  `publicFileUrls` signs inline upload URLs, which body reads (issue, comments, children) need. */
export async function withLinearRead<T>(
  entry: LinearClientForWorkspace,
  read: (client: LinearClient) => Promise<T>,
  options: { publicFileUrls?: boolean } = {}
): Promise<T> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), LINEAR_READ_TIMEOUT_MS)
  try {
    try {
      await acquire(deadline.signal)
    } catch {
      throw linearReadTimedOut()
    }
    try {
      const client = options.publicFileUrls
        ? getPublicFileUrlClient(entry, deadline.signal)
        : getClientWithSignal(entry, deadline.signal)
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
      throw linearError(classifyLinearError(error), linearMessage(error))
    } finally {
      release()
    }
  } finally {
    clearTimeout(timer)
  }
}
