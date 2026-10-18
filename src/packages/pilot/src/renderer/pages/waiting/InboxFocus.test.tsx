// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_NAMED } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxFocus } from './InboxFocus'

afterEach(cleanup)

const cards = [1, 2, 3].map((n) => ({
  ...inboxRow({ id: `in_${n}`, title: `Card ${n}` }),
  host: LOCAL_NAMED
}))

function Harness({ onExit, onChoice }: { onExit: () => void; onChoice: (l: string) => void }) {
  const [at, setAt] = useState(1)
  return (
    <>
      <textarea aria-label="notes" />
      <InboxFocus
        cards={cards}
        at={at}
        onAt={setAt}
        tabLabel="Needs you"
        onExit={onExit}
        renderCard={(c) => (
          <div>
            <h3>current {c.title}</h3>
            <button data-skip="" data-choice="Skip" onClick={() => onChoice('Skip')}>
              Skip
            </button>
            <button data-choice="Approve" onClick={() => onChoice('Approve')}>
              Approve
            </button>
            <button data-choice="Reject" onClick={() => onChoice('Reject')}>
              Reject
            </button>
          </div>
        )}
      />
    </>
  )
}

function setup() {
  const onExit = vi.fn()
  const onChoice = vi.fn()
  render(<Harness onExit={onExit} onChoice={onChoice} />)
  return { onExit, onChoice }
}

describe('InboxFocus', () => {
  it('names the position in the tab', () => {
    setup()
    expect(screen.getByText('2 of 3 in Needs you')).toBeTruthy()
  })

  it('J moves to the next card and K back', () => {
    setup()
    fireEvent.keyDown(document.body, { key: 'j' })
    expect(screen.getByText('current Card 3')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'k' })
    expect(screen.getByText('current Card 2')).toBeTruthy()
  })

  it('a number clicks that answer button and S clicks Skip', () => {
    const { onChoice } = setup()
    fireEvent.keyDown(document.body, { key: '2' })
    expect(onChoice).toHaveBeenLastCalledWith('Reject')
    fireEvent.keyDown(document.body, { key: 's' })
    expect(onChoice).toHaveBeenLastCalledWith('Skip')
  })

  it('Escape exits', () => {
    const { onExit } = setup()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('ignores keys typed in a text field and keys with a modifier', () => {
    const { onChoice, onExit } = setup()
    fireEvent.keyDown(screen.getByLabelText('notes'), { key: '1' })
    fireEvent.keyDown(document.body, { key: '1', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'Escape', ctrlKey: true })
    expect(onChoice).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    expect(screen.getByText('2 of 3 in Needs you')).toBeTruthy()
  })

  it('clamps to the last card when the list shrinks', () => {
    const { rerender } = render(
      <InboxFocus
        cards={cards}
        at={2}
        onAt={() => {}}
        tabLabel="All"
        onExit={() => {}}
        renderCard={(c) => <p>{c.title}</p>}
      />
    )
    rerender(
      <InboxFocus
        cards={cards.slice(0, 1)}
        at={2}
        onAt={() => {}}
        tabLabel="All"
        onExit={() => {}}
        renderCard={(c) => <p>{c.title}</p>}
      />
    )
    expect(screen.getByText('1 of 1 in All')).toBeTruthy()
  })
})
