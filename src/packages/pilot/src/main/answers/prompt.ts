import type { InboxItemRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { oneLine } from '../inbox/card'

export type AgentAnswer = { item: InboxItemRow; revise: boolean; needsAgent: string | null }

const REVISE = " (revise: change the proposal and ask again as a new action; don't run it)"
const RECORD =
  'Act on each one in this worktree, then record it with `pilot inbox tick --id <id> --outcome "<what happened>"`; ' +
  'if an answer is unclear, ask with `pilot inbox reply --id <id> --text "<question>"` and leave it open. ' +
  'Never wait in this tab for a reply.'

function howNote(answer: AgentAnswer): string {
  if (answer.revise) {
    return REVISE
  }
  if (answer.needsAgent) {
    // The action's own words: one line, like everything in a typed prompt.
    return ` (approved; its action stopped for judgement: ${oneLine(answer.needsAgent)})`
  }
  return ''
}

// apply.py prompt(): the bundle the answer was given against, pinned by its SHA-256, so a drafted patch
// applied is the one shown. The path is quoted: job folders contain ' · ', the prompt's separator.
function detailsNote(item: InboxItemRow): string {
  if (!item.details) {
    return ''
  }
  const { path, sha256 } = item.details
  return ` (Details "${oneLine(path)}" sha256 ${sha256}: a drafted patch applies only by ~/.agents/skills/item-details/references/apply.md)`
}

function note(answer: AgentAnswer): string {
  return howNote(answer) + detailsNote(answer.item)
}

// apply.py prompt(): one line (a newline would submit early in a typed prompt), each claimed answer as
// [id] "title" → answer, then how to record what happened.
export function answersLine(
  askingRunId: string | null,
  answerRunId: string,
  answers: AgentAnswer[]
): string {
  const head = askingRunId
    ? `Answers to the questions run ${askingRunId} asked (answer run ${answerRunId}), already claimed:`
    : `Answers saved on Waiting on you (answer run ${answerRunId}), already claimed:`
  const lines = answers.map(
    (a) => `[${a.item.id}] "${a.item.title}" → ${a.item.answer?.text ?? ''}${note(a)}`
  )
  return [head, ...lines, RECORD].join(' · ')
}

// What `{run.answer}` is in an answer run (G7): the answers, one per line.
export function answersText(answers: AgentAnswer[]): string {
  return answers.map((a) => a.item.answer?.text ?? '').join('\n')
}

export function modeFile(skill: string, mode: string): string {
  return `~/.agents/skills/${skill}/modes/${mode}.md`
}

// A resumed or forked session already knows its job, but not this automation's rules for applying answers
// (re-check first, never push yourself): one sentence pointing at the mode file, ahead of the answers.
export function withModePointer(
  mode: { skill: string | null; mode: string },
  line: string
): string {
  if (!mode.skill) {
    return line
  }
  return `Apply these answers as ${modeFile(mode.skill, mode.mode)} says. ${line}`
}

// A new session knows nothing yet: the wrapped preamble (contract §7) and the skill's answers mode file.
export function newSessionPrompt(
  def: Pick<AutomationDefinition, 'name'>,
  run: { id: string; label: string },
  target: { skill: string | null; mode: string },
  line: string
): string {
  const lines = [`Started by the Pilot automation "${def.name}" (run ${run.id}) for ${run.label}.`]
  if (target.skill) {
    lines.push(
      `Use the ${target.skill} skill in its ${target.mode} mode (${modeFile(target.skill, target.mode)}).`
    )
  }
  lines.push('', line)
  return lines.join('\n')
}
