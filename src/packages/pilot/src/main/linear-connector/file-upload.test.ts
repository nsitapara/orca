import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../main/linear/linear-request-concurrency', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn()
}))

vi.mock('../../../../../main/linear/linear-token-store', () => ({ clearToken: vi.fn() }))

import { uploadLinearImage } from './file-upload'

const UPLOAD_FILE = {
  uploadUrl: 'https://storage.googleapis.com/linear-uploads/abc?sig=1',
  assetUrl: 'https://uploads.linear.app/ws/abc/shot.png',
  headers: [{ key: 'x-a', value: '1' }]
}
const INPUT = {
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'image/png',
  filename: 'shot.png',
  team: 'WEB',
  workspaceId: 'ws1'
}

function connected(count: number, payload: unknown = { success: true, uploadFile: UPLOAD_FILE }) {
  const fileUpload = vi.fn().mockResolvedValue(payload)
  const entries = Array.from({ length: count }, (_, i) => ({
    workspace: { id: `ws${i + 1}` },
    client: { fileUpload },
    apiKey: 'key'
  }))
  return { fileUpload, clients: vi.fn().mockReturnValue(entries) }
}

function answering(status: number) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }))
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('uploadLinearImage', () => {
  it("PUTs the bytes to Linear's signed URL with its headers and returns the asset URL", async () => {
    const linear = connected(1)
    const fetch = answering(200)

    await expect(uploadLinearImage(INPUT, { clients: linear.clients, fetch })).resolves.toEqual({
      assetUrl: UPLOAD_FILE.assetUrl
    })
    expect(linear.clients).toHaveBeenCalledWith('ws1')
    expect(linear.fileUpload).toHaveBeenCalledWith('image/png', 'shot.png', 3)
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
    const linear = connected(count, payload)
    const fetch = answering(status)

    await expect(uploadLinearImage(INPUT, { clients: linear.clients, fetch })).rejects.toThrow(
      message
    )
  })
})
