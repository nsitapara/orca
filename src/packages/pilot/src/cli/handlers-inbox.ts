import {
  PREPARATION_REFUSED,
  PreparationInputSchema,
  type PreparationInput
} from '../shared/preparation'
import { PREPARATION_HANDLERS } from './preparation'
import { resolve } from 'node:path'
import type { CommandHandler } from '../../../../cli/dispatch'
import {
  getOptionalJsonFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import type {
  InboxAddParams,
  InboxAddResult,
  InboxAnswerParams,
  InboxItemRow,
  InboxListParams,
  InboxListPayload
} from '../shared/api-types'
import { DETAILS_EITHER } from '../shared/details'
import { invalid, jsonObjectFlag, readTextFile } from './cli-values'
import { formatInboxList, formatInboxShow } from './format-inbox'
import {
  checkInboxOption,
  INBOX_TYPES,
  inboxTarget,
  isDetailsBundleText,
  isInboxType,
  MAX_DETAILS_BYTES
} from './inbox-args'

type Flags = Map<string, string | boolean>

function orInvalid<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error))
  }
}

// Leaves a key out when the flag wasn't given, so the RPC sees only what the caller said.
function given<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  if (value === undefined) {
    return {}
  }
  return { [key]: value } as Partial<Record<K, V>>
}

function nonEmpty<T>(list: T[]): T[] | undefined {
  return list.length > 0 ? list : undefined
}

// --details-file is markdown, read here; a bundle given there is refused, since it would show as raw JSON.
function detailsMarkdown(path: string): string {
  const text = readTextFile(path, 'details-file', MAX_DETAILS_BYTES)
  if (isDetailsBundleText(text)) {
    throw invalid(`--details-file ${path} is a Details bundle: pass it with --details-bundle`)
  }
  return text
}

// --details-bundle is sent as an absolute path: Pilot reads and checks the bundle itself (ruling 1).
function detailsFlags(flags: Flags): Pick<InboxAddParams, 'detailsMd' | 'detailsBundlePath'> {
  const file = getOptionalStringFlag(flags, 'details-file')
  const bundle = getOptionalStringFlag(flags, 'details-bundle')
  if (file !== undefined && bundle !== undefined) {
    throw invalid(DETAILS_EITHER)
  }
  if (bundle !== undefined) {
    return { detailsBundlePath: resolve(process.cwd(), bundle) }
  }
  if (file !== undefined) {
    return { detailsMd: detailsMarkdown(file) }
  }
  return {}
}

// The request file: unreadable, too big, not JSON or not a request is a refusal of the request itself (D2's prefix).
function preparationFlag(file: string | undefined): PreparationInput | undefined {
  if (file === undefined) {
    return undefined
  }
  try {
    return PreparationInputSchema.parse(
      JSON.parse(readTextFile(file, 'preparation-file', 128 * 1024))
    )
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    throw invalid(`${PREPARATION_REFUSED}: ${said.replace(/\s+/g, ' ').slice(0, 1000)}`)
  }
}

function notPreparedFlags(flags: Flags): InboxAddParams['notPrepared'] {
  const key = getOptionalStringFlag(flags, 'not-prepared-key')
  const reason = getOptionalStringFlag(flags, 'not-prepared-reason')
  if ((key === undefined) !== (reason === undefined)) {
    throw invalid('--not-prepared-key and --not-prepared-reason go together')
  }
  return key === undefined || reason === undefined ? undefined : { key, reason }
}

function addParams(flags: Flags): InboxAddParams {
  const type = getRequiredStringFlag(flags, 'type')
  if (!isInboxType(type)) {
    throw invalid(`--type must be one of ${INBOX_TYPES.join(', ')}`)
  }
  const action = getOptionalStringFlag(flags, 'action')
  const argsJson = getOptionalJsonFlag(flags, 'args-json')
  if ((action === undefined) !== (argsJson === undefined)) {
    throw invalid('--action and --args-json go together')
  }
  const details = detailsFlags(flags)
  const preparation = preparationFlag(getOptionalStringFlag(flags, 'preparation-file'))
  const notPrepared = notPreparedFlags(flags)
  const target = orInvalid(() =>
    inboxTarget(process.env, {
      automation: getOptionalStringFlag(flags, 'automation'),
      item: getOptionalStringFlag(flags, 'item')
    })
  )
  const options = orInvalid(() => getRepeatedStringFlag(flags, 'option').map(checkInboxOption))
  return {
    ...target,
    ...given('preparation', preparation),
    ...given('notPrepared', notPrepared),
    type,
    title: getRequiredStringFlag(flags, 'title'),
    ...given('context', getOptionalStringFlag(flags, 'context')),
    ...given('suggested', getOptionalStringFlag(flags, 'suggested')),
    ...given('options', nonEmpty(options)),
    ...details,
    ...given('action', action),
    ...given('actionArgs', jsonObjectFlag(argsJson, 'args-json')),
    ...given('worktreePath', getOptionalStringFlag(flags, 'worktree'))
  }
}

// --option <n> is 1-based, as `inbox list` numbers the options; the RPC's option is 0-based.
function answerParams(flags: Flags): InboxAnswerParams {
  const id = getRequiredStringFlag(flags, 'id')
  const option = getOptionalPositiveIntegerFlag(flags, 'option')
  const text = getOptionalStringFlag(flags, 'text')
  if ((option === undefined) === (text === undefined)) {
    throw invalid('Give exactly one of --option <n> and --text <answer>')
  }
  if (option === undefined) {
    return { id, text }
  }
  return { id, option: option - 1 }
}

export const INBOX_HANDLERS: Record<string, CommandHandler> = {
  ...PREPARATION_HANDLERS,
  'inbox add': async ({ flags, client, json }) => {
    const response = await client.call<InboxAddResult>('pilot.inbox.add', addParams(flags))
    const { id, refused } = response.result
    if (id === null) {
      throw invalid(`Not added: ${refused ?? 'Pilot refused the card'}`)
    }
    printResult({ ...response, result: { id } }, json, (r) => r.id)
  },
  'inbox list': async ({ flags, client, json }) => {
    const person = getOptionalStringFlag(flags, 'person')
    const params: InboxListParams = person ? { person } : {}
    printResult(
      await client.call<InboxListPayload>('pilot.inbox.list', params),
      json,
      formatInboxList
    )
  },
  'inbox show': async ({ flags, client, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    printResult(await client.call<InboxItemRow>('pilot.inbox.get', { id }), json, formatInboxShow)
  },
  'inbox answer': async ({ flags, client, json }) => {
    const response = await client.call<InboxItemRow>('pilot.inbox.answer', answerParams(flags))
    printResult(response, json, (r) => `Saved your answer to ${r.id} (${r.status})`)
  }
}
