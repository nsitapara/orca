import { basename, extname, isAbsolute } from 'node:path'
import { z } from 'zod'
import { DETAILS_LIMITS, IMAGE_TYPES } from '../../shared/details'
import { realInside, realRoot } from '../inbox/details-bundle'
import { DetailsRefused, readCapped, sha256 } from '../inbox/details-read'
import type { LinearWriter } from '../linear-connector/linear-writer'
import { messageOf, notCreated } from './linear-create-outcome'
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
type TicketImage = { ref: string; bytes: Buffer; contentType: string; filename: string }
type Ticket = { team: string; body?: string; images?: ImageArg[]; workspace_id?: string }

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

// The images the body shows; one whose line was deleted never leaves the Mac.
export function bodyImages(body: string, images: ImageArg[]): ImageArg[] {
  const shown = new Set(body.match(IMAGE_REF))
  return images.filter((image) => shown.has(image.ref))
}

function imageType(path: string): string | null {
  const ext = extname(path).toLowerCase()
  return Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : null
}

// Every screenshot checked before any upload: an image inside the Automations folder, unchanged since the draft.
function readTicketImages(
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

// The body's screenshots read, checked and uploaded in order into the team's workspace, resolved once and returned.
export async function uploadTicketImages(
  linear: Pick<LinearWriter, 'teamWorkspace' | 'uploadImage'>,
  root: string | null,
  ticket: Ticket
): Promise<{ urls: Map<string, string>; workspaceId?: string } | { refused: ActionResult }> {
  const read = readTicketImages(root, bodyImages(ticket.body ?? '', ticket.images ?? []))
  if ('refused' in read) {
    return read
  }
  const urls = new Map<string, string>()
  if (read.images.length === 0) {
    return { urls }
  }
  let workspaceId: string
  try {
    workspaceId = await linear.teamWorkspace(ticket.team, ticket.workspace_id)
  } catch (error) {
    return {
      refused: notCreated(
        'failed',
        `couldn't upload screenshots to ${ticket.team}: ${messageOf(error)}`
      )
    }
  }
  for (const image of read.images) {
    try {
      const uploaded = await linear.uploadImage({
        bytes: image.bytes,
        contentType: image.contentType,
        filename: image.filename,
        workspaceId
      })
      urls.set(image.ref, uploaded.assetUrl)
    } catch (error) {
      return { refused: notCreated('failed', `couldn't upload ${image.ref}: ${messageOf(error)}`) }
    }
  }
  return { urls, workspaceId }
}

// The body with each screenshot ref replaced by the asset URL its image uploaded to.
export function withAssetUrls(body: string, urls: ReadonlyMap<string, string>): string {
  return body.replace(IMAGE_REF, (ref) => urls.get(ref) ?? ref)
}
