// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeRunPanel, openRun } from '../../run-views/run-panel-state'
import { LOCAL_NAMED } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { type FocusPlace, InboxFocus } from './InboxFocus'

afterEach(cleanup)

const cards = [1, 2, 3].map((n) => ({
  ...inboxRow({ id: `in_${n}`, title: `Card ${n}` }),
  host: LOCAL_NAMED
}))

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    ...inboxRow({ id: `m_${i}`, title: `Card ${i + 1}` }),
    host: LOCAL_NAMED
  }))

// Where a page starts: a position, before any card is known.
const at = (n: number): FocusPlace => ({ key: null, at: n })

function Harness({ onExit, onChoice }: { onExit: () => void; onChoice: (l: string) => void }) {
  const [place, setPlace] = useState(at(1))
  // InboxPage's root, which the keys are scoped to.
  return (
    <div className="pilot-inbox">
      <InboxFocus
        cards={cards}
        place={place}
        onPlace={setPlace}
        tabLabel="Needs you"
        onExit={onExit}
        renderCard={(c) => (
          <div>
            <h3>current {c.title}</h3>
            <textarea aria-label="notes" />
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
    </div>
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

  it('shows the next four cards under Up next', () => {
    const six = many(6)
    render(
      <InboxFocus
        cards={six}
        place={at(0)}
        onPlace={() => {}}
        tabLabel="All"
        onExit={() => {}}
        renderCard={(c) => <p>{c.title}</p>}
      />
    )
    const upNext = screen.getByRole('region', { name: 'Up next' })
    expect(
      within(upNext)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Card 2', 'Card 3', 'Card 4', 'Card 5'])
  })

  it('keeps the clamped card when the list shrinks and refills', () => {
    function Shrinking({ n }: { n: number }) {
      const [place, setPlace] = useState(at(5))
      return (
        <InboxFocus
          cards={many(n)}
          place={place}
          onPlace={setPlace}
          tabLabel="All"
          onExit={() => {}}
          renderCard={(c) => <p>{c.title}</p>}
        />
      )
    }
    const { rerender } = render(<Shrinking n={6} />)
    rerender(<Shrinking n={2} />)
    rerender(<Shrinking n={6} />)
    expect(screen.getByText('2 of 6 in All')).toBeTruthy()
  })

  it.each([
    ['the answered card before it leaves the list', cards.slice(1)],
    ['a new card sorts in ahead of it', [many(1)[0], ...cards]]
  ])('keeps the card J moved to when %s', (_name, next) => {
    function Live({ list }: { list: typeof cards }) {
      const [place, setPlace] = useState(at(0))
      return (
        <InboxFocus
          cards={list}
          place={place}
          onPlace={setPlace}
          tabLabel="Needs you"
          onExit={() => {}}
          renderCard={(c) => (
            <div>
              <h3>current {c.title}</h3>
              <button data-choice="Approve">Approve</button>
            </div>
          )}
        />
      )
    }
    const { rerender } = render(<Live list={cards} />)
    fireEvent.keyDown(document.body, { key: '1' })
    fireEvent.keyDown(document.body, { key: 'j' })
    expect(screen.getByText('current Card 2')).toBeTruthy()
    rerender(<Live list={next} />)
    expect(screen.getByText('current Card 2')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Up next' })).getByText('Card 3')).toBeTruthy()
  })

  it('starts a new tab at its first card', () => {
    function Page({ tab }: { tab: string }) {
      const [focus, setFocus] = useState({ ...at(2), scope: 'a' })
      return (
        <InboxFocus
          cards={many(5)}
          place={focus.scope === tab ? focus : at(0)}
          onPlace={(place) => setFocus({ ...place, scope: tab })}
          tabLabel={tab}
          onExit={() => {}}
          renderCard={(c) => <p>{c.title}</p>}
        />
      )
    }
    const { rerender } = render(<Page tab="a" />)
    expect(screen.getByText('3 of 5 in a')).toBeTruthy()
    rerender(<Page tab="b" />)
    expect(screen.getByText('1 of 5 in b')).toBeTruthy()
  })

  describe('J does not move the card when', () => {
    function overlay() {
      const d = document.createElement('div')
      d.setAttribute('role', 'dialog')
      document.body.append(d)
      return d
    }
    function outside() {
      const t = document.createElement('textarea')
      t.className = 'xterm-helper-textarea'
      document.body.append(t)
      return t
    }
    const cases: [
      string,
      () => { target: Element; init?: KeyboardEventInit; undo?: () => void }
    ][] = [
      ['repeat', () => ({ target: document.body, init: { repeat: true } })],
      ['composing', () => ({ target: document.body, init: { isComposing: true } })],
      ['meta', () => ({ target: document.body, init: { metaKey: true } })],
      ['ctrl', () => ({ target: document.body, init: { ctrlKey: true } })],
      ['alt', () => ({ target: document.body, init: { altKey: true } })],
      ['shift', () => ({ target: document.body, init: { shiftKey: true } })],
      [
        'an overlay is visible',
        () => {
          const d = overlay()
          return { target: document.body, undo: () => d.remove() }
        }
      ],
      [
        'the run panel is open',
        () => {
          act(() => openRun('r1'))
          return { target: document.body, undo: () => act(() => closeRunPanel()) }
        }
      ],
      [
        'the target is outside the inbox root',
        () => {
          const t = outside()
          return { target: t, undo: () => t.remove() }
        }
      ],
      ["the target is the card's notes box", () => ({ target: screen.getByLabelText('notes') })]
    ]
    it.each(cases)('%s', (_name, arrange) => {
      setup()
      const { target, init, undo } = arrange()
      fireEvent.keyDown(target, { key: 'j', ...init })
      undo?.()
      expect(screen.getByText('2 of 3 in Needs you')).toBeTruthy()
    })

    it('control: document.body moves the card', () => {
      setup()
      fireEvent.keyDown(document.body, { key: 'j' })
      expect(screen.getByText('3 of 3 in Needs you')).toBeTruthy()
    })
  })
})
