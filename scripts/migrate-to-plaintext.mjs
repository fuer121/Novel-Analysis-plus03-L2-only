#!/usr/bin/env node
/**
 * 一次性迁移脚本：旧版 AES-256-GCM 加密 SQLite 库 → 新版明文 SQLite 库。
 *
 * 用法：
 *   node scripts/migrate-to-plaintext.mjs --source <旧库路径> --target <新库路径> \
 *     [--key-file <base64 密钥文件>] [--keychain-service <名称>] [--keychain-account <账户>]
 *
 * 密钥解析优先级：--key-file > NOVEL_MASTER_KEY 环境变量 > macOS Keychain
 * （默认 service "novel-chapter-gpt-service" / account "master-key"，与旧版 server/crypto.js 一致）。
 *
 * 行为：
 * - target 已存在时直接报错退出，绝不覆盖。
 * - source 缺少加密列（chapters.ciphertext / analysis_runs.ciphertext / l2_facts.ciphertext）
 *   时判定"不是旧版加密库"并退出。
 * - 仅迁移 l2_query 类型的 analysis_runs（依据解密后 prompt 快照的 analysis_mode 字段），
 *   其余 run 连同其 summary parts 一起跳过。
 * - analysis_chapters / prompt_groups / l1_window_indexes 三张表在新版中已废弃，不迁移。
 * - 旧 source_hmac 列统一回填为对应章节新 content_hash（sha256(明文)），查不到章节时留空。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_KEYCHAIN_SERVICE = "novel-chapter-gpt-service";
const DEFAULT_KEYCHAIN_ACCOUNT = "master-key";

function usage() {
  return [
    "用法：node scripts/migrate-to-plaintext.mjs --source <旧库> --target <新库> [选项]",
    "",
    "必填：",
    "  --source <路径>            旧版加密 SQLite 库",
    "  --target <路径>            新版明文 SQLite 库（必须不存在）",
    "选项：",
    "  --key-file <路径>          包含 base64 主密钥的文件",
    "  --keychain-service <名称>  Keychain service（默认 novel-chapter-gpt-service）",
    "  --keychain-account <账户>  Keychain account（默认 master-key）",
    "  -h, --help                 显示帮助"
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    source: "",
    target: "",
    keyFile: "",
    keychainService: DEFAULT_KEYCHAIN_SERVICE,
    keychainAccount: DEFAULT_KEYCHAIN_ACCOUNT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    const next = argv[index + 1];
    switch (arg) {
      case "--source": options.source = next || ""; break;
      case "--target": options.target = next || ""; break;
      case "--key-file": options.keyFile = next || ""; break;
      case "--keychain-service": options.keychainService = next || ""; break;
      case "--keychain-account": options.keychainAccount = next || ""; break;
      default:
        throw new Error(`未知参数：${arg}\n${usage()}`);
    }
    index += 1;
  }
  if (!options.source || !options.target) {
    throw new Error(`--source 与 --target 均为必填。\n${usage()}`);
  }
  return options;
}

function decodeKey(value) {
  const key = Buffer.from(String(value || "").trim(), "base64");
  if (key.length !== 32) {
    throw new Error("主密钥必须是 32 字节的 base64 编码字符串。");
  }
  return key;
}

function resolveMasterKey(options) {
  if (options.keyFile) {
    return decodeKey(fs.readFileSync(options.keyFile, "utf8"));
  }
  if (process.env.NOVEL_MASTER_KEY) {
    return decodeKey(process.env.NOVEL_MASTER_KEY);
  }
  try {
    const stdout = execFileSync("security", [
      "find-generic-password",
      "-s", options.keychainService,
      "-a", options.keychainAccount,
      "-w"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return decodeKey(stdout);
  } catch {
    throw new Error(
      "未找到主密钥：请通过 --key-file 或 NOVEL_MASTER_KEY 提供，" +
      `或确认 Keychain 中存在 service=${options.keychainService} account=${options.keychainAccount} 的条目。`
    );
  }
}

function decryptText(masterKey, payload, aad = "") {
  if (!payload?.ciphertext || !payload?.iv || !payload?.tag) {
    throw new Error("密文结构不完整，无法解密。");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(payload.iv, "base64")
  );
  if (aad) decipher.setAAD(Buffer.from(String(aad), "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

// AAD 规则与旧版 server/db.js 保持一致
const chapterAad = (bookId, chapterIndex) => `chapter:${bookId}:${chapterIndex}`;
const analysisRunAad = (analysisId) => `analysis-final:${analysisId}`;
const analysisPromptAad = (analysisId) => `analysis-prompt:${analysisId}`;
const analysisSummaryPartAad = (analysisId, partKey) =>
  `analysis-summary-part:${analysisId}:${String(partKey || "").trim().slice(0, 240)}`;
const l2FactAad = (factId) => `l2-fact:${factId}`;

// 新版明文 schema，需与 server/db.js 中的 DDL 保持同步
const NEW_SCHEMA_SQL = `
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
`;

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table));
}

function assertEncryptedSource(sourceDb) {
  const required = [
    ["chapters", "ciphertext"],
    ["analysis_runs", "ciphertext"],
    ["l2_facts", "ciphertext"]
  ];
  for (const [table, column] of required) {
    if (!tableExists(sourceDb, table) || !tableColumns(sourceDb, table).includes(column)) {
      throw new Error(
        `源库缺少 ${table}.${column}，不是旧版加密库，无需迁移（或路径错误）。`
      );
    }
  }
}

function normalizePromptSnapshot(snapshot) {
  // 旧版快照形状：{ ...settings, index_group_keys, use_l1_context, analysis_mode, source_review_budget, l2_query }
  // 新版仅保留 l2_query 三要素
  return {
    analysis_mode: "l2_query",
    query: String(snapshot?.l2_query?.query ?? snapshot?.query ?? ""),
    index_group_keys: Array.isArray(snapshot?.index_group_keys) ? snapshot.index_group_keys : []
  };
}

function migrate(options, masterKey) {
  const sourceDb = new DatabaseSync(options.source, { readOnly: true });
  assertEncryptedSource(sourceDb);

  fs.mkdirSync(path.dirname(path.resolve(options.target)), { recursive: true });
  const targetDb = new DatabaseSync(options.target);
  targetDb.exec(NEW_SCHEMA_SQL);

  const stats = {
    books: 0,
    chapters: 0,
    prompt_settings: 0,
    book_index_prompts: 0,
    book_index_groups: 0,
    analysis_runs_migrated: 0,
    analysis_runs_skipped: 0,
    analysis_summary_parts: 0,
    l1_chapter_indexes: 0,
    l2_chapter_statuses: 0,
    l2_facts: 0,
    l2_subjects: 0
  };
  const warnings = [];

  const contentHashByChapter = new Map();
  const chapterHashKey = (bookId, chapterIndex) => `${bookId}${chapterIndex}`;
  const sourceHashFor = (bookId, chapterIndex) =>
    contentHashByChapter.get(chapterHashKey(bookId, chapterIndex)) || "";

  targetDb.exec("BEGIN");
  try {
    // books
    const insertBook = targetDb.prepare(`
      INSERT INTO books (book_id, book_name, created_at, updated_at, last_import_status)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of sourceDb.prepare("SELECT * FROM books").all()) {
      insertBook.run(row.book_id, row.book_name, row.created_at, row.updated_at, row.last_import_status);
      stats.books += 1;
    }

    // chapters：解密正文，content_hash 改为 sha256(明文)
    const insertChapter = targetDb.prepare(`
      INSERT INTO chapters (
        book_id, chapter_index, title, content, content_length, content_hash,
        fetch_status, fetched_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of sourceDb.prepare("SELECT * FROM chapters ORDER BY book_id, chapter_index").all()) {
      const content = decryptText(masterKey, row, chapterAad(row.book_id, row.chapter_index));
      const contentHash = sha256(content);
      insertChapter.run(
        row.book_id, row.chapter_index, row.title, content, content.length, contentHash,
        row.fetch_status, row.fetched_at, row.updated_at
      );
      contentHashByChapter.set(chapterHashKey(row.book_id, row.chapter_index), contentHash);
      stats.chapters += 1;
    }

    // prompt_settings：旧列很多，仅保留 l1/l2 索引提示词
    if (tableExists(sourceDb, "prompt_settings")) {
      const insertPromptSettings = targetDb.prepare(`
        INSERT INTO prompt_settings (id, l1_index_prompt, l2_index_prompt, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM prompt_settings").all()) {
        insertPromptSettings.run(
          row.id,
          row.l1_index_prompt || "",
          row.l2_index_prompt || "",
          row.updated_at
        );
        stats.prompt_settings += 1;
      }
    }

    // book_index_prompts / book_index_groups：明文，原样复制
    if (tableExists(sourceDb, "book_index_prompts")) {
      const insertBookPrompts = targetDb.prepare(`
        INSERT INTO book_index_prompts (book_id, l1_index_prompt, l2_index_prompt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM book_index_prompts").all()) {
        insertBookPrompts.run(row.book_id, row.l1_index_prompt, row.l2_index_prompt, row.created_at, row.updated_at);
        stats.book_index_prompts += 1;
      }
    }
    if (tableExists(sourceDb, "book_index_groups")) {
      const insertGroup = targetDb.prepare(`
        INSERT INTO book_index_groups (
          book_id, group_key, name, description, category_scope, trigger_keywords,
          l2_index_prompt, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM book_index_groups").all()) {
        insertGroup.run(
          row.book_id, row.group_key, row.name, row.description, row.category_scope,
          row.trigger_keywords, row.l2_index_prompt, row.enabled, row.created_at, row.updated_at
        );
        stats.book_index_groups += 1;
      }
    }

    // analysis_runs：仅迁移 l2_query；解密 prompt 快照与最终结果
    const insertRun = targetDb.prepare(`
      INSERT INTO analysis_runs (
        id, name, book_id, start_chapter, end_chapter, chapter_selection, model,
        reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
        error_summary, source_stats, prompt_snapshot, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const migratedRunIds = new Set();
    for (const row of sourceDb.prepare("SELECT * FROM analysis_runs").all()) {
      let snapshot = null;
      if (row.prompt_ciphertext) {
        try {
          snapshot = JSON.parse(decryptText(masterKey, {
            ciphertext: row.prompt_ciphertext,
            iv: row.prompt_iv,
            tag: row.prompt_tag
          }, analysisPromptAad(row.id)));
        } catch (error) {
          warnings.push(`analysis_runs ${row.id}：prompt 快照解密失败，已跳过（${error.message}）`);
        }
      }
      if (!snapshot || snapshot.analysis_mode !== "l2_query") {
        stats.analysis_runs_skipped += 1;
        continue;
      }
      let result = null;
      if (row.ciphertext) {
        try {
          result = decryptText(masterKey, row, analysisRunAad(row.id));
        } catch (error) {
          warnings.push(`analysis_runs ${row.id}：最终结果解密失败，结果置空（${error.message}）`);
        }
      }
      insertRun.run(
        row.id, row.name, row.book_id, row.start_chapter, row.end_chapter,
        row.chapter_selection, row.model, row.reasoning_effort, row.prompt_hash,
        row.schema_hash, row.status, row.chapter_count, row.error_summary,
        row.source_stats, JSON.stringify(normalizePromptSnapshot(snapshot)), result,
        row.created_at, row.updated_at
      );
      migratedRunIds.add(row.id);
      stats.analysis_runs_migrated += 1;
    }

    // analysis_summary_parts：只跟随已迁移的 run；解密 result
    if (tableExists(sourceDb, "analysis_summary_parts")) {
      const insertPart = targetDb.prepare(`
        INSERT INTO analysis_summary_parts (
          analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash,
          schema_hash, model, reasoning_effort, input_summary, trace_summary,
          error_summary, result, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM analysis_summary_parts").all()) {
        if (!migratedRunIds.has(row.analysis_id)) continue;
        let result = null;
        if (row.ciphertext) {
          try {
            result = decryptText(masterKey, row, analysisSummaryPartAad(row.analysis_id, row.part_key));
          } catch (error) {
            warnings.push(`analysis_summary_parts ${row.analysis_id}/${row.part_key}：解密失败，结果置空（${error.message}）`);
          }
        }
        insertPart.run(
          row.analysis_id, row.part_key, row.parent_key, row.stage, row.status,
          row.content_hash, row.prompt_hash, row.schema_hash, row.model,
          row.reasoning_effort, row.input_summary, row.trace_summary,
          row.error_summary, result, row.created_at, row.updated_at
        );
        stats.analysis_summary_parts += 1;
      }
    }

    // l1_chapter_indexes：明文，source_hmac → source_hash（回填新 content_hash）
    if (tableExists(sourceDb, "l1_chapter_indexes")) {
      const insertL1 = targetDb.prepare(`
        INSERT INTO l1_chapter_indexes (
          book_id, chapter_index, status, source_hash, model, prompt_hash, summary,
          keywords, entities, key_events, items_places_orgs, open_questions,
          route_schema_version, route_summary, route_entities, route_keywords, signals,
          category_scores, has_major_signal, confidence, error_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM l1_chapter_indexes").all()) {
        insertL1.run(
          row.book_id, row.chapter_index, row.status,
          sourceHashFor(row.book_id, row.chapter_index),
          row.model, row.prompt_hash, row.summary, row.keywords, row.entities,
          row.key_events, row.items_places_orgs, row.open_questions,
          row.route_schema_version, row.route_summary, row.route_entities,
          row.route_keywords, row.signals, row.category_scores, row.has_major_signal,
          row.confidence, row.error_summary, row.created_at, row.updated_at
        );
        stats.l1_chapter_indexes += 1;
      }
    }

    // l2_chapter_statuses：明文，source_hmac → source_hash
    if (tableExists(sourceDb, "l2_chapter_statuses")) {
      const insertStatus = targetDb.prepare(`
        INSERT INTO l2_chapter_statuses (
          book_id, index_group_key, chapter_index, status, source_hash, model,
          prompt_hash, schema_version, facts_count, error_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM l2_chapter_statuses").all()) {
        insertStatus.run(
          row.book_id, row.index_group_key, row.chapter_index, row.status,
          sourceHashFor(row.book_id, row.chapter_index),
          row.model, row.prompt_hash, row.schema_version, row.facts_count,
          row.error_summary, row.created_at, row.updated_at
        );
        stats.l2_chapter_statuses += 1;
      }
    }

    // l2_facts：解密 { fact, evidence, review_note } 拆成明文列，source_hmac → source_hash
    const insertFact = targetDb.prepare(`
      INSERT INTO l2_facts (
        id, book_id, index_group_key, chapter_index, status, source_hash, model,
        prompt_hash, schema_version, category, entity, aliases, tags, related_entities,
        fact_type, fact, evidence, review_note, importance, confidence, review_source,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of sourceDb.prepare("SELECT * FROM l2_facts").all()) {
      let payload = {};
      if (row.ciphertext) {
        try {
          payload = JSON.parse(decryptText(masterKey, row, l2FactAad(row.id)));
        } catch (error) {
          warnings.push(`l2_facts ${row.id}：解密失败，明文列置空（${error.message}）`);
        }
      }
      insertFact.run(
        row.id, row.book_id, row.index_group_key, row.chapter_index, row.status,
        sourceHashFor(row.book_id, row.chapter_index),
        row.model, row.prompt_hash, row.schema_version, row.category, row.entity,
        row.aliases, row.tags, row.related_entities, row.fact_type,
        String(payload.fact || ""),
        JSON.stringify(Array.isArray(payload.evidence) ? payload.evidence : []),
        String(payload.review_note || ""),
        row.importance, row.confidence, row.review_source, row.created_at, row.updated_at
      );
      stats.l2_facts += 1;
    }

    // l2_subjects：明文，原样复制
    if (tableExists(sourceDb, "l2_subjects")) {
      const insertSubject = targetDb.prepare(`
        INSERT INTO l2_subjects (
          book_id, index_group_key, subject_key, canonical_name, aliases, creature_type,
          original_form, qualification_chapter, qualification_basis, qualification_evidence,
          confidence, status, prompt_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of sourceDb.prepare("SELECT * FROM l2_subjects").all()) {
        insertSubject.run(
          row.book_id, row.index_group_key, row.subject_key, row.canonical_name,
          row.aliases, row.creature_type, row.original_form, row.qualification_chapter,
          row.qualification_basis, row.qualification_evidence, row.confidence,
          row.status, row.prompt_hash, row.created_at, row.updated_at
        );
        stats.l2_subjects += 1;
      }
    }

    targetDb.exec("COMMIT");
  } catch (error) {
    targetDb.exec("ROLLBACK");
    targetDb.close();
    sourceDb.close();
    fs.rmSync(options.target, { force: true });
    throw error;
  }

  targetDb.close();
  sourceDb.close();
  return { stats, warnings };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.source)) {
    throw new Error(`源库不存在：${options.source}`);
  }
  if (fs.existsSync(options.target)) {
    throw new Error(`目标库已存在，为避免覆盖已停止：${options.target}`);
  }
  const masterKey = resolveMasterKey(options);
  const { stats, warnings } = migrate(options, masterKey);

  console.log("迁移完成，各表行数：");
  for (const [table, count] of Object.entries(stats)) {
    console.log(`  ${table}: ${count}`);
  }
  for (const warning of warnings) {
    console.warn(`警告：${warning}`);
  }
  console.log(`新库已写入：${options.target}`);
}

try {
  main();
} catch (error) {
  console.error(`迁移失败：${error.message}`);
  process.exit(1);
}
