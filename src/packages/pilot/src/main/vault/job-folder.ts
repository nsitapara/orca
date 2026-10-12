import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { vaultJobName } from '../../shared/job-name'

function folders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// An automation's vault folder: the one named exactly like it, else its vault job by the shared job-name
// rule (today's folders, e.g. "05 · Fix failed CI on my MRs"). With neither, a folder named after the automation.
export function jobFolderFor(automationsDir: string, name: string): string {
  const all = folders(automationsDir)
  const found = all.includes(name) ? name : vaultJobName(name, all)
  return join(automationsDir, found ?? name.replace(/[/\\:]/g, '-'))
}
