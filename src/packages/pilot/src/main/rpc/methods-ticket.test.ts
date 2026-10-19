import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { TicketCreateResult, TicketDraft, TicketDraftEdit } from '../../shared/ticket-types'
import type { ActionCatalog } from '../actions/types'
import { loadDefinitions } from '../definitions/loader'
import type * as TicketDraftModule from '../inbox/ticket-draft'
import { buildTicketDraft } from '../inbox/ticket-draft'
import type * as TicketForLaterModule from '../inbox/ticket-for-later'
import { fileTicketForLater } from '../inbox/ticket-for-later'
import type { PilotHost } from '../pilot-services'
import { skillSearchDirs } from '../run/modes'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

vi.mock('../inbox/ticket-draft', async (importOriginal) => ({
  ...(await importOriginal<typeof TicketDraftModule>()),
  buildTicketDraft: vi.fn()
}))
vi.mock('../inbox/ticket-for-later', async (importOriginal) => ({
  ...(await importOriginal<typeof TicketForLaterModule>()),
  fileTicketForLater: vi.fn()
}))

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, ctx: { caller?: RpcCallerIdentity }): unknown
}

const DESKTOP: RpcCallerIdentity = { kind: 'desktop' }
const PAIRED: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'ipad' }
const CLI: RpcCallerIdentity = { kind: 'local-cli' }
const DIGEST = 'd'.repeat(64)
const EDIT: TicketDraftEdit = {
  title: 'Mixed greys in the sidebar',
  body: 'Seen on load.',
  team: 'WEB',
  state: 'Backlog',
  priority: 'low',
  labels: ['qa'],
  images: ['pilot-image:1']
}
const DRAFT: TicketDraft = {
  ...EDIT,
  assignee: 'me',
  images: [],
  link: null,
  ticketedBefore: null,
  templatePath: '/skills/follow-up-ticket/assets/ticket.md',
  digest: DIGEST
}
const FILED: TicketCreateResult = { ok: true, identifier: 'WEB-1', url: 'https://linear.app/x/1' }

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-ticket-rpc-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish }\n')
  const loaded = loadDefinitions([dir])
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  const actions: ActionCatalog = { entries: () => [], get: () => null }
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these methods never read the scheduler.
      scheduler: null as never,
      actions,
      dispatcher: null,
      schedulerOn: true,
      detailsRoot: '/vault/Automations'
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: defineMethod's objects have name, params and handler.
  const methods = buildPilotMethods(host) as unknown as Callable[]
  const method = (name: string) => methods.find((m) => m.name === name)!
  return {
    store,
    loaded,
    actions,
    method,
    callAs: async (caller: RpcCallerIdentity, name: string, p: unknown) =>
      method(name).handler(p, { caller })
  }
}

describe('pilot.inbox.ticketDraft and pilot.inbox.ticketForLater', () => {
  beforeEach(() => {
    vi.mocked(buildTicketDraft).mockReset().mockReturnValue(DRAFT)
    vi.mocked(fileTicketForLater).mockReset().mockResolvedValue(FILED)
  })

  it.each<[string, unknown, boolean]>([
    ['a full draft', { id: 'in_1', digest: DIGEST, draft: EDIT }, true],
    ['an empty title', { id: 'in_1', digest: DIGEST, draft: { ...EDIT, title: '' } }, false],
    [
      'a title over 255 characters',
      { id: 'in_1', digest: DIGEST, draft: { ...EDIT, title: 'x'.repeat(256) } },
      false
    ],
    [
      'an unknown priority',
      { id: 'in_1', digest: DIGEST, draft: { ...EDIT, priority: 'p1' } },
      false
    ],
    ['no digest', { id: 'in_1', draft: EDIT }, false]
  ])('ticketForLater checks %s', (_name, params, ok) => {
    expect(setup().method('pilot.inbox.ticketForLater').params!.safeParse(params).success).toBe(ok)
  })

  it.each<[string, RpcCallerIdentity]>([
    ['a paired device', PAIRED],
    ['the local CLI', CLI]
  ])('refuses Create from %s, filing nothing', async (_name, caller) => {
    const { callAs } = setup()
    await expect(
      callAs(caller, 'pilot.inbox.ticketForLater', { id: 'in_1', digest: DIGEST, draft: EDIT })
    ).rejects.toThrow("Create the ticket from Pilot's desktop app")
    expect(fileTicketForLater).not.toHaveBeenCalled()
  })

  it('refuses a draft from the local CLI', async () => {
    const { callAs } = setup()
    await expect(
      callAs(CLI, 'pilot.inbox.ticketDraft', { id: 'in_1', digest: DIGEST })
    ).rejects.toThrow("Draft the ticket from Pilot's window or a paired device")
    expect(buildTicketDraft).not.toHaveBeenCalled()
  })

  it.each<[string, RpcCallerIdentity]>([
    ["Pilot's desktop app", DESKTOP],
    ['a paired device', PAIRED]
  ])(
    'drafts for %s from the store, the definitions, the Automations folder and the skill folders',
    async (_name, caller) => {
      const { store, loaded, callAs } = setup()
      expect(await callAs(caller, 'pilot.inbox.ticketDraft', { id: 'in_1', digest: DIGEST })).toBe(
        DRAFT
      )
      const [deps, id, digest] = vi.mocked(buildTicketDraft).mock.calls[0]
      expect([id, digest]).toEqual(['in_1', DIGEST])
      expect(deps.store).toBe(store)
      expect(deps.definitions()).toBe(loaded.definitions)
      expect(deps.detailsRoot).toBe('/vault/Automations')
      expect(deps.skillDirs()).toEqual(skillSearchDirs(null))
    }
  )

  it("creates from Pilot's desktop app through the catalog and the inbox", async () => {
    const { store, loaded, actions, callAs } = setup()
    const req = { id: 'in_1', digest: DIGEST, draft: EDIT }
    expect(await callAs(DESKTOP, 'pilot.inbox.ticketForLater', req)).toBe(FILED)
    const [deps, sent] = vi.mocked(fileTicketForLater).mock.calls[0]
    expect(sent).toEqual(req)
    expect(deps.store).toBe(store)
    expect(deps.definitions()).toBe(loaded.definitions)
    expect(deps.detailsRoot).toBe('/vault/Automations')
    expect(deps.skillDirs()).toEqual(skillSearchDirs(null))
    expect(deps.attempt.store).toBe(store)
    expect(deps.attempt.catalog).toBe(actions)
    expect(deps.attempt.definitions()).toBe(loaded.definitions)
    expect(deps.inbox.store).toBe(store)
    expect(deps.inbox.detailsRoot).toBe('/vault/Automations')
    expect(deps.inbox.knownAction?.('linear_create')).toBe(false)
  })
})
