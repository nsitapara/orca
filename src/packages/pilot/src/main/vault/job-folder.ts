import { readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
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
// The name comes from a definition file, so it never picks a folder outside `automationsDir`: path
// characters become "-", and null means "." / ".." / empty or a path that still resolves outside.
export function jobFolderFor(automationsDir: string, name: string): string | null {
  const all = folders(automationsDir)
  const found = all.includes(name) ? name : (vaultJobName(name, all) ?? name)
  const safe = found.replace(/[/\\:]/g, '-')
  if (safe === '' || safe === '.' || safe === '..') {
    return null
  }
  const path = join(automationsDir, safe)
  const rel = relative(resolve(automationsDir), resolve(path))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }
  return path
}
