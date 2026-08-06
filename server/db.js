import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { defaultL1IndexPrompt, defaultL2IndexPrompt } from "./indexing-inputs.js";

const DEFAULT_L1_INDEX_PROMPT = defaultL1IndexPrompt();
const DEFAULT_L2_INDEX_PROMPT = defaultL2IndexPrompt();

const DEFAULT_L1_INDEX_PROMPT_HASH = "l1-route-v1";
const DEFAULT_L2_INDEX_PROMPT_HASH = "l2-v1-typed-facts";
export const BASE_INDEX_GROUP_KEY = "base";

const dbPath = path.join(config.dataDir, "novel-chapters.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS books (
    book_id TEXT PRIMARY KEY,
    book_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_import_status TEXT NOT NULL DEFAULT 'idle'
  );

  CREATE TABLE IF NOT EXISTS chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    content_length INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    fetch_status TEXT NOT NULL DEFAULT 'ok',
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS prompt_settings (
    id TEXT PRIMARY KEY,
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS book_index_prompts (
    book_id TEXT PRIMARY KEY,
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS book_index_groups (
    book_id TEXT NOT NULL,
    group_key TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category_scope TEXT NOT NULL DEFAULT '[]',
    trigger_keywords TEXT NOT NULL DEFAULT '[]',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, group_key),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    book_id TEXT NOT NULL,
    start_chapter INTEGER NOT NULL,
    end_chapter INTEGER NOT NULL,
    chapter_selection TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    schema_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    chapter_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    source_stats TEXT NOT NULL DEFAULT '',
    prompt_snapshot TEXT,
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analysis_summary_parts (
    analysis_id TEXT NOT NULL,
    part_key TEXT NOT NULL,
    parent_key TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    reasoning_effort TEXT NOT NULL DEFAULT '',
    input_summary TEXT NOT NULL DEFAULT '',
    trace_summary TEXT NOT NULL DEFAULT '',
    error_summary TEXT NOT NULL DEFAULT '',
    result TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, part_key),
    FOREIGN KEY (analysis_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l1_chapter_indexes (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    entities TEXT NOT NULL DEFAULT '[]',
    key_events TEXT NOT NULL DEFAULT '[]',
    items_places_orgs TEXT NOT NULL DEFAULT '[]',
    open_questions TEXT NOT NULL DEFAULT '[]',
    route_schema_version TEXT NOT NULL DEFAULT '',
    route_summary TEXT NOT NULL DEFAULT '',
    route_entities TEXT NOT NULL DEFAULT '[]',
    route_keywords TEXT NOT NULL DEFAULT '[]',
    signals TEXT NOT NULL DEFAULT '[]',
    category_scores TEXT NOT NULL DEFAULT '{}',
    has_major_signal INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l2_chapter_statuses (
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    facts_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, index_group_key, chapter_index),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS l2_facts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    entity TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    related_entities TEXT NOT NULL DEFAULT '[]',
    fact_type TEXT NOT NULL DEFAULT '',
    fact TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '[]',
    review_note TEXT NOT NULL DEFAULT '',
    importance REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    review_source TEXT NOT NULL DEFAULT 'index',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_l2_facts_lookup
    ON l2_facts(book_id, index_group_key, category, entity, chapter_index);
  CREATE INDEX IF NOT EXISTS idx_l2_facts_chapter
    ON l2_facts(book_id, index_group_key, chapter_index);

  CREATE TABLE IF NOT EXISTS l2_subjects (
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL,
    subject_key TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    creature_type TEXT NOT NULL DEFAULT '',
    original_form TEXT NOT NULL DEFAULT '',
    qualification_chapter INTEGER NOT NULL,
    qualification_basis TEXT NOT NULL DEFAULT '',
    qualification_evidence TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'verified',
    prompt_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, index_group_key, subject_key),
    FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_l2_subjects_lookup
    ON l2_subjects(book_id, index_group_key, qualification_chapter, status);
`);

assertPlaintextSchema();
seedDefaultPrompts();

export function getDbPath() {
  return dbPath;
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureBook(bookId, bookName = "") {
  const id = normalizeBookId(bookId);
  const name = normalizeBookName(bookName);
  const now = nowIso();
  const existing = getBook(id);

  if (existing) {
    if (name && existing.book_name && existing.book_name !== name) {
      const error = new Error(`小说 ID ${id} 已绑定书名《${existing.book_name}》，不能再绑定为《${name}》。`);
      error.status = 409;
      throw error;
    }
    db.prepare("UPDATE books SET book_name = ?, updated_at = ? WHERE book_id = ?")
      .run(existing.book_name || name, now, id);
    ensureBookIndexPrompts(id);
    ensureBaseIndexGroup(id);
    return getBook(id);
  }

  db.prepare(`
    INSERT INTO books (book_id, book_name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, name, now, now);
  ensureBookIndexPrompts(id);
  ensureBaseIndexGroup(id);
  return getBook(id);
}

export function getBook(bookId) {
  return db.prepare("SELECT * FROM books WHERE book_id = ?").get(normalizeBookId(bookId));
}

export function listBooks() {
  return db.prepare(`
    SELECT
      b.book_id,
      b.book_name,
      b.created_at,
      b.updated_at,
      b.last_import_status,
      COUNT(c.chapter_index) AS chapter_count,
      MIN(c.chapter_index) AS first_chapter,
      MAX(c.chapter_index) AS last_chapter
    FROM books b
    LEFT JOIN chapters c ON c.book_id = b.book_id
    GROUP BY b.book_id
    ORDER BY b.updated_at DESC
  `).all();
}

export function getDatabaseDiagnostics() {
  const stats = safeStat(dbPath);
  const books = listBooks().map((book) => ({
    book_id: book.book_id,
    book_name: book.book_name,
    chapter_count: Number(book.chapter_count || 0),
    first_chapter: book.first_chapter,
    last_chapter: book.last_chapter,
    last_import_status: book.last_import_status,
    updated_at: book.updated_at,
    l1: countStatusesForBook("l1_chapter_indexes", book.book_id),
    l2: countStatusesForBook("l2_chapter_statuses", book.book_id),
    index_groups: countRows("book_index_groups", "book_id = ?", [book.book_id]),
    l2_facts: countRows("l2_facts", "book_id = ?", [book.book_id]),
    analyses: countStatusesForBook("analysis_runs", book.book_id)
  }));
  return {
    generated_at: nowIso(),
    storage: {
      db_file_bytes: stats.size || 0,
      db_updated_at: stats.mtime ? stats.mtime.toISOString() : ""
    },
    totals: {
      books: countRows("books"),
      chapters: countRows("chapters"),
      l1_indexes: countRows("l1_chapter_indexes"),
      l2_chapter_statuses: countRows("l2_chapter_statuses"),
      index_groups: countRows("book_index_groups"),
      l2_facts: countRows("l2_facts"),
      analyses: countRows("analysis_runs"),
      summary_parts: countRows("analysis_summary_parts")
    },
    statuses: {
      l1: countStatuses("l1_chapter_indexes"),
      l2: countStatuses("l2_chapter_statuses"),
      analyses: countStatuses("analysis_runs"),
      summary_parts: countStatuses("analysis_summary_parts")
    },
    books
  };
}

export function updateBookImportStatus(bookId, status) {
  db.prepare("UPDATE books SET last_import_status = ?, updated_at = ? WHERE book_id = ?")
    .run(String(status || "idle"), nowIso(), normalizeBookId(bookId));
}

export function listChapterMetadata(bookId) {
  return db.prepare(`
    SELECT book_id, chapter_index, title, content_length, content_hash, fetch_status, fetched_at, updated_at
    FROM chapters
    WHERE book_id = ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId));
}

export function getChapterMetadata(bookId, chapterIndex) {
  return db.prepare(`
    SELECT book_id, chapter_index, title, content_length, content_hash, fetch_status, fetched_at, updated_at
    FROM chapters
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeChapterIndex(chapterIndex));
}

export function getExistingChapterIndexes(bookId, startChapter, endChapter) {
  const rows = db.prepare(`
    SELECT chapter_index
    FROM chapters
    WHERE book_id = ? AND chapter_index BETWEEN ? AND ?
  `).all(normalizeBookId(bookId), normalizeChapterIndex(startChapter), normalizeChapterIndex(endChapter));
  return new Set(rows.map((row) => row.chapter_index));
}

export function saveChapter({ bookId, chapterIndex, title = "", content, fetchStatus = "ok" }) {
  const normalizedBookId = normalizeBookId(bookId);
  const normalizedIndex = normalizeChapterIndex(chapterIndex);
  const text = String(content || "");
  const contentHash = sha256(text);
  const now = nowIso();

  ensureBook(normalizedBookId);
  db.prepare(`
    INSERT INTO chapters (
      book_id, chapter_index, title, content, content_length, content_hash,
      fetch_status, fetched_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_index) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      content_length = excluded.content_length,
      content_hash = excluded.content_hash,
      fetch_status = excluded.fetch_status,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at
  `).run(
    normalizedBookId,
    normalizedIndex,
    String(title || ""),
    text,
    text.length,
    contentHash,
    String(fetchStatus || "ok"),
    now,
    now
  );

  return getChapterMetadata(normalizedBookId, normalizedIndex);
}

export function getChapterContent(bookId, chapterIndex) {
  const normalizedBookId = normalizeBookId(bookId);
  const normalizedIndex = normalizeChapterIndex(chapterIndex);
  const row = db.prepare(`
    SELECT content
    FROM chapters
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizedBookId, normalizedIndex);

  if (!row) {
    const error = new Error(`章节不存在：${normalizedBookId} #${normalizedIndex}`);
    error.status = 404;
    throw error;
  }

  return String(row.content || "");
}

export function deleteBook(bookId) {
  const id = normalizeBookId(bookId);
  const result = db.prepare("DELETE FROM books WHERE book_id = ?").run(id);
  return { deleted: result.changes > 0, bookId: id };
}

export function getIndexPromptSettings() {
  const settings = promptSettingsRow();
  return {
    l1_index_prompt: settings.l1_index_prompt,
    l2_index_prompt: settings.l2_index_prompt,
    l1_index_prompt_hash: l1IndexPromptHash(settings),
    l2_index_prompt_hash: l2IndexPromptHash(settings),
    updated_at: settings.updated_at
  };
}

export function saveIndexPromptSettings(settings = {}) {
  const current = promptSettingsRow();
  const next = {
    l1_index_prompt: Object.hasOwn(settings, "l1_index_prompt")
      ? normalizeIndexPrompt(settings.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT)
      : current.l1_index_prompt,
    l2_index_prompt: Object.hasOwn(settings, "l2_index_prompt")
      ? normalizeIndexPrompt(settings.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT)
      : current.l2_index_prompt
  };
  db.prepare(`
    INSERT INTO prompt_settings (id, l1_index_prompt, l2_index_prompt, updated_at)
    VALUES ('default', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      l1_index_prompt = excluded.l1_index_prompt,
      l2_index_prompt = excluded.l2_index_prompt,
      updated_at = excluded.updated_at
  `).run(next.l1_index_prompt, next.l2_index_prompt, nowIso());
  return getIndexPromptSettings();
}

export function ensureBookIndexPrompts(bookId, prompts = {}) {
  const id = normalizeBookId(bookId);
  const defaults = promptSettingsRow();
  const now = nowIso();
  const current = db.prepare("SELECT * FROM book_index_prompts WHERE book_id = ?").get(id);
  if (current) return publicBookIndexPrompts(current);
  db.prepare(`
    INSERT INTO book_index_prompts (book_id, l1_index_prompt, l2_index_prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    normalizeIndexPrompt(prompts.l1_index_prompt, defaults.l1_index_prompt),
    normalizeIndexPrompt(prompts.l2_index_prompt, defaults.l2_index_prompt),
    now,
    now
  );
  return getBookIndexPrompts(id);
}

export function getBookIndexPrompts(bookId) {
  const id = normalizeBookId(bookId);
  const row = db.prepare("SELECT * FROM book_index_prompts WHERE book_id = ?").get(id);
  if (row) return publicBookIndexPrompts(row);
  return ensureBookIndexPrompts(id);
}

export function updateBookIndexPrompts(bookId, payload = {}) {
  const current = getBookIndexPrompts(bookId);
  const next = {
    l1_index_prompt: Object.hasOwn(payload, "l1_index_prompt")
      ? normalizeIndexPrompt(payload.l1_index_prompt, current.l1_index_prompt)
      : current.l1_index_prompt,
    l2_index_prompt: Object.hasOwn(payload, "l2_index_prompt")
      ? normalizeIndexPrompt(payload.l2_index_prompt, current.l2_index_prompt)
      : current.l2_index_prompt
  };
  db.prepare(`
    UPDATE book_index_prompts
    SET l1_index_prompt = ?, l2_index_prompt = ?, updated_at = ?
    WHERE book_id = ?
  `).run(next.l1_index_prompt, next.l2_index_prompt, nowIso(), normalizeBookId(bookId));
  ensureBaseIndexGroup(bookId);
  return getBookIndexPrompts(bookId);
}

export function ensureBaseIndexGroup(bookId) {
  const id = normalizeBookId(bookId);
  const prompts = getBookIndexPrompts(id);
  const now = nowIso();
  const current = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, BASE_INDEX_GROUP_KEY);
  if (!current) {
    db.prepare(`
      INSERT INTO book_index_groups (
        book_id, group_key, name, description, category_scope, trigger_keywords,
        l2_index_prompt, enabled, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      BASE_INDEX_GROUP_KEY,
      "专项事实索引",
      "书籍级专项事实索引，兼容历史迁移数据。",
      JSON.stringify([]),
      JSON.stringify([]),
      prompts.l2_index_prompt,
      now,
      now
    );
  } else if (current.l2_index_prompt !== prompts.l2_index_prompt || current.name !== "专项事实索引" || current.description !== "书籍级专项事实索引，兼容历史迁移数据。") {
    db.prepare(`
      UPDATE book_index_groups
      SET name = ?, description = ?, l2_index_prompt = ?, enabled = 1, updated_at = ?
      WHERE book_id = ? AND group_key = ?
    `).run("专项事实索引", "书籍级专项事实索引，兼容历史迁移数据。", prompts.l2_index_prompt, now, id, BASE_INDEX_GROUP_KEY);
  }
  return getBookIndexGroup(id, BASE_INDEX_GROUP_KEY);
}

export function listBookIndexGroups(bookId, { includeDisabled = false, includeStats = false } = {}) {
  const id = normalizeBookId(bookId);
  ensureBaseIndexGroup(id);
  const rows = db.prepare(`
    SELECT *
    FROM book_index_groups
    WHERE book_id = ? ${includeDisabled ? "" : "AND enabled = 1"}
    ORDER BY CASE WHEN group_key = ? THEN 0 ELSE 1 END, updated_at DESC
  `).all(id, BASE_INDEX_GROUP_KEY);
  const groups = rows.map(publicBookIndexGroup);
  if (!includeStats) return groups;
  const statsByGroup = listBookIndexGroupStats(id);
  return groups.map((group) => ({
    ...group,
    stats: statsByGroup.get(group.group_key) || { facts_count: 0, built_chapters: 0, failed_chapters: 0 }
  }));
}

/**
 * 按索引组聚合 L2 统计：facts_count 取 l2_facts 完成行计数，
 * built/failed_chapters 取 l2_chapter_statuses 的组×章状态聚合。
 * 供 index-groups?include_stats=1 的抽屉列表使用；返回 Map<groupKey, stats>。
 */
export function listBookIndexGroupStats(bookId) {
  const id = normalizeBookId(bookId);
  const stats = new Map();
  const ensure = (key) => {
    const groupKey = normalizeIndexGroupKey(key);
    if (!stats.has(groupKey)) stats.set(groupKey, { facts_count: 0, built_chapters: 0, failed_chapters: 0 });
    return stats.get(groupKey);
  };
  for (const row of db.prepare(`
    SELECT index_group_key, COUNT(*) AS facts_count
    FROM l2_facts
    WHERE book_id = ? AND status = 'completed'
    GROUP BY index_group_key
  `).all(id)) {
    ensure(row.index_group_key).facts_count = Number(row.facts_count || 0);
  }
  for (const row of db.prepare(`
    SELECT index_group_key,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS built_chapters,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_chapters
    FROM l2_chapter_statuses
    WHERE book_id = ?
    GROUP BY index_group_key
  `).all(id)) {
    const entry = ensure(row.index_group_key);
    entry.built_chapters = Number(row.built_chapters || 0);
    entry.failed_chapters = Number(row.failed_chapters || 0);
  }
  return stats;
}

export function getBookIndexGroup(bookId, groupKey = BASE_INDEX_GROUP_KEY) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const row = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, BASE_INDEX_GROUP_KEY);
    if (row) return publicBookIndexGroup(row);
  }
  const row = db.prepare("SELECT * FROM book_index_groups WHERE book_id = ? AND group_key = ?").get(id, key);
  return publicBookIndexGroup(row);
}

