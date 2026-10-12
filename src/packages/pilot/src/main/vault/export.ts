import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { InboxItemRow, RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { WAITING } from '../inbox/inbox-service'
import { branchOfRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import {
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

  constructor(private readonly deps: VaultExportDeps) {}

  private definition(id: string): AutomationDefinition | null {
    return this.deps.definitions().find((d) => d.id === id) ?? null
  }

  private folderOf(def: AutomationDefinition): string {
    return jobFolderFor(this.deps.dir, def.name)
  }

  private exportRun(run: RunRow, def: AutomationDefinition, at: number): void {
    const folder = this.folderOf(def)
    const path = join(folder, 'Runs.md')
    const root = dirname(dirname(this.deps.dir))
    const header = runsHeader(
      `[[${relative(root, join(folder, basename(folder)))}|${basename(folder)}]]`
    )
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
      this.exportRun(run, def, at)
      lines += 1
    }
    return lines
  }

  private branchOf(item: InboxItemRow): string | null {
    const fromRun = item.runId ? branchOfRun(this.deps.store, item.runId) : null
    return fromRun ?? (item.worktreePath ? basename(item.worktreePath) : null)
  }

  private notePathOf(item: InboxItemRow, def: AutomationDefinition): string {
    const branch = this.branchOf(item)
    const name = branch ? `${branch.replace(/\//g, '-')}.md` : 'Items.md'
    return join(this.folderOf(def), name)
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
    const block = items.length ? itemsBlock(def.id, items, (i) => this.branchOf(i) ?? 'job') : null
    const existing = readNote(path)
    if (existing === null && block === null) {
      return
    }
    const base = existing ?? `# ${basename(path, '.md')}\n`
    writeNote(
      path,
      touchFrontmatter(replaceBlock(base, def.id, block), at, basename(dirname(path)))
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
      this.writeBlock(path, def, items, at)
      this.written.set(path, signature)
      written += 1
    }
    for (const [path, signature] of this.written) {
      if (notes.has(path) || signature === '') {
        continue
      }
      const owner = this.deps.definitions().find((d) => path.startsWith(this.folderOf(d)))
      if (owner) {
        this.writeBlock(path, owner, [], at)
        written += 1
      }
      this.written.set(path, '')
    }
    return written
  }

  pass(): { lines: number; notes: number } {
    const at = this.deps.now()
    return { lines: this.exportRuns(at), notes: this.exportNotes(at) }
  }
}
