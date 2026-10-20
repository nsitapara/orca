import { useId } from 'react'
import { effectText } from '../../shared/effect-text'
import { safeHref } from '../../shared/safe-href'
import type { Effect } from '../../shared/visibility-types'

export const EFFECTS_SHOWN = 4

function keyOf(e: Effect, i: number): string {
  return `${e.kind}:${e.target ?? ''}:${e.stepIdx ?? 'run'}:${i}`
}

function EffectLink({ effect }: { effect: Effect }): React.JSX.Element {
  const text = effectText(effect)
  const href = safeHref(effect.url)
  if (!href) {
    return <span>{text}</span>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline-offset-2 hover:underline"
    >
      {`${text} ↗`}
    </a>
  )
}

// A run's effects in one line (Activity, finished runs): the first four, then "+N".
export function EffectsLine({
  effects
}: {
  effects: readonly Effect[] | null
}): React.JSX.Element | null {
  if (!effects || effects.length === 0) {
    return null
  }
  const more = effects.length - EFFECTS_SHOWN
  return (
    <div
      role="group"
      aria-label="Effects"
      className="flex flex-wrap gap-x-2 text-xs text-muted-foreground"
    >
      {effects.slice(0, EFFECTS_SHOWN).map((e, i) => (
        <EffectLink key={keyOf(e, i)} effect={e} />
      ))}
      {more > 0 ? <span>{`+${more}`}</span> : null}
    </div>
  )
}

// The run panel's What it changed (Run visibility spec §2): every effect, linked, with the step it came from.
export function WhatItChanged({
  effects
}: {
  effects: readonly Effect[] | null
}): React.JSX.Element | null {
  const headingId = useId()
  if (!effects || effects.length === 0) {
    return null
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h3
        id={headingId}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        What it changed
      </h3>
      <ul className="flex flex-col gap-0.5 text-sm">
        {effects.map((e, i) => (
          <li key={keyOf(e, i)}>
            <EffectLink effect={e} />
            {e.stepIdx === null ? null : (
              <span className="text-xs text-muted-foreground">{` · step ${e.stepIdx + 1}`}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
