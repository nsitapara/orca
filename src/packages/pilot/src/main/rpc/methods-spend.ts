import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotContext } from '../pilot-services'
import { DEFAULT_SPEND_DAYS, MAX_SPEND_DAYS, spendPayload } from '../spend/spend'

const Spend = z.object({
  by: z.enum(['automation', 'skill', 'agent', 'mr']).optional(),
  days: z.number().int().positive().max(MAX_SPEND_DAYS).optional()
})

const WriteReport = z.object({
  dir: z
    .string()
    .min(1)
    .max(4096)
    .refine((d) => isAbsolute(d), 'dir must be an absolute path')
    .optional()
})

export const REPORT_NO_CALLER = "Pilot can't tell who is calling; nothing was written"

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
    }),
    // Any identified caller may trigger it (the transport's stamp, never a param; none is refused): it only
    // rewrites Pilot's own report files (fixed names, atomic, idempotent), and into job 08's folder only
    // after the hand-over.
    defineMethod({
      name: 'pilot.usage.writeReport',
      permission: 'workspace',
      params: WriteReport,
      handler: (p, rpc) => {
        const c = ctx()
        if (!rpc?.caller) {
          throw new Error(REPORT_NO_CALLER)
        }
        if (!c.writeUsageReport) {
          throw new Error("The usage report isn't available in this process")
        }
        return c.writeUsageReport(p.dir)
      }
    })
  ]
}
