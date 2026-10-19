import { getClients, type LinearClientForWorkspace } from '../../../../../main/linear/client'
import {
  LinearWriteFailure,
  runLinearWrite
} from '../../../../../main/linear/linear-issue-write-support'

// workspaceId: the workspace that owns the ticket's team (LinearWriter.teamWorkspace).
export type LinearImageUpload = {
  bytes: Uint8Array
  contentType: string
  filename: string
  workspaceId: string
}

export type LinearUploadDeps = { clients: typeof getClients; fetch: typeof fetch }

// runLinearAgentWrite's write deadline (runtime-linear-comment-lookup-commands.ts): a stalled sign frees its slot.
export const LINEAR_UPLOAD_SIGN_TIMEOUT_MS = 25_000
// One screenshot's PUT to storage; it holds no Linear request slot, so it may outlast a Linear write.
const PUT_TIMEOUT_MS = 120_000

// Linear's signed upload target, asked for under a deadline that aborts the request.
async function signedTarget(entry: LinearClientForWorkspace, input: LinearImageUpload) {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), LINEAR_UPLOAD_SIGN_TIMEOUT_MS)
  try {
    return await runLinearWrite(entry, deadline.signal, async (client) => {
      const payload = await client.fileUpload(
        input.contentType,
        input.filename,
        input.bytes.byteLength
      )
      if (!payload.success || !payload.uploadFile) {
        throw new LinearWriteFailure(
          'failed',
          `Linear couldn't prepare the upload of ${input.filename}`
        )
      }
      return payload.uploadFile
    })
  } catch (error) {
    if (deadline.signal.aborted) {
      throw new LinearWriteFailure(
        'unconfirmed',
        `Linear didn't sign the upload of ${input.filename} within ${LINEAR_UPLOAD_SIGN_TIMEOUT_MS / 1000}s`,
        error
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// One file into Linear's storage from upstream's pieces, as comment-edit.ts (D24): sign, PUT, asset URL.
export async function uploadLinearImage(
  input: LinearImageUpload,
  deps: LinearUploadDeps = { clients: getClients, fetch: (url, init) => fetch(url, init) }
): Promise<{ assetUrl: string }> {
  const entry = deps.clients(input.workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }
  const target = await signedTarget(entry, input)
  const headers = new Headers({
    'Content-Type': input.contentType,
    'Cache-Control': 'public, max-age=31536000'
  })
  for (const { key, value } of target.headers) {
    headers.set(key, value)
  }
  const response = await deps.fetch(target.uploadUrl, {
    method: 'PUT',
    headers,
    // A copy on a plain ArrayBuffer: fetch's BodyInit takes no SharedArrayBuffer-backed view.
    body: new Uint8Array(input.bytes),
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new LinearWriteFailure(
      'failed',
      `Linear refused the upload of ${input.filename}: HTTP ${response.status}`
    )
  }
  return { assetUrl: target.assetUrl }
}
