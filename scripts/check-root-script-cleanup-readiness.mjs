#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const productTools = new Set([
  'check-book-cleanup-readiness.mjs',
  'check-root-script-cleanup-readiness.mjs',
  'generate-dify-workflow-manifest.mjs',
  'migrate-to-plaintext.mjs',
])

const supplementalRows = [{
  source_path: 'scripts/enrich-divorce-faces.py',
  target_path: 'books/222767-离婚后她惊艳了世界/archive/2026/legacy-scripts/enrich-divorce-faces.py',
  status: 'historical',
  reason: '补录的离婚书五官富化一次性脚本',
}]

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const headers = rows.shift()
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])))
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function inventoryRows(root) {
  const booksRoot = path.join(root, 'books')
  const rows = fs.readdirSync(booksRoot).flatMap((book) => {
    const inventory = path.join(booksRoot, book, 'migration', '2026-08-27-sample', 'scripts-inventory.csv')
    if (!fs.existsSync(inventory)) return []
    return parseCsv(fs.readFileSync(inventory, 'utf8')).map((row) => ({
      source_path: row.source_path || row.filename,
      target_path: row.target_path,
      status: row.status,
      reason: row.reason || row.notes,
      inventory: path.relative(root, inventory),
    }))
  })
  return [...rows, ...supplementalRows.map((row) => ({ ...row, inventory: 'supplemental' }))]
}

function preservationPath(row) {
  if (row.status === 'active') {
    const bookRoot = row.target_path.split('/scripts/active/')[0]
    return `${bookRoot}/archive/2026/source-records/active-scripts/${path.basename(row.source_path)}`
  }
  return row.target_path.endsWith('/') ? `${row.target_path}${path.basename(row.source_path)}` : row.target_path
}

export function checkRootScriptCleanupReadiness({ root = repoRoot } = {}) {
  const rows = inventoryRows(root).filter((row) => row.source_path.startsWith('scripts/'))
  const candidates = [...new Set(rows.map((row) => row.source_path))].sort()
  const unexpectedSources = fs.readdirSync(path.join(root, 'scripts'))
    .filter((name) => !productTools.has(name))
    .map((name) => `scripts/${name}`)
    .filter((file) => !candidates.includes(file))

  const files = candidates.map((sourcePath) => {
    const matches = rows.filter((row) => row.source_path === sourcePath)
    if (matches.length !== 1) return { source_path: sourcePath, inventory_matches: matches.length, ready: false }
    const row = matches[0]
    const preservedPath = preservationPath(row)
    const source = path.join(root, sourcePath)
    const preserved = path.join(root, preservedPath)
    const sourceExists = fs.existsSync(source)
    const preservedExists = fs.existsSync(preserved)
    const sourceHash = sourceExists ? sha256(source) : null
    const preservedHash = preservedExists ? sha256(preserved) : null
    return {
      source_path: sourcePath,
      status: row.status,
      preserved_path: preservedPath,
      source_exists: sourceExists,
      source_sha256: sourceHash,
      preserved_sha256: preservedHash,
      preserved_exists: preservedExists,
      hashes_match: sourceExists ? sourceHash === preservedHash : null,
      inventory: row.inventory,
      cleanup_status: !sourceExists && preservedExists
        ? 'source_removed_preserved'
        : sourceExists && preservedExists && sourceHash === preservedHash
          ? 'ready_for_manual_confirmation'
          : 'blocked',
      ready: preservedExists && (!sourceExists || sourceHash === preservedHash),
    }
  })

  const statusCounts = Object.fromEntries(['historical', 'active', 'review'].map((status) => [
    status,
    files.filter((file) => file.status === status).length,
  ]))

  return {
    candidate_count: files.length,
    remaining_source_count: files.filter((file) => file.source_exists).length,
    removed_source_count: files.filter((file) => !file.source_exists).length,
    unexpected_sources: unexpectedSources,
    status_counts: statusCounts,
    all_ready_for_manual_confirmation: files.length > 0 && files.every((file) => file.ready) && unexpectedSources.length === 0,
    files,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = checkRootScriptCleanupReadiness()
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`root script candidates: ${report.candidate_count}`)
    console.log(`historical: ${report.status_counts.historical}; active source copies: ${report.status_counts.active}; review: ${report.status_counts.review}`)
    console.log(`removed sources: ${report.removed_source_count}; remaining sources: ${report.remaining_source_count}`)
    console.log(`all preserved with matching SHA-256: ${report.all_ready_for_manual_confirmation}`)
    for (const file of report.files.filter((entry) => !entry.ready)) console.log(`  blocked: ${file.source_path}`)
  }
  if (!report.all_ready_for_manual_confirmation) process.exitCode = 1
}
