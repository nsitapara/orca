import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { queueEntries } from '../answers/queue-view'
import { saveAnswer } from '../answers/save'
import { resolveRepoPath } from '../fields/runtime-facts'
import { runtimeFieldDeps } from '../fields/runtime-field-deps'
import { applyVaultImport } from '../inbox/import-apply'
import { isBackfillable, isDatable, planVaultImport } from '../inbox/import-vault'
import { readOpenVaultItems } from '../inbox/vault-reader'
import type { PilotContext } from '../pilot-services'
import { inboxDeps } from './methods-inbox'

const Answer = z.object({
  id: z.string().min(1),
  option: z.number().int().nonnegative().optional(),
  text: z.string().max(4000).optional(),
  digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  by: z.string().min(1).max(64).optional()
})
const QueueList = z.object({ person: z.string().min(1).optional() })
const ApplyNow = z.object({ ids: z.array(z.string().min(1)).max(200).optional() })

const ImportVault = z.object({ apply: z.boolean() })

export const IMPORT_NO_CALLER = "Pilot can't tell who is calling; nothing was imported"
export const IMPORT_APPLY_DESKTOP = 'Apply the vault import in Pilot (Inbox)'

// Worktree ids by path for the worktree-kind automations' item keys; an unreadable repo just leaves them out.
async function worktreeIds(
  runtime: OrcaRuntimeService,
  c: PilotContext
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  const repos = new Set(
    c
      .loaded()
      .definitions.filter((d) => d.items?.kind === 'worktree')
      .map((d) => d.repo)
  )
  for (const repo of repos) {
    try {
      const path = (await resolveRepoPath(runtime, repo)).path
      for (const wt of await runtimeFieldDeps(runtime, c.store).listWorktrees(path)) {
        ids.set(wt.path, wt.id)
      }
    } catch {
      continue
    }
  }
  return ids
}

export const APPLY_NOW_ELSEWHERE =
  "Answers are applied by the Pilot app that runs the scheduler; this process doesn't run it"
export const APPLY_NOW_NO_CALLER = "Pilot can't tell who is calling; nothing was applied"

export function buildAnswerMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.answer',
      permission: 'workspace',
      params: Answer,
      // The caller kind is the transport's stamp (never a param): it is recorded on the answer, and save.ts
      // lets the local CLI nowhere near a card, a paired device answer but never approve, the desktop all.
      handler: (p, rpc) => {
        const c = ctx()
        return saveAnswer(inboxDeps(c), p, {
          callerKind: rpc.caller?.kind ?? null,
          catalog: c.actions
        })
      }
    }),
    defineMethod({
      name: 'pilot.answers.applyNow',
      permission: 'workspace',
      params: ApplyNow,
      // apply.py now: skip the settle for these answers (all, without ids), then run a pass. Who may hurry
      // an approval past its settle is the transport's stamp, never a param: only the desktop app; any
      // other caller (a paired device, the local CLI, so any agent) settles only answers that run no action.
      handler: async (p, rpc) => {
        const c = ctx()
        if (!c.dispatcher) {
          throw new Error(APPLY_NOW_ELSEWHERE)
        }
        const kind = rpc.caller?.kind
        if (!kind) {
          throw new Error(APPLY_NOW_NO_CALLER)
        }
        const ids = p.ids ? { ids: p.ids } : {}
        return c.dispatcher.applyNow({ ...ids, approver: kind === 'desktop' })
      }
    }),
    defineMethod({
      name: 'pilot.inbox.importVault',
      permission: 'workspace',
      params: ImportVault,
      // A one-shot, idempotent import of the vault's open cards and answers. A preview (apply: false) is
      // open to any identified caller and writes nothing; applying is the desktop's alone (the transport's
      // stamp, never a param), so an agent can't seed cards or answers. The cards go through the normal
      // add path (catalog, argument and size checks, routing).
      handler: async (p, rpc) => {
        const c = ctx()
        if (!rpc.caller) {
          throw new Error(IMPORT_NO_CALLER)
        }
        if (p.apply && rpc.caller.kind !== 'desktop') {
          throw new Error(IMPORT_APPLY_DESKTOP)
        }
        const now = Date.now()
        const plan = planVaultImport(await readOpenVaultItems({ engineEnv: c.engineEnv }), {
          definitions: c.loaded().definitions,
          people: c.loaded().people,
          worktreeIds: await worktreeIds(rpc.runtime, c),
          existing: (id) => c.store.inbox.get(id) !== null,
          backfillable: (id) => isBackfillable(c.store.inbox.get(id)),
          datable: (id, at) => isDatable(c.store.inbox.get(id), at),
          now
        })
        return applyVaultImport(inboxDeps(c), plan, now, { dryRun: !p.apply })
      }
    }),
    defineMethod({
      name: 'pilot.queue.list',
      permission: 'workspace',
      params: QueueList,
      handler: (p) => {
        const c = ctx()
        return { entries: queueEntries(inboxDeps(c), c.actions, p) }
      }
    })
  ]
}
