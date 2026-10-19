import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ~/.agents/skills/follow-up-ticket/assets/ticket.md, verbatim (tests never read the home folder).
export const TICKET_FRONTMATTER = `---
team: WEB
state: Backlog
priority: low
labels: []
assignee: me
title: '{title}'
---
`
export const TICKET_BODY = `**From** {job} · {found}
Where: \`{location}\` on \`{branch}\`

## What was found
{context}

## Suggested
{suggested}

## Evidence
{screenshots}
- MR: {mr.web_url}

---
Filed for later from Pilot · pilot-item \`{automation_id}:{item_key}\`
`
export const TICKET_MD = TICKET_FRONTMATTER + TICKET_BODY

// A skills folder holding follow-up-ticket/assets/ticket.md with this text; returns the folder and the file.
export function skillsWithTemplate(text: string = TICKET_MD): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-ticket-skills-'))
  const assets = join(dir, 'follow-up-ticket', 'assets')
  mkdirSync(assets, { recursive: true })
  const file = join(assets, 'ticket.md')
  writeFileSync(file, text)
  return { dir, file }
}
