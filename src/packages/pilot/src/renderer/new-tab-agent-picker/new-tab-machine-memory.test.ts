// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEW_TAB_MACHINE_KEY,
  readLastNewTabMachine,
  rememberNewTabMachine
} from './new-tab-machine-memory'

describe('new-tab machine memory', () => {
  beforeEach(() => localStorage.clear())

  it('keeps one machine per project', () => {
    rememberNewTabMachine('git:a', 'runtime:env-b')
    rememberNewTabMachine('git:b', 'ssh:box')
    rememberNewTabMachine('git:a', 'local')
    expect([
      readLastNewTabMachine('git:a'),
      readLastNewTabMachine('git:b'),
      readLastNewTabMachine('git:c')
    ]).toEqual(['local', 'ssh:box', null])
  })

  it.each(['{nope', '[]', JSON.stringify({ 'git:a': 'nope' }), JSON.stringify({ 'git:a': 42 })])(
    'reads %s as nothing remembered',
    (raw) => {
      localStorage.setItem(NEW_TAB_MACHINE_KEY, raw)
      expect(readLastNewTabMachine('git:a')).toBeNull()
    }
  )

  it('survives a throwing localStorage', () => {
    const boom = (): never => {
      throw new Error('denied')
    }
    const spies = [
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    ]
    expect(readLastNewTabMachine('git:a')).toBeNull()
    expect(() => rememberNewTabMachine('git:a', 'local')).not.toThrow()
    spies.forEach((s) => s.mockRestore())
  })
})
