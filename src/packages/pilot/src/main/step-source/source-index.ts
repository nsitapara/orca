import { z } from 'zod'
import type { SourceIndex } from '../../shared/source-types'
import type { Pilotcli } from '../envs/pilotcli'

const TIMEOUT_MS = 10_000
// A new pilotcli install is seen within a minute.
const FRESH_MS = 60_000

const Version = z.object({ source_root: z.string().min(1) })
const Commands = z.object({
  modules: z.array(
    z.object({
      commands: z.array(
        z.object({
          command: z.string(),
          source: z
            .object({ file: z.string().min(1), line: z.number().int().positive() })
            .optional()
        })
      )
    })
  )
})

// Where pilotcli's commands are (get-version's source_root, list-commands' source), and the skills folder. A pilotcli
// that doesn't say gives no command links; the skills still have theirs.
export async function readSourceIndex(pilotcli: Pilotcli, skillsDir: string): Promise<SourceIndex> {
  const [version, listed] = await Promise.all([
    pilotcli({ args: ['self', 'get-version', '--format', 'json'], timeoutMs: TIMEOUT_MS }),
    pilotcli({ args: ['self', 'list-commands', '--format', 'json'], timeoutMs: TIMEOUT_MS })
  ])
  const root = version.outcome === 'ok' ? Version.safeParse(version.data) : null
  const catalog = listed.outcome === 'ok' ? Commands.safeParse(listed.data) : null
  if (!root?.success || !catalog?.success) {
    return { pilotcli: null, skillsDir }
  }
  const commands: Record<string, { file: string; line: number }> = {}
  for (const command of catalog.data.modules.flatMap((m) => m.commands)) {
    if (command.source) {
      commands[command.command] = command.source
    }
  }
  return { pilotcli: { root: root.data.source_root, commands }, skillsDir }
}

// One read shared by every caller until it is a minute old.
export function sourceIndexReader(
  read: () => Promise<SourceIndex>,
  now: () => number = Date.now
): () => Promise<SourceIndex> {
  let cached: { at: number; index: Promise<SourceIndex> } | null = null
  return () => {
    if (!cached || now() - cached.at > FRESH_MS) {
      cached = { at: now(), index: read() }
    }
    return cached.index
  }
}
