import { parseAutomationYaml } from '../../shared/definition/parse'
import { WHERE_SCHEMAS } from '../../shared/definition/where'
import type { PilotStore } from '../store/store'
import type { Item, ItemSource, RepoFacts } from './types'
import type { WorktreeRecord } from './worktree-records'

// Preparation has its own durable queue. Discovery's once-per-head marker does not own retries.
export function inboxPreparationSource(
  store: PilotStore,
  listWorktrees: (repo: RepoFacts) => Promise<WorktreeRecord[]>
): ItemSource {
  return {
    kind: 'inbox_preparation',
    whereSchema: WHERE_SCHEMAS.inbox_preparation,
    async list(ctx) {
      const worktrees = await listWorktrees(ctx.repo)
      const paths = new Set(worktrees.filter((w) => !w.isArchived).map((w) => w.path))
      paths.add(ctx.repo.path)
      const items: Item[] = []
      const warnings: string[] = []
      for (const item of store.inboxPreparations.listEligible(ctx.now)) {
        const p = item.preparation
        if (!p) {
          continue
        }
        const origin = store.definitions.lastValid(item.automationId)
        const parsed = origin ? parseAutomationYaml(origin.yaml, origin.file) : null
        if (!parsed?.ok || parsed.definition.repo !== ctx.repo.name) {
          continue
        }
        if (item.worktreePath && !paths.has(item.worktreePath)) {
          warnings.push(`${item.title}: preparation waits for its original worktree`)
          continue
        }
        // A worker that lost its lease must stop before another attempt starts beside it.
        if (p.runId && store.runs.get(p.runId)?.status === 'running') {
          continue
        }
        items.push({
          kind: 'inbox_preparation',
          key: item.id,
          label: item.title,
          fields: {
            'preparation.item_id': item.id,
            'preparation.revision': p.revision,
            'preparation.attempt': p.attempt + 1,
            'preparation.context': p.input.context,
            'preparation.requirements': p.input.requirements.join(','),
            'preparation.origin_automation': item.automationId,
            'preparation.origin_run': item.runId,
            'preparation.error': p.error,
            'preparation.head': p.input.head ?? null,
            'worktree.path': item.worktreePath ?? ctx.repo.path
          },
          worktreeHint: { path: item.worktreePath ?? ctx.repo.path },
          sortKeys: { waitingSince: item.createdAt, priority: null }
        })
      }
      return { items, warnings }
    },
    scope: () => ({ ok: true })
  }
}
