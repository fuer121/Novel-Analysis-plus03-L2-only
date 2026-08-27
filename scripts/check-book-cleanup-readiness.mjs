#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { asOf: null, bookId: null, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') args.json = true
    else if (value === '--as-of') args.asOf = argv[++index]
    else if (value === '--book') args.bookId = argv[++index]
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (args.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(args.asOf)) {
    throw new Error('--as-of must use YYYY-MM-DD')
  }
  return args
}

function shanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function loadHashManifest(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
    if (!match) throw new Error(`Invalid hash manifest line in ${file}: ${line}`)
    return { expected: match[1], file: match[2] }
  })
}

function verifyEntries(entries) {
  const missing = []
  const mismatches = []
  for (const entry of entries) {
    const absolute = path.resolve(repoRoot, entry.file)
    if (!fs.existsSync(absolute)) {
      missing.push(entry.file)
      continue
    }
    const actual = sha256(absolute)
    if (actual !== entry.expected) mismatches.push({ file: entry.file, expected: entry.expected, actual })
  }
  return {
    expected_file_count: entries.length,
    matched_file_count: entries.length - missing.length - mismatches.length,
    missing,
    mismatches,
    hashes_match: missing.length === 0 && mismatches.length === 0,
  }
}

function verifyRemovedEntries(entries) {
  const remaining = entries.map((entry) => entry.file).filter((file) => fs.existsSync(path.resolve(repoRoot, file)))
  return {
    expected_file_count: entries.length,
    removed_file_count: entries.length - remaining.length,
    remaining,
    all_sources_removed: remaining.length === 0,
  }
}

const LEGACY_REFERENCE_PATTERN = /(?:["'`]artifacts["'`]|artifacts\/)/

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(absolute) : [absolute]
  })
}

export function findActiveLegacyReferences({ root = repoRoot, files = null } = {}) {
  const candidates = files || [
    path.join(root, 'scripts', 'check-book-cleanup-readiness.mjs'),
    path.join(root, 'scripts', 'generate-dify-workflow-manifest.mjs'),
    path.join(root, 'scripts', 'migrate-to-plaintext.mjs'),
    ...walkFiles(path.join(root, 'server')),
    ...walkFiles(path.join(root, 'src')),
    ...walkFiles(path.join(root, 'books')).filter((file) => file.includes(`${path.sep}scripts${path.sep}active${path.sep}`)),
  ]

  return candidates.filter((file) => fs.existsSync(file)).flatMap((file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    return lines.flatMap((line, index) => LEGACY_REFERENCE_PATTERN.test(line)
      ? [{ file: path.relative(root, file), line: index + 1, content: line.trim() }]
      : [])
  })
}

function findMigrations(bookId) {
  const booksRoot = path.join(repoRoot, 'books')
  return fs.readdirSync(booksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (!bookId || entry.name.startsWith(`${bookId}-`)))
    .map((entry) => path.join(booksRoot, entry.name, 'migration', '2026-08-27-sample'))
    .filter((directory) => fs.existsSync(path.join(directory, 'migration-manifest.json')))
    .sort()
}

export function checkCleanupReadiness({ asOf = null, bookId = null } = {}) {
  const reviewDate = asOf || shanghaiDate()
  const migrations = findMigrations(bookId)
  const activeLegacyReferences = findActiveLegacyReferences()
  if (!migrations.length) throw new Error(bookId ? `No migration found for book ${bookId}` : 'No book migrations found')

  const books = migrations.map((migrationDir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(migrationDir, 'migration-manifest.json'), 'utf8'))
    const sourceEntries = loadHashManifest(path.join(migrationDir, manifest.source_sha256_manifest))
    const source = manifest.status === 'completed_source_cleaned'
      ? verifyRemovedEntries(sourceEntries)
      : verifyEntries(sourceEntries)
    const target = verifyEntries(loadHashManifest(path.join(migrationDir, manifest.target_sha256_manifest)))
    const windowElapsed = reviewDate >= manifest.source_cleanup_after
    const cleanupCompleted = manifest.status === 'completed_source_cleaned'
    const ready = cleanupCompleted
      ? source.all_sources_removed && target.hashes_match && activeLegacyReferences.length === 0
      : windowElapsed && source.hashes_match && target.hashes_match && activeLegacyReferences.length === 0
    return {
      book_id: manifest.book_id,
      book_name: manifest.book_name,
      migration_status: manifest.status,
      source_cleanup_after: manifest.source_cleanup_after,
      review_date: reviewDate,
      window_elapsed: windowElapsed,
      source,
      target,
      cleanup_status: ready
        ? cleanupCompleted ? 'source_cleanup_completed' : 'ready_for_manual_confirmation'
        : cleanupCompleted
          ? !source.all_sources_removed
            ? 'blocked_by_remaining_sources'
            : !target.hashes_match
              ? 'blocked_by_hash_drift'
              : 'blocked_by_active_legacy_references'
        : !windowElapsed
          ? 'waiting_for_verification_window'
          : !source.hashes_match || !target.hashes_match
            ? 'blocked_by_hash_drift'
            : 'blocked_by_active_legacy_references',
    }
  })

  return {
    checked_at: reviewDate,
    active_legacy_references: activeLegacyReferences,
    all_ready_for_manual_confirmation: books.every((book) => ['ready_for_manual_confirmation', 'source_cleanup_completed'].includes(book.cleanup_status)),
    books,
  }
}

function printHuman(report) {
  for (const book of report.books) {
    console.log(`${book.book_id} ${book.book_name}: ${book.cleanup_status}`)
    console.log(`  review date: ${book.review_date}; cleanup after: ${book.source_cleanup_after}`)
    if (book.cleanup_status === 'source_cleanup_completed') {
      console.log(`  removed sources: ${book.source.removed_file_count}/${book.source.expected_file_count}`)
    } else console.log(`  source hashes: ${book.source.matched_file_count}/${book.source.expected_file_count}`)
    console.log(`  target hashes: ${book.target.matched_file_count}/${book.target.expected_file_count}`)
  }
  console.log(`all ready: ${report.all_ready_for_manual_confirmation}`)
  console.log(`active legacy references: ${report.active_legacy_references.length}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const report = checkCleanupReadiness(args)
    if (args.json) console.log(JSON.stringify(report, null, 2))
    else printHuman(report)
    if (report.books.some((book) => book.cleanup_status.startsWith('blocked_by_'))) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
