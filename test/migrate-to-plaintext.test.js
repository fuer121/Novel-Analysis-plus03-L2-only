import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/migrate-to-plaintext.mjs", import.meta.url));
const MASTER_KEY = Buffer.alloc(32, 7);
const MASTER_KEY_BASE64 = MASTER_KEY.toString("base64");

function encryptText(plaintext, aad = "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function hmacText(value) {
  return crypto.createHmac("sha256", MASTER_KEY).update(String(value || ""), "utf8").digest("hex");
}

const now = () => new Date().toISOString();

// 旧版加密库 schema（与旧 server/db.js 一致，仅保留迁移涉及的表与三张应跳过的表）
const OLD_SCHEMA_SQL = `
  CREATE TABLE books (
    book_id TEXT PRIMARY KEY,
    book_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_import_status TEXT NOT NULL DEFAULT 'idle'
  );
  CREATE TABLE chapters (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content_length INTEGER NOT NULL DEFAULT 0,
    content_hmac TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    fetch_status TEXT NOT NULL DEFAULT 'ok',
    fetched_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter_index)
  );
  CREATE TABLE prompt_settings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning_effort TEXT NOT NULL,
    chapter_prompt TEXT NOT NULL,
    summary_prompt TEXT NOT NULL,
    output_schema TEXT NOT NULL,
    schema_mode TEXT NOT NULL DEFAULT 'fields',
    schema_fields TEXT NOT NULL DEFAULT '[]',
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE book_index_prompts (
    book_id TEXT PRIMARY KEY,
    l1_index_prompt TEXT NOT NULL DEFAULT '',
    l2_index_prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE book_index_groups (
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
    PRIMARY KEY (book_id, group_key)
  );
  CREATE TABLE analysis_runs (
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
    prompt_ciphertext TEXT,
    prompt_iv TEXT,
    prompt_tag TEXT,
    prompt_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE analysis_chapters (
    analysis_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    content_hmac TEXT,
    prompt_hash TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    error_summary TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, chapter_index)
  );
  CREATE TABLE analysis_summary_parts (
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
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, part_key)
  );
  CREATE TABLE l1_chapter_indexes (
    book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
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
    PRIMARY KEY (book_id, chapter_index)
  );
  CREATE TABLE l1_window_indexes (
    book_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (book_id, window_start, window_end)
  );
  CREATE TABLE l2_chapter_statuses (
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    facts_count INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (book_id, index_group_key, chapter_index)
  );
  CREATE TABLE l2_facts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    index_group_key TEXT NOT NULL DEFAULT 'base',
    chapter_index INTEGER NOT NULL,
    status TEXT NOT NULL,
    source_hmac TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_hash TEXT NOT NULL DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    entity TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    related_entities TEXT NOT NULL DEFAULT '[]',
    fact_type TEXT NOT NULL DEFAULT '',
    importance REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    review_source TEXT NOT NULL DEFAULT 'index',
    ciphertext TEXT,
    iv TEXT,
    tag TEXT,
    algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE l2_subjects (
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
    PRIMARY KEY (book_id, index_group_key, subject_key)
  );
  CREATE TABLE prompt_groups (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '未分类',
    chapter_prompt TEXT NOT NULL,
    summary_prompt TEXT NOT NULL,
    index_group_keys TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const CHAPTER_1_CONTENT = "第一章明文：陈平安在泥瓶巷得到一把木剑。";
const CHAPTER_2_CONTENT = "第二章明文：木剑中藏着一缕剑灵。";
const L2_FACT_TEXT = "陈平安得到木剑，剑中藏有剑灵。";
const L2_QUERY_TEXT = "主角的飞剑有哪些？";
const RUN_RESULT_TEXT = JSON.stringify({ answer: "木剑一把，内藏剑灵。" });
const PART_RESULT_TEXT = JSON.stringify({ partial: "批次一：木剑候选。" });

function seedOldDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(OLD_SCHEMA_SQL);
  const ts = now();

  db.prepare("INSERT INTO books (book_id, book_name, created_at, updated_at, last_import_status) VALUES (?, ?, ?, ?, ?)")
    .run("book-a", "测试小说", ts, ts, "idle");

  const insertChapter = db.prepare(`
    INSERT INTO chapters (
      book_id, chapter_index, title, content_length, content_hmac,
      ciphertext, iv, tag, algorithm, fetch_status, fetched_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [chapterIndex, title, content] of [
    [1, "泥瓶巷", CHAPTER_1_CONTENT],
    [2, "剑灵", CHAPTER_2_CONTENT]
  ]) {
    const encrypted = encryptText(content, `chapter:book-a:${chapterIndex}`);
    insertChapter.run(
      "book-a", chapterIndex, title, content.length, hmacText(content),
      encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.algorithm,
      "ok", ts, ts
    );
  }

  db.prepare(`
    INSERT INTO prompt_settings (
      id, name, model, reasoning_effort, chapter_prompt, summary_prompt,
      output_schema, schema_mode, schema_fields, l1_index_prompt, l2_index_prompt, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "default", "默认", "gpt-test", "medium", "旧章节提示词", "旧汇总提示词",
    "{}", "fields", "[]", "旧 L1 索引提示词", "旧 L2 索引提示词", ts
  );

  db.prepare(`
    INSERT INTO book_index_prompts (book_id, l1_index_prompt, l2_index_prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("book-a", "书本 L1 提示词", "书本 L2 提示词", ts, ts);

  db.prepare(`
    INSERT INTO book_index_groups (
      book_id, group_key, name, description, category_scope, trigger_keywords,
      l2_index_prompt, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("book-a", "sword-special", "飞剑专项", "", "[]", "[]", "飞剑专项事实", 1, ts, ts);

  const l2QuerySnapshot = {
    model: "gpt-test",
    index_group_keys: ["sword-special"],
    use_l1_context: false,
    analysis_mode: "l2_query",
    source_review_budget: 20000,
    l2_query: { query: L2_QUERY_TEXT }
  };
  const fullTextSnapshot = {
    model: "gpt-test",
    index_group_keys: ["base"],
    use_l1_context: true,
    analysis_mode: "full_text"
  };
  const insertRun = db.prepare(`
    INSERT INTO analysis_runs (
      id, name, book_id, start_chapter, end_chapter, chapter_selection, model,
      reasoning_effort, prompt_hash, schema_hash, status, chapter_count,
      error_summary, source_stats,
      prompt_ciphertext, prompt_iv, prompt_tag, prompt_algorithm,
      ciphertext, iv, tag, algorithm, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const queryPrompt = encryptText(JSON.stringify(l2QuerySnapshot), "analysis-prompt:run-l2-query");
  const queryResult = encryptText(RUN_RESULT_TEXT, "analysis-final:run-l2-query");
  insertRun.run(
    "run-l2-query", "飞剑提问", "book-a", 1, 2, "", "gpt-test", "medium",
    "prompt-hash", "schema-hash", "completed", 2, "", "",
    queryPrompt.ciphertext, queryPrompt.iv, queryPrompt.tag, queryPrompt.algorithm,
    queryResult.ciphertext, queryResult.iv, queryResult.tag, queryResult.algorithm,
    ts, ts
  );
  const fullPrompt = encryptText(JSON.stringify(fullTextSnapshot), "analysis-prompt:run-full-text");
  const fullResult = encryptText(JSON.stringify({ answer: "全文分析结果" }), "analysis-final:run-full-text");
  insertRun.run(
    "run-full-text", "全文分析", "book-a", 1, 2, "", "gpt-test", "medium",
    "prompt-hash", "schema-hash", "completed", 2, "", "",
    fullPrompt.ciphertext, fullPrompt.iv, fullPrompt.tag, fullPrompt.algorithm,
    fullResult.ciphertext, fullResult.iv, fullResult.tag, fullResult.algorithm,
    ts, ts
  );

  const insertPart = db.prepare(`
    INSERT INTO analysis_summary_parts (
      analysis_id, part_key, parent_key, stage, status, content_hash, prompt_hash,
      schema_hash, model, reasoning_effort, input_summary, trace_summary,
      error_summary, ciphertext, iv, tag, algorithm, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const partResult = encryptText(PART_RESULT_TEXT, "analysis-summary-part:run-l2-query:l2_query.batch.001");
  insertPart.run(
    "run-l2-query", "l2_query.batch.001", "l2_query.final.merge", "text_l2_query_batch",
    "completed", "content-hash", "prompt-hash", "", "gpt-test", "low",
    "批次一", "", "", partResult.ciphertext, partResult.iv, partResult.tag,
    partResult.algorithm, ts, ts
  );
  const orphanPart = encryptText("{}", "analysis-summary-part:run-full-text:full.batch.001");
  insertPart.run(
    "run-full-text", "full.batch.001", "", "text_full_batch",
    "completed", "", "prompt-hash", "", "gpt-test", "low",
    "全文批次", "", "", orphanPart.ciphertext, orphanPart.iv, orphanPart.tag,
    orphanPart.algorithm, ts, ts
  );

  const chapter1Hmac = hmacText(CHAPTER_1_CONTENT);
  db.prepare(`
    INSERT INTO l1_chapter_indexes (
      book_id, chapter_index, status, source_hmac, model, prompt_hash, summary,
      keywords, entities, key_events, items_places_orgs, open_questions,
      route_schema_version, route_summary, route_entities, route_keywords, signals,
      category_scores, has_major_signal, confidence, error_summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "book-a", 1, "completed", chapter1Hmac, "gpt-test", "l1-hash",
    "第一章摘要", '["木剑"]', '["陈平安"]', "[]", "[]", "[]",
    "l1-route-v1", "路由摘要", '["陈平安"]', '["木剑"]', "[]",
    "{}", 0, 0.9, "", ts, ts
  );

  db.prepare(`
    INSERT INTO l2_chapter_statuses (
      book_id, index_group_key, chapter_index, status, source_hmac, model,
      prompt_hash, schema_version, facts_count, error_summary, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "book-a", "sword-special", 1, "completed", chapter1Hmac, "gpt-test",
    "l2-hash", "l2-facts-v1", 1, "", ts, ts
  );

  const factPayload = encryptText(
    JSON.stringify({ fact: L2_FACT_TEXT, evidence: ["得到木剑"], review_note: "人工已核" }),
    "l2-fact:fact-1"
  );
  db.prepare(`
    INSERT INTO l2_facts (
      id, book_id, index_group_key, chapter_index, status, source_hmac, model,
      prompt_hash, schema_version, category, entity, aliases, tags, related_entities,
      fact_type, importance, confidence, review_source,
      ciphertext, iv, tag, algorithm, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "fact-1", "book-a", "sword-special", 1, "completed", chapter1Hmac, "gpt-test",
    "l2-hash", "l2-facts-v1", "item", "陈平安", "[]", '["木剑"]', "[]",
    "item_gain", 0.8, 0.9, "index",
    factPayload.ciphertext, factPayload.iv, factPayload.tag, factPayload.algorithm, ts, ts
  );

  db.prepare(`
    INSERT INTO l2_subjects (
      book_id, index_group_key, subject_key, canonical_name, aliases, creature_type,
      original_form, qualification_chapter, qualification_basis, qualification_evidence,
      confidence, status, prompt_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "book-a", "sword-special", "木剑", "木剑", "[]", "法器", "木剑",
    1, "持剑资格", '["得到木剑"]', 0.9, "verified", "l2-hash", ts, ts
  );

  // 三张应被跳过的表各插一行
  db.prepare(`
    INSERT INTO analysis_chapters (analysis_id, chapter_index, status, content_hmac, prompt_hash, model, error_summary, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("run-full-text", 1, "completed", chapter1Hmac, "prompt-hash", "gpt-test", "", ts);
  db.prepare(`
    INSERT INTO prompt_groups (id, book_id, name, category, chapter_prompt, summary_prompt, index_group_keys, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("group-1", "book-a", "旧分组", "未分类", "章节", "汇总", "[]", ts, ts);
  db.prepare(`
    INSERT INTO l1_window_indexes (book_id, window_start, window_end, status, source_hmac)
    VALUES (?, ?, ?, ?, ?)
  `).run("book-a", 1, 2, "completed", chapter1Hmac);

  db.close();
}

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-plaintext-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeKeyFile(dir) {
  const keyFile = path.join(dir, "master-key.txt");
  fs.writeFileSync(keyFile, `${MASTER_KEY_BASE64}\n`);
  return keyFile;
}

function runMigration(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf8" });
}

test("migrates an encrypted database into the plaintext schema", (t) => {
  const dir = makeTempDir(t);
  const source = path.join(dir, "old.sqlite");
  const target = path.join(dir, "new.sqlite");
  seedOldDatabase(source);
  const keyFile = writeKeyFile(dir);

  const run = runMigration(["--source", source, "--target", target, "--key-file", keyFile]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /迁移完成/);
  assert.match(run.stdout, /chapters: 2/);
  assert.match(run.stdout, /analysis_runs_migrated: 1/);
  assert.match(run.stdout, /analysis_runs_skipped: 1/);

  const db = new DatabaseSync(target, { readOnly: true });

  // chapters：明文 + sha256 content_hash
  const chapters = db.prepare("SELECT * FROM chapters ORDER BY chapter_index").all();
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].content, CHAPTER_1_CONTENT);
  assert.equal(chapters[0].title, "泥瓶巷");
  assert.equal(chapters[0].content_hash, sha256(CHAPTER_1_CONTENT));
  assert.equal(chapters[0].content_length, CHAPTER_1_CONTENT.length);
  assert.equal(chapters[1].content, CHAPTER_2_CONTENT);
  assert.equal(chapters[1].content_hash, sha256(CHAPTER_2_CONTENT));
  assert.equal(tableColumns(db, "chapters").includes("ciphertext"), false);

  // analysis_runs：仅 l2_query 迁移，快照收敛为新形状，结果明文
  const runs = db.prepare("SELECT * FROM analysis_runs").all();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "run-l2-query");
  assert.deepEqual(JSON.parse(runs[0].prompt_snapshot), {
    analysis_mode: "l2_query",
    query: L2_QUERY_TEXT,
    index_group_keys: ["sword-special"]
  });
  assert.equal(runs[0].result, RUN_RESULT_TEXT);

  // analysis_summary_parts：只跟随已迁移 run，结果明文
  const parts = db.prepare("SELECT * FROM analysis_summary_parts").all();
  assert.equal(parts.length, 1);
  assert.equal(parts[0].analysis_id, "run-l2-query");
  assert.equal(parts[0].result, PART_RESULT_TEXT);

  // l2_facts：密文拆成 fact/evidence/review_note 明文列，source_hash 回填
  const facts = db.prepare("SELECT * FROM l2_facts").all();
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact, L2_FACT_TEXT);
  assert.deepEqual(JSON.parse(facts[0].evidence), ["得到木剑"]);
  assert.equal(facts[0].review_note, "人工已核");
  assert.equal(facts[0].source_hash, sha256(CHAPTER_1_CONTENT));

  // l1_chapter_indexes / l2_chapter_statuses：source_hash 回填为新 content_hash
  const l1 = db.prepare("SELECT * FROM l1_chapter_indexes").all();
  assert.equal(l1.length, 1);
  assert.equal(l1[0].summary, "第一章摘要");
  assert.equal(l1[0].source_hash, sha256(CHAPTER_1_CONTENT));
  const l2Status = db.prepare("SELECT * FROM l2_chapter_statuses").all();
  assert.equal(l2Status.length, 1);
  assert.equal(l2Status[0].index_group_key, "sword-special");
  assert.equal(l2Status[0].source_hash, sha256(CHAPTER_1_CONTENT));

  // 其余明文明细原样保留
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM books").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM l2_subjects").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM book_index_groups").get().n, 1);
  assert.equal(db.prepare("SELECT l1_index_prompt FROM book_index_prompts WHERE book_id = 'book-a'").get().l1_index_prompt, "书本 L1 提示词");
  const promptSettings = db.prepare("SELECT * FROM prompt_settings WHERE id = 'default'").get();
  assert.equal(promptSettings.l1_index_prompt, "旧 L1 索引提示词");
  assert.equal(promptSettings.l2_index_prompt, "旧 L2 索引提示词");

  // 已废弃的旧表不进入新库
  for (const table of ["analysis_chapters", "prompt_groups", "l1_window_indexes"]) {
    assert.equal(tableExists(db, table), false, `${table} 不应被迁移`);
  }

  db.close();
});

test("refuses to overwrite an existing target database", (t) => {
  const dir = makeTempDir(t);
  const source = path.join(dir, "old.sqlite");
  const target = path.join(dir, "new.sqlite");
  seedOldDatabase(source);
  fs.writeFileSync(target, "");

  const run = runMigration(["--source", source, "--target", target, "--key-file", writeKeyFile(dir)]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /目标库已存在/);
});

test("rejects a source that is not an encrypted legacy database", (t) => {
  const dir = makeTempDir(t);
  const source = path.join(dir, "plain.sqlite");
  const target = path.join(dir, "new.sqlite");
  const db = new DatabaseSync(source);
  db.exec("CREATE TABLE chapters (book_id TEXT, chapter_index INTEGER, content TEXT)");
  db.close();

  const run = runMigration(["--source", source, "--target", target, "--key-file", writeKeyFile(dir)]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /不是旧版加密库/);
  assert.equal(fs.existsSync(target), false);
});

test("fails clearly when the master key is wrong", (t) => {
  const dir = makeTempDir(t);
  const source = path.join(dir, "old.sqlite");
  const target = path.join(dir, "new.sqlite");
  seedOldDatabase(source);
  const wrongKeyFile = path.join(dir, "wrong-key.txt");
  fs.writeFileSync(wrongKeyFile, Buffer.alloc(32, 9).toString("base64"));

  const run = runMigration(["--source", source, "--target", target, "--key-file", wrongKeyFile]);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /迁移失败/);
  assert.equal(fs.existsSync(target), false);
});

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table));
}
