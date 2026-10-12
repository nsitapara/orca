import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotContext } from '../pilot-services'
import { DEFAULT_SPEND_DAYS, MAX_SPEND_DAYS, spendPayload } from '../spend/spend'

const Spend = z.object({
  by: z.enum(['automation', 'skill', 'agent', 'mr']).optional(),
  days: z.number().int().positive().max(MAX_SPEND_DAYS).optional()
})

export function buildSpendMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.spend',
      permission: 'workspace',
      params: Spend,
      handler: (p) => {
        const c = ctx()
        const names = new Map(c.loaded().definitions.map((d) => [d.id, d.name] as const))
        return spendPayload(
          c.store,
          names,
          p.by ?? 'automation',
          p.days ?? DEFAULT_SPEND_DAYS,
          Date.now()
        )
      }
    })
  ]
}
