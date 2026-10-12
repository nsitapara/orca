import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { InboxItemRow, RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { WAITING } from '../inbox/inbox-service'
import { branchOfRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import {
  hasBrokenMarkers,
  hasMarkers,
  insertRunsLine,
  itemsBlock,
  replaceBlock,
  runSummary,
  runsHeader,
  stamp,
  touchFrontmatter
} from './export-format'
import { jobFolderFor } from './job-folder'

const DAY = 24 * 60 * 60_000
const LOOKBACK = 7 * DAY
const NOT_EXPORTED = new Set(['running', 'asking', 'cancelled'])
const CLOSED = ['done', 'obsolete', 'stale', 'dismissed'] as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type VaultExportDeps = {
  store: PilotStore
  now(): number
  dir: string
  definitions(): AutomationDefinition[]
  log(message: string): void
}

function readNote(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

// Write a temp file and rename it, so Obsidian and vault.py never read half a note.
function writeNote(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.pilot-tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

export class VaultExporter {
  // note path → signature of the cards last written there, so an unchanged note isn't rewritten
  private readonly written = new Map<string, string>()
  private readonly warned = new Set<string>()
  private scanned = false

  constructor(private readonly deps: VaultExportDeps) {}

  private definition(id: string): AutomationDefinition | null {
    return this.deps.definitions().find((d) => d.id === id) ?? null
  }

  // Null (and a warning, once per name) for a job name that would reach outside the automations folder.
  private folderOf(def: AutomationDefinition): string | null {
    const folder = jobFolderFor(this.deps.dir, def.name)
    if (folder === null && !this.warned.has(def.name)) {
      this.warned.add(def.name)
      this.deps.log(
        `[pilot] vault export: "${def.name}" names a folder outside ${this.deps.dir}; not exporting it`
      )
    }
    return folder
  }

  // [[Agent Work/Automations/<job>/<job>|<job>]] when the folder sits in a vault's Agent Work/Automations,
  // else just the job's name: a vault-relative path can't be known for any other layout.
  private jobLink(folder: string): string {
    const name = basename(folder)
    const dir = this.deps.dir
    if (basename(dir) === 'Automations' && basename(dirname(dir)) === 'Agent Work') {
      return `[[${relative(dirname(dirname(dir)), join(folder, name))}|${name}]]`
    }
    return `[[${name}]]`
  }

  private exportRun(run: RunRow, def: AutomationDefinition, at: number): boolean {
    const folder = this.folderOf(def)
    if (folder === null) {
      return false
    }
    const path = join(folder, 'Runs.md')
    const header = runsHeader(this.jobLink(folder))
    const line = `- ${stamp(run.finishedAt ?? at)} · ${runSummary(run, this.deps.store.runs.steps(run.id))}\n`
    const content = insertRunsLine(readNote(path) ?? header, header, line)
    writeNote(path, touchFrontmatter(content, at, basename(folder)))
    this.deps.store.events.add({
      at,
      automationId: run.automationId,
      runId: run.id,
      worktreePath: run.worktreePath,
      itemKey: run.itemKey,
      kind: 'vault_export',
      payload: { path }
    })
    return true
  }

  private exportRuns(at: number): number {
    const since = at - LOOKBACK
    const done = new Set(
      this.deps.store.events.list({ kinds: ['vault_export'], since }).map((e) => e.runId)
    )
    let lines = 0
    for (const run of this.deps.store.runs.finishedSince(since)) {
      const def = this.definition(run.automationId)
      if (done.has(run.id) || NOT_EXPORTED.has(run.status) || run.imported || !def) {
        continue
      }
      try {
        if (this.exportRun(run, def, at)) {
          lines += 1
        }
      } catch (error) {
        this.deps.log(`[pilot] vault export of run ${run.id} failed: ${messageOf(error)}`)
      }
    }
    return lines
  }

  private branchOf(item: InboxItemRow): string | null {
    const fromRun = item.runId ? branchOfRun(this.deps.store, item.runId) : null
    return fromRun ?? (item.worktreePath ? basename(item.worktreePath) : null)
  }

  private notePathOf(item: InboxItemRow, def: AutomationDefinition): string | null {
    const folder = this.folderOf(def)
    if (folder === null) {
      return null
    }
    const branch = this.branchOf(item)?.replace(/[/\\:]/g, '-')
    const name = branch && branch !== '.' && branch !== '..' ? `${branch}.md` : 'Items.md'
    return join(folder, name)
  }

  private cardsByNote(
    at: number
  ): Map<string, { def: AutomationDefinition; items: InboxItemRow[] }> {
    const { inbox } = this.deps.store
    const items = [
      ...inbox.list({ status: WAITING }),
      ...inbox.list({ status: CLOSED, updatedSince: at - DAY })
    ].filter((i) => i.source !== 'import')
    const notes = new Map<string, { def: AutomationDefinition; items: InboxItemRow[] }>()
    for (const item of items) {
      const def = this.definition(item.automationId)
      if (!def) {
        continue
      }
      const path = this.notePathOf(item, def)
      if (path === null) {
        continue
      }
      const entry = notes.get(path) ?? { def, items: [] }
      entry.items.push(item)
      notes.set(path, entry)
    }
    return notes
  }

  private writeBlock(
    path: string,
    def: AutomationDefinition,
    items: InboxItemRow[],
    at: number
  ): void {
    const block = items.length
      ? itemsBlock(def.id, items, (i) => this.branchOf(i) ?? 'job', at)
      : null
    const existing = readNote(path)
    if (existing === null && block === null) {
      return
    }
    if (existing !== null && hasBrokenMarkers(existing, def.id)) {
      this.deps.log(
        `[pilot] vault export: ${path} has unpaired pilot:inbox markers; left untouched`
      )
      return
    }
    const base = existing ?? `# ${basename(path, '.md')}\n`
    writeNote(
      path,
      touchFrontmatter(replaceBlock(base, def.id, block), at, basename(dirname(path)))
    )
  }

  private tryBlock(
    path: string,
    def: AutomationDefinition,
    items: InboxItemRow[],
    at: number
  ): boolean {
    try {
      this.writeBlock(path, def, items, at)
      return true
    } catch (error) {
      this.deps.log(`[pilot] vault export of ${path} failed: ${messageOf(error)}`)
      return false
    }
  }

  // After a restart `written` is empty: notes that kept a block of cards which have all closed since are found
  // by their markers, and (being absent from `live`) get it removed.
  private staleBlocks(live: Map<string, unknown>, at: number): number {
    let removed = 0
    for (const def of this.deps.definitions()) {
      const folder = this.folderOf(def)
      if (folder === null || !existsSync(folder)) {
        continue
      }
      for (const file of readdirSync(folder).filter((f) => f.endsWith('.md'))) {
        const path = join(folder, file)
        try {
          if (
            !live.has(path) &&
            hasMarkers(readNote(path) ?? '', def.id) &&
            this.tryBlock(path, def, [], at)
          ) {
            removed += 1
          }
        } catch (error) {
          this.deps.log(`[pilot] vault export of ${path} failed: ${messageOf(error)}`)
        }
      }
    }
    return removed
  }

  private ownerOf(path: string): AutomationDefinition | null {
    return (
      this.deps.definitions().find((d) => {
        const folder = this.folderOf(d)
        return folder !== null && path.startsWith(folder + sep)
      }) ?? null
    )
  }

  private exportNotes(at: number): number {
    const notes = this.cardsByNote(at)
    let written = 0
    for (const [path, { def, items }] of notes) {
      const signature = items.map((i) => `${i.id}@${i.updatedAt}:${i.status}`).join(',')
      if (this.written.get(path) === signature) {
        continue
      }
      if (this.tryBlock(path, def, items, at)) {
        this.written.set(path, signature)
        written += 1
      }
    }
    for (const [path, signature] of this.written) {
      if (notes.has(path) || signature === '') {
        continue
      }
      const owner = this.ownerOf(path)
      if (owner && this.tryBlock(path, owner, [], at)) {
        written += 1
      }
      this.written.set(path, '')
    }
    if (!this.scanned) {
      this.scanned = true
      written += this.staleBlocks(notes, at)
    }
    return written
  }

  pass(): { lines: number; notes: number } {
    const at = this.deps.now()
    return {
      lines: this.part('runs', () => this.exportRuns(at)),
      notes: this.part('notes', () => this.exportNotes(at))
    }
  }

  private part(what: string, work: () => number): number {
    try {
      return work()
    } catch (error) {
      this.deps.log(`[pilot] vault export of ${what} failed: ${messageOf(error)}`)
      return 0
    }
  }
}
