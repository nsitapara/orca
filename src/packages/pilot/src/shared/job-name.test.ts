import { describe, expect, it } from 'vitest'
import { jobCode, vaultJobName } from './job-name'

describe('jobCode', () => {
  it.each([
    ['05 · Fix failed CI on my MRs', '05'],
    ['M01 · Review my branches', 'M01'],
    ['13 · Linear todo', '13'],
    ['Fix failed CI on my MRs', null],
    ['5 · too short', null]
  ])('%s → %s', (name, code) => expect(jobCode(name)).toBe(code))
})

describe('vaultJobName', () => {
  const jobs = ['05 · Fix failed CI on my MRs', 'M01 · Review my branches', 'Scratch']
  it.each([
    ['05 · Fix failed CI on my MRs', '05 · Fix failed CI on my MRs'],
    ['Fix failed CI on my MRs', '05 · Fix failed CI on my MRs'],
    ['Review my branches', 'M01 · Review my branches'],
    ['Scratch', null],
    ['Only in Pilot', null]
  ])('%s → %s', (name, job) => expect(vaultJobName(name, jobs)).toBe(job))
})
