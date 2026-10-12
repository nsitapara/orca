import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { DetailsSnapshot } from '../../shared/details'
import { CARD_CHANGED_ON_SAVE } from '../answers/save'
import { readDetailsImage } from '../inbox/details-bundle'
import { setInboxDetails } from '../inbox/inbox-details'
import { getInboxItem } from '../inbox/inbox-service'
import type { PilotContext } from '../pilot-services'
import { runBinding } from './methods-actions'
import { inboxDeps } from './methods-inbox'

export const DETAILS_NO_CALLER = "Pilot can't tell who is calling; nothing was read"
export const NO_DETAILS = 'This card has no Details bundle'
export const DETAILS_RUN_ONLY =
  "Attach Details from a Pilot run's step, for a card of that run's automation"
export const DETAILS_OWN_AUTOMATION = 'This run belongs to another automation than the card'
export const DETAILS_NO_CALLER_CHANGE = "Pilot can't tell who is calling; nothing was changed"

const Digest = z.string().regex(/^[0-9a-f]{64}$/)
const Details = z.object({ id: z.string().min(1), digest: Digest.optional() })
const Image = z.object({ id: z.string().min(1), digest: Digest, file: z.string().min(1).max(1024) })
const SetDetails = z.object({
  id: z.string().min(1),
  bundlePath: z.string().min(1).max(4096),
  head: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
  // Where the call comes from: the CLI's terminal handle, and the env's step as the fallback (ruling 8d).
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
})

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

// Who may replace a card's bundle (ruling 4), from the transport's stamp only: the desktop, or the local
// CLI bound to a run (the step on its terminal, else the env's active step) of the card's own automation.
// A binding that can't be resolved fails closed; a paired device, an unnamed or unknown caller is refused.
function refuseOutsideScope(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  p: z.infer<typeof SetDetails>,
  automationId: string
): void {
  if (caller?.kind === 'desktop') {
    return
  }
  if (caller?.kind !== 'local-cli') {
    throw new Error(DETAILS_RUN_ONLY)
  }
  let bound: { runId: string; stepIdx: number } | null
  try {
    bound = runBinding(c, p)
  } catch (error) {
    throw new Error(
      `${DETAILS_RUN_ONLY} (${error instanceof Error ? error.message : String(error)})`
    )
  }
  if (!bound) {
    throw new Error(DETAILS_RUN_ONLY)
  }
  if (c.store.runs.get(bound.runId)?.automationId !== automationId) {
    throw new Error(DETAILS_OWN_AUTOMATION)
  }
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
    // pilot inbox set-details: a new bundle for a waiting card, which clears any answer it had.
    defineMethod({
      name: 'pilot.inbox.setDetails',
      permission: 'workspace',
      params: SetDetails,
      handler: (p, rpc) => {
        if (!rpc.caller) {
          throw new Error(DETAILS_NO_CALLER_CHANGE)
        }
        const c = ctx()
        const deps = inboxDeps(c)
        refuseOutsideScope(c, rpc.caller, p, getInboxItem(deps, p.id).automationId)
        return setInboxDetails(deps, p.id, p.bundlePath, {
          head: p.head ?? null,
          onlyUnanswered: false
        })
      }
    })
  ]
}
