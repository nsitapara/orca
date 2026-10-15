import type { StepRow } from '../api-types'
import type { AgentKind } from '../definition/types'
import { agentWord } from './chain-text'
import { chainPart, type ChainPart } from './chain'

function agentRunsText(agent: AgentKind, skill: string | null): string {
  if (skill) {
    return `${agentWord(agent)} · ${skill}`
  }
  return agentWord(agent)
}

// A stored step as a part of its own: a run older than a YAML change, or an answer run's step.
export function storedStepPart(s: StepRow, prefix: 'step' | 'answer'): ChainPart {
  const agent = s.agent === 'claude' || s.agent === 'codex' ? s.agent : null
  const runs = agent ? agentRunsText(agent, s.skill) : ''
  return chainPart({
    key: `${prefix}:${s.idx}`,
    kind: 'step',
    group: prefix === 'answer' ? 'asks' : 'steps',
    who: agent ? 'agent' : 'script',
    name: s.name,
    short: agent ? `${agentWord(agent)} · ${s.skill ?? s.name}` : s.name,
    runs,
    agent,
    skill: s.skill,
    when: s.whenExpr,
    stepIdx: s.idx
  })
}

export function hasDrifted(chain: readonly ChainPart[], steps: readonly StepRow[]): boolean {
  return steps.some(
    (s) => chain.find((p) => p.kind === 'step' && p.stepIdx === s.idx)?.name !== s.name
  )
}
