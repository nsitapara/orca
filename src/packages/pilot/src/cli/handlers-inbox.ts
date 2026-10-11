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
import { invalid, jsonObjectFlag, readTextFile } from './cli-values'
import { formatInboxList } from './format-inbox'
import {
  checkInboxOption,
  INBOX_TYPES,
  inboxTarget,
  isInboxType,
  MAX_DETAILS_BYTES,
  parseParts,
  parseSwitchWords
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
  const detailsFile = getOptionalStringFlag(flags, 'details-file')
  const target = orInvalid(() =>
    inboxTarget(process.env, {
      automation: getOptionalStringFlag(flags, 'automation'),
      item: getOptionalStringFlag(flags, 'item')
    })
  )
  const options = orInvalid(() => getRepeatedStringFlag(flags, 'option').map(checkInboxOption))
  const parts = orInvalid(() => parseParts(getRepeatedStringFlag(flags, 'part')))
  const switchWords = orInvalid(() => parseSwitchWords(getRepeatedStringFlag(flags, 'switch')))
  return {
    ...target,
    type,
    title: getRequiredStringFlag(flags, 'title'),
    ...given('context', getOptionalStringFlag(flags, 'context')),
    ...given('suggested', getOptionalStringFlag(flags, 'suggested')),
    ...given('options', nonEmpty(options)),
    ...given(
      'detailsMd',
      detailsFile === undefined
        ? undefined
        : readTextFile(detailsFile, 'details-file', MAX_DETAILS_BYTES)
    ),
    ...given('action', action),
    ...given('actionArgs', jsonObjectFlag(argsJson, 'args-json')),
    ...given('parts', Object.keys(parts).length > 0 ? parts : undefined),
    ...given('switchWords', nonEmpty(switchWords)),
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
    return { id, text, via: 'cli' }
  }
  return { id, option: option - 1, via: 'cli' }
}

export const INBOX_HANDLERS: Record<string, CommandHandler> = {
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
  'inbox answer': async ({ flags, client, json }) => {
    const response = await client.call<InboxItemRow>('pilot.inbox.answer', answerParams(flags))
    printResult(response, json, (r) => `Saved your answer to ${r.id} (${r.status})`)
  }
}
