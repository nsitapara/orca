import { cn } from '@/lib/utils'

type MarkProps = { stateType?: string; color?: string; className?: string }

// A filled disc with the glyph drawn in the background colour, as Linear draws Done and Canceled.
function GlyphDisc({ glyph }: { glyph: string }): React.JSX.Element {
  return (
    <>
      <circle cx="7" cy="7" r="6.5" fill="currentColor" />
      <path
        d={glyph}
        fill="none"
        stroke="var(--color-background)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  )
}

function MarkShape({ stateType }: { stateType?: string }): React.JSX.Element {
  switch (stateType ?? 'unstarted') {
    case 'backlog':
    case 'triage':
      return (
        <circle
          cx="7"
          cy="7"
          r="5.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.2 1.8"
        />
      )
    case 'started':
      return (
        <>
          <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )
    case 'completed':
      return <GlyphDisc glyph="M4.4 7.2 6.2 9l3.4-3.7" />
    case 'canceled':
      return <GlyphDisc glyph="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2" />
    default:
      return <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
  }
}

/** A Linear issue's state mark: the shape is the state's type, the colour the workspace's own for it. */
export function LinearStateMark({ stateType, color, className }: MarkProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('shrink-0', !color && 'text-muted-foreground', className)}
      style={color ? { color } : undefined}
    >
      <MarkShape stateType={stateType} />
    </svg>
  )
}
