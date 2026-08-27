import test from 'node:test'
import assert from 'node:assert/strict'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkCleanupReadiness, findActiveLegacyReferences } from '../scripts/check-book-cleanup-readiness.mjs'

test('book cleanup remains blocked until the 14-day verification window ends', () => {
  const report = checkCleanupReadiness({ asOf: '2026-08-27' })

  assert.equal(report.books.length, 4)
  assert.equal(report.all_ready_for_manual_confirmation, false)
  for (const book of report.books) {
    assert.equal(book.source.hashes_match, true)
    assert.equal(book.target.hashes_match, true)
    assert.equal(book.cleanup_status, 'waiting_for_verification_window')
  }
})

test('book cleanup becomes ready after hash verification on the review date', () => {
  const report = checkCleanupReadiness({ asOf: '2026-09-10' })

  assert.equal(report.all_ready_for_manual_confirmation, true)
  for (const book of report.books) {
    assert.equal(book.cleanup_status, 'ready_for_manual_confirmation')
  }
})

test('active legacy path references are detected with file and line evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'book-cleanup-reference-'))
  const file = path.join(directory, 'active-script.py')
  fs.writeFileSync(file, 'ROOT = Path("artifacts") / "book"\nprint(ROOT)\n')

  const references = findActiveLegacyReferences({ root: directory, files: [file] })

  assert.deepEqual(references, [{
    file: 'active-script.py',
    line: 1,
    content: 'ROOT = Path("artifacts") / "book"',
  }])
})

test('the current active execution surfaces no longer reference legacy artifacts', () => {
  assert.deepEqual(findActiveLegacyReferences(), [])
})
