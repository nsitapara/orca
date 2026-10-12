import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../../../../cli/args'
import type { HandlerContext } from '../../../../cli/dispatch'
import type { InboxItemRow, InboxListPayload } from '../shared/api-types'
import type { DetailsRef } from '../shared/details'
import { INBOX_HANDLERS } from './handlers-inbox'
import { PILOT_COMMAND_SPECS } from './specs'

function contextFor(argv: string[], result: unknown) {
  const parsed = normalizeCommandPositionals(
    PILOT_COMMAND_SPECS,
    parseArgs(argv, undefined, PILOT_COMMAND_SPECS)
  )
  const call = vi.fn().mockResolvedValue({ result })
  const context = {
    flags: parsed.flags,
    client: { call },
    cwd: '/',
    json: false
  } as unknown as HandlerContext
  return { context, call }
}
function insideStep(): void {
  vi.stubEnv('PILOT_RUN_ID', 'run-1')
  vi.stubEnv('PILOT_STEP_IDX', '2')
  vi.stubEnv('PILOT_AUTOMATION_ID', 'fix-failed-ci')
  vi.stubEnv('PILOT_ITEM_KEY', 'mr:1561')
}
function outsideRuns(): void {
  for (const name of ['PILOT_RUN_ID', 'PILOT_STEP_IDX', 'PILOT_AUTOMATION_ID', 'PILOT_ITEM_KEY']) {
    vi.stubEnv(name, '')
  }
}
// Why __dirname: it works under Vitest and the CommonJS emit the CLI is type-checked against.
const DETAILS_FIXTURES = join(__dirname, '../../test/fixtures/details')
const ADDED = { id: 'q1', existing: false, refused: null }
const SHOWN = {
  id: 'in_x',
  type: 'bug',
  status: 'answered',
  version: 2,
  title: 'Leaving asks to discard edits',
  detailsMd: null,
  details: null
}
const CARD = ['inbox', 'add', '--type', 'question', '--title', 'Push the fix?']

