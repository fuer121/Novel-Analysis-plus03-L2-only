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
    const match = line.match(/^([a-f0-9]{64})  (.+)$/)
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
  if (!migrations.length) throw new Error(bookId ? `No migration found for book ${bookId}` : 'No book migrations found')

  const books = migrations.map((migrationDir) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(migrationDir, 'migration-manifest.json'), 'utf8'))
    const source = verifyEntries(loadHashManifest(path.join(migrationDir, manifest.source_sha256_manifest)))
    const target = verifyEntries(loadHashManifest(path.join(migrationDir, manifest.target_sha256_manifest)))
    const windowElapsed = reviewDate >= manifest.source_cleanup_after
    const ready = windowElapsed && source.hashes_match && target.hashes_match
    return {
      book_id: manifest.book_id,
      book_name: manifest.book_name,
      migration_status: manifest.status,
      source_cleanup_after: manifest.source_cleanup_after,
      review_date: reviewDate,
      window_elapsed: windowElapsed,
      source,
      target,
      cleanup_status: ready ? 'ready_for_manual_confirmation' : windowElapsed ? 'blocked_by_hash_drift' : 'waiting_for_verification_window',
    }
  })

  return {
    checked_at: reviewDate,
    all_ready_for_manual_confirmation: books.every((book) => book.cleanup_status === 'ready_for_manual_confirmation'),
    books,
  }
}

function printHuman(report) {
  for (const book of report.books) {
    console.log(`${book.book_id} ${book.book_name}: ${book.cleanup_status}`)
    console.log(`  review date: ${book.review_date}; cleanup after: ${book.source_cleanup_after}`)
    console.log(`  source hashes: ${book.source.matched_file_count}/${book.source.expected_file_count}`)
    console.log(`  target hashes: ${book.target.matched_file_count}/${book.target.expected_file_count}`)
  }
  console.log(`all ready: ${report.all_ready_for_manual_confirmation}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const report = checkCleanupReadiness(args)
    if (args.json) console.log(JSON.stringify(report, null, 2))
    else printHuman(report)
    if (report.books.some((book) => book.cleanup_status === 'blocked_by_hash_drift')) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
