import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileUpload: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn()
}))

vi.mock('../../../../../main/linear/linear-request-concurrency', () => ({
  acquire: mocks.acquire,
  release: mocks.release
}))

vi.mock('../../../../../main/linear/linear-token-store', () => ({ clearToken: vi.fn() }))

// The SDK client a signalled write builds: its fileUpload gets the signal the client was made with.
vi.mock('../../../../../main/linear/linear-sdk', () => ({
  loadLinearSdk: () => ({
    LinearClient: class {
      readonly fileUpload: (...args: unknown[]) => unknown
      constructor(options: { signal?: AbortSignal }) {
        this.fileUpload = (...args) => mocks.fileUpload(options.signal, ...args)
      }
    },
    AuthenticationLinearError: class extends Error {}
  })
}))

import { LINEAR_UPLOAD_SIGN_TIMEOUT_MS, uploadLinearImage } from './file-upload'

const UPLOAD_FILE = {
  uploadUrl: 'https://storage.googleapis.com/linear-uploads/abc?sig=1',
  assetUrl: 'https://uploads.linear.app/ws/abc/shot.png',
  headers: [{ key: 'x-a', value: '1' }]
}
const INPUT = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/png',
  filename: 'shot.png',
  workspaceId: 'ws1'
}

function connected(count: number, payload: unknown = { success: true, uploadFile: UPLOAD_FILE }) {
  mocks.fileUpload.mockResolvedValue(payload)
  const entries = Array.from({ length: count }, (_, i) => ({
    workspace: { id: `ws${i + 1}` },
    apiKey: 'key'
  }))
  return vi.fn().mockReturnValue(entries)
}

function answering(status: number) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('uploadLinearImage', () => {
  it("PUTs the bytes to Linear's signed URL with its headers and returns the asset URL", async () => {
    const clients = connected(1)
    const fetch = answering(200)

    await expect(uploadLinearImage(INPUT, { clients, fetch })).resolves.toEqual({
      assetUrl: UPLOAD_FILE.assetUrl
    })
    expect(clients).toHaveBeenCalledWith('ws1')
    expect(mocks.fileUpload).toHaveBeenCalledWith(
      expect.any(AbortSignal),
      'image/png',
      'shot.png',
      3
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(UPLOAD_FILE.uploadUrl)
    expect(init?.method).toBe('PUT')
    expect(init?.body).toEqual(INPUT.bytes)
    const headers = new Headers(init?.headers)
    expect(headers.get('x-a')).toBe('1')
    expect(headers.get('content-type')).toBe('image/png')
    expect(headers.get('cache-control')).toBe('public, max-age=31536000')
  })

  it.each([
    [
      'an HTTP 403 from the upload',
      1,
      undefined,
      403,
      'Linear refused the upload of shot.png: HTTP 403'
    ],
    ['no Linear login', 0, undefined, 200, 'Not connected to Linear'],
    [
      'an upload Linear could not prepare',
      1,
      { success: false, uploadFile: null },
      200,
      "Linear couldn't prepare the upload of shot.png"
    ]
  ])('refuses %s', async (_name, count, payload, status, message) => {
    const clients = connected(count, payload)
    const fetch = answering(status)

    await expect(uploadLinearImage(INPUT, { clients, fetch })).rejects.toThrow(message)
  })

  it('aborts a sign Linear never answers at its deadline, freeing the Linear slot and PUTting nothing', async () => {
    vi.useFakeTimers()
    const clients = connected(1)
    // Like the SDK's fetch: no answer until the client's signal aborts the request.
    mocks.fileUpload.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('This operation was aborted')))
        })
    )
    const fetch = answering(200)

    const upload = uploadLinearImage(INPUT, { clients, fetch })
    const settled = expect(upload).rejects.toMatchObject({
      kind: 'unconfirmed',
      message: "Linear didn't sign the upload of shot.png within 25s"
    })
    await vi.advanceTimersByTimeAsync(LINEAR_UPLOAD_SIGN_TIMEOUT_MS)
    await settled
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
