// One row of the run panel's summary list: its name, and what it says.
export function RunFact({
  name,
  children
}: {
  name: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}
