import { basename, extname, isAbsolute } from 'node:path'
import { z } from 'zod'
import { DETAILS_LIMITS, IMAGE_TYPES } from '../../shared/details'
import { realInside, realRoot } from '../inbox/details-bundle'
import { DetailsRefused, readCapped, sha256 } from '../inbox/details-read'
import { notCreated } from './linear-create-outcome'
import type { ActionResult } from './types'

// A screenshot's placeholder in a ticket body, replaced by its Linear asset URL before the create.
const IMAGE_REF = /pilot-image:\d+/g

export const imageArg = z.strictObject({
  ref: z.string().regex(/^pilot-image:\d+$/, 'a pilot-image:N ref'),
  path: z.string().refine((path) => isAbsolute(path) && !path.includes('\0'), 'an absolute path'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 hex digest'),
  caption: z.string().optional()
})
type ImageArg = z.infer<typeof imageArg>

export type TicketImage = { ref: string; bytes: Buffer; contentType: string; filename: string }

// Why a body's refs don't fit its images: a ref given twice, or a body ref with no image.
export function imageRefProblem(
  body: string,
  images: ImageArg[]
): { path: string; message: string } | null {
  const refs = images.map((image) => image.ref)
  const twice = refs.find((ref, at) => refs.indexOf(ref) !== at)
  if (twice) {
    return { path: 'images', message: `${twice} is given twice` }
  }
  const unknown = body.match(IMAGE_REF)?.find((ref) => !refs.includes(ref))
  if (unknown) {
    return { path: 'body', message: `${unknown} names no image` }
  }
  return null
}

function imageType(path: string): string | null {
  const ext = extname(path).toLowerCase()
  return Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : null
}

// Every screenshot checked before any upload: an image inside the Automations folder, unchanged since the draft.
export function readTicketImages(
  root: string | null,
  images: ImageArg[]
): { images: TicketImage[] } | { refused: ActionResult } {
  if (images.length === 0) {
    return { images: [] }
  }
  try {
    const top = realRoot(root)
    const read: TicketImage[] = []
    for (const image of images) {
      const label = `screenshot ${image.ref}`
      const real = realInside(top, image.path, label)
      const contentType = imageType(real)
      if (contentType === null || imageType(image.path) === null) {
        return { refused: notCreated('failed', `${label} is not an image`) }
      }
      const bytes = readCapped(real, DETAILS_LIMITS.imageBytes, label)
      if (sha256(bytes) !== image.sha256) {
        return { refused: notCreated('stale', `${label} changed since the ticket was drafted`) }
      }
      read.push({ ref: image.ref, bytes, contentType, filename: basename(real) })
    }
    return { images: read }
  } catch (error) {
    if (error instanceof DetailsRefused) {
      return { refused: notCreated('failed', error.reason) }
    }
    throw error
  }
}

// The body with each screenshot ref replaced by the asset URL its image uploaded to.
export function withAssetUrls(body: string, urls: ReadonlyMap<string, string>): string {
  return body.replace(IMAGE_REF, (ref) => urls.get(ref) ?? ref)
}
