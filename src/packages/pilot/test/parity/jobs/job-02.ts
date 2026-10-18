import type { VerdictTable } from '../compare'

export const JOB_02 = { job: '02', automationId: 'merge-dev' }

// 02's words (frozen in the test data) and the verdicts that agree with them. The only item is the run-once repo item.
export const VERDICTS_02: VerdictTable = {
  map: { due: ['started'], quota: ['held'] },
  whenOldMissing: []
}
