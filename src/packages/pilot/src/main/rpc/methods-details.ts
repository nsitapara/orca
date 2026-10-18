import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { DetailsSnapshot } from '../../shared/details'
import { CARD_CHANGED_ON_SAVE } from '../answers/save'
import { readDetailsImage, reportPath } from '../inbox/details-bundle'
import type { PilotContext } from '../pilot-services'

export const DETAILS_NO_CALLER = "Pilot can't tell who is calling; nothing was read"
export const NO_DETAILS = 'This card has no Details bundle'
export { DETAILS_NO_CALLER_CHANGE, DETAILS_OWN_AUTOMATION, DETAILS_RUN_ONLY } from './details-scope'

const Digest = z.string().regex(/^[0-9a-f]{64}$/)
const Details = z.object({ id: z.string().min(1), digest: Digest.optional() })
const Image = z.object({ id: z.string().min(1), digest: Digest, file: z.string().min(1).max(1024) })
const Report = Image

function requireCaller(caller: RpcCallerIdentity | undefined): void {
  if (!caller) {
    throw new Error(DETAILS_NO_CALLER)
  }
}

// What is read is always the version being answered: a digest that isn't the card's current one is
// refused, the way a save against it would be.
function currentSnapshot(
  c: PilotContext,
  id: string,
  digest: string | undefined
): { digest: string; snapshot: DetailsSnapshot } {
  const current = c.store.inbox.currentDetails(id)
  if (!current) {
    throw new Error(`No inbox item ${id}`)
  }
  if (digest !== undefined && digest !== current.digest) {
    throw new Error(CARD_CHANGED_ON_SAVE)
  }
  if (!current.snapshot) {
    throw new Error(NO_DETAILS)
  }
  return { digest: current.digest, snapshot: current.snapshot }
}

// A card's Details (ruling 2): the list carries only the light ref; the snapshot, and each image its
// bundle names, are read here for the digest shown.
export function buildDetailsMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.details',
      permission: 'workspace',
      params: Details,
      handler: (p, rpc) => {
        requireCaller(rpc.caller)
        const { digest, snapshot } = currentSnapshot(ctx(), p.id, p.digest)
        return { id: p.id, digest, snapshot }
      }
    }),
    // The image is read now, its path checked again (inside the Automations folder, an image type, under
    // the size cap): only a file the card's bundle names.
    defineMethod({
      name: 'pilot.inbox.image',
      permission: 'workspace',
      params: Image,
      handler: (p, rpc) => {
        requireCaller(rpc.caller)
        const c = ctx()
        const { snapshot } = currentSnapshot(c, p.id, p.digest)
        return readDetailsImage(c.detailsRoot ?? null, snapshot, p.file)
      }
    }),
    // A report's real path, for Open to hand the OS: checked again now (a report of this card's Details, inside the
    // Automations folder, an .html file), never a path the caller chose.
    defineMethod({
      name: 'pilot.inbox.report',
      permission: 'workspace',
      params: Report,
      handler: (p, rpc) => {
        requireCaller(rpc.caller)
        const c = ctx()
        const { snapshot } = currentSnapshot(c, p.id, p.digest)
        return { path: reportPath(c.detailsRoot ?? null, snapshot, p.file) }
      }
    })
  ]
}