export function createBookIndexGroup(bookId, payload = {}) {
  const id = normalizeBookId(bookId);
  ensureBook(id);
  const group = normalizeBookIndexGroupPayload(payload);
  if (group.group_key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不能手动创建。");
    error.status = 409;
    throw error;
  }
  let nextGroupKey = group.group_key;
  if (getBookIndexGroup(id, nextGroupKey)) {
    nextGroupKey = resolveAvailableBookIndexGroupKey(id, nextGroupKey);
  }
  const now = nowIso();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      db.prepare(`
        INSERT INTO book_index_groups (
          book_id, group_key, name, description, category_scope, trigger_keywords,
          l2_index_prompt, enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        nextGroupKey,
        group.name,
        group.description,
        JSON.stringify(group.category_scope),
        JSON.stringify(group.trigger_keywords),
        group.l2_index_prompt,
        group.enabled ? 1 : 0,
        now,
        now
      );
      return getBookIndexGroup(id, nextGroupKey);
    } catch (error) {
      if (!isBookIndexGroupUniqueError(error) || attempt >= 1) throw error;
      nextGroupKey = resolveAvailableBookIndexGroupKey(id, nextGroupKey);
    }
  }
  const finalError = new Error("创建事实索引失败，请稍后重试。");
  finalError.status = 500;
  throw finalError;
}

export function updateBookIndexGroup(bookId, groupKey, payload = {}) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引请通过书籍 L2 Prompt 更新。");
    error.status = 409;
    throw error;
  }
  const current = getBookIndexGroup(id, key);
  if (!current) {
    const error = new Error("索引组不存在。");
    error.status = 404;
    throw error;
  }
  const group = normalizeBookIndexGroupPayload({ ...current, ...payload, group_key: key });
  db.prepare(`
    UPDATE book_index_groups
    SET name = ?, description = ?, category_scope = ?, trigger_keywords = ?,
      l2_index_prompt = ?, enabled = ?, updated_at = ?
    WHERE book_id = ? AND group_key = ?
  `).run(
    group.name,
    group.description,
    JSON.stringify(group.category_scope),
    JSON.stringify(group.trigger_keywords),
    group.l2_index_prompt,
    group.enabled ? 1 : 0,
    nowIso(),
    id,
    key
  );
  return getBookIndexGroup(id, key);
}

export function deleteBookIndexGroup(bookId, groupKey) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不可删除。");
    error.status = 409;
    throw error;
  }
  const result = db.transaction(() => {
    const deleted = db.prepare("DELETE FROM book_index_groups WHERE book_id = ? AND group_key = ?").run(id, key);
    db.prepare("DELETE FROM l2_chapter_statuses WHERE book_id = ? AND index_group_key = ?").run(id, key);
    db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ?").run(id, key);
    db.prepare("DELETE FROM l2_subjects WHERE book_id = ? AND index_group_key = ?").run(id, key);
    return deleted;
  })();
  return { deleted: result.changes > 0, bookId: id, groupKey: key };
}

export function disableBookIndexGroup(bookId, groupKey) {
  const id = normalizeBookId(bookId);
  const key = normalizeIndexGroupKey(groupKey);
  if (key === BASE_INDEX_GROUP_KEY) {
    const error = new Error("专项事实索引不可删除。");
    error.status = 409;
    throw error;
  }
  const result = db.prepare(`
    UPDATE book_index_groups
    SET enabled = 0, updated_at = ?
    WHERE book_id = ? AND group_key = ?
  `).run(nowIso(), id, key);
  return { disabled: result.changes > 0, bookId: id, groupKey: key };
}

export function createAnalysisRun({
  id,
  name,
  bookId,
  startChapter,
  endChapter,
  chapterSelection,
  model,
  reasoningEffort,
  promptHash,
  schemaHash,
  chapterCount,
  promptSnapshot
}) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO analysis_runs (
      id, name, book_id, start_chapter, end_chapter, chapter_selection,
      model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
      prompt_snapshot, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(
    id,
    normalizeAnalysisName(name, bookId, startChapter, endChapter),
    normalizeBookId(bookId),
    normalizeChapterIndex(startChapter),
    normalizeChapterIndex(endChapter),
    JSON.stringify(chapterSelection || {}),
    model,
    reasoningEffort,
    promptHash,
    schemaHash,
    chapterCount,
    promptSnapshot ? JSON.stringify(promptSnapshot) : null,
    now,
    now
  );
  return getAnalysisRun(id);
}

export function updateAnalysisRun(id, patch = {}) {
  const current = getAnalysisRun(id);
  if (!current) return null;
  const next = { ...current, ...patch, updated_at: nowIso() };
  db.prepare(`
    UPDATE analysis_runs
    SET status = ?, error_summary = ?, source_stats = ?, result = ?, updated_at = ?
    WHERE id = ?
  `).run(
    next.status,
    next.error_summary || "",
    next.source_stats || "",
    next.result || null,
    next.updated_at,
    id
  );
  return getAnalysisRun(id);
}

export function getAnalysisRun(id) {
  return db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(String(id || ""));
}

export function listAnalysisRuns(bookId) {
  if (bookId) {
    return db.prepare(`
      SELECT id, name, book_id, start_chapter, end_chapter, chapter_selection,
        model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
        error_summary, source_stats, created_at, updated_at
      FROM analysis_runs
      WHERE book_id = ?
      ORDER BY created_at DESC
    `).all(normalizeBookId(bookId));
  }

  return db.prepare(`
    SELECT id, name, book_id, start_chapter, end_chapter, chapter_selection,
      model, reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
      error_summary, source_stats, created_at, updated_at
    FROM analysis_runs
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
}

export function deleteAnalysisRun(id) {
  const result = db.prepare("DELETE FROM analysis_runs WHERE id = ?").run(String(id || ""));
  return { deleted: result.changes > 0, id: String(id || "") };
}

export function saveL1ChapterIndex({ bookId, chapterIndex, status, sourceHash, model, promptHash, value = {}, errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  const routeValue = normalizeL1RouteValue(value);
  db.prepare(`
    INSERT INTO l1_chapter_indexes (
      book_id, chapter_index, status, source_hash, model, prompt_hash,
      summary, keywords, entities, key_events, items_places_orgs, open_questions,
      route_schema_version, route_summary, route_entities, route_keywords, signals,
      category_scores, has_major_signal, confidence, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hash = excluded.source_hash,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      summary = excluded.summary,
      keywords = excluded.keywords,
      entities = excluded.entities,
      key_events = excluded.key_events,
      items_places_orgs = excluded.items_places_orgs,
      open_questions = excluded.open_questions,
      route_schema_version = excluded.route_schema_version,
      route_summary = excluded.route_summary,
      route_entities = excluded.route_entities,
      route_keywords = excluded.route_keywords,
      signals = excluded.signals,
      category_scores = excluded.category_scores,
      has_major_signal = excluded.has_major_signal,
      confidence = excluded.confidence,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    index,
    String(status || "pending"),
    String(sourceHash || ""),
    String(model || ""),
    String(promptHash || ""),
    routeValue.summary,
    stringifyJsonArray(routeValue.keywords),
    stringifyJsonArray(routeValue.entities),
    stringifyJsonArray(value.key_events),
    stringifyJsonArray(value.items_places_orgs),
    stringifyJsonArray(value.open_questions),
    routeValue.route_schema_version,
    "",
    stringifyJsonArray(routeValue.route_entities),
    stringifyJsonArray(routeValue.route_keywords),
    stringifyJsonArray(routeValue.signals),
    stringifyJsonObject(routeValue.category_scores),
    deriveRouteMajorSignal(routeValue) ? 1 : 0,
    normalizeConfidence(routeValue.confidence),
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );
  return getL1ChapterIndex(id, index);
}

export function getL1ChapterIndex(bookId, chapterIndex) {
  const row = db.prepare(`
    SELECT *
    FROM l1_chapter_indexes
    WHERE book_id = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeChapterIndex(chapterIndex));
  return publicL1ChapterIndex(row);
}

export function listL1ChapterIndexes(bookId, startChapter, endChapter) {
  const range = normalizeRange(startChapter, endChapter);
  return db.prepare(`
    SELECT *
    FROM l1_chapter_indexes
    WHERE book_id = ? AND chapter_index BETWEEN ? AND ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId), range.startChapter, range.endChapter).map(publicL1ChapterIndex);
}

export function getL1Coverage({ bookId, startChapter, endChapter, model = "", promptHash = "" }) {
  const id = normalizeBookId(bookId);
  const range = normalizeRange(startChapter, endChapter);
  const chapters = listChapterMetadata(id)
    .filter((chapter) => chapter.chapter_index >= range.startChapter && chapter.chapter_index <= range.endChapter);
  const indexes = new Map(listL1ChapterIndexes(id, range.startChapter, range.endChapter)
    .map((entry) => [entry.chapter_index, entry]));

  const chapterStats = {
    total: chapters.length,
    completed: 0,
    failed: 0,
    missing: 0,
    outdated: 0
  };

  for (const chapter of chapters) {
    const index = indexes.get(chapter.chapter_index);
    if (!index) {
      chapterStats.missing += 1;
      continue;
    }
    const outdated = index.source_hash !== chapter.content_hash
      || (model && index.model !== model)
      || (promptHash && index.prompt_hash !== promptHash);
    if (outdated) {
      chapterStats.outdated += 1;
    } else if (index.status === "completed") {
      chapterStats.completed += 1;
    } else if (index.status === "failed") {
      chapterStats.failed += 1;
    } else {
      chapterStats.missing += 1;
    }
  }

  return {
    book_id: id,
    start_chapter: range.startChapter,
    end_chapter: range.endChapter,
    chapters: chapterStats
  };
}

export function saveL2ChapterFacts({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex, status, sourceHash, model, promptHash, schemaVersion, facts = [], candidateFacts = [], errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  const normalizedFacts = Array.isArray(facts) ? facts.map((fact) => normalizeL2Fact(fact)).filter(Boolean) : [];
  const normalizedCandidateFacts = Array.isArray(candidateFacts) ? candidateFacts.map((fact) => normalizeL2Fact(fact)).filter(Boolean) : [];

  db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?").run(id, groupKey, index);

  db.prepare(`
    INSERT INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hash, model, prompt_hash, schema_version,
      facts_count, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, index_group_key, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hash = excluded.source_hash,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      schema_version = excluded.schema_version,
      facts_count = excluded.facts_count,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    groupKey,
    index,
    String(status || "pending"),
    String(sourceHash || ""),
    String(model || ""),
    String(promptHash || ""),
    String(schemaVersion || ""),
    normalizedFacts.length,
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );

  const insertFact = db.prepare(`
    INSERT INTO l2_facts (
      id, book_id, index_group_key, chapter_index, status, source_hash, model, prompt_hash, schema_version,
      category, entity, aliases, tags, related_entities, fact_type, fact, evidence, review_note,
      importance, confidence, review_source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const entry of [
    ...normalizedFacts.map((fact) => ({ fact, status: String(status || "completed"), reviewSource: fact.review_source })),
    ...normalizedCandidateFacts.map((fact) => ({ fact, status: "candidate", reviewSource: "candidate" }))
  ]) {
    const { fact, status: factStatus, reviewSource } = entry;
    insertFact.run(
      crypto.randomUUID(),
      id,
      groupKey,
      index,
      factStatus,
      String(sourceHash || ""),
      String(model || ""),
      String(promptHash || ""),
      String(schemaVersion || ""),
      fact.category,
      fact.entity,
      stringifyJsonArray(fact.aliases),
      stringifyJsonArray(fact.tags),
      stringifyJsonArray(fact.related_entities),
      fact.fact_type,
      fact.fact,
      stringifyJsonArray(fact.evidence),
      fact.review_note,
      fact.importance,
      fact.confidence,
      reviewSource,
      now,
      now
    );
  }

  return getL2ChapterStatus(id, index, groupKey);
}

export function appendL2ChapterFacts({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex, sourceHash, model, promptHash, schemaVersion, facts = [] }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const index = normalizeChapterIndex(chapterIndex);
  const normalizedFacts = Array.isArray(facts) ? facts.map((fact) => normalizeL2Fact(fact)).filter(Boolean) : [];
  const now = nowIso();
  const insertFact = db.prepare(`
    INSERT INTO l2_facts (
      id, book_id, index_group_key, chapter_index, status, source_hash, model, prompt_hash, schema_version,
      category, entity, aliases, tags, related_entities, fact_type, fact, evidence, review_note,
      importance, confidence, review_source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'historical_rescan', ?, ?)
  `);
  for (const fact of normalizedFacts) {
    insertFact.run(
      crypto.randomUUID(), id, groupKey, index, String(sourceHash || ""), String(model || ""), String(promptHash || ""), String(schemaVersion || ""),
      fact.category, fact.entity, stringifyJsonArray(fact.aliases), stringifyJsonArray(fact.tags), stringifyJsonArray(fact.related_entities),
      fact.fact_type, fact.fact, stringifyJsonArray(fact.evidence), fact.review_note,
      fact.importance, fact.confidence, now, now
    );
  }
  return normalizedFacts.length;
}

export function saveL2ChapterStatus({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex, status, sourceHash, model, promptHash, schemaVersion, errorSummary = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const index = normalizeChapterIndex(chapterIndex);
  const now = nowIso();
  db.prepare(`
    INSERT INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hash, model, prompt_hash, schema_version,
      facts_count, error_summary, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT(book_id, index_group_key, chapter_index) DO UPDATE SET
      status = excluded.status,
      source_hash = excluded.source_hash,
      model = excluded.model,
      prompt_hash = excluded.prompt_hash,
      schema_version = excluded.schema_version,
      facts_count = excluded.facts_count,
      error_summary = excluded.error_summary,
      updated_at = excluded.updated_at
  `).run(
    id,
    groupKey,
    index,
    String(status || "pending"),
    String(sourceHash || ""),
    String(model || ""),
    String(promptHash || ""),
    String(schemaVersion || ""),
    String(errorSummary || "").slice(0, 1000),
    now,
    now
  );
  if (status !== "failed") db.prepare("DELETE FROM l2_facts WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?").run(id, groupKey, index);
  return getL2ChapterStatus(id, index, groupKey);
}

export function upsertL2Subject({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, subjectKey, canonicalName, aliases = [], creatureType = "", originalForm = "", qualificationChapter, qualificationBasis = "", qualificationEvidence = [], confidence = 0.0, status = "verified", promptHash = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  ensureBook(id);
  const key = String(subjectKey || canonicalName || "").trim().slice(0, 160);
  const name = String(canonicalName || key).trim().slice(0, 160);
  if (!key || !name) throw new Error("L2 神奇生物主体缺少稳定名称。");
  const chapter = status === "candidate" ? Math.max(0, Number(qualificationChapter) || 0) : normalizeChapterIndex(qualificationChapter);
  const subjectStatus = status === "candidate" ? "candidate" : "verified";
  const now = nowIso();
  const existing = db.prepare("SELECT aliases FROM l2_subjects WHERE book_id = ? AND index_group_key = ? AND subject_key = ?")
    .get(id, groupKey, key);
  const mergedAliases = [...new Set([
    ...parseJsonArray(existing?.aliases),
    ...normalizeStringArray(aliases, 12, 80),
    key === name ? "" : key
  ].filter(Boolean))].slice(0, 24);
  db.prepare(`
    INSERT INTO l2_subjects (
      book_id, index_group_key, subject_key, canonical_name, aliases, creature_type, original_form,
      qualification_chapter, qualification_basis, qualification_evidence, confidence, status, prompt_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, index_group_key, subject_key) DO UPDATE SET
      canonical_name = excluded.canonical_name,
      aliases = excluded.aliases,
      creature_type = excluded.creature_type,
      original_form = excluded.original_form,
      qualification_chapter = CASE WHEN excluded.status = 'verified' THEN excluded.qualification_chapter ELSE MIN(l2_subjects.qualification_chapter, excluded.qualification_chapter) END,
      qualification_basis = CASE WHEN l2_subjects.qualification_basis <> '' THEN l2_subjects.qualification_basis ELSE excluded.qualification_basis END,
      qualification_evidence = CASE WHEN l2_subjects.qualification_evidence <> '[]' THEN l2_subjects.qualification_evidence ELSE excluded.qualification_evidence END,
      confidence = MAX(l2_subjects.confidence, excluded.confidence),
      status = excluded.status,
      prompt_hash = excluded.prompt_hash,
      updated_at = excluded.updated_at
  `).run(
    id, groupKey, key, name, stringifyJsonArray(mergedAliases), String(creatureType || "").trim().slice(0, 80),
    String(originalForm || "").trim().slice(0, 200), chapter, String(qualificationBasis || "").trim().slice(0, 80),
    stringifyJsonArray(qualificationEvidence), normalizeConfidence(confidence), subjectStatus, String(promptHash || ""), now, now
  );
  return listL2Subjects({ bookId: id, indexGroupKey: groupKey, terms: [key], chapterIndex: Math.max(chapter, Number.MAX_SAFE_INTEGER), promptHash })[0] || null;
}

export function listL2Subjects({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, chapterIndex = Number.MAX_SAFE_INTEGER, terms = [], promptHash = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const values = normalizeStringArray(terms, 24, 160);
  const params = [id, groupKey, Number(chapterIndex) || Number.MAX_SAFE_INTEGER];
  const where = ["book_id = ?", "index_group_key = ?", "qualification_chapter <= ?", "status = 'verified'"];
  if (promptHash) {
    where.push("prompt_hash = ?");
    params.push(String(promptHash));
  }
  if (values.length) {
    where.push(`(${values.map(() => "LOWER(canonical_name) LIKE ? OR LOWER(subject_key) LIKE ? OR LOWER(aliases) LIKE ?").join(" OR ")})`);
    for (const value of values) {
      const pattern = `%${value.toLowerCase()}%`;
      params.push(pattern, pattern, pattern);
    }
  }
  return db.prepare(`SELECT * FROM l2_subjects WHERE ${where.join(" AND ")} ORDER BY qualification_chapter ASC, canonical_name ASC`).all(...params).map((row) => ({
    subject_key: row.subject_key,
    canonical_name: row.canonical_name,
    aliases: parseJsonArray(row.aliases),
    creature_type: row.creature_type,
    original_form: row.original_form,
    qualification_chapter: Number(row.qualification_chapter),
    qualification_basis: row.qualification_basis,
    qualification_evidence: parseJsonArray(row.qualification_evidence),
    confidence: Number(row.confidence || 0)
  }));
}

export function clearL2Subjects({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY }) {
  return db.prepare("DELETE FROM l2_subjects WHERE book_id = ? AND index_group_key = ?")
    .run(normalizeBookId(bookId), normalizeIndexGroupKey(indexGroupKey));
}

export function promoteL2CandidateFacts({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, canonicalName, aliases = [], promptHash = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const names = [...new Set([canonicalName, ...aliases].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  if (!names.length) return 0;
  const where = names.map(() => "(LOWER(entity) = ? OR LOWER(aliases) LIKE ? OR LOWER(related_entities) LIKE ? OR LOWER(tags) LIKE ?)").join(" OR ");
  const params = ["completed", "index", nowIso(), id, groupKey];
  if (promptHash) params.push(String(promptHash));
  params.push(...names.flatMap((name) => [name, `%"${name}"%`, `%"${name}"%`, `%"${name}"%`]));
  return Number(db.prepare(`
    UPDATE l2_facts
    SET status = ?, review_source = ?, updated_at = ?
    WHERE book_id = ? AND index_group_key = ? AND status = 'candidate'
      ${promptHash ? "AND prompt_hash = ?" : ""} AND (${where})
  `).run(...params).changes || 0);
}

export function getL2ChapterStatus(bookId, chapterIndex, indexGroupKey = BASE_INDEX_GROUP_KEY) {
  const row = db.prepare(`
    SELECT *
    FROM l2_chapter_statuses
    WHERE book_id = ? AND index_group_key = ? AND chapter_index = ?
  `).get(normalizeBookId(bookId), normalizeIndexGroupKey(indexGroupKey), normalizeChapterIndex(chapterIndex));
  return publicL2ChapterStatus(row);
}

export function listL2ChapterStatuses(bookId, startChapter, endChapter, indexGroupKey = BASE_INDEX_GROUP_KEY) {
  const range = normalizeRange(startChapter, endChapter);
  return db.prepare(`
    SELECT *
    FROM l2_chapter_statuses
    WHERE book_id = ? AND index_group_key = ? AND chapter_index BETWEEN ? AND ?
    ORDER BY chapter_index ASC
  `).all(normalizeBookId(bookId), normalizeIndexGroupKey(indexGroupKey), range.startChapter, range.endChapter).map(publicL2ChapterStatus);
}

export function getL2Coverage({ bookId, indexGroupKey = BASE_INDEX_GROUP_KEY, startChapter, endChapter, model = "", promptHash = "", schemaVersion = "" }) {
  const id = normalizeBookId(bookId);
  const groupKey = normalizeIndexGroupKey(indexGroupKey);
  const range = normalizeRange(startChapter, endChapter);
  const chapters = listChapterMetadata(id)
    .filter((chapter) => chapter.chapter_index >= range.startChapter && chapter.chapter_index <= range.endChapter);
  const statuses = new Map(listL2ChapterStatuses(id, range.startChapter, range.endChapter, groupKey)
    .map((entry) => [entry.chapter_index, entry]));
  const stats = {
    total: chapters.length,
    completed: 0,
    failed: 0,
    missing: 0,
    outdated: 0,
    facts: 0
  };
  const failed_chapters = [];
  for (const chapter of chapters) {
    const status = statuses.get(chapter.chapter_index);
    if (!status) {
      stats.missing += 1;
      continue;
    }
    const outdated = status.source_hash !== chapter.content_hash
      || (model && status.model !== model)
      || (promptHash && status.prompt_hash !== promptHash)
      || (schemaVersion && status.schema_version !== schemaVersion);
    if (outdated) {
      stats.outdated += 1;
    } else if (status.status === "completed") {
      stats.completed += 1;
      stats.facts += status.facts_count || 0;
    } else if (status.status === "failed") {
      stats.failed += 1;
      failed_chapters.push(status.chapter_index);
    } else {
      stats.missing += 1;
    }
  }
  return {
    book_id: id,
    index_group_key: groupKey,
    start_chapter: range.startChapter,
    end_chapter: range.endChapter,
    chapters: stats,
    failed_chapters
  };
}

export function listL2Facts({ bookId, indexGroupKeys = [BASE_INDEX_GROUP_KEY], startChapter, endChapter, chapterIndexes = [], categories = [], entity = "", entities = [], limit = 500, includeContent = true }) {
  const range = normalizeRange(startChapter, endChapter);
  const indexes = normalizeChapterIndexList(chapterIndexes)
    .filter((index) => index >= range.startChapter && index <= range.endChapter);
  const groupKeys = normalizeIndexGroupKeys(indexGroupKeys);
  const categoryList = normalizeL2Categories(categories);
  const params = [normalizeBookId(bookId), range.startChapter, range.endChapter];
  const where = ["book_id = ?", "chapter_index BETWEEN ? AND ?", "status = 'completed'"];
  where.push(`index_group_key IN (${groupKeys.map(() => "?").join(", ")})`);
  params.push(...groupKeys);
  if (indexes.length) {
    where.push(`chapter_index IN (${indexes.map(() => "?").join(", ")})`);
    params.push(...indexes);
  }
  if (categoryList.length) {
    where.push(`category IN (${categoryList.map(() => "?").join(", ")})`);
    params.push(...categoryList);
  }
  const entityQueries = normalizeEntityQueries(entity, entities);
  if (entityQueries.length) {
    where.push(`(${entityQueries.map(() => "(LOWER(entity) LIKE ? OR LOWER(aliases) LIKE ? OR LOWER(related_entities) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(fact_type) LIKE ?)").join(" OR ")})`);
    for (const entityQuery of entityQueries) {
      const pattern = `%${entityQuery}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
  }
  params.push(Math.max(1, Math.min(2000, Number.parseInt(limit, 10) || 500)));
  const rows = db.prepare(`
    SELECT *
    FROM l2_facts
    WHERE ${where.join(" AND ")}
    ORDER BY importance DESC, confidence DESC, chapter_index ASC
    LIMIT ?
  `).all(...params);

  return rows.map((row) => (includeContent ? publicL2FactWithContent(row) : publicL2Fact(row)));
}

function normalizeChapterIndexList(values) {
  const input = Array.isArray(values) ? values : [];
  const seen = new Set();
  const indexes = [];
  for (const value of input) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    indexes.push(number);
  }
  return indexes.sort((left, right) => left - right);
}

export function listL2FactMetadata({ bookId, indexGroupKeys = [BASE_INDEX_GROUP_KEY], startChapter, endChapter, categories = [], entity = "", limit = 500 }) {
  const range = normalizeRange(startChapter, endChapter);
  const groupKeys = normalizeIndexGroupKeys(indexGroupKeys);
  const categoryList = normalizeL2Categories(categories);
  const params = [normalizeBookId(bookId), range.startChapter, range.endChapter];
  const where = ["book_id = ?", "chapter_index BETWEEN ? AND ?", "status = 'completed'"];
  where.push(`index_group_key IN (${groupKeys.map(() => "?").join(", ")})`);
  params.push(...groupKeys);
  if (categoryList.length) {
    where.push(`category IN (${categoryList.map(() => "?").join(", ")})`);
    params.push(...categoryList);
  }
  const entityQuery = String(entity || "").trim().toLowerCase();
  if (entityQuery) {
    where.push("(LOWER(entity) LIKE ? OR LOWER(aliases) LIKE ? OR LOWER(related_entities) LIKE ? OR LOWER(tags) LIKE ?)");
    const pattern = `%${entityQuery}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  params.push(Math.max(1, Math.min(2000, Number.parseInt(limit, 10) || 500)));
  return db.prepare(`
    SELECT id, book_id, index_group_key, chapter_index, status, source_hash, model, prompt_hash, schema_version,
      category, entity, aliases, tags, related_entities, fact_type, importance, confidence,
      review_source, created_at, updated_at
    FROM l2_facts
    WHERE ${where.join(" AND ")}
    ORDER BY importance DESC, confidence DESC, chapter_index ASC
    LIMIT ?
  `).all(...params).map(publicL2Fact);
}

export function saveAnalysisSummaryPart({
  analysisId,
  partKey,
  parentKey = "",
  stage,
  status,
  contentHash = "",
  promptHash = "",
  schemaHash = "",
  model = "",
  reasoningEffort = "",
  inputSummary = "",
  traceSummary = null,
  result,
  errorSummary = ""
}) {
  const now = nowIso();
  const resultText = result === undefined ? null : JSON.stringify(result);
  const normalizedTraceSummary = traceSummary
    ? JSON.stringify(traceSummary).slice(0, 12000)
    : "";
  db.prepare(`
    INSERT INTO analysis_summary_parts (
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary,
      result, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id, part_key) DO UPDATE SET
      parent_key = excluded.parent_key,
      stage = excluded.stage,
      status = excluded.status,
      content_hash = excluded.content_hash,
      prompt_hash = excluded.prompt_hash,
      schema_hash = excluded.schema_hash,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      input_summary = excluded.input_summary,
      trace_summary = excluded.trace_summary,
      error_summary = excluded.error_summary,
      result = excluded.result,
      updated_at = excluded.updated_at
  `).run(
    String(analysisId || ""),
    normalizeSummaryPartKey(partKey),
    String(parentKey || ""),
    String(stage || ""),
    String(status || ""),
    String(contentHash || ""),
    String(promptHash || ""),
    String(schemaHash || ""),
    String(model || ""),
    String(reasoningEffort || ""),
    String(inputSummary || "").slice(0, 1000),
    normalizedTraceSummary,
    String(errorSummary || "").slice(0, 1000),
    resultText,
    now,
    now
  );
  return getAnalysisSummaryPartMetadata(analysisId, partKey);
}

export function getAnalysisSummaryPartMetadata(analysisId, partKey) {
  const row = db.prepare(`
    SELECT
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary, created_at, updated_at,
      CASE WHEN result IS NOT NULL AND result != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_summary_parts
    WHERE analysis_id = ? AND part_key = ?
  `).get(String(analysisId || ""), normalizeSummaryPartKey(partKey));
  return publicAnalysisSummaryPart(row);
}

export function listAnalysisSummaryPartMetadata(analysisId) {
  return db.prepare(`
    SELECT
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash, schema_hash,
      model, reasoning_effort, input_summary, trace_summary, error_summary, created_at, updated_at,
      CASE WHEN result IS NOT NULL AND result != '' THEN 1 ELSE 0 END AS has_result
    FROM analysis_summary_parts
    WHERE analysis_id = ?
    ORDER BY part_key ASC
  `).all(String(analysisId || "")).map(publicAnalysisSummaryPart);
}

export function getAnalysisSummaryPartResult(analysisId, partKey) {
  const row = db.prepare(`
    SELECT result
    FROM analysis_summary_parts
    WHERE analysis_id = ? AND part_key = ?
  `).get(String(analysisId || ""), normalizeSummaryPartKey(partKey));
  if (!row?.result) return null;
  return JSON.parse(row.result);
}

export function saveFinalAnalysisResult(analysisId, result) {
  return updateAnalysisRun(analysisId, {
    status: "completed",
    result: JSON.stringify(result)
  });
}

export function getFinalAnalysisResult(analysisId) {
  const row = getAnalysisRun(analysisId);
  if (!row?.result) return null;
  return JSON.parse(row.result);
}

export function getAnalysisPromptSnapshot(analysisId) {
  const row = getAnalysisRun(analysisId);
  if (!row?.prompt_snapshot) return null;
  return JSON.parse(row.prompt_snapshot);
}

export function normalizeBookId(bookId) {
  const value = String(bookId || "").trim();
  if (!value) {
    const error = new Error("book_id 不能为空。");
    error.status = 400;
    throw error;
  }
  return value;
}

export function normalizeBookName(bookName) {
  return String(bookName || "").trim().slice(0, 120);
}

export function normalizeChapterIndex(value) {
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index) || index <= 0) {
    const error = new Error("章节编号必须是大于 0 的整数。");
    error.status = 400;
    throw error;
  }
  return index;
}

export function normalizeRange(startChapter, endChapter) {
  const start = normalizeChapterIndex(startChapter);
  const end = normalizeChapterIndex(endChapter);
  return {
    startChapter: start,
    endChapter: end < start ? start : end,
    total: Math.max(1, (end < start ? start : end) - start + 1)
  };
}

export function l1IndexPromptHash(settings = promptSettingsRow()) {
  return isDefaultL1IndexPrompt(settings.l1_index_prompt)
    ? DEFAULT_L1_INDEX_PROMPT_HASH
    : sha256(`l1-route-v1\n${settings.l1_index_prompt}`);
}

export function l2IndexPromptHash(settings = promptSettingsRow()) {
  return isDefaultL2IndexPrompt(settings.l2_index_prompt)
    ? DEFAULT_L2_INDEX_PROMPT_HASH
    : sha256(`l2-index-v2\n${settings.l2_index_prompt}`);
}

export function bookL1IndexPromptHash(bookPrompts = promptSettingsRow()) {
  return isDefaultL1IndexPrompt(bookPrompts.l1_index_prompt)
    ? DEFAULT_L1_INDEX_PROMPT_HASH
    : sha256(`book-l1-route-v1\n${bookPrompts.l1_index_prompt}`);
}

export function bookL2IndexPromptHash(bookPrompts = promptSettingsRow()) {
  return isDefaultL2IndexPrompt(bookPrompts.l2_index_prompt)
    ? DEFAULT_L2_INDEX_PROMPT_HASH
    : sha256(`book-l2-index-v1\n${bookPrompts.l2_index_prompt}`);
}

export function indexGroupL2PromptHash(group = {}) {
  const prompt = normalizeIndexPrompt(group.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT);
  if (normalizeIndexGroupKey(group.group_key) === BASE_INDEX_GROUP_KEY) {
    return isDefaultL2IndexPrompt(prompt)
      ? DEFAULT_L2_INDEX_PROMPT_HASH
      : sha256(`book-l2-index-v1\n${prompt}`);
  }
  return sha256(`book-l2-index-group-v1\n${normalizeIndexGroupKey(group.group_key)}\n${prompt}`);
}

function promptSettingsRow() {
  const row = db.prepare("SELECT * FROM prompt_settings WHERE id = 'default'").get();
  return {
    l1_index_prompt: normalizeIndexPrompt(row?.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
    l2_index_prompt: normalizeIndexPrompt(row?.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT),
    updated_at: row?.updated_at || ""
  };
}

function normalizeIndexPrompt(value, fallback) {
  const prompt = String(value || fallback || "").trim();
  return prompt || fallback;
}

function isDefaultL1IndexPrompt(value) {
  return normalizeIndexPrompt(value, DEFAULT_L1_INDEX_PROMPT) === DEFAULT_L1_INDEX_PROMPT;
}

function isDefaultL2IndexPrompt(value) {
  return normalizeIndexPrompt(value, DEFAULT_L2_INDEX_PROMPT) === DEFAULT_L2_INDEX_PROMPT;
}

function seedDefaultPrompts() {
  const exists = db.prepare("SELECT id FROM prompt_settings WHERE id = 'default'").get();
  if (exists) return;
  db.prepare(`
    INSERT INTO prompt_settings (id, l1_index_prompt, l2_index_prompt, updated_at)
    VALUES ('default', ?, ?, ?)
  `).run(DEFAULT_L1_INDEX_PROMPT, DEFAULT_L2_INDEX_PROMPT, nowIso());
}

function assertPlaintextSchema() {
  const chapters = db.prepare("PRAGMA table_info(chapters)").all();
  if (chapters.length && !chapters.some((entry) => entry.name === "content")) {
    throw new Error("数据库为旧版加密格式，本版本已改为明文存储且不再兼容。请备份后删除数据目录中的 novel-chapters.sqlite 再启动。");
  }
  const runs = db.prepare("PRAGMA table_info(analysis_runs)").all();
  if (runs.length && !runs.some((entry) => entry.name === "result")) {
    throw new Error("数据库为旧版加密格式，本版本已改为明文存储且不再兼容。请备份后删除数据目录中的 novel-chapters.sqlite 再启动。");
  }
}

function publicBookIndexPrompts(row) {
  if (!row) return null;
  const prompts = {
    ...row,
    l1_index_prompt: normalizeIndexPrompt(row.l1_index_prompt, DEFAULT_L1_INDEX_PROMPT),
    l2_index_prompt: normalizeIndexPrompt(row.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT)
  };
  return {
    ...prompts,
    l1_index_prompt_hash: bookL1IndexPromptHash(prompts),
    l2_index_prompt_hash: bookL2IndexPromptHash(prompts)
  };
}

function publicBookIndexGroup(row) {
  if (!row) return null;
  const group = {
    ...row,
    group_key: normalizeIndexGroupKey(row.group_key),
    category_scope: parseJsonArray(row.category_scope),
    trigger_keywords: parseJsonArray(row.trigger_keywords),
    l2_index_prompt: normalizeIndexPrompt(row.l2_index_prompt, DEFAULT_L2_INDEX_PROMPT),
    enabled: Boolean(row.enabled)
  };
  return {
    ...group,
    l2_index_prompt_hash: indexGroupL2PromptHash(group)
  };
}

function normalizeAnalysisName(name, bookId, startChapter, endChapter) {
  const value = String(name || "").trim();
  if (value) return value.slice(0, 120);
  return `${normalizeBookId(bookId)} ${normalizeChapterIndex(startChapter)}-${normalizeChapterIndex(endChapter)}`;
}

function publicL1ChapterIndex(row) {
  if (!row) return null;
  const rest = { ...row };
  delete rest.route_summary;
  delete rest.confidence;
  delete rest.has_major_signal;
  return {
    ...rest,
    keywords: parseJsonArray(row.keywords),
    entities: parseJsonArray(row.entities),
    key_events: parseJsonArray(row.key_events),
    items_places_orgs: parseJsonArray(row.items_places_orgs),
    open_questions: parseJsonArray(row.open_questions),
    route_schema_version: row.route_schema_version || "",
    route_entities: parseJsonArray(row.route_entities),
    route_keywords: parseJsonArray(row.route_keywords),
    signals: parseJsonArray(row.signals),
    category_scores: parseJsonObject(row.category_scores)
  };
}

function publicL2ChapterStatus(row) {
  if (!row) return null;
  return {
    ...row,
    index_group_key: normalizeIndexGroupKey(row.index_group_key),
    facts_count: Number(row.facts_count || 0)
  };
}

function publicL2Fact(row) {
  if (!row) return null;
  return {
    id: row.id,
    book_id: row.book_id,
    index_group_key: normalizeIndexGroupKey(row.index_group_key),
    chapter_index: row.chapter_index,
    status: row.status,
    source_hash: row.source_hash,
    model: row.model,
    prompt_hash: row.prompt_hash,
    schema_version: row.schema_version,
    category: row.category,
    entity: row.entity,
    aliases: parseJsonArray(row.aliases),
    tags: parseJsonArray(row.tags),
    related_entities: parseJsonArray(row.related_entities),
    fact_type: row.fact_type,
    importance: Number(row.importance || 0),
    confidence: Number(row.confidence || 0),
    review_source: row.review_source,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function publicAnalysisSummaryPart(row) {
  if (!row) return null;
  return {
    analysis_id: row.analysis_id,
    part_key: row.part_key,
    parent_key: row.parent_key || "",
    stage: row.stage,
    status: row.status,
    content_hash: row.content_hash || "",
    prompt_hash: row.prompt_hash || "",
    schema_hash: row.schema_hash || "",
    model: row.model || "",
    reasoning_effort: row.reasoning_effort || "",
    input_summary: row.input_summary || "",
    trace_summary: parseJsonObject(row.trace_summary),
    error_summary: row.error_summary || "",
    has_result: Boolean(row.has_result),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function publicL2FactWithContent(row) {
  return {
    ...publicL2Fact(row),
    fact: String(row.fact || ""),
    evidence: parseJsonArray(row.evidence),
    review_note: String(row.review_note || "")
  };
}

function stringifyJsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function stringifyJsonObject(value) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return {};
  }
}

function countRows(table, where = "", params = []) {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return Number(db.prepare(sql).get(...params)?.count || 0);
}

function countStatuses(table) {
  return Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM ${table}
    GROUP BY status
    ORDER BY status ASC
  `).all().map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function countStatusesForBook(table, bookId) {
  return Object.fromEntries(db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM ${table}
    WHERE book_id = ?
    GROUP BY status
    ORDER BY status ASC
  `).all(normalizeBookId(bookId)).map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

const L2_CATEGORIES = new Set([
  "character",
  "relationship",
  "cultivation",
  "force",
  "item",
  "magical_creature",
  "location",
  "event",
  "foreshadowing",
  "other"
]);

const L1_ROUTE_SCHEMA_VERSION = "l1-route-v1";

function normalizeL1RouteValue(value = {}) {
  const routeEntities = normalizeRouteEntities(value.route_entities ?? value.entities ?? []);
  const routeKeywords = normalizeStringArray(value.route_keywords ?? value.keywords ?? [], 24, 80);
  const signals = normalizeRouteSignals(value.signals ?? []);
  const categoryScores = normalizeRouteCategoryScores(value.category_scores ?? {}, signals);
  return {
    summary: String(value.summary ?? "").trim().slice(0, 1000),
    keywords: normalizeStringArray(value.keywords ?? routeKeywords, 24, 80),
    entities: normalizeRouteEntities(value.entities ?? routeEntities),
    route_schema_version: String(value.route_schema_version || L1_ROUTE_SCHEMA_VERSION).trim().slice(0, 40),
    route_entities: routeEntities,
    route_keywords: routeKeywords,
    signals,
    category_scores: categoryScores
  };
}

function deriveRouteMajorSignal(routeValue) {
  const signals = Array.isArray(routeValue?.signals) ? routeValue.signals : [];
  const scores = routeValue?.category_scores && typeof routeValue.category_scores === "object"
    ? routeValue.category_scores
    : {};
  if (signals.some((signal) => Number(signal?.strength || 0) >= 0.72)) return true;
  return Object.values(scores).some((score) => Number(score || 0) >= 0.8);
}

function normalizeRouteEntities(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((entry) => {
    if (typeof entry === "string") {
      return {
        name: entry.trim().slice(0, 120),
        type: "",
        aliases: [],
        role: "",
        note: ""
      };
    }
    if (!entry || typeof entry !== "object") return null;
    const name = String(entry.name || "").trim().slice(0, 120);
    if (!name) return null;
    return {
      name,
      type: String(entry.type || "").trim().slice(0, 60),
      aliases: normalizeStringArray(entry.aliases, 12, 80),
      role: String(entry.role || "").trim().slice(0, 80),
      note: String(entry.note || "").trim().slice(0, 160)
    };
  }).filter(Boolean).slice(0, 24);
}

function normalizeRouteSignals(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const category = normalizeL2Category(entry.category);
    const reason = String(entry.reason || "").trim().slice(0, 160);
    const entities = normalizeStringArray(entry.entities, 12, 120);
    const keywords = normalizeStringArray(entry.keywords, 12, 80);
    if (!reason && !entities.length && !keywords.length) return null;
    return {
      category,
      strength: normalizeConfidence(entry.strength),
      entities,
      keywords,
      reason
    };
  }).filter(Boolean).slice(0, 16);
}

function normalizeRouteCategoryScores(value, signals = []) {
  const scores = {};
  for (const category of L2_CATEGORIES) {
    const raw = Number(value?.[category]);
    const signalStrength = Math.max(0, ...signals
      .filter((signal) => signal.category === category)
      .map((signal) => Number(signal.strength || 0)));
    scores[category] = normalizeConfidence(Number.isFinite(raw) ? Math.max(raw, signalStrength) : signalStrength);
  }
  return scores;
}

function normalizeL2Fact(value) {
  if (!value || typeof value !== "object") return null;
  const fact = String(value.fact || "").trim();
  const entity = String(value.entity || "").trim().slice(0, 120);
  const category = normalizeL2Category(value.category);
  if (!fact && !entity) return null;
  return {
    category,
    entity,
    aliases: normalizeStringArray(value.aliases, 12, 80),
    tags: normalizeStringArray(value.tags, 12, 80),
    related_entities: normalizeStringArray(value.related_entities, 12, 120),
    fact_type: String(value.fact_type || category).trim().slice(0, 80),
    fact,
    evidence: normalizeStringArray(value.evidence, 8, 300),
    importance: normalizeConfidence(value.importance),
    confidence: normalizeConfidence(value.confidence),
    review_source: ["index", "source_review"].includes(value.review_source) ? value.review_source : "index",
    review_note: String(value.review_note || "").trim().slice(0, 1000)
  };
}

function normalizeL2Category(value) {
  const category = String(value || "other").trim().toLowerCase();
  return L2_CATEGORIES.has(category) ? category : "other";
}

function normalizeL2Categories(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(raw.map(normalizeL2Category).filter(Boolean))].filter((category) => category !== "other" || raw.some((entry) => String(entry).trim().toLowerCase() === "other"));
}

function normalizeBookIndexGroupPayload(payload = {}) {
  const groupKey = normalizeIndexGroupKey(payload.group_key ?? payload.groupKey ?? payload.key);
  const prompt = normalizeIndexPrompt(payload.l2_index_prompt ?? payload.l2IndexPrompt, DEFAULT_L2_INDEX_PROMPT);
  return {
    group_key: groupKey,
    name: String(payload.name || groupKey).trim().slice(0, 80) || groupKey,
    description: String(payload.description || "").trim().slice(0, 500),
    category_scope: normalizeL2Categories(payload.category_scope ?? payload.categoryScope ?? []),
    trigger_keywords: normalizeStringArray(payload.trigger_keywords ?? payload.triggerKeywords ?? [], 40, 80),
    l2_index_prompt: prompt,
    enabled: payload.enabled === undefined ? true : Boolean(payload.enabled)
  };
}

export function normalizeIndexGroupKey(value) {
  const raw = String(value || BASE_INDEX_GROUP_KEY).trim().toLowerCase();
  const key = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return key || BASE_INDEX_GROUP_KEY;
}

function isBookIndexGroupUniqueError(error) {
  const message = String(error?.message || "");
  return error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    || error?.code === "SQLITE_CONSTRAINT_UNIQUE"
    || message.includes("UNIQUE constraint failed: book_index_groups.book_id, book_index_groups.group_key");
}

function resolveAvailableBookIndexGroupKey(bookId, rawKey) {
  const id = normalizeBookId(bookId);
  const baseKey = normalizeIndexGroupKey(rawKey);
  const rows = db.prepare("SELECT group_key FROM book_index_groups WHERE book_id = ?").all(id);
  const used = new Set(rows.map((row) => normalizeIndexGroupKey(row.group_key)));
  if (!used.has(baseKey)) return baseKey;
  for (let index = 2; index <= 999; index += 1) {
    const candidate = normalizeIndexGroupKey(`${baseKey}-${index}`);
    if (!used.has(candidate)) return candidate;
  }
  return normalizeIndexGroupKey(`${baseKey}-${Date.now()}`);
}

function normalizeIndexGroupKeys(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s]+/);
  const keys = [...new Set(raw.map(normalizeIndexGroupKey).filter(Boolean))];
  return keys.length ? keys : [BASE_INDEX_GROUP_KEY];
}

function normalizeEntityQueries(entity, entities) {
  const values = [
    entity,
    ...(Array.isArray(entities) ? entities : [])
  ];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.slice(0, 8);
}

function normalizeStringArray(value, maxItems, maxChars) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => String(entry || "").trim().slice(0, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSummaryPartKey(value) {
  const key = String(value || "").trim();
  if (!key) {
    const error = new Error("summary part key 不能为空。");
    error.status = 400;
    throw error;
  }
  return key.slice(0, 240);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