beforeEach(() => vi.stubEnv('ORCA_TERMINAL_HANDLE', ''))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('pilot inbox add', () => {
  it("sends the card for the env's run step, with every option raw, and prints the new id", async () => {
    insideStep()
    const { context, call } = contextFor(
      [
        ...CARD,
        '--context',
        'Two commits',
        '--suggested',
        'Push',
        '--option',
        'Push — publish both commits',
        '--option',
        'Hold'
      ],
      ADDED
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith('pilot.inbox.add', {
      runId: 'run-1',
      stepIdx: 2,
      automationId: 'fix-failed-ci',
      itemKey: 'mr:1561',
      type: 'question',
      title: 'Push the fix?',
      context: 'Two commits',
      suggested: 'Push',
      options: ['Push — publish both commits', 'Hold']
    })
    expect(log).toHaveBeenCalledWith('q1')
  })

  it("sends the terminal's handle beside the env's step, which is only the fallback", async () => {
    insideStep()
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor(CARD, ADDED)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({ terminal: 'term-A', runId: 'run-1', stepIdx: 2 })
    )
  })

  it('sends --part, --switch (on then off) and --worktree', async () => {
    insideStep()
    const { context, call } = contextFor(
      [
        ...CARD,
        '--part',
        'a=First fix',
        '--part',
        'b=Second fix',
        '--switch',
        'Post',
        '--switch',
        'Leave out',
        '--worktree',
        '/wt/1493'
      ],
      ADDED
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({
        parts: { a: 'First fix', b: 'Second fix' },
        switchWords: ['Post', 'Leave out'],
        worktreePath: '/wt/1493'
      })
    )
  })

  it('sends --action with its --args-json object', async () => {
    insideStep()
    const { context, call } = contextFor(
      [...CARD, '--action', 'push', '--args-json', '{"argv":["/wt/1493","b","aaa","bbb"]}'],
      ADDED
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({
        action: 'push',
        actionArgs: { argv: ['/wt/1493', 'b', 'aaa', 'bbb'] }
      })
    )
  })

  it('inside a terminal needs no PILOT_RUN_ID: the server resolves the step from the terminal', async () => {
    outsideRuns()
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor(CARD, ADDED)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({ terminal: 'term-A' })
    )
  })

  it('needs --automation and --item outside a run, and sends them', async () => {
    outsideRuns()
    const bare = contextFor(CARD, ADDED)
    await expect(INBOX_HANDLERS['inbox add'](bare.context)).rejects.toThrow(
      'Outside a Pilot run, give --automation <id> and --item <key>'
    )
    const given = contextFor(
      [...CARD, '--automation', 'review-requests', '--item', 'mr:1588'],
      ADDED
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](given.context)
    expect(given.call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({ automationId: 'review-requests', itemKey: 'mr:1588' })
    )
    expect(given.call.mock.calls[0][1]).not.toHaveProperty('runId')
  })

  it('fails with the reason when Pilot refuses the card', async () => {
    insideStep()
    const { context } = contextFor(CARD, {
      id: null,
      existing: false,
      refused: 'The merge request is merged'
    })
    await expect(INBOX_HANDLERS['inbox add'](context)).rejects.toThrow(
      'Not added: The merge request is merged'
    )
  })

  it('reads --details-file, and says why it cannot', async () => {
    insideStep()
    const file = join(mkdtempSync(join(tmpdir(), 'pilot-inbox-')), 'details.md')
    writeFileSync(file, '## Why\nTwo commits are not on origin.\n')
    const ok = contextFor([...CARD, '--details-file', file], ADDED)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](ok.context)
    expect(ok.call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({ detailsMd: '## Why\nTwo commits are not on origin.\n' })
    )
    const missing = contextFor([...CARD, '--details-file', `${file}.nope`], ADDED)
    await expect(INBOX_HANDLERS['inbox add'](missing.context)).rejects.toThrow(
      `Can't read ${file}.nope: ENOENT`
    )
  })

  it.each([
    [
      'an unknown --type',
      ['inbox', 'add', '--type', 'note', '--title', 'x'],
      '--type must be one of question, flagged, default, action, bug, left_for_you'
    ],
    [
      '--action without --args-json',
      [...CARD, '--action', 'push'],
      '--action and --args-json go together'
    ],
    [
      '--args-json that is not an object',
      [...CARD, '--action', 'push', '--args-json', '[1]'],
      '--args-json must be a JSON object'
    ],
    ['an option without a label', [...CARD, '--option', ' — meaning'], 'has no label'],
    ['a --part without a label', [...CARD, '--part', 'a'], '--part "a" isn\'t <id>=<label>'],
    ['one --switch word', [...CARD, '--switch', 'Post'], 'Give --switch twice']
  ])('refuses %s before calling Pilot', async (_n, argv, message) => {
    insideStep()
    const { context, call } = contextFor(argv, ADDED)
    await expect(INBOX_HANDLERS['inbox add'](context)).rejects.toThrow(message)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('pilot inbox add with a Details bundle', () => {
  it('sends --details-bundle as an absolute path for Pilot to read', async () => {
    insideStep()
    const { context, call } = contextFor([...CARD, '--details-bundle', 'rel/F2.json'], ADDED)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox add'](context)
    expect(call).toHaveBeenCalledWith(
      'pilot.inbox.add',
      expect.objectContaining({ detailsBundlePath: resolve(process.cwd(), 'rel/F2.json') })
    )
    expect(call.mock.calls[0][1]).not.toHaveProperty('detailsMd')
  })

  it.each([
    [
      'a bundle passed as --details-file',
      ['--details-file', join(DETAILS_FIXTURES, 'F2.json')],
      `--details-file ${join(DETAILS_FIXTURES, 'F2.json')} is a Details bundle: pass it with --details-bundle`
    ],
    [
      '--details-file and --details-bundle together',
      ['--details-file', join(DETAILS_FIXTURES, 'F2.patch'), '--details-bundle', 'F2.json'],
      'Give Details as markdown (--details-file) or as a bundle (--details-bundle), not both'
    ]
  ])('refuses %s before calling Pilot', async (_n, flags, message) => {
    insideStep()
    const { context, call } = contextFor([...CARD, ...flags], ADDED)
    await expect(INBOX_HANDLERS['inbox add'](context)).rejects.toThrow(message)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('pilot inbox show', () => {
  const REF: DetailsRef = {
    path: '/v/Automations/job/b/details/r/F2.json',
    sha256: 'a'.repeat(64),
    inlined: {},
    blocks: 8,
    drafted: true,
    draftedBase: '7cc153d0000000000000000000000000000000000'
  }
  it.each([
    [
      'a bundle',
      { details: REF },
      `Details: /v/Automations/job/b/details/r/F2.json (sha256 ${'a'.repeat(64)}, 8 blocks, drafted at 7cc153d0)`
    ],
    [
      'an undrafted bundle',
      { details: { ...REF, blocks: 1, drafted: false, draftedBase: null } },
      `Details: /v/Automations/job/b/details/r/F2.json (sha256 ${'a'.repeat(64)}, 1 block)`
    ],
    ['markdown', { detailsMd: '## Why' }, 'Details: markdown'],
    ['nothing', {}, 'Details: none']
  ])('prints the card and where its Details are: %s', async (_n, over, line) => {
    const row = { ...SHOWN, ...over }
    const { context, call } = contextFor(['inbox', 'show', '--id', 'in_x'], row)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox show'](context)
    expect(call).toHaveBeenCalledWith('pilot.inbox.get', { id: 'in_x' })
    expect(log).toHaveBeenCalledWith(
      ['in_x · bug · answered · v2', 'Leaving asks to discard edits', line].join('\n')
    )
  })
})

describe('pilot inbox set-details', () => {
  const SET = ['inbox', 'set-details', '--id', 'in_x', '--bundle', 'rel/F2.json']

  it("sends the bundle's absolute path, the head and the step the call runs in", async () => {
    insideStep()
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-A')
    const { context, call } = contextFor([...SET, '--head', '1234abcd'], {
      id: 'in_x',
      version: 3,
      changed: true,
      cleared: false
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox set-details'](context)
    expect(call).toHaveBeenCalledWith('pilot.inbox.setDetails', {
      id: 'in_x',
      bundlePath: resolve(process.cwd(), 'rel/F2.json'),
      head: '1234abcd',
      terminal: 'term-A',
      runId: 'run-1',
      stepIdx: 2
    })
  })

  it.each([
    [
      { changed: true, cleared: false },
      `Attached ${resolve(process.cwd(), 'rel/F2.json')} to in_x (version 3)`
    ],
    [
      { changed: true, cleared: true },
      `Attached ${resolve(process.cwd(), 'rel/F2.json')} to in_x (version 3); your answer was cleared`
    ],
    [
      { changed: false, cleared: false },
      `No change: in_x already shows ${resolve(process.cwd(), 'rel/F2.json')}`
    ]
  ])('says what it did (%j)', async (outcome, line) => {
    outsideRuns()
    const { context } = contextFor(SET, { id: 'in_x', version: 3, ...outcome })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox set-details'](context)
    expect(log).toHaveBeenCalledWith(line)
  })
})

describe('pilot inbox list', () => {
  it('asks for one person and prints each card with its numbered options', async () => {
    const item: InboxItemRow = {
      id: 'q1',
      automationId: 'fix-failed-ci',
      runId: 'run-1',
      stepIdx: 0,
      itemKey: 'mr:1561',
      worktreePath: '/wt',
      person: 'nish',
      type: 'question',
      title: 'Push the fix?',
      context: '',
      options: [
        { label: 'Push', meaning: 'publish both commits' },
        { label: 'Hold', meaning: '' }
      ],
      suggested: 'Push',
      detailsMd: null,
      details: null,
      action: null,
      actionArgs: null,
      digest: 'd',
      version: 1,
      status: 'open',
      answer: null,
      answeredAt: null,
      answeredBy: null,
      createdAt: 1,
      updatedAt: 1,
      outcome: null,
      replies: [],
      parts: {},
      switchWords: [],
      source: 'engine',
      vaultRef: null
    }
    const payload: InboxListPayload = {
      items: [item],
      runLines: {},
      people: [],
      groups: [],
      automations: []
    }
    const { context, call } = contextFor(['inbox', 'list', '--person', 'nish'], payload)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox list'](context)
    expect(call).toHaveBeenCalledWith('pilot.inbox.list', { person: 'nish' })
    expect(log).toHaveBeenCalledWith(
      [
        'q1  question  open  Push the fix?  (fix-failed-ci · mr:1561)',
        '    1. Push — publish both commits',
        '    2. Hold'
      ].join('\n')
    )
  })

  it('says so when nothing is waiting', async () => {
    const { context } = contextFor(['inbox', 'list'], {
      items: [],
      people: [],
      groups: [],
      automations: []
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox list'](context)
    expect(log).toHaveBeenCalledWith('Nothing is waiting on you.')
  })
})

describe('pilot inbox answer', () => {
  it.each([
    [['--option', '2'], { id: 'q1', option: 1 }],
    [['--text', 'Not yet'], { id: 'q1', text: 'Not yet' }]
  ])('%j sends %j (the CLI numbers options from 1; the server from 0)', async (flags, params) => {
    const { context, call } = contextFor(['inbox', 'answer', '--id', 'q1', ...flags], {
      id: 'q1',
      status: 'answered'
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await INBOX_HANDLERS['inbox answer'](context)
    expect(call).toHaveBeenCalledWith('pilot.inbox.answer', params)
  })

  it.each([[[]], [['--option', '1', '--text', 'both']]])(
    'needs exactly one of --option and --text (%j)',
    async (flags) => {
      const { context, call } = contextFor(['inbox', 'answer', '--id', 'q1', ...flags], {})
      await expect(INBOX_HANDLERS['inbox answer'](context)).rejects.toThrow(
        'Give exactly one of --option <n> and --text <answer>'
      )
      expect(call).not.toHaveBeenCalled()
    }
  )
})
