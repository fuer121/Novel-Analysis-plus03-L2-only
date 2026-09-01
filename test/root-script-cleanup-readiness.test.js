import test from 'node:test'
import assert from 'node:assert/strict'

import { checkRootScriptCleanupReadiness } from '../scripts/check-root-script-cleanup-readiness.mjs'

const localArtifactTest = process.env.CI ? test.skip : test

localArtifactTest('every removed root book-specific script retains its preservation target', () => {
  const report = checkRootScriptCleanupReadiness()

  assert.equal(report.candidate_count, 81)
  assert.deepEqual(report.status_counts, { historical: 74, active: 4, review: 3 })
  assert.equal(report.removed_source_count, 81)
  assert.equal(report.remaining_source_count, 0)
  assert.deepEqual(report.unexpected_sources, [])
  assert.equal(report.all_ready_for_manual_confirmation, true)
  assert.deepEqual(report.files.filter((file) => !file.ready), [])
})
