import test from 'node:test'
import assert from 'node:assert/strict'

import { checkRootScriptCleanupReadiness } from '../scripts/check-root-script-cleanup-readiness.mjs'

test('every root book-specific script has one hash-matched preservation target', () => {
  const report = checkRootScriptCleanupReadiness()

  assert.equal(report.candidate_count, 81)
  assert.deepEqual(report.status_counts, { historical: 74, active: 4, review: 3 })
  assert.equal(report.all_ready_for_manual_confirmation, true)
  assert.deepEqual(report.files.filter((file) => !file.ready), [])
})
