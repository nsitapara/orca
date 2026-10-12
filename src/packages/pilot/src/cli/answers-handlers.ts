import type { CommandHandler } from '../../../../cli/dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type { InboxItemRow } from '../shared/api-types'
import { invalid } from './cli-values'

// The CLI never imports main code: its own copy of attempt.ts's EXIT_CODES.
const ACTION_EXIT: Record<string, number> = {
  done: 0,
  failed: 1,
  stale: 3,
  needs_agent: 4,
  not_yet: 5,
  asked: 6
}
// Generous: act.py's run allows 10 min (RUN_TIMEOUT_MS) and the call needs a little more.
const ACTION_TIMEOUT_MS = 660_000

type ActionReply = { outcome: string; detail: string; link?: string | null }
type ActionCaller = { terminal?: string; runId?: string; stepIdx?: number }

function argsJson(raw: string | undefined): Record<string, unknown> {
  let value: unknown = {}
  try {
    value = raw === undefined ? {} : JSON.parse(raw)
  } catch {
    value = null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('--args-json must be a JSON object')
  }
  return value as Record<string, unknown>
}

// Who is calling, for the server to resolve (ruling 8d, Task 22b): the terminal this runs in, and the env's
// run and step as the fallback. Only what is set is sent; with none of it, the caller is a person.
export function actionCaller(env: NodeJS.ProcessEnv): ActionCaller {
  const terminal = env.ORCA_TERMINAL_HANDLE?.trim() ?? ''
  const runId = env.PILOT_RUN_ID?.trim() ?? ''
  const rawIdx = env.PILOT_STEP_IDX?.trim() ?? ''
  return {
    ...(terminal ? { terminal } : {}),
    ...(runId ? { runId } : {}),
    ...(runId && /^\d+$/.test(rawIdx) ? { stepIdx: Number(rawIdx) } : {})
  }
}

export function inboxItemLine(
  i: Pick<InboxItemRow, 'id' | 'status' | 'outcome' | 'title'>
): string {
  return [i.id, i.status, i.outcome, i.title].filter(Boolean).join(' · ')
}

export const ANSWERS_HANDLERS: Record<string, CommandHandler> = {
  'inbox tick': async ({ flags, client, json }) => {
    const params = {
      id: getRequiredStringFlag(flags, 'id'),
      outcome: getRequiredStringFlag(flags, 'outcome')
    }
    printResult(await client.call<InboxItemRow>('pilot.inbox.tick', params), json, inboxItemLine)
  },
  'inbox reply': async ({ flags, client, json }) => {
    const params = {
      id: getRequiredStringFlag(flags, 'id'),
      text: getRequiredStringFlag(flags, 'text')
    }
    printResult(await client.call<InboxItemRow>('pilot.inbox.reply', params), json, inboxItemLine)
  },
  'action run': async ({ flags, client, json }) => {
    const params = {
      action: getRequiredStringFlag(flags, 'name'),
      args: argsJson(getOptionalStringFlag(flags, 'args-json')),
      dryRun: flags.get('dry-run') === true,
      ...actionCaller(process.env)
    }
    const response = await client.call<ActionReply>('pilot.action.run', params, {
      timeoutMs: ACTION_TIMEOUT_MS
    })
    printResult(response, json, (r) => [r.outcome, r.detail, r.link].filter(Boolean).join(' · '))
    process.exitCode = ACTION_EXIT[response.result.outcome] ?? 1
  },
  'action list': async ({ client, json }) => {
    type Row = { name: string; power: string | null; usage: string }
    printResult(await client.call<Row[]>('pilot.action.list'), json, (rows) =>
      rows
        .map((r) => `${r.name.padEnd(17)} ${(r.power ?? 'approval').padEnd(14)} ${r.usage}`)
        .join('\n')
    )
  }
}
