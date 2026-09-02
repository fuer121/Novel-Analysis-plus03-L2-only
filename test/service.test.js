import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-service-"));
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tempDir;
process.env.DIFY_API_BASE = "http://127.0.0.1:9999/v1";
process.env.DIFY_CHAPTER_WORKFLOW_API_KEY = "app-test";
process.env.DIFY_L1_WORKFLOW_API_KEY = "app-l1-test";
process.env.DIFY_L2_WORKFLOW_API_KEY = "app-l2-test";
process.env.DIFY_ANALYSIS_SUMMARY_WORKFLOW_API_KEY = "app-analysis-summary-test";
process.env.DIFY_L1_WORKFLOW_VERSION = "v1";
process.env.DIFY_L2_WORKFLOW_VERSION = "v1";
process.env.DIFY_ANALYSIS_SUMMARY_WORKFLOW_VERSION = "v1";

const db = await import("../server/db.js");
const dify = await import("../server/dify.js");
const appConfig = await import("../server/config.js");
const characterLibrary = await import("../server/character-library.js");
const indexingInputs = await import("../server/indexing-inputs.js");
const api = await import("../src/api.js");
const schemaTools = await import("../src/schemaTools.js");
const tasks = await import("../server/tasks.js");
const workflows = await import("../server/workflows.js");

test("character library API helpers encode resource paths and queries", () => {
  assert.equal(api.characterLibraryUrl("book/1"), "/api/books/book%2F1/character-library");
  assert.equal(
    api.charactersUrl("book/1", { search: "沈 昭", filter: "multi_stage", sort: "facts" }),
    "/api/books/book%2F1/characters?search=%E6%B2%88+%E6%98%AD&filter=multi_stage&sort=facts"
  );
  assert.equal(api.characterUrl("book/1", "character/1"), "/api/books/book%2F1/characters/character%2F1");
  assert.equal(api.characterLibraryBuildUrl("build/1"), "/api/character-library-builds/build%2F1");
  assert.equal(api.characterLibraryBuildEventsUrl("build/1"), "/api/character-library-builds/build%2F1/events");
});

test.after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const stableStageFacts = (facts) => facts.map((fact) => JSON.parse(JSON.stringify(fact))).sort((left, right) => characterLibrary.characterFactFingerprint(left).localeCompare(characterLibrary.characterFactFingerprint(right)));

test("character library admits only stable named characters", () => {
  assert.equal(characterLibrary.isStableCharacterName("顾南风"), true);
  assert.equal(characterLibrary.isStableCharacterName("黑衣人"), false);
  assert.equal(characterLibrary.isStableCharacterName("某人的母亲"), false);
  assert.equal(characterLibrary.isStableCharacterName("侍卫"), false);
  assert.equal(characterLibrary.isStableCharacterName("老人"), false);
  assert.equal(characterLibrary.isStableCharacterName(""), false);
  assert.equal(characterLibrary.isStableCharacterName("一名过路女子"), false);
  assert.equal(characterLibrary.isStableCharacterName("林深的师父"), false);
  assert.equal(characterLibrary.isStableCharacterName("顾".repeat(80)), true);
  assert.equal(characterLibrary.isStableCharacterName("顾".repeat(81)), false);
});

test("character library accepts only the complete alias templates", () => {
  const cases = [
    ["沈昭小名昭昭", "昭昭"],
    ["沈昭的小名是阿昭", "阿昭"],
    ["沈昭又名沈月", "沈月"],
    ["沈昭化名为沈瑄", "沈瑄"],
    ["沈昭的化名是“沈珩”", "沈珩"],
    ["沈昭改名为沈宁", "沈宁"],
    ["沈昭被称为昭光居士", "昭光居士"],
    ["沈昭的称号是《昭月仙子》", "昭月仙子"],
    ["昭华是沈昭的小名", "昭华"],
    ["昭影是沈昭的化名", "昭影"],
    ["昭君是沈昭的称号", "昭君"]
  ];
  for (const [statement, alias] of cases) {
    const aliasFact = {
      entity: "沈昭",
      aliases: [alias],
      fact_type: "alias",
      fact: statement,
      evidence: [statement]
    };
    const aliasAppearance = {
      entity: alias,
      fact_type: "appearance",
      fact: `${alias}身形高挑`,
      evidence: [`${alias}身形高挑`]
    };
    const result = characterLibrary.resolveCharacterCandidates([aliasAppearance, aliasFact]);
    assert.deepEqual(result, [{ canonical_name: "沈昭", aliases: [alias], facts: stableStageFacts([aliasAppearance, aliasFact]) }], statement);
  }
});

test("character library accepts only complete structured alias confirmation", () => {
  const accepted = {
    entity: "沈昭",
    aliases: ["昭昭"],
    fact_type: "alias",
    fact: "上游结构化确认",
    evidence: ["沈家旧谱记载"],
    alias_relation: "confirmed",
    alias_confidence: 0.9
  };
  const merged = characterLibrary.resolveCharacterCandidates([
    accepted,
    { entity: "昭昭", fact_type: "appearance", evidence: ["眉尾有痣"] }
  ]);
  assert.deepEqual(merged.map((item) => item.canonical_name), ["沈昭"]);
  assert.deepEqual(merged[0].aliases, ["昭昭"]);

  const rejected = [
    ["aliases alone", { fact_type: "appearance" }, ["沈昭", "昭昭"]],
    ["missing evidence", { evidence: [] }, ["沈昭", "昭昭"]],
    ["weak confidence", { alias_confidence: 0.89 }, ["沈昭", "昭昭"]],
    ["unconfirmed relation", { alias_relation: "candidate" }, ["沈昭", "昭昭"]],
    ["unstable canonical", { entity: "黑衣人" }, ["昭昭"]],
    ["unstable alias", { aliases: ["侍卫"] }, ["沈昭"]]
  ];
  for (const [label, overrides, expectedNames] of rejected) {
    const alias = overrides.aliases?.[0] ?? "昭昭";
    const result = characterLibrary.resolveCharacterCandidates([
      { ...accepted, aliases: ["昭昭"], ...overrides },
      { entity: alias, fact_type: "appearance", evidence: ["独立事实"] }
    ]);
    assert.deepEqual(result.map((item) => item.canonical_name), expectedNames, label);
    assert.equal(result.every((item) => item.aliases.length === 0), true, label);
  }
});

test("character library does not fall back from explicit alias relation states", () => {
  const aliasFact = {
    entity: "沈昭",
    aliases: ["昭昭"],
    fact_type: "alias",
    fact: "沈昭小名昭昭",
    evidence: ["沈家旧谱"]
  };
  const appearance = { entity: "昭昭", fact_type: "appearance", evidence: ["眉尾有痣"] };
  for (const overrides of [
    { alias_relation: "candidate", alias_confidence: 0.99 },
    { alias_relation: "rejected", alias_confidence: 0.99 },
    { alias_relation: "unknown", alias_confidence: 0.99 },
    { alias_relation: "confirmed", alias_confidence: 0.89 },
    { alias_relation: "confirmed", alias_confidence: 1.2 },
    { alias_relation: "confirmed", alias_confidence: Number.NaN },
    { alias_relation: "confirmed", alias_confidence: "0.95" }
  ]) {
    const result = characterLibrary.resolveCharacterCandidates([{ ...aliasFact, ...overrides }, appearance]);
    assert.deepEqual(result.map((item) => item.canonical_name), ["沈昭", "昭昭"]);
  }
  assert.deepEqual(
    characterLibrary.resolveCharacterCandidates([aliasFact, appearance]).map((item) => item.canonical_name),
    ["沈昭"]
  );
});

test("character library blocks conflicting assertions for the same alias pair", () => {
  const confirmed = {
    entity: "沈昭",
    aliases: ["昭昭"],
    fact_type: "alias",
    fact: "结构化确认",
    evidence: ["确认证据"],
    alias_relation: "confirmed",
    alias_confidence: 0.95
  };
  const legacy = { ...confirmed, fact: "沈昭小名昭昭", evidence: ["旧谱证据"] };
  delete legacy.alias_relation;
  delete legacy.alias_confidence;
  const rejected = { ...confirmed, fact: "结构化拒绝", evidence: ["拒绝证据"], alias_relation: "rejected" };
  const candidate = { ...confirmed, fact: "结构化候选", evidence: ["候选证据"], alias_relation: "candidate" };
  const appearance = { entity: "昭昭", fact_type: "appearance", evidence: ["眉尾有痣"] };
  for (const assertions of [[confirmed, rejected], [confirmed, candidate], [legacy, rejected]]) {
    const result = characterLibrary.resolveCharacterCandidates([...assertions, appearance]);
    assert.deepEqual(result.map((item) => item.canonical_name), ["沈昭", "昭昭"]);
  }
});

test("character library returns deterministic deduplicated candidate facts", () => {
  const sharedFact = {
    entity: "沈昭",
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: 3,
    fact_type: "appearance",
    fact: "沈昭眉尾有痣",
    evidence: ["眉尾有痣"]
  };
  const duplicateA = { ...sharedFact, id: "volatile-z", source_rank: "beta" };
  const duplicateB = { ...sharedFact, id: "volatile-a", source_rank: "alpha" };
  const forward = characterLibrary.resolveCharacterCandidates([duplicateA, duplicateB]);
  const reversed = characterLibrary.resolveCharacterCandidates([duplicateB, duplicateA]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward[0].facts, [{ ...sharedFact, source_rank: "alpha" }]);
});

test("character library rejects weak or extended alias statements", () => {
  const statements = [
    "沈昭与昭昭同章出现",
    "沈昭的小名也是昭昭",
    "沈昭后来改名为昭昭",
    "沈昭的小名是昭昭，但关系未经确认"
  ];
  for (const statement of statements) {
    const result = characterLibrary.resolveCharacterCandidates([
      { entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: statement, evidence: [statement] },
      { entity: "昭昭", fact_type: "appearance", evidence: ["眉尾有痣"] }
    ]);
    assert.deepEqual(result.map((item) => item.canonical_name), ["沈昭", "昭昭"], statement);
  }
});

test("character library isolates aliases claimed by multiple canonical names", () => {
  const result = characterLibrary.resolveCharacterCandidates([
    { entity: "白清", aliases: ["小雪"], fact_type: "alias", fact: "白清小名小雪", evidence: ["白家旧谱"] },
    { entity: "苏晚", aliases: ["小雪"], fact_type: "alias", fact: "苏晚小名小雪", evidence: ["苏家旧谱"] },
    { entity: "小雪", fact_type: "appearance", evidence: ["身着青衣"] }
  ]);
  assert.deepEqual(result.map((item) => item.canonical_name), ["白清", "苏晚", "小雪"]);
  assert.equal(result.every((item) => item.aliases.length === 0), true);
});

test("character library isolates alias chains and cycles", () => {
  const chain = characterLibrary.resolveCharacterCandidates([
    { entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: "沈昭小名昭昭", evidence: ["沈家旧谱"] },
    { entity: "昭昭", aliases: ["阿昭"], fact_type: "alias", fact: "昭昭化名为阿昭", evidence: ["行走江湖"] },
    { entity: "沈昭", aliases: ["阿昭"], fact_type: "alias", fact: "沈昭又名阿昭", evidence: ["别名记录"] },
    { entity: "阿昭", fact_type: "appearance", evidence: ["身形高挑"] }
  ]);
  assert.deepEqual(chain.map((item) => item.canonical_name), ["阿昭", "沈昭", "昭昭"]);
  assert.equal(chain.every((item) => item.aliases.length === 0), true);

  const cycle = characterLibrary.resolveCharacterCandidates([
    { entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: "沈昭又名昭昭", evidence: ["证据一"] },
    { entity: "昭昭", aliases: ["沈昭"], fact_type: "alias", fact: "昭昭又名沈昭", evidence: ["证据二"] }
  ]);
  assert.deepEqual(cycle.map((item) => item.canonical_name), ["沈昭", "昭昭"]);
  assert.equal(cycle.every((item) => item.aliases.length === 0), true);
});

test("character stages split only qualified structured stage facts", () => {
  const facts = [
    { chapter_index: 1, stage_hint: "少年", stage_type: "age", stage_stability: "stable", stable_difference: true, evidence: ["身量未足"] },
    { chapter_index: 2, stage_hint: "人类形态", stage_type: "form", stage_stability: "stable", stable_difference: true, evidence: ["保持人身"] },
    { chapter_index: 3, stage_hint: "皇后时期", stage_type: "identity", stage_stability: "stable", stable_difference: true, evidence: ["册封为后"] },
    { chapter_index: 4, fact_type: "appearance", fact: "普通角色事实", evidence: ["普通证据"] }
  ];
  assert.deepEqual(characterLibrary.deriveCharacterStages("沈昭", facts), [
    { name: "少年", type: "age", facts: [facts[0]] },
    { name: "人类形态", type: "form", facts: [facts[1]] },
    { name: "皇后时期", type: "identity", facts: [facts[2]] }
  ]);
});

test("character stages require every structured contract field", () => {
  const first = {
    stage_hint: "少年",
    stage_type: "age",
    stage_stability: "stable",
    stable_difference: true,
    evidence: ["身量未足"]
  };
  const second = {
    stage_hint: "成年",
    stage_type: "age",
    stage_stability: "stable",
    stable_difference: true,
    evidence: ["骨架高大"]
  };
  const cases = [
    ["stage hint", { stage_hint: "" }],
    ["stage type", { stage_type: undefined }],
    ["allowed stage type", { stage_type: "state" }],
    ["stage stability", { stage_stability: undefined }],
    ["stable stage", { stage_stability: "temporary" }],
    ["stable difference", { stable_difference: undefined }],
    ["confirmed difference", { stable_difference: false }],
    ["evidence", { evidence: [] }]
  ];
  for (const [label, overrides] of cases) {
    const facts = [first, { ...second, ...overrides }];
    assert.deepEqual(characterLibrary.deriveCharacterStages("沈昭", facts), [
      { name: "默认阶段", type: "default", facts: stableStageFacts(facts) }
    ], label);
  }

  const conflictingFacts = [
    first,
    { ...first, stage_type: "identity", evidence: ["身份发生变化"] },
    second,
    {
      stage_hint: "人类形态",
      stage_type: "form",
      stage_stability: "stable",
      stable_difference: true,
      evidence: ["保持人身"]
    }
  ];
  assert.deepEqual(characterLibrary.deriveCharacterStages("沈昭", conflictingFacts), [
    { name: "默认阶段", type: "default", facts: stableStageFacts(conflictingFacts) }
  ], "conflicting stage type");
});

test("character stages fall back when any stage signal is unqualified", () => {
  const stableStages = [
    { stage_hint: "少年", stage_type: "age", stage_stability: "stable", stable_difference: true, fact: "少年事实", evidence: ["少年证据"] },
    { stage_hint: "成年", stage_type: "age", stage_stability: "stable", stable_difference: true, fact: "成年事实", evidence: ["成年证据"] }
  ];
  const attempts = [
    { stage_hint: "过渡期", stage_type: "age", stage_stability: "temporary", stable_difference: true, evidence: ["临时证据"] },
    { stage_hint: "过渡期", stage_type: "age", stage_stability: "uncertain", stable_difference: true, evidence: ["不确定证据"] },
    { stage_hint: "过渡期", stage_stability: "stable", stable_difference: true, evidence: ["缺字段证据"] }
  ];
  for (const attempt of attempts) {
    const facts = [...stableStages, attempt];
    assert.deepEqual(characterLibrary.deriveCharacterStages("沈昭", facts), [
      { name: "默认阶段", type: "default", facts: stableStageFacts(facts) }
    ]);
  }
});

test("character stages sort qualified output independently of input order", () => {
  const facts = [
    { stage_hint: "后期", stage_type: "identity", stage_stability: "stable", stable_difference: true, evidence: ["后期证据一"] },
    { chapter_index: 2, stage_hint: "早期", stage_type: "age", stage_stability: "stable", stable_difference: true, evidence: ["早期证据"] },
    { stage_hint: "乙阶段", stage_type: "form", stage_stability: "stable", stable_difference: true, evidence: ["乙阶段证据"] },
    { chapter_index: 10, stage_hint: "后期", stage_type: "identity", stage_stability: "stable", stable_difference: true, evidence: ["后期证据二"] },
    { chapter_index: "invalid", stage_hint: "甲阶段", stage_type: "identity", stage_stability: "stable", stable_difference: true, evidence: ["甲阶段证据"] }
  ];
  const reorderedFacts = [facts[4], facts[2], facts[1], facts[3], facts[0]];
  const stages = characterLibrary.deriveCharacterStages("沈昭", facts);
  assert.deepEqual(characterLibrary.deriveCharacterStages("沈昭", reorderedFacts), stages);
  assert.deepEqual(stages.map((stage) => stage.name), ["早期", "后期", "甲阶段", "乙阶段"]);

  const sharedFact = { ...facts[1], book_id: "book-1", index_group_key: "characters", chapter_index: 4, stage_hint: "成年", fact: "成年阶段事实", evidence: ["成年阶段证据"] };
  const duplicateA = { ...sharedFact, id: "volatile-z", source_rank: "beta" };
  const duplicateB = { ...sharedFact, id: "volatile-a", source_rank: "alpha" };
  const otherStage = facts[1];
  const forward = characterLibrary.deriveCharacterStages("沈昭", [otherStage, duplicateA, duplicateB]);
  const reversed = characterLibrary.deriveCharacterStages("沈昭", [duplicateB, duplicateA, otherStage]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward[1].facts, [{ ...sharedFact, source_rank: "alpha" }]);
});
test("character stages require independent evidence for every stage", () => {
  const base = {
    stage_type: "form",
    stage_stability: "stable",
    stable_difference: true
  };
  const cases = [
    [
      { ...base, stage_hint: "人类形态", fact: "人身事实", evidence: ["共享证据"] },
      { ...base, stage_hint: "龙形", fact: "龙形事实", evidence: [" 共享证据 "] }
    ],
    [
      { ...base, stage_hint: "人类形态", fact: "人身事实", evidence: ["共享证据", "人身独立证据"] },
      { ...base, stage_hint: "龙形", fact: "龙形事实", evidence: ["共享证据"] }
    ]
  ];
  for (const facts of cases) {
    assert.deepEqual(characterLibrary.deriveCharacterStages("玄霜", facts), [
      { name: "默认阶段", type: "default", facts: stableStageFacts(facts) }
    ]);
  }
  const sharedFact = { ...base, book_id: "book-1", chapter_index: 3, stage_hint: "人类形态", fact: "相同来源事实", evidence: ["相同来源证据"] };
  const duplicateA = { ...sharedFact, id: "volatile-z", source_rank: "beta" };
  const duplicateB = { ...sharedFact, id: "volatile-a", source_rank: "alpha" };
  const forward = characterLibrary.deriveCharacterStages("玄霜", [duplicateA, duplicateB]);
  const reversed = characterLibrary.deriveCharacterStages("玄霜", [duplicateB, duplicateA]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward[0].facts, [{ ...sharedFact, source_rank: "alpha" }]);
});

test("character fact fingerprints survive L2 UUID replacement", () => {
  const left = characterLibrary.characterFactFingerprint({
    id: "original-uuid",
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: "12",
    fact: "顾南风有一双狭长凤眼",
    evidence: ["那双狭长的凤眼微微抬起", "他  眸光沉静"]
  });
  const right = characterLibrary.characterFactFingerprint({
    id: "replacement-uuid",
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: 12,
    fact: "  顾南风有一双狭长凤眼  ",
    evidence: [" 他 眸光沉静 ", "那双狭长的凤眼微微抬起", "那双狭长的凤眼微微抬起"]
  });
  assert.equal(left, right);
});

test("character library persists and atomically replaces the current projection", () => {
  const bookId = "character-persistence-book";
  db.ensureBook(bookId, "角色持久化测试书");

  const firstBuild = db.createCharacterLibraryBuild({
    bookId,
    indexGroupKey: "characters",
    startChapter: 1,
    endChapter: 20,
    sourceFingerprint: "source-v1"
  });
  assert.equal(firstBuild.status, "running");
  assert.throws(
    () => db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 20, sourceFingerprint: "source-concurrent" }),
    /unfinished character library build/i
  );

  db.replaceCharacterProjection(firstBuild.id, [{
    id: `${bookId}:shen-zhao`,
    book_id: bookId,
    canonical_name: "沈昭",
    aliases: ["昭昭"],
    gender: "女",
    stages: [{
      id: `${bookId}:shen-zhao:default`,
      name: "默认阶段",
      stable_appearance: "眉尾有痣",
      stable_temperament: "冷静克制",
      original_facial_features: "眉尾有痣",
      designed_facial_features: "窄长眼型，眉峰平直",
      design_basis: ["眉尾有痣", "冷静克制"],
      facts: [{ fingerprint: "fact-1", chapter_index: 8, fact_type: "appearance", fact: "眉尾有痣", evidence: ["眉尾那颗痣"] }]
    }]
  }], { coverage: { end_chapter: 20 }, quality: { warning_count: 0 } });

  const firstStatus = db.getCharacterLibraryStatus(bookId);
  assert.equal(firstStatus.build_id, firstBuild.id);
  assert.equal(firstStatus.status, "completed");
  assert.equal(firstStatus.is_current, true);
  assert.equal(firstStatus.coverage.end_chapter, 20);
  assert.equal(firstStatus.character_count, 1);
  assert.equal(firstStatus.stage_count, 1);
  assert.equal(firstStatus.fact_count, 1);

  const firstDetail = db.getCharacterLibraryCharacter(bookId, `${bookId}:shen-zhao`);
  assert.equal(firstDetail.canonical_name, "沈昭");
  assert.equal(firstDetail.stages[0].designed_facial_features, "窄长眼型，眉峰平直");
  assert.equal(firstDetail.stages[0].facts[0].fingerprint, "fact-1");

  const secondBuild = db.createCharacterLibraryBuild({
    bookId,
    indexGroupKey: "characters",
    startChapter: 1,
    endChapter: 30,
    sourceFingerprint: "source-v2"
  });
  db.replaceCharacterProjection(secondBuild.id, [
    {
      id: `${bookId}:shen-zhao`,
      book_id: bookId,
      canonical_name: "沈昭",
      aliases: ["昭昭"],
      stages: [{ id: `${bookId}:shen-zhao:default`, name: "默认阶段", facts: [] }]
    },
    {
      id: `${bookId}:other-shen-zhao`,
      book_id: bookId,
      canonical_name: "沈昭",
      aliases: ["另一个沈昭"],
      stages: [
        { id: `${bookId}:other-shen-zhao:early`, name: "早期", start_chapter: 1, facts: [{ fingerprint: "fact-2", chapter_index: 2, fact: "早期事实", evidence: ["早期证据"] }] },
        { id: `${bookId}:other-shen-zhao:late`, name: "后期", start_chapter: 20, facts: [] }
      ]
    }
  ], { status: "partial", coverage: { end_chapter: 30, is_partial: true } });

  const secondStatus = db.getCharacterLibraryStatus(bookId);
  assert.equal(secondStatus.build_id, secondBuild.id);
  assert.equal(secondStatus.status, "partial");
  assert.equal(secondStatus.character_count, 2);
  assert.equal(secondStatus.stage_count, 3);
  assert.equal(secondStatus.fact_count, 1);
  assert.deepEqual(db.listCharacterLibraryCharacters({ bookId }).map((item) => item.id), [
    `${bookId}:other-shen-zhao`,
    `${bookId}:shen-zhao`
  ]);
  assert.deepEqual(db.listCharacterLibraryCharacters({ bookId, search: "另一个" }).map((item) => item.id), [`${bookId}:other-shen-zhao`]);
  assert.deepEqual(db.listCharacterLibraryCharacters({ bookId, filter: "multi_stage" }).map((item) => item.id), [`${bookId}:other-shen-zhao`]);
  assert.equal(db.listCharacterLibraryCharacters({ bookId, filter: "incomplete" }).length, 2);
  assert.equal(db.listCharacterLibraryCharacters({ bookId, sort: "facts" })[0].id, `${bookId}:other-shen-zhao`);
});

test("character library rejects invalid projections without replacing the current version", () => {
  const bookId = "character-rollback-book";
  db.ensureBook(bookId, "角色回滚测试书");
  const currentBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 10, sourceFingerprint: "valid" });
  db.replaceCharacterProjection(currentBuild.id, [{
    id: `${bookId}:valid`,
    book_id: bookId,
    canonical_name: "顾南风",
    stages: [{ id: `${bookId}:valid:default`, name: "默认阶段", facts: [] }]
  }]);

  const failedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 12, sourceFingerprint: "invalid" });
  assert.throws(() => db.replaceCharacterProjection(failedBuild.id, [{
    id: `${bookId}:invalid`,
    book_id: "another-book",
    canonical_name: "错误归属",
    stages: [{ id: `${bookId}:invalid:default`, name: "默认阶段", facts: [] }]
  }]), /character book_id must match build book_id/i);

  assert.equal(db.getCharacterLibraryStatus(bookId).build_id, currentBuild.id);
  assert.equal(db.getCharacterLibraryCharacter(bookId, `${bookId}:valid`).canonical_name, "顾南风");
  db.updateCharacterLibraryBuild(failedBuild.id, { status: "failed", errorSummary: "invalid projection" });
  assert.throws(() => db.updateCharacterLibraryBuild(failedBuild.id, { status: "running" }), /terminal character library build/i);
  assert.equal(db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 12, sourceFingerprint: "retry" }).status, "running");
});

test("character library build persists items and reads character facts with stable keyset pages", () => {
  const bookId = "character-build-storage-book";
  db.ensureBook(bookId, "角色构建暂存测试书");
  for (let chapterIndex = 1; chapterIndex <= 3; chapterIndex += 1) {
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "characters",
      chapterIndex,
      status: "completed",
      sourceHash: `source-${chapterIndex}`,
      model: "dify:l2:v1",
      promptHash: "characters-v1",
      schemaVersion: "l2-facts-v1",
      facts: Array.from({ length: 3 }, (_, offset) => ({
        category: "character",
        entity: `角色${chapterIndex}-${offset}`,
        fact_type: "appearance",
        fact: `第${chapterIndex}章外形事实${offset}`,
        evidence: [`第${chapterIndex}章证据${offset}`]
      }))
    });
  }
  const firstPage = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 3, pageSize: 4 });
  const secondPage = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 3, pageSize: 4, cursor: firstPage.next_cursor });
  const thirdPage = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 3, pageSize: 4, cursor: secondPage.next_cursor });
  assert.equal([...firstPage.items, ...secondPage.items, ...thirdPage.items].length, 9);
  assert.deepEqual(firstPage.items.map((fact) => fact.chapter_index), [1, 1, 1, 2]);

  const build = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 3, sourceFingerprint: "source-build" });
  assert.equal(build.control_state, "active");
  db.saveCharacterLibraryBuildItem(build.id, {
    item_key: "candidate-a",
    candidate_fingerprint: "candidate-fingerprint-a",
    source_fact_fingerprints: ["fact-a"],
    input_payload: { canonical_name: "沈昭" },
    classification_output: { aliases: [] },
    status: "running",
    heartbeat_at: "2000-01-01T00:00:00.000Z"
  });
  assert.equal(db.resetStaleCharacterLibraryBuildItems(build.id, { staleBefore: "2020-01-01T00:00:00.000Z" }), 1);
  assert.equal(db.listCharacterLibraryBuildItems(build.id)[0].status, "pending");
});

test("character library conservatively reuses stable character and stage ids", () => {
  const previous = [{
    id: "character-old",
    canonical_name: "沈昭",
    aliases: ["昭昭"],
    stages: [{ id: "stage-old", name: "默认阶段", stage_type: "default", facts: [{ fingerprint: "fact-shared" }] }]
  }];
  const candidates = [{
    canonical_name: "沈昭",
    aliases: ["昭昭"],
    facts: [{ fingerprint: "fact-shared" }],
    stages: [{ name: "默认阶段", type: "default", facts: [{ fingerprint: "fact-shared" }] }]
  }];
  const result = characterLibrary.assignStableCharacterIds("stable-id-book", candidates, previous);
  assert.equal(result[0].id, "character-old");
  assert.equal(result[0].stages[0].id, "stage-old");
  assert.deepEqual(result[0].quality_warnings, []);
});

test("character library affected closure expands fact deletion and alias reconnection", () => {
  const previous = [
    { canonical_name: "沈昭", aliases: ["昭昭"], stages: [{ name: "默认阶段", facts: [{ fingerprint: "fact-a" }] }] },
    { canonical_name: "顾南风", aliases: [], stages: [{ name: "默认阶段", facts: [{ fingerprint: "fact-b" }] }] }
  ];
  const next = [
    { canonical_name: "沈昭", aliases: [], facts: [] },
    { canonical_name: "昭昭", aliases: ["阿昭"], facts: [{ fingerprint: "fact-c" }] },
    { canonical_name: "顾南风", aliases: [], facts: [{ fingerprint: "fact-b" }] }
  ];
  const closure = characterLibrary.computeAffectedCharacterClosure(previous, next);
  assert.deepEqual(new Set(closure.affected_names), new Set(["昭昭", "沈昭"]));
  assert.equal(closure.affected_names.includes("顾南风"), false);
});

test("character library source fingerprint changes when a failed chapter content changes", () => {
  const base = {
    facts: [],
    coverage: { start_chapter: 1, end_chapter: 2, failed_chapters: [2], is_partial: true }
  };
  const left = characterLibrary.prepareCharacterLibraryBuild({
    ...base,
    versions: { source_chapters: [{ chapter_index: 1, content_hash: "ok" }, { chapter_index: 2, content_hash: "failed-v1", l2_status: "failed" }] }
  });
  const right = characterLibrary.prepareCharacterLibraryBuild({
    ...base,
    versions: { source_chapters: [{ chapter_index: 1, content_hash: "ok" }, { chapter_index: 2, content_hash: "failed-v2", l2_status: "failed" }] }
  });
  assert.notEqual(left.source_fingerprint, right.source_fingerprint);
});

test("character library marks ambiguous stage identity instead of silently reusing an id", () => {
  const result = characterLibrary.assignStableCharacterIds("stage-ambiguous-book", [{
    canonical_name: "沈昭",
    facts: [{ fingerprint: "character-fact" }],
    stages: [{ name: "成年", type: "age", facts: [{ fingerprint: "shared-stage-fact" }] }]
  }], [{
    id: "character-old",
    canonical_name: "沈昭",
    facts: [{ fingerprint: "character-fact" }],
    stages: [
      { id: "stage-old-a", name: "成年", stage_type: "age", facts: [{ fingerprint: "shared-stage-fact" }] },
      { id: "stage-old-b", name: "成年", stage_type: "age", facts: [{ fingerprint: "shared-stage-fact" }] }
    ]
  }]);
  assert.notEqual(result[0].stages[0].id, "stage-old-a");
  assert.notEqual(result[0].stages[0].id, "stage-old-b");
  assert.equal(result[0].stages[0].quality_warnings.includes("stage_identity_ambiguous"), true);
});

test("character library cancellation marks pending build items cancelled", () => {
  const bookId = "character-cancel-items-book";
  db.ensureBook(bookId, "角色取消测试书");
  const build = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "cancel-source" });
  db.saveCharacterLibraryBuildItem(build.id, { item_key: "pending", candidate_fingerprint: "pending", status: "pending" });
  db.saveCharacterLibraryBuildItem(build.id, { item_key: "done", candidate_fingerprint: "done", status: "succeeded" });
  assert.equal(db.cancelPendingCharacterLibraryBuildItems(build.id), 1);
  assert.deepEqual(db.listCharacterLibraryBuildItems(build.id).map((item) => item.status), ["succeeded", "cancelled"]);
  db.updateCharacterLibraryBuild(build.id, { status: "cancelled" });
});

test("character library workflow cancellation preserves projection and cancels pending items", async () => {
  const bookId = "character-workflow-cancel-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] },
    { category: "character", entity: "顾南风", fact_type: "appearance", fact: "顾南风眼型狭长", evidence: ["眼型狭长"] }
  ]);
  let releaseProfile;
  const blockedProfile = new Promise((resolve) => { releaseProfile = resolve; });
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, request = {}) => {
    calls += 1;
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    const response = difyWorkflowResponse({ result: JSON.stringify(characterProfileFixture(context.character.canonical_name)) });
    if (calls === 3) {
      await blockedProfile;
    }
    return response;
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    while (calls < 3 || !task.result?.buildId) await new Promise((resolve) => setTimeout(resolve, 5));
    const buildId = task.result.buildId;
    assert.equal(db.listCharacterLibraryBuildItems(buildId).some((item) => item.status === "pending"), true);
    workflows.cancelCharacterLibraryBuild(buildId);
    releaseProfile();
    await waitForTerminalTask(task);
    assert.equal(task.status, "cancelled");
    assert.equal(db.getCharacterLibraryBuild(buildId).status, "cancelled");
    assert.equal(db.listCharacterLibraryBuildItems(buildId).some((item) => item.status === "cancelled"), true);
    assert.equal(db.getCharacterLibraryStatus(bookId), null);
  } finally {
    global.fetch = previousFetch;
  }
});

test("paused character library cancellation resumes cleanup before the terminal event", async () => {
  const bookId = "character-pause-cancel-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] },
    { category: "character", entity: "顾南风", fact_type: "appearance", fact: "顾南风眼型狭长", evidence: ["眼型狭长"] }
  ]);
  let releaseProfile;
  const blockedProfile = new Promise((resolve) => { releaseProfile = resolve; });
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, request = {}) => {
    calls += 1;
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    const response = difyWorkflowResponse({ result: JSON.stringify(characterProfileFixture(context.character.canonical_name)) });
    if (calls === 1) await blockedProfile;
    return response;
  };
  try {
    const task = workflows.startCharacterLibraryTask({
      book_id: bookId,
      index_group_key: "characters",
      start_chapter: 1,
      end_chapter: 1
    });
    while (calls < 1 || !task.result?.buildId) await new Promise((resolve) => setTimeout(resolve, 5));
    const buildId = task.result.buildId;
    db.saveCharacterLibraryBuildItem(buildId, {
      item_key: "pause-cancel-pending",
      candidate_fingerprint: "pause-cancel-pending",
      status: "pending"
    });
    workflows.pauseCharacterLibraryBuild(buildId);
    assert.equal(task.status, "paused");
    workflows.cancelCharacterLibraryBuild(buildId);
    assert.equal(task.paused, false);
    assert.equal(task.events.at(-1).type, "progress");
    assert.equal(task.events.some((event) => event.type === "cancelled"), false);
    releaseProfile();
    await waitForTerminalTask(task);
    assert.equal(task.status, "cancelled");
    assert.equal(task.events.at(-1).type, "cancelled");
    assert.equal(db.getCharacterLibraryBuild(buildId).status, "cancelled");
    assert.equal(db.listCharacterLibraryBuildItems(buildId).some((item) => item.status === "cancelled"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library task uses its build id as the task id", async () => {
  const bookId = "character-unified-task-id-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  const previousFetch = global.fetch;
  global.fetch = async (_url, request = {}) => {
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    return difyWorkflowResponse({ result: JSON.stringify(characterProfileFixture(context.character.canonical_name)) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({
      book_id: bookId,
      index_group_key: "characters",
      start_chapter: 1,
      end_chapter: 1
    });
    assert.equal(task.id, task.result.buildId);
    assert.equal(db.getCharacterLibraryBuild(task.id).id, task.id);
    await waitForTask(task);
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library API exposes queries, builds, events, and controls", async () => {
  const bookId = "character-api-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  const currentBuild = db.createCharacterLibraryBuild({
    bookId,
    indexGroupKey: "characters",
    startChapter: 1,
    endChapter: 1,
    sourceFingerprint: "character-api-current"
  });
  db.replaceCharacterProjection(currentBuild.id, [{
    id: "character/api",
    canonical_name: "沈昭",
    stages: [{ id: "stage-api", name: "默认阶段", facts: [] }]
  }]);

  const port = 21000 + Math.floor(Math.random() * 10000);
  let server = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve("."),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: tempDir },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHttpServer(`${base}/api/health`, server);
    const library = await fetchJson(`${base}${api.characterLibraryUrl(bookId)}`);
    assert.equal(library.response.status, 200);
    assert.equal(library.body.library.build_id, currentBuild.id);

    const list = await fetchJson(`${base}${api.charactersUrl(bookId, { filter: "invalid", sort: "invalid" })}`);
    assert.equal(list.body.characters.length, 1);
    const detail = await fetchJson(`${base}${api.characterUrl(bookId, "character/api")}`);
    assert.equal(detail.body.character.canonical_name, "沈昭");

    const buildStatus = await fetchJson(`${base}${api.characterLibraryBuildUrl(currentBuild.id)}`);
    assert.equal(buildStatus.body.task.id, currentBuild.id);
    const events = await fetch(`${base}${api.characterLibraryBuildEventsUrl(currentBuild.id)}`);
    assert.match(await events.text(), /event: snapshot/);

    const buildBookId = "character-api-build-book";
    seedCharacterLibraryWorkflowBook(buildBookId, [
      { category: "character", entity: "顾南风", fact_type: "appearance", fact: "顾南风眼型狭长", evidence: ["眼型狭长"] }
    ]);
    const created = await fetchJson(`${base}${api.characterLibraryBuildsUrl(buildBookId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index_group_key: "characters", start_chapter: 1, end_chapter: 1 })
    });
    assert.equal(created.response.status, 202);
    assert.equal(created.body.task.id, created.body.task.result.buildId);
    assert.equal((await fetch(`${base}${api.characterLibraryBuildsUrl(buildBookId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index_group_key: "characters", start_chapter: 1, end_chapter: 1 })
    })).status, 409);

    const paused = await fetchJson(`${base}${api.characterLibraryBuildUrl(created.body.task.id)}/pause`, { method: "POST" });
    assert.equal(paused.response.status, 200);
    assert.equal(paused.body.task.controlState, "pause_requested");
    assert.equal(paused.body.task.progress.total, db.listCharacterLibraryBuildItems(created.body.task.id).length);
    const liveSnapshot = await readFirstSseEvent(`${base}${api.characterLibraryBuildEventsUrl(created.body.task.id)}`);
    assert.equal(liveSnapshot.task.controlState, "pause_requested");
    assert.equal(liveSnapshot.task.status, db.getCharacterLibraryBuild(created.body.task.id).status === "running" ? "paused" : db.getCharacterLibraryBuild(created.body.task.id).status);

    await stopChildProcess(server);
    server = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve("."),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: tempDir },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForHttpServer(`${base}/api/health`, server);
    const resumed = await fetchJson(`${base}${api.characterLibraryBuildUrl(created.body.task.id)}/resume`, { method: "POST" });
    assert.equal(resumed.response.status, 202);
    assert.equal(resumed.body.task.id, created.body.task.id);
    assert.equal(db.getCharacterLibraryBuild(created.body.task.id).control_state, "active");
    const cancelled = await fetchJson(`${base}${api.characterLibraryBuildUrl(created.body.task.id)}/cancel`, { method: "POST" });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.task.controlState, "cancel_requested");
    assert.equal(cancelled.body.task.events.at(-1).type, "progress");
    await waitForCharacterBuildStatus(base, created.body.task.id, "cancelled");
    const terminalEvents = await fetch(`${base}${api.characterLibraryBuildEventsUrl(created.body.task.id)}`);
    const terminalEventText = await terminalEvents.text();
    assert.match(terminalEventText, /event: snapshot/);
    assert.match(terminalEventText, /"status":"cancelled"/);

    assert.equal((await fetch(`${base}${api.characterLibraryBuildUrl(currentBuild.id)}/resume`, { method: "POST" })).status, 409);
    assert.equal((await fetch(`${base}${api.characterLibraryBuildUrl(currentBuild.id)}/pause`, { method: "POST" })).status, 409);
    assert.equal((await fetch(`${base}${api.characterLibraryBuildUrl(currentBuild.id)}/cancel`, { method: "POST" })).status, 409);

    assert.equal((await fetch(`${base}/api/books/missing/character-library`)).status, 404);
    assert.equal((await fetch(`${base}/api/character-library-builds/missing`)).status, 404);
    assert.equal((await fetch(`${base}${api.characterUrl(bookId, "missing")}`)).status, 404);
  } finally {
    await stopChildProcess(server);
  }
});

test("character library unchanged character is reused without a Dify call", async () => {
  const bookId = "character-zero-call-reuse-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  const fact = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1 }).items[0];
  const fingerprint = characterLibrary.characterFactFingerprint(fact);
  const seedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "reuse-seed" });
  db.replaceCharacterProjection(seedBuild.id, [{
    id: "reused-character",
    canonical_name: "沈昭",
    stages: [{ id: "reused-stage", name: "默认阶段", facts: [{ ...fact, fingerprint }] }]
  }]);
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("unchanged character must not call Dify");
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    assert.equal(calls, 0);
    assert.equal(db.listCharacterLibraryCharacters({ bookId })[0].id, "reused-character");
    assert.equal(db.listCharacterLibraryBuildItems(db.getCharacterLibraryStatus(bookId).build_id)[0].status, "reused");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library unchanged confirmed alias component is reused without Dify", async () => {
  const bookId = "character-alias-zero-call-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: "沈昭又名昭昭", evidence: ["沈昭又名昭昭"] },
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] },
    { category: "character", entity: "昭昭", fact_type: "appearance", fact: "昭昭身形清瘦", evidence: ["身形清瘦"] }
  ]);
  const facts = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1 }).items
    .map((fact) => ({ ...fact, fingerprint: characterLibrary.characterFactFingerprint(fact) }));
  const seedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "alias-reuse-seed" });
  db.replaceCharacterProjection(seedBuild.id, [{
    id: "alias-reused-character",
    canonical_name: "沈昭",
    aliases: ["昭昭"],
    stages: [{ id: "alias-reused-stage", name: "默认阶段", facts }]
  }]);
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("unchanged alias component must not call Dify");
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    assert.equal(calls, 0);
    assert.equal(db.listCharacterLibraryCharacters({ bookId })[0].id, "alias-reused-character");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library alias change rebuilds only its connected component", async () => {
  const bookId = "character-alias-component-book";
  const { group, chapter } = seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: "沈昭又名昭昭", evidence: ["沈昭又名昭昭"] },
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] },
    { category: "character", entity: "昭昭", fact_type: "appearance", fact: "昭昭身形清瘦", evidence: ["身形清瘦"] },
    { category: "character", entity: "顾南风", fact_type: "appearance", fact: "顾南风眼型狭长", evidence: ["眼型狭长"] }
  ]);
  const oldFacts = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1 }).items;
  const oldBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "alias-component-seed" });
  db.replaceCharacterProjection(oldBuild.id, [
    { id: "old-alias-component", canonical_name: "沈昭", aliases: ["昭昭"], stages: [{ id: "old-alias-stage", name: "默认阶段", facts: oldFacts.filter((fact) => ["沈昭", "昭昭"].includes(fact.entity)).map((fact) => ({ ...fact, fingerprint: characterLibrary.characterFactFingerprint(fact) })) }] },
    { id: "old-unaffected", canonical_name: "顾南风", stages: [{ id: "old-unaffected-stage", name: "默认阶段", facts: oldFacts.filter((fact) => fact.entity === "顾南风").map((fact) => ({ ...fact, fingerprint: characterLibrary.characterFactFingerprint(fact) })) }] }
  ]);
  db.saveL2ChapterFacts({
    bookId, indexGroupKey: "characters", chapterIndex: 1, status: "completed", sourceHash: chapter.content_hash,
    model: workflows.l2IndexExecutionSignature(), promptHash: db.indexGroupL2PromptHash(group), schemaVersion: "l2-facts-v1",
    facts: [
      { category: "character", entity: "沈昭", aliases: ["阿昭"], fact_type: "alias", fact: "沈昭又名阿昭", evidence: ["沈昭又名阿昭"] },
      { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] },
      { category: "character", entity: "阿昭", fact_type: "appearance", fact: "阿昭身形清瘦", evidence: ["身形清瘦"] },
      { category: "character", entity: "顾南风", fact_type: "appearance", fact: "顾南风眼型狭长", evidence: ["眼型狭长"] }
    ]
  });
  const previousFetch = global.fetch;
  const calledNames = [];
  global.fetch = async (_url, request = {}) => {
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    calledNames.push(context.character.canonical_name);
    return difyWorkflowResponse({ result: JSON.stringify(characterProfileFixture(context.character.canonical_name)) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    assert.equal(calledNames.includes("顾南风"), false);
    assert.equal(calledNames.length > 0, true);
    assert.equal(db.listCharacterLibraryCharacters({ bookId }).some((row) => row.id === "old-unaffected"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library partial coverage keeps an unconfirmed previous character stale", async () => {
  const bookId = "character-partial-stale-book";
  const { group } = seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  db.saveChapter({ bookId, chapterIndex: 2, title: "第二章", content: "顾南风出场" });
  const chapter2 = db.getChapterMetadata(bookId, 2);
  const prompts = db.getBookIndexPrompts(bookId);
  db.saveL1ChapterIndex({
    bookId, chapterIndex: 2, status: "completed", sourceHash: chapter2.content_hash,
    model: workflows.l1IndexExecutionSignature(), promptHash: db.bookL1IndexPromptHash(prompts), value: {}
  });
  db.saveL2ChapterStatus({
    bookId, indexGroupKey: "characters", chapterIndex: 2, status: "failed", sourceHash: chapter2.content_hash,
    model: workflows.l2IndexExecutionSignature(), promptHash: db.indexGroupL2PromptHash(group), schemaVersion: "l2-facts-v1", factsCount: 0,
    errorSummary: "failed"
  });
  const seedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 2, sourceFingerprint: "partial-seed" });
  db.replaceCharacterProjection(seedBuild.id, [{
    id: "old-missing-character",
    canonical_name: "顾南风",
    stages: [{ id: "old-missing-stage", name: "默认阶段", facts: [{ fingerprint: "old-chapter-2", chapter_index: 2, fact: "顾南风出场", evidence: ["顾南风出场"] }] }]
  }]);
  const previousFetch = global.fetch;
  global.fetch = async (_url, request = {}) => {
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    return difyWorkflowResponse({ result: JSON.stringify(characterProfileFixture(context.character.canonical_name)) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 2 });
    await waitForTask(task);
    const rows = db.listCharacterLibraryCharacters({ bookId });
    const stale = rows.find((row) => row.id === "old-missing-character");
    assert.equal(db.getCharacterLibraryStatus(bookId).status, "partial");
    assert.equal(stale.quality_status, "stale");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library partial coverage deletes an old character whose source chapters are fresh", async () => {
  const bookId = "character-partial-confirmed-delete-book";
  const { group } = seedCharacterLibraryWorkflowBook(bookId, []);
  db.saveChapter({ bookId, chapterIndex: 2, title: "第二章", content: "本章索引失败" });
  const chapter2 = db.getChapterMetadata(bookId, 2);
  db.saveL2ChapterStatus({
    bookId, indexGroupKey: "characters", chapterIndex: 2, status: "failed", sourceHash: chapter2.content_hash,
    model: workflows.l2IndexExecutionSignature(), promptHash: db.indexGroupL2PromptHash(group), schemaVersion: "l2-facts-v1", factsCount: 0,
    errorSummary: "failed"
  });
  const seedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 2, sourceFingerprint: "confirmed-delete-seed" });
  db.replaceCharacterProjection(seedBuild.id, [{
    id: "fresh-deleted-character",
    canonical_name: "沈昭",
    stages: [{ id: "fresh-deleted-stage", name: "默认阶段", facts: [{ fingerprint: "fresh-old-fact", chapter_index: 1, fact: "旧事实", evidence: ["旧证据"] }] }]
  }]);
  const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 2 });
  await waitForTask(task);
  assert.equal(db.getCharacterLibraryStatus(bookId).status, "partial");
  assert.equal(db.listCharacterLibraryCharacters({ bookId }).some((row) => row.id === "fresh-deleted-character"), false);
});

test("character library empty fresh chapter intersection ignores stale L2 facts", async () => {
  const bookId = "character-empty-fresh-intersection-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  db.saveChapter({ bookId, chapterIndex: 1, title: "第一章", content: "章节正文已经修改" });

  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("empty fresh chapter intersection must not call Dify");
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    const status = db.getCharacterLibraryStatus(bookId);
    assert.equal(calls, 0);
    assert.equal(status.status, "partial");
    assert.deepEqual(status.coverage.failed_chapters, [1]);
    assert.equal(status.character_count, 0);
    assert.equal(db.listCharacterLibraryBuildItems(status.build_id).length, 0);
    assert.equal(db.listCharacterLibraryCharacters({ bookId }).length, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library build persists profiles and atomically activates a complete candidate set", async () => {
  const bookId = "character-build-workflow-book";
  db.ensureBook(bookId, "角色构建编排测试书");
  const group = db.createBookIndexGroup(bookId, {
    group_key: "characters",
    name: "角色",
    category_scope: ["character"],
    l2_index_prompt: "角色事实"
  });
  db.saveChapter({ bookId, chapterIndex: 1, title: "第一章", content: "沈昭眉尾有痣。" });
  const chapter = db.getChapterMetadata(bookId, 1);
  const prompts = db.getBookIndexPrompts(bookId);
  db.saveL1ChapterIndex({
    bookId,
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: workflows.l1IndexExecutionSignature(),
    promptHash: db.bookL1IndexPromptHash(prompts),
    value: {}
  });
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "characters",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: workflows.l2IndexExecutionSignature(),
    promptHash: db.indexGroupL2PromptHash(group),
    schemaVersion: "l2-facts-v1",
    facts: [{ category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }]
  });
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, request = {}) => {
    calls += 1;
    const body = JSON.parse(request.body);
    assert.deepEqual(Object.keys(JSON.parse(body.inputs.context_json)).sort(), ["book", "character", "stages"]);
    return difyWorkflowResponse({ result: JSON.stringify({
      canonical_name: "沈昭",
      gender: "女",
      aliases: [],
      stages: [{
        name: "默认阶段",
        stage_hint: "",
        stage_type: "age",
        stage_stability: "uncertain",
        stable_difference: false,
        age: "",
        identity_profession: "",
        stable_appearance: "眉尾有痣",
        stable_temperament: "冷静",
        original_facial_features: "眉尾有痣",
        designed_facial_features: "细长眼型",
        design_basis: ["眉尾有痣"],
        evidence: ["眉尾有痣"],
        quality_warnings: []
      }]
    }) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    assert.equal(calls, 2);
    const status = db.getCharacterLibraryStatus(bookId);
    assert.equal(status.status, "completed");
    assert.equal(status.character_count, 1);
    assert.equal(db.listCharacterLibraryBuildItems(status.build_id)[0].status, "succeeded");
    assert.equal(db.listCharacterLibraryCharacters({ bookId })[0].canonical_name, "沈昭");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library failure reuses the previous character and activates a partial projection", async () => {
  const bookId = "character-build-workflow-book";
  const chapter = db.getChapterMetadata(bookId, 1);
  const group = db.getBookIndexGroup(bookId, "characters");
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "characters",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: workflows.l2IndexExecutionSignature(),
    promptHash: db.indexGroupL2PromptHash(group),
    schemaVersion: "l2-facts-v1",
    facts: [{ category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣，身形清瘦", evidence: ["眉尾有痣，身形清瘦"] }]
  });
  const previous = db.listCharacterLibraryCharacters({ bookId })[0];
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 2) return new Response(JSON.stringify({ message: "profile unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    return difyWorkflowResponse({ result: JSON.stringify({
      canonical_name: "沈昭",
      gender: "女",
      aliases: [],
      stages: [{
        name: "默认阶段", stage_hint: "", stage_type: "age", stage_stability: "uncertain", stable_difference: false,
        age: "", identity_profession: "", stable_appearance: "清瘦", stable_temperament: "冷静",
        original_facial_features: "眉尾有痣", designed_facial_features: "细长眼型", design_basis: ["清瘦"],
        evidence: ["眉尾有痣，身形清瘦"], quality_warnings: []
      }]
    }) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    const status = db.getCharacterLibraryStatus(bookId);
    const current = db.listCharacterLibraryCharacters({ bookId })[0];
    assert.equal(status.status, "partial");
    assert.equal(status.quality.failed_character_count, 1);
    assert.equal(status.quality.retry_list.length, 1);
    assert.equal(current.id, previous.id);
    assert.equal(current.quality_status, "stale");
    assert.equal(db.listCharacterLibraryBuildItems(status.build_id)[0].status, "failed");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library ambiguous merge failure preserves every related previous character", async () => {
  const bookId = "character-ambiguous-merge-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["沈昭眉尾有痣"] },
    { category: "character", entity: "昭昭", fact_type: "appearance", fact: "昭昭身形清瘦", evidence: ["昭昭身形清瘦"] }
  ]);
  const facts = db.listCharacterL2FactsPage({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1 }).items;
  const oldBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "ambiguous-old" });
  db.replaceCharacterProjection(oldBuild.id, facts.map((fact) => ({
    id: `old:${fact.entity}`,
    canonical_name: fact.entity,
    stages: [{ id: `old:${fact.entity}:default`, name: "默认阶段", facts: [{ ...fact, fingerprint: `old:${characterLibrary.characterFactFingerprint(fact)}` }] }]
  })));
  const previousFetch = global.fetch;
  let calls = 0;
  global.fetch = async (_url, request = {}) => {
    calls += 1;
    if (calls === 3) return new Response(JSON.stringify({ message: "merged profile unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    const context = JSON.parse(JSON.parse(request.body).inputs.context_json);
    const name = context.character.canonical_name;
    return difyWorkflowResponse({ result: JSON.stringify({
      canonical_name: name,
      gender: "",
      aliases: name === "沈昭" ? [{ name: "昭昭", alias_relation: "confirmed", alias_confidence: 0.99, evidence: ["沈昭又名昭昭"], quality_warnings: [] }] : [],
      stages: [{
        name: "默认阶段", stage_hint: "", stage_type: "age", stage_stability: "uncertain", stable_difference: false,
        age: "", identity_profession: "", stable_appearance: "", stable_temperament: "", original_facial_features: "",
        designed_facial_features: "", design_basis: [], evidence: ["原文证据"], quality_warnings: []
      }]
    }) });
  };
  try {
    const task = workflows.startCharacterLibraryTask({ book_id: bookId, index_group_key: "characters", start_chapter: 1, end_chapter: 1 });
    await waitForTask(task);
    const rows = db.listCharacterLibraryCharacters({ bookId });
    assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(["old:沈昭", "old:昭昭"]));
    assert.equal(rows.every((row) => row.quality_status === "stale"), true);
    assert.equal(db.getCharacterLibraryStatus(bookId).status, "partial");
  } finally {
    global.fetch = previousFetch;
  }
});

test("character library resume rejects mismatched scope and source fingerprint", async () => {
  const bookId = "character-resume-mismatch-book";
  seedCharacterLibraryWorkflowBook(bookId, [
    { category: "character", entity: "沈昭", fact_type: "appearance", fact: "沈昭眉尾有痣", evidence: ["眉尾有痣"] }
  ]);
  const seedBuild = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "seed" });
  db.replaceCharacterProjection(seedBuild.id, [{
    id: "resume-old-character",
    canonical_name: "沈昭",
    stages: [{ id: "resume-old-stage", name: "默认阶段", facts: [] }]
  }]);
  const scopeMismatch = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "scope-mismatch" });
  const scopeTask = workflows.startCharacterLibraryTask({
    build_id: scopeMismatch.id,
    book_id: bookId,
    index_group_key: "characters",
    start_chapter: 1,
    end_chapter: 2
  });
  await waitForTerminalTask(scopeTask);
  assert.equal(scopeTask.status, "failed");
  assert.match(scopeTask.error, /scope mismatch/);
  assert.equal(db.getCharacterLibraryBuild(scopeMismatch.id).status, "failed");

  const sourceMismatch = db.createCharacterLibraryBuild({ bookId, indexGroupKey: "characters", startChapter: 1, endChapter: 1, sourceFingerprint: "source-mismatch" });
  const sourceTask = workflows.startCharacterLibraryTask({
    build_id: sourceMismatch.id,
    book_id: bookId,
    index_group_key: "characters",
    start_chapter: 1,
    end_chapter: 1
  });
  await waitForTerminalTask(sourceTask);
  assert.equal(sourceTask.status, "failed");
  assert.match(sourceTask.error, /source mismatch/);
  assert.equal(db.getCharacterLibraryBuild(sourceMismatch.id).status, "failed");
});

test("character profile schema and inputs preserve the structured contract", () => {
  const schema = indexingInputs.characterProfileSchema();
  assert.deepEqual(schema.properties.aliases.items.properties.alias_relation.enum, ["confirmed", "candidate", "rejected"]);
  assert.deepEqual(schema.properties.stages.items.properties.stage_type.enum, ["age", "form", "identity"]);
  assert.deepEqual(schema.properties.stages.items.properties.stage_stability.enum, ["stable", "temporary", "uncertain"]);
  assert.equal(schema.properties.stages.items.properties.stable_difference.type, "boolean");
  assert.equal(schema.required.includes("aliases"), true);
  assert.equal(schema.required.includes("stages"), true);

  const inputs = indexingInputs.buildCharacterProfileInputs({
    book: { book_id: "book-1", book_name: "测试书" },
    character: { canonical_name: "沈昭", aliases: ["昭昭"] },
    stages: [{ name: "默认阶段", facts: [{ fact: "眉尾有痣", evidence: ["原文证据"] }] }]
  });
  assert.equal(JSON.parse(inputs.book_json).book_id, "book-1");
  assert.equal(JSON.parse(inputs.character_json).canonical_name, "沈昭");
  assert.equal(JSON.parse(inputs.stages_json)[0].facts[0].fact, "眉尾有痣");
  assert.deepEqual(JSON.parse(inputs.schema_json), schema);
  assert.match(inputs.prompt, /临时伤病/);
  assert.match(inputs.prompt, /设计五官/);
});

test("normalizes character profiles while separating facts from design", () => {
  const profile = dify.normalizeCharacterProfileOutput({ result: JSON.stringify({
    canonical_name: "沈昭",
    gender: "女",
    aliases: [{ name: "昭昭", alias_relation: "confirmed", alias_confidence: 0.96, evidence: ["她自幼便被唤作昭昭"], quality_warnings: [] }],
    stages: [{
      name: "默认阶段",
      stage_hint: "成年",
      stage_type: "age",
      stage_stability: "stable",
      stable_difference: true,
      age: "二十岁左右",
      identity_profession: "医者",
      stable_appearance: "清瘦，眉尾有痣",
      stable_temperament: "冷静克制",
      original_facial_features: "眉尾有痣",
      designed_facial_features: "窄长眼型，眉峰平直",
      design_basis: ["清瘦", "冷静克制"],
      evidence: ["她约莫二十岁，身形清瘦"],
      quality_warnings: []
    }]
  }) });
  assert.equal(profile.aliases[0].alias_relation, "confirmed");
  assert.equal(profile.stages[0].stage_stability, "stable");
  assert.equal(profile.stages[0].original_facial_features, "眉尾有痣");
  assert.equal(profile.stages[0].designed_facial_features, "窄长眼型，眉峰平直");
  assert.deepEqual(profile.stages[0].design_basis, ["清瘦", "冷静克制"]);
});

test("character profile normalization degrades invalid or unsupported claims", () => {
  const profile = dify.normalizeCharacterProfileOutput({ output: {
    canonical_name: "沈昭",
    aliases: [{ name: "昭昭", alias_relation: "certain", alias_confidence: 8, evidence: [], quality_warnings: [] }],
    stages: [{
      name: "战损",
      stage_hint: "战损",
      stage_type: "costume",
      stage_stability: "forever",
      stable_difference: "yes",
      original_facial_features: "",
      designed_facial_features: "凤眼",
      evidence: [],
      quality_warnings: ["模型警告", "模型警告"]
    }]
  } });
  assert.equal(profile.aliases[0].alias_relation, "candidate");
  assert.equal(profile.aliases[0].alias_confidence, 1);
  assert.equal(profile.aliases[0].quality_warnings.length > 0, true);
  assert.equal(profile.stages[0].stage_type, "");
  assert.equal(profile.stages[0].stage_stability, "uncertain");
  assert.equal(profile.stages[0].stable_difference, false);
  assert.equal(profile.stages[0].original_facial_features, "");
  assert.equal(profile.stages[0].designed_facial_features, "凤眼");
  assert.equal(new Set(profile.stages[0].quality_warnings).size, profile.stages[0].quality_warnings.length);
});

test("character fact fingerprints normalize invalid chapter indexes", () => {
  const base = {
    book_id: "book-1",
    index_group_key: "characters",
    fact: "顾南风有一双狭长凤眼",
    evidence: ["那双狭长的凤眼微微抬起"]
  };
  assert.equal(
    characterLibrary.characterFactFingerprint({ ...base, chapter_index: "invalid" }),
    characterLibrary.characterFactFingerprint({ ...base, chapter_index: "" })
  );
});

test("character fact fingerprints include every stable source field", () => {
  const base = {
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: 12,
    fact: "顾南风有一双狭长凤眼",
    evidence: ["他 眸光沉静", "那双狭长的凤眼微微抬起"]
  };
  const fingerprint = characterLibrary.characterFactFingerprint(base);

  assert.notEqual(fingerprint, characterLibrary.characterFactFingerprint({ ...base, book_id: "book-2" }));
  assert.notEqual(fingerprint, characterLibrary.characterFactFingerprint({ ...base, index_group_key: "people" }));
  assert.notEqual(fingerprint, characterLibrary.characterFactFingerprint({ ...base, chapter_index: 13 }));
  assert.notEqual(fingerprint, characterLibrary.characterFactFingerprint({ ...base, evidence: ["不同证据"] }));
});

test("character fact fingerprint matches the fixed SHA-256 contract", () => {
  assert.equal(
    characterLibrary.characterFactFingerprint({
      book_id: "book-1",
      index_group_key: "characters",
      chapter_index: 12,
      fact: "顾南风有一双狭长凤眼",
      evidence: ["他 眸光沉静", "那双狭长的凤眼微微抬起"]
    }),
    "8cd8aba48ee91709ea85f624479a4f7ca44976b260ba4364a4fb22d26104b8ff"
  );
});

test("builds Dify batches and normalizes chapter output", () => {
  assert.deepEqual(dify.buildChapterBatches(1, 25, 10), [
    { startChapter: 1, endChapter: 10 },
    { startChapter: 11, endChapter: 20 },
    { startChapter: 21, endChapter: 25 }
  ]);

  const chapters = dify.normalizeDifyChapterOutput(
    JSON.stringify({
      chapters: [
        { chapter_index: 1, title: "第一章", content: "正文一" },
        { sortid: 2, chapter_title: "第二章", text: "正文二" }
      ]
    }),
    { bookId: "215243", startChapter: 1, endChapter: 2 }
  );

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].chapter_title, "第一章");
  assert.equal(chapters[1].chapter_index, 2);
  assert.equal(chapters[1].content, "正文二");
});

test("normalizes Dify L1/L2 workflow outputs from result/text/output/data envelopes", () => {
  const l1 = dify.normalizeDifyL1Output({
    result: JSON.stringify({
      route_schema_version: "l1-route-v1",
      route_entities: [{ name: "陈平安", type: "character", aliases: ["平安"], role: "主角", note: "核心主体" }],
      route_keywords: ["陈平安", "飞剑"],
      signals: [{ category: "item", strength: 0.9, entities: ["飞剑"], keywords: ["飞剑"], reason: "高价值物件" }],
      category_scores: { item: 0.9 }
    })
  });
  assert.equal(l1.route_schema_version, "l1-route-v1");
  assert.equal(l1.route_entities[0].name, "陈平安");
  assert.equal(l1.category_scores.item, 0.9);
  assert.equal(l1.category_scores.character, 0);

  const l2 = dify.normalizeDifyL2Output({
    output: {
      chapter_index: 221,
      chapter_title: "剑仙来此",
      facts: [{
        category: "item",
        entity: "初一",
        aliases: ["本命飞剑"],
        tags: ["飞剑"],
        related_entities: ["陈平安"],
        fact_type: "origin",
        fact: "初一是陈平安本命飞剑之一。",
        evidence: ["本命飞剑"],
        importance: 0.8,
        confidence: 0.9
      }]
    }
  });
  assert.equal(l2.chapter_index, 221);
  assert.equal(l2.chapter_title, "剑仙来此");
  assert.equal(l2.facts.length, 1);
  assert.equal(l2.facts[0].entity, "初一");
  assert.equal(l2.facts[0].category, "item");
  assert.equal(l2.facts[0].scope_fields_complete, false);
});

test("l2 schema accepts optional chapter metadata", () => {
  const schema = indexingInputs.l2ChapterFactsSchema();
  assert.equal(schema.properties.chapter_index.type, "integer");
  assert.equal(schema.properties.chapter_title.type, "string");
  assert.equal(schema.required.includes("facts"), true);
});

test("tests Dify connection with target-specific API keys", async () => {
  const previousFetch = global.fetch;
  const seenTokens = [];
  global.fetch = async (_url, request = {}) => {
    seenTokens.push(String(request.headers?.Authorization || ""));
    return difyParametersResponse();
  };

  try {
    await dify.testDifyConnection({ target: "import" });
    await dify.testDifyConnection({ target: "l1" });
    await dify.testDifyConnection({ target: "l2" });
    await dify.testDifyConnection({ target: "analysis_summary" });
    assert.equal(seenTokens.includes("Bearer app-test"), true);
    assert.equal(seenTokens.includes("Bearer app-l1-test"), true);
    assert.equal(seenTokens.includes("Bearer app-l2-test"), true);
    assert.equal(seenTokens.includes("Bearer app-analysis-summary-test"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("retries transient Dify connection failures with a target label", async () => {
  const previousFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("fetch failed");
    }
    return difyParametersResponse();
  };

  try {
    const result = await dify.testDifyConnection({ target: "analysis_summary" });
    assert.equal(result.ok, true);
    assert.equal(attempts, 3);
  } finally {
    global.fetch = previousFetch;
  }
});

test("labels Dify connection failures after short retry exhaustion", async () => {
  const previousFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () => dify.testDifyConnection({ target: "l1" }),
      /无法连接 Dify API：l1 parameters @ .*fetch failed.*已重试 3\/3/
    );
    assert.equal(attempts, 3);
  } finally {
    global.fetch = previousFetch;
  }
});

test("retries transient Dify workflow failures with a target label", async () => {
  const previousFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new Error("fetch failed");
    }
    return difyWorkflowResponse({ result: "ok" });
  };

  try {
    const outputs = await dify.runDifyWorkflow({
      apiKey: "app-analysis-summary-test",
      inputs: {},
      target: "analysis_summary"
    });
    assert.deepEqual(outputs, { result: "ok" });
    assert.equal(attempts, 2);
  } finally {
    global.fetch = previousFetch;
  }
});

test("stores chapter content in plaintext with a sha256 content hash", async () => {
  const plainText = "固定测试短句-应以明文写入数据库";
  db.saveChapter({
    bookId: "plain-book",
    chapterIndex: 1,
    title: "明文章",
    content: plainText
  });

  const meta = db.getChapterMetadata("plain-book", 1);
  assert.equal(meta.content_length, plainText.length);
  assert.equal(meta.title, "明文章");
  assert.equal(meta.content_hash, sha256Text(plainText));
  assert.equal(db.getChapterContent("plain-book", 1), plainText);

  const dbBytes = await readDatabaseBytes();
  assert.equal(dbBytes.includes(Buffer.from(plainText)), true);
});

test("stores summary parts in plaintext and exposes resumable metadata", async () => {
  const partResult = { value: "汇总分块明文内容" };
  db.ensureBook("summary-part-book", "分块测试书");
  db.createAnalysisRun({
    id: "analysis-summary-part-plain",
    name: "分块测试",
    bookId: "summary-part-book",
    startChapter: 1,
    endChapter: 1,
    chapterSelection: { mode: "range", chapter_indexes: [1] },
    model: "dify:analysis_summary:v1",
    reasoningEffort: "medium",
    promptHash: "prompt-hash",
    schemaHash: "schema-hash",
    chapterCount: 1,
    promptSnapshot: { analysis_mode: "l2_query", query: "测试查询", index_group_keys: ["base"] }
  });

  db.saveAnalysisSummaryPart({
    analysisId: "analysis-summary-part-plain",
    partKey: "l2_query.batch.001",
    parentKey: "l2_query.final.merge",
    stage: "text_l2_query_batch",
    status: "completed",
    contentHash: "content-hash",
    promptHash: "prompt-hash",
    schemaHash: "",
    model: "dify:analysis_summary:v1",
    reasoningEffort: "low",
    inputSummary: "测试分块",
    result: partResult
  });

  const meta = db.getAnalysisSummaryPartMetadata("analysis-summary-part-plain", "l2_query.batch.001");
  assert.equal(meta.status, "completed");
  assert.equal(meta.has_result, true);
  assert.equal(meta.input_summary, "测试分块");
  assert.deepEqual(db.getAnalysisSummaryPartResult("analysis-summary-part-plain", "l2_query.batch.001"), partResult);

  const run = db.getAnalysisRun("analysis-summary-part-plain");
  assert.equal(run.prompt_snapshot.includes("测试查询"), true);
  const dbBytes = await readDatabaseBytes();
  assert.equal(dbBytes.includes(Buffer.from("汇总分块明文内容")), true);
});

test("analysis summary parts expose source trace metadata without raw evidence text", () => {
  db.saveAnalysisSummaryPart({
    analysisId: "analysis-summary-part-plain",
    partKey: "l2_query.batch.002",
    parentKey: "l2_query.final.merge",
    stage: "text_l2_query_batch",
    status: "completed",
    contentHash: "trace-content-hash",
    promptHash: "prompt-hash",
    schemaHash: "",
    model: "dify:analysis_summary:v1",
    reasoningEffort: "low",
    inputSummary: "追踪分块",
    traceSummary: {
      field_name: "l2_query",
      evidence_packet_count: 2,
      source_types: { l2_fact: 2 },
      chapters: { count: 2, min: 1, max: 8, sample: [1, 8] },
      categories: { character: 2 },
      subjects: ["云筝"]
    },
    result: { value: "追踪结果" }
  });

  const meta = db.getAnalysisSummaryPartMetadata("analysis-summary-part-plain", "l2_query.batch.002");
  assert.equal(meta.trace_summary.evidence_packet_count, 2);
  assert.deepEqual(meta.trace_summary.source_types, { l2_fact: 2 });
  assert.equal(JSON.stringify(meta.trace_summary).includes("l2_query"), true);
  assert.equal(JSON.stringify(meta.trace_summary).includes("云筝"), true);
});

test("database diagnostics expose metadata without chapter content", async () => {
  const plainText = "诊断接口不应回传的章节正文";
  db.saveChapter({
    bookId: "diagnostic-book",
    chapterIndex: 1,
    title: "诊断章节",
    content: plainText
  });
  const chapter = db.getChapterMetadata("diagnostic-book", 1);
  db.saveL1ChapterIndex({
    bookId: "diagnostic-book",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l1:v1",
    promptHash: "l1-route-v1",
    value: {
      summary: "不应出现在诊断中的 L1 摘要",
      keywords: ["秘密关键词"],
      entities: ["秘密人物"],
      key_events: [],
      items_places_orgs: [],
      open_questions: []
    }
  });
  db.saveL2ChapterFacts({
    bookId: "diagnostic-book",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "character",
      entity: "公开主体",
      fact: "不应出现在诊断中的 L2 事实正文",
      evidence: ["不应出现在诊断中的证据摘记"],
      importance: 0.8,
      confidence: 0.8
    }]
  });

  const diagnostics = db.getDatabaseDiagnostics();
  const serialized = JSON.stringify(diagnostics);
  assert.equal(diagnostics.totals.books >= 1, true);
  assert.equal(diagnostics.totals.chapters >= 1, true);
  assert.equal(serialized.includes("diagnostic-book"), true);
  assert.equal(serialized.includes(plainText), false);
  assert.equal(serialized.includes("不应出现在诊断中的 L1 摘要"), false);
  assert.equal(serialized.includes("不应出现在诊断中的 L2 事实正文"), false);
  assert.equal(serialized.includes("不应出现在诊断中的证据摘记"), false);

  const dbBytes = await readDatabaseBytes();
  assert.equal(dbBytes.includes(Buffer.from(plainText)), true);
});

test("binds one book name to each novel id", () => {
  const first = db.ensureBook("named-book", "第一本书");
  assert.equal(first.book_name, "第一本书");
  assert.equal(db.getBookIndexPrompts("named-book").book_id, "named-book");

  const same = db.ensureBook("named-book", "第一本书");
  assert.equal(same.book_name, "第一本书");

  assert.throws(
    () => db.ensureBook("named-book", "另一个名字"),
    /已绑定书名/
  );
});

test("task lifecycle supports pause, resume, and cancel states", async () => {
  const task = tasks.createTask("test-lifecycle");
  tasks.markTaskRunning(task);

  const paused = tasks.pauseTask(task.id);
  assert.equal(paused.status, "paused");

  let resumed = false;
  const waiting = tasks.waitIfPaused(task).then(() => {
    resumed = true;
  });
  setTimeout(() => tasks.resumeTask(task.id), 30);
  await waiting;
  assert.equal(resumed, true);
  assert.equal(task.status, "running");

  const cancelled = tasks.cancelTask(task.id);
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => tasks.assertNotCancelled(task), /任务已取消/);
});

test("task estimate uses processed units and excludes paused time", async () => {
  const task = tasks.createTask("test-estimate");
  tasks.markTaskRunning(task, {
    progress: {
      total: 5,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: "开始"
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  tasks.updateTask(task, {
    progress: {
      ...task.progress,
      completed: 1,
      current: "完成 1"
    }
  });
  const firstEstimate = tasks.publicTask(task).estimate;
  assert.equal(firstEstimate.processed, 1);
  assert.equal(firstEstimate.total, 5);
  assert.equal(firstEstimate.remainingMs > 0, true);

  tasks.pauseTask(task.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pausedEstimate = tasks.publicTask(task).estimate;
  tasks.resumeTask(task.id);

  await new Promise((resolve) => setTimeout(resolve, 20));
  tasks.updateTask(task, {
    progress: {
      ...task.progress,
      skipped: 2,
      current: "跳过 2"
    }
  });
  const afterSkipEstimate = tasks.publicTask(task).estimate;
  assert.equal(afterSkipEstimate.processed, 3);
  assert.equal(afterSkipEstimate.elapsedMs < pausedEstimate.elapsedMs + 45, true);
  assert.equal(afterSkipEstimate.sampleSize > 0, true);
});

test("analysis coverage note includes every bound index group", async () => {
  const { analysisIndexCoverageText } = await import("../src/analysisCoverage.js");
  const note = analysisIndexCoverageText({
    indexGroupKeys: ["appearance", "items"],
    indexGroups: [
      { group_key: "appearance", name: "人物形象" },
      { group_key: "items", name: "法宝武器" }
    ],
    coveragesByGroup: {
      appearance: { chapters: { completed: 100, total: 120, facts: 320 } },
      items: { chapters: { completed: 80, total: 120, facts: 210 } }
    }
  });

  assert.equal(note, "事实索引 人物形象 100/120 章，320 条；法宝武器 80/120 章，210 条");
});

test("infers result tables from default and custom JSON result shapes", () => {
  const defaultTables = schemaTools.tableViewsFromJson({
    title: "人物汇总",
    summary: "摘要",
    items: [
      { name: "陈平安", chapters: [1, 2], confidence: 0.9 },
      { name: "齐静春", chapters: [3], note: "先生" }
    ],
    failed_chapters: []
  });
  assert.equal(defaultTables[0].key, "items");
  assert.deepEqual(defaultTables[0].columns.map((column) => column.key), ["name", "chapters", "confidence", "note"]);
  assert.equal(defaultTables[0].rows.length, 2);

  const customTables = schemaTools.tableViewsFromJson({
    roles: [{ name: "陈平安", identity: "少年" }],
    world_rules: ["规矩一", "规矩二"],
    note: "按自定义 JSON 输出"
  });
  assert.equal(customTables.length, 2);
  assert.equal(customTables.some((table) => table.key === "roles" && table.columns.some((column) => column.key === "identity")), true);
  assert.equal(customTables.some((table) => table.key === "world_rules" && table.columns[0].key === "value"), true);

  const stringTables = schemaTools.tableViewsFromJson(JSON.stringify([{ name: "宁姚", chapters: [10] }]));
  assert.equal(stringTables[0].rows[0].name, "宁姚");
  assert.deepEqual(schemaTools.tableViewsFromJson("纯文本结果"), []);
});

test("infers readable tables from nested dossier JSON result shapes", () => {
  const tables = schemaTools.tableViewsFromJson({
    book_name: "剑来",
    topic: "飞剑初一设定集",
    target_item: "初一",
    sword: {
      name: "初一",
      core_profile: "初一是陈平安飞剑体系中的重要飞剑。",
      appearance: {
        after_refine: "如小小白虹，剑身纤细。",
        field_evidence_refs: ["json.sword.batch.001"]
      },
      origin: {
        text: "与陈平安早期飞剑谱系相关。"
      },
      classic_records: [
        { chapter: 221, summary: "初一参与关键战斗。" }
      ]
    },
    global_uncertainties: [
      { value: "来源存在信息不足。" }
    ]
  });

  assert.equal(tables.some((table) => table.key === "sword"), true);
  assert.equal(tables.some((table) => table.key === "global_uncertainties"), true);
  const swordTable = tables.find((table) => table.key === "sword");
  assert.deepEqual(swordTable.columns.map((column) => column.key), ["field", "value"]);
  assert.equal(swordTable.rows.some((row) => row.field === "外形 / 炼化后" && row.value === "如小小白虹，剑身纤细。"), true);
  assert.equal(swordTable.rows.some((row) => row.field === "来源 / text" && row.value === "与陈平安早期飞剑谱系相关。"), true);
  assert.equal(swordTable.rows.some((row) => row.field === "经典记录" && row.value.includes("初一参与关键战斗")), true);
});

test("builds Excel workbook XML from parsed JSON result tables", () => {
  const xml = schemaTools.excelWorkbookXmlFromJson({
    target_item: "初一",
    sword: {
      name: "初一",
      core_profile: "初一 & 十五 <本命飞剑>",
      appearance: {
        after_refine: "如小小白虹，剑身纤细。"
      }
    },
    global_uncertainties: [
      { value: "来源信息不足。" }
    ]
  }, { title: "飞剑初一" });

  assert.equal(xml.includes('<Worksheet ss:Name="飞剑设定">'), true);
  assert.equal(xml.includes('<Worksheet ss:Name="整体不确定性">'), true);
  assert.equal(xml.includes('<Data ss:Type="String">外形 / 炼化后</Data>'), true);
  assert.equal(xml.includes("初一 &amp; 十五 &lt;本命飞剑&gt;"), true);
  assert.equal(schemaTools.excelWorkbookXmlFromJson("纯文本结果"), "");
});

test("imports once, skips stored chapters, and analyzes from the local plaintext store", async () => {
  const previousFetch = global.fetch;
  let importWorkflowCalls = 0;
  let summaryWorkflowCalls = 0;

  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    if (body.inputs?.task_type === "summary") {
      summaryWorkflowCalls += 1;
      return difyWorkflowResponse({ text: "## L2 提问结果\n陈平安在第 1 章得到木剑。" });
    }
    importWorkflowCalls += 1;
    const chapters = [];
    for (let index = body.inputs.start_chapter; index <= body.inputs.end_chapter; index += 1) {
      chapters.push({
        chapter_index: index,
        chapter_title: `第${index}章`,
        content: `测试章节 ${index} 的原文`
      });
    }
    return difyWorkflowResponse({ result: JSON.stringify({ chapters }) });
  };

  try {
    const firstImport = workflows.startImportTask({
      book_id: "book-e2e",
      start_chapter: 1,
      end_chapter: 3
    });
    await waitForTask(firstImport);
    assert.equal(firstImport.status, "completed");
    assert.equal(importWorkflowCalls, 1);
    assert.equal(db.listChapterMetadata("book-e2e").length, 3);
    assert.equal(db.getChapterContent("book-e2e", 2), "测试章节 2 的原文");

    const secondImport = workflows.startImportTask({
      book_id: "book-e2e",
      start_chapter: 1,
      end_chapter: 3
    });
    await waitForTask(secondImport);
    assert.equal(secondImport.progress.skipped, 3);
    assert.equal(importWorkflowCalls, 1);

    const chapter = db.getChapterMetadata("book-e2e", 1);
    db.saveL2ChapterFacts({
      bookId: "book-e2e",
      chapterIndex: 1,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "character",
        entity: "陈平安",
        fact_type: "item_gain",
        fact: "陈平安得到木剑。",
        evidence: ["木剑"],
        importance: 0.8,
        confidence: 0.9
      }]
    });

    const analysis = workflows.startAnalysisTask({
      book_id: "book-e2e",
      start_chapter: 1,
      end_chapter: 3,
      index_group_keys: ["base"],
      query: "陈平安得到了什么"
    });
    await waitForTask(analysis);
    assert.equal(analysis.status, "completed");
    assert.equal(summaryWorkflowCalls, 1);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.finalResult.includes("陈平安在第 1 章得到木剑"), true);
    assert.equal(result.source_stats.analysis_mode, "l2_query");
  } finally {
    global.fetch = previousFetch;
  }
});

test("import preflights Dify token before running chapter batches", async () => {
  const previousFetch = global.fetch;
  let workflowCalls = 0;

  global.fetch = async (url) => {
    if (String(url).includes("/parameters")) {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: "unauthorized", message: "Access token is invalid" })
      };
    }
    if (String(url).includes("/workflows/run")) {
      workflowCalls += 1;
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const task = workflows.startImportTask({
      book_id: "book-dify-token",
      start_chapter: 1,
      end_chapter: 3
    });
    await waitForTerminalTask(task);
    assert.equal(task.status, "failed");
    assert.equal(workflowCalls, 0);
    assert.match(task.error, /Dify .*鉴权失败/);
    assert.match(task.error, /DIFY_CHAPTER_WORKFLOW_API_KEY/);
  } finally {
    global.fetch = previousFetch;
  }
});

test("builds chapter-only L1 indexes via Dify and skips fresh indexes", async () => {
  db.saveChapter({
    bookId: "book-l1-task",
    chapterIndex: 1,
    title: "第一章",
    content: "第一章正文"
  });
  db.saveChapter({
    bookId: "book-l1-task",
    chapterIndex: 2,
    title: "第二章",
    content: "第二章正文"
  });

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  const capturedInputs = [];

  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    workflowCalls += 1;
    const body = JSON.parse(request.body);
    capturedInputs.push(body.inputs);
    return difyWorkflowResponse({
      result: JSON.stringify({
        route_schema_version: "l1-route-v1",
        route_entities: [{ name: "角色", type: "character", aliases: ["别名"], role: "主体", note: "章节主体" }],
        route_keywords: ["关键词"],
        signals: [{ category: "character", strength: 0.8, entities: ["角色"], keywords: ["关键词"], reason: "角色信号" }],
        category_scores: { character: 0.8 }
      })
    });
  };

  try {
    const task = workflows.startL1IndexTask({
      book_id: "book-l1-task",
      start_chapter: 1,
      end_chapter: 2
    });
    await waitForTask(task);
    assert.equal(task.status, "completed");
    assert.equal(workflowCalls, 2);
    const savedIndex = db.getL1ChapterIndex("book-l1-task", 1);
    assert.equal(savedIndex.route_schema_version, "l1-route-v1");
    assert.equal(savedIndex.route_entities[0].name, "角色");
    assert.equal(savedIndex.route_keywords[0], "关键词");
    assert.equal(savedIndex.signals[0].category, "character");
    assert.equal(savedIndex.category_scores.character, 0.8);
    assert.equal(savedIndex.model, "dify:l1:v1");
    assert.equal(capturedInputs[0].chapter_index, 1);
    assert.equal(capturedInputs[0].chapter_title, "第一章");
    assert.equal(capturedInputs[0].chapter_content, "第一章正文");
    assert.equal(typeof capturedInputs[0].index_prompt, "string");

    const skipped = workflows.startL1IndexTask({
      book_id: "book-l1-task",
      start_chapter: 1,
      end_chapter: 2
    });
    await waitForTask(skipped);
    assert.equal(skipped.progress.skipped, 2);
    assert.equal(workflowCalls, 2);
  } finally {
    global.fetch = previousFetch;
  }
});

test("routes L1/L2 single-chapter indexing through Dify and stores workflow signatures", async () => {
  db.saveChapter({
    bookId: "book-dify-index-provider",
    chapterIndex: 1,
    title: "第一章",
    content: "陈平安得到飞剑。"
  });

  const previousFetch = global.fetch;
  const previousL1Version = appConfig.config.dify.l1WorkflowVersion;
  const previousL2Version = appConfig.config.dify.l2WorkflowVersion;
  let l1WorkflowCalls = 0;
  let l2WorkflowCalls = 0;
  const seenInputs = [];

  appConfig.config.dify.l1WorkflowVersion = "v7";
  appConfig.config.dify.l2WorkflowVersion = "v9";

  global.fetch = async (url, request = {}) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    seenInputs.push(body.inputs || {});
    const isL2 = Object.hasOwn(body.inputs || {}, "index_group_key");
    if (isL2) {
      l2WorkflowCalls += 1;
      return difyWorkflowResponse({
        output: JSON.stringify({
          facts: [{
            category: "item",
            entity: "飞剑",
            aliases: ["本命飞剑"],
            tags: ["飞剑"],
            related_entities: ["陈平安"],
            fact_type: "item_gain",
            fact: "陈平安得到飞剑。",
            evidence: ["飞剑"],
            importance: 0.8,
            confidence: 0.9
          }]
        })
      });
    }
    l1WorkflowCalls += 1;
    return difyWorkflowResponse({
      result: JSON.stringify({
        route_schema_version: "l1-route-v1",
        route_entities: [{ name: "陈平安", type: "character", aliases: [], role: "主角", note: "得到飞剑" }],
        route_keywords: ["陈平安", "飞剑"],
        signals: [{ category: "item", strength: 0.8, entities: ["飞剑"], keywords: ["飞剑"], reason: "物件获得" }],
        category_scores: { character: 0.6, item: 0.8, event: 0.4 }
      })
    });
  };

  try {
    const l1Task = workflows.startL1IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l1Task);
    assert.equal(l1Task.status, "completed");
    assert.equal(l1WorkflowCalls, 1);
    assert.equal(db.getL1ChapterIndex("book-dify-index-provider", 1).model, "dify:l1:v7");

    const l2Task = workflows.startL2IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l2Task);
    assert.equal(l2Task.status, "completed");
    assert.equal(l2WorkflowCalls, 1);
    assert.equal(db.getL2ChapterStatus("book-dify-index-provider", 1).model, "dify:l2:v9");
    assert.equal(seenInputs.some((input) => typeof input.l1_route_json === "string"), true);

    const l1Skipped = workflows.startL1IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l1Skipped);
    assert.equal(l1Skipped.progress.skipped, 1);
    assert.equal(l1WorkflowCalls, 1);

    appConfig.config.dify.l1WorkflowVersion = "v8";
    const l1Rebuilt = workflows.startL1IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l1Rebuilt);
    assert.equal(l1Rebuilt.progress.completed, 1);
    assert.equal(l1WorkflowCalls, 2);
    assert.equal(db.getL1ChapterIndex("book-dify-index-provider", 1).model, "dify:l1:v8");

    const l2Skipped = workflows.startL2IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l2Skipped);
    assert.equal(l2Skipped.progress.skipped, 1);
    assert.equal(l2WorkflowCalls, 1);

    appConfig.config.dify.l2WorkflowVersion = "v10";
    const l2Rebuilt = workflows.startL2IndexTask({
      book_id: "book-dify-index-provider",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l2Rebuilt);
    assert.equal(l2Rebuilt.progress.completed, 1);
    assert.equal(l2WorkflowCalls, 2);
    assert.equal(db.getL2ChapterStatus("book-dify-index-provider", 1).model, "dify:l2:v10");
  } finally {
    global.fetch = previousFetch;
    appConfig.config.dify.l1WorkflowVersion = previousL1Version;
    appConfig.config.dify.l2WorkflowVersion = previousL2Version;
  }
});

test("stores L2 facts in plaintext and reports coverage", async () => {
  db.saveChapter({
    bookId: "book-l2-storage",
    chapterIndex: 1,
    title: "第一章",
    content: "陈平安得到木剑。"
  });
  const chapter = db.getChapterMetadata("book-l2-storage", 1);
  db.saveL2ChapterFacts({
    bookId: "book-l2-storage",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "character",
      entity: "陈平安",
      aliases: ["少年"],
      tags: ["木剑"],
      related_entities: ["木剑"],
      fact_type: "item_gain",
      fact: "陈平安得到木剑。",
      evidence: ["得到木剑"],
      importance: 0.8,
      confidence: 0.9
    }]
  });

  const facts = db.listL2Facts({
    bookId: "book-l2-storage",
    startChapter: 1,
    endChapter: 1,
    categories: ["character"],
    entity: "陈平安"
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].fact, "陈平安得到木剑。");
  assert.equal(facts[0].entity, "陈平安");
  const coverage = db.getL2Coverage({
    bookId: "book-l2-storage",
    startChapter: 1,
    endChapter: 1,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1"
  });
  assert.equal(coverage.chapters.completed, 1);
  assert.equal(coverage.chapters.facts, 1);
  const dbBytes = await readDatabaseBytes();
  assert.equal(dbBytes.includes(Buffer.from("陈平安得到木剑。")), true);
});

test("appends historical rescan facts without replacing chapter facts", () => {
  db.saveChapter({
    bookId: "book-l2-history-append",
    chapterIndex: 1,
    title: "历史回扫",
    content: "测试异兽出现。"
  });
  const chapter = db.getChapterMetadata("book-l2-history-append", 1);
  db.saveL2ChapterFacts({
    bookId: "book-l2-history-append",
    indexGroupKey: "magical-creatures",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "history-prompt",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "magical_creature",
      entity: "测试异兽",
      fact_type: "classification",
      fact: "测试异兽被确认属于异兽。",
      evidence: ["异兽"],
      importance: 0.9,
      confidence: 0.9
    }]
  });
  db.appendL2ChapterFacts({
    bookId: "book-l2-history-append",
    indexGroupKey: "magical-creatures",
    chapterIndex: 1,
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "history-prompt",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "magical_creature",
      entity: "测试异兽",
      fact_type: "appearance",
      fact: "测试异兽通体土黄。",
      evidence: ["通体土黄"],
      importance: 0.7,
      confidence: 0.8
    }]
  });
  const facts = db.listL2Facts({
    bookId: "book-l2-history-append",
    indexGroupKeys: ["magical-creatures"],
    startChapter: 1,
    endChapter: 1
  });
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((fact) => fact.fact_type).sort(), ["appearance", "classification"]);
});

test("persists specialized magical creature facts with their declared category", () => {
  db.saveChapter({
    bookId: "book-magical-category",
    chapterIndex: 1,
    title: "白鹿",
    content: "白鹿主动认主。"
  });
  const group = db.createBookIndexGroup("book-magical-category", {
    group_key: "magical-creatures",
    name: "神奇生物",
    category_scope: ["magical_creature"],
    l2_index_prompt: "只提取神奇生物。"
  });
  const chapter = db.getChapterMetadata("book-magical-category", 1);
  db.saveL2ChapterFacts({
    bookId: "book-magical-category",
    indexGroupKey: group.group_key,
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: group.l2_index_prompt_hash,
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "magical_creature",
      entity: "白鹿",
      tags: ["神奇生物", "异兽", "白鹿"],
      fact_type: "classification",
      fact: "白鹿被原文明确称为祥瑞异兽。",
      evidence: ["白鹿主动认主。"],
      importance: 0.9,
      confidence: 0.95
    }]
  });

  const facts = db.listL2Facts({
    bookId: "book-magical-category",
    indexGroupKeys: [group.group_key],
    startChapter: 1,
    endChapter: 1,
    categories: ["magical_creature"]
  });
  assert.deepEqual(group.category_scope, ["magical_creature"]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].category, "magical_creature");
});

test("magical creature index rejects ineligible Dify facts before storage", async () => {
  db.saveChapter({
    bookId: "book-magical-admission",
    chapterIndex: 1,
    title: "资格校验",
    content: "白鹿主动认主，铁匠正在打铁。"
  });
  const group = db.createBookIndexGroup("book-magical-admission", {
    group_key: "magical-creatures",
    name: "神奇生物",
    category_scope: ["magical_creature"],
    l2_index_prompt: "只提取神奇生物。"
  });

  const previousFetch = global.fetch;
  global.fetch = async (url, _request = {}) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) throw new Error(`Unexpected fetch URL: ${url}`);
    return difyWorkflowResponse({
      result: JSON.stringify({
        facts: [
          {
            category: "other",
            entity: "阮师傅",
            tags: ["神奇生物", "器物成精", "铁匠"],
            fact_type: "classification",
            fact: "阮师傅是普通铁匠，未说明其为器物成精。",
            evidence: ["原文称其为铁匠。"],
            importance: 0.8,
            confidence: 0.9,
            scope_eligible: false,
            scope_basis: ""
          },
          {
            category: "magical_creature",
            entity: "锈剑条",
            tags: ["神奇生物", "器物成精", "剑类器物"],
            fact_type: "status_change",
            fact: "本章未说明锈剑条具有独立灵智或化形能力。",
            evidence: ["仅描述其镇压功能。"],
            importance: 0.7,
            confidence: 0.8,
            scope_eligible: false,
            scope_basis: ""
          },
          {
            category: "other",
            entity: "白鹿",
            tags: ["神奇生物", "异兽", "白鹿"],
            fact_type: "classification",
            fact: "白鹿被原文明确称为祥瑞异兽，并主动认主。",
            evidence: ["白鹿主动走出山野大泽认主。"],
            importance: 0.95,
            confidence: 0.98,
            scope_eligible: true,
            scope_basis: "explicit_nonhuman_species"
          }
        ]
      })
    });
  };

  try {
    const task = workflows.startL2IndexTask({
      book_id: "book-magical-admission",
      index_group_key: group.group_key,
      start_chapter: 1,
      end_chapter: 1,
      force: true
    });
    await waitForTask(task);
    const facts = db.listL2Facts({
      bookId: "book-magical-admission",
      indexGroupKeys: [group.group_key],
      startChapter: 1,
      endChapter: 1
    });
    assert.equal(task.status, "completed");
    assert.deepEqual(facts.map((fact) => fact.entity), ["白鹿"]);
    assert.equal(facts[0].category, "magical_creature");
    assert.ok(task.events.some((event) => event.message === "章节 1 生成 3 条，准入 1 条。"));
  } finally {
    global.fetch = previousFetch;
  }
});

test("stores and recalls verified magical creature subjects across chapters", () => {
  db.upsertL2Subject({
    bookId: "book-magical-subject-memory",
    indexGroupKey: "magical-creatures",
    subjectKey: "测试异兽",
    canonicalName: "测试异兽",
    aliases: ["测试别名"],
    creatureType: "异兽",
    originalForm: "自然繁衍的测试异兽",
    qualificationChapter: 11,
    qualificationBasis: "explicit_nonhuman_species",
    qualificationEvidence: ["原文明确其为异兽"],
    confidence: 0.96
  });

  assert.deepEqual(db.listL2Subjects({
    bookId: "book-magical-subject-memory",
    indexGroupKey: "magical-creatures",
    chapterIndex: 12,
    terms: ["测试异兽"]
  }), [{
    subject_key: "测试异兽",
    canonical_name: "测试异兽",
    aliases: ["测试别名"],
    creature_type: "异兽",
    original_form: "自然繁衍的测试异兽",
    qualification_chapter: 11,
    qualification_basis: "explicit_nonhuman_species",
    qualification_evidence: ["原文明确其为异兽"],
    confidence: 0.96
  }]);

  const inherited = workflows.admitL2FactsForIndexGroup([{
    category: "magical_creature",
    entity: "测试别名",
    aliases: [],
    related_entities: [],
    fact_type: "event_record",
    fact: "测试异兽在本章参与了一次行动。",
    evidence: ["章节中出现测试别名"],
    scope_eligible: false,
    scope_basis: ""
  }], { category_scope: ["magical_creature"] }, db.listL2Subjects({
    bookId: "book-magical-subject-memory",
    indexGroupKey: "magical-creatures",
    chapterIndex: 12,
    terms: ["测试别名"]
  }));
  assert.equal(inherited.facts.length, 1);
  assert.equal(inherited.facts[0].identity_basis, "prior_verified_subject");
});

test("magical creature admission rejects sentient artifacts without biological transformation evidence", () => {
  const group = db.createBookIndexGroup("book-magical-artifact-gate", {
    group_key: "magical-creatures",
    name: "神奇生物",
    category_scope: ["magical_creature"],
    l2_index_prompt: "只提取神奇生物。"
  });
  const admission = workflows.admitL2FactsForIndexGroup([{
    category: "magical_creature",
    entity: "飞剑",
    fact_type: "intelligence",
    fact: "飞剑具有独立意识。",
    evidence: ["飞剑有灵。"],
    scope_eligible: true,
    scope_basis: "explicit_sentience",
    transformation_eligible: false
  }], group);
  assert.equal(admission.facts.length, 0);
});

test("magical creature admission rejects artifact names even when the model marks them as nonhuman", () => {
  const group = { category_scope: ["magical_creature"] };
  const admission = workflows.admitL2FactsForIndexGroup([{
    category: "magical_creature",
    entity: "符箓",
    fact_type: "classification",
    fact: "符箓被描述为具有灵性并能自行飞行。",
    evidence: ["符箓自行飞行"],
    scope_eligible: true,
    scope_basis: "explicit_nonhuman_species",
    transformation_eligible: false
  }], group);
  assert.equal(admission.facts.length, 0);
  assert.equal(admission.candidateFacts.length, 0);
});

test("magical creature admission does not trust a fabricated artifact transformation flag", () => {
  const admission = workflows.admitL2FactsForIndexGroup([{
    category: "magical_creature",
    entity: "飞剑",
    fact_type: "classification",
    fact: "飞剑具有独立灵智和生物化形能力。",
    evidence: ["飞剑会飞行并执行命令。"],
    scope_eligible: true,
    scope_basis: "explicit_transformation",
    transformation_eligible: true,
    creature_type: "器物成精"
  }], { category_scope: ["magical_creature"] });
  assert.equal(admission.facts.length, 0);
});

test("historical rescan helpers reject negative facts and generic subject aliases", () => {
  assert.equal(workflows.isHistoricalRescanFactUsable({
    entity: "飞剑",
    fact_type: "identity_clue",
    fact: "本章未直接出现飞剑，仅作为历史主体保留候选。",
    evidence: ["本章正文未提及飞剑"]
  }), false);
  assert.equal(workflows.isHistoricalRescanSubjectName("飞剑"), false);
  assert.equal(workflows.isHistoricalRescanSubjectName("白衣女子"), false);
  assert.equal(workflows.isHistoricalRescanSubjectName("四脚蛇"), true);
});

test("extracts an embedded named creature as an independent candidate subject", () => {
  const expanded = workflows.expandEmbeddedMagicalCreatureFacts([{
    category: "magical_creature",
    entity: "稚圭",
    fact_type: "event_record",
    fact: "稚圭回到院子后，一条四脚蛇从角落窜出爬到她脚边，被她一脚踢飞。",
    evidence: ["一条四脚蛇从角落窜出"],
    scope_eligible: false,
    scope_basis: ""
  }]);
  assert.equal(expanded.length, 2);
  assert.deepEqual(expanded[1], {
    category: "magical_creature",
    entity: "四脚蛇",
    aliases: [],
    tags: ["候选主体"],
    related_entities: ["稚圭"],
    fact_type: "identity_clue",
    fact: "当前章节出现四脚蛇，并记录其与稚圭发生接触；当前证据不足以确认其属于神奇生物。",
    evidence: ["一条四脚蛇从角落窜出"],
    importance: 0.45,
    confidence: 0.55,
    scope_eligible: false,
    scope_basis: "",
    transformation_eligible: false,
    creature_type: "",
    original_form: "",
    subject_key: "四脚蛇",
    identity_basis: "current_chapter"
  });
});

test("magical creature candidate retention excludes ordinary people and artifacts", () => {
  const result = workflows.admitL2FactsForIndexGroup([
    {
      category: "character",
      entity: "年轻剑客",
      fact_type: "identity_clue",
      fact: "年轻剑客在街上行走。",
      evidence: ["年轻剑客"],
      scope_eligible: false,
      scope_basis: ""
    },
    {
      category: "item",
      entity: "符箓",
      fact_type: "event_record",
      fact: "符箓被用于劈开石台。",
      evidence: ["符箓"],
      scope_eligible: false,
      scope_basis: ""
    },
    {
      category: "other",
      entity: "测试异兽",
      fact_type: "identity_clue",
      fact: "本章只出现测试异兽的名称，尚不足以确认其类别。",
      evidence: ["测试异兽"],
      scope_eligible: false,
      scope_basis: ""
    }
  ], { category_scope: ["magical_creature"] });

  assert.deepEqual(result.candidateFacts.map((fact) => fact.entity), ["测试异兽"]);
});

test("magical creature candidates exclude named materials and structures", () => {
  const result = workflows.admitL2FactsForIndexGroup([
    ...["山魈茶壶", "祖荫槐叶", "十二脚牌坊", "蛇胆石"].map((entity) => ({
      category: "other",
      entity,
      fact_type: "identity_clue",
      fact: `${entity}在本章出现。`,
      evidence: [entity],
      scope_eligible: false,
      scope_basis: ""
    })),
    {
      category: "other",
      entity: "四脚蛇",
      fact_type: "identity_clue",
      fact: "四脚蛇头顶生角，行动异常，当前证据不足。",
      evidence: ["头顶生角"],
      scope_eligible: false,
      scope_basis: ""
    }
  ], { category_scope: ["magical_creature"] });
  assert.deepEqual(result.candidateFacts.map((fact) => fact.entity), ["四脚蛇"]);
});

test("magical creature admission rejects tentative human similes without nonhuman evidence", () => {
  const result = workflows.admitL2FactsForIndexGroup([{
    category: "magical_creature",
    entity: "青衣少女",
    fact_type: "classification",
    fact: "青衣少女看起来像一头年幼狐魅，但本章没有说明其本体。",
    evidence: ["像一头年幼狐魅"],
    scope_eligible: true,
    scope_basis: "explicit_nonhuman_species"
  }], { category_scope: ["magical_creature"] });
  assert.equal(result.facts.length, 0);
});

test("magical creature candidate retention excludes ordinary animals and named sword artifacts", () => {
  const result = workflows.admitL2FactsForIndexGroup([
    {
      category: "item",
      entity: "锈剑条",
      fact_type: "identity_clue",
      fact: "锈剑条在本章出现。",
      evidence: ["锈剑条"],
      scope_eligible: false,
      scope_basis: ""
    },
    {
      category: "other",
      entity: "来福",
      tags: ["狗", "普通动物", "年老"],
      fact_type: "identity_clue",
      fact: "来福是一条年老的普通狗。",
      evidence: ["年老的狗"],
      scope_eligible: false,
      scope_basis: ""
    },
    {
      category: "other",
      entity: "小蛟",
      tags: ["异兽", "水族"],
      fact_type: "identity_clue",
      fact: "小蛟在本章短暂出现，尚未确认其完整来历。",
      evidence: ["小蛟"],
      scope_eligible: false,
      scope_basis: ""
    }
  ], { category_scope: ["magical_creature"] });
  assert.deepEqual(result.candidateFacts.map((fact) => fact.entity), ["小蛟"]);
});

test("verified magical creature subjects are isolated by L2 prompt hash", () => {
  db.upsertL2Subject({
    bookId: "book-magical-subject-prompt-isolation",
    indexGroupKey: "magical-creatures",
    subjectKey: "旧版本主体",
    canonicalName: "旧版本主体",
    qualificationChapter: 1,
    qualificationBasis: "explicit_nonhuman_species",
    qualificationEvidence: ["旧版本证据"],
    promptHash: "prompt-old"
  });
  db.upsertL2Subject({
    bookId: "book-magical-subject-prompt-isolation",
    indexGroupKey: "magical-creatures",
    subjectKey: "新版本主体",
    canonicalName: "新版本主体",
    qualificationChapter: 2,
    qualificationBasis: "explicit_nonhuman_species",
    qualificationEvidence: ["新版本证据"],
    promptHash: "prompt-new"
  });

  assert.deepEqual(
    db.listL2Subjects({
      bookId: "book-magical-subject-prompt-isolation",
      indexGroupKey: "magical-creatures",
      promptHash: "prompt-new"
    }).map((subject) => subject.canonical_name),
    ["新版本主体"]
  );

  db.upsertL2Subject({
    bookId: "book-magical-subject-prompt-isolation",
    indexGroupKey: "magical-creatures",
    subjectKey: "新版本主体",
    canonicalName: "新版本主体",
    qualificationChapter: 3,
    qualificationBasis: "explicit_transformation",
    qualificationEvidence: ["新版本补充证据"],
    promptHash: "prompt-newer"
  });
  assert.equal(db.listL2Subjects({
    bookId: "book-magical-subject-prompt-isolation",
    indexGroupKey: "magical-creatures",
    promptHash: "prompt-new"
  }).length, 0);
  assert.equal(db.listL2Subjects({
    bookId: "book-magical-subject-prompt-isolation",
    indexGroupKey: "magical-creatures",
    promptHash: "prompt-newer"
  }).length, 1);
});

test("keeps uncertain magical creature facts as candidates and promotes them after subject verification", () => {
  db.saveChapter({
    bookId: "book-magical-candidate-replay",
    chapterIndex: 1,
    title: "候选主体",
    content: "章节只提到测试异兽的名字。"
  });
  const chapter = db.getChapterMetadata("book-magical-candidate-replay", 1);
  db.saveL2ChapterFacts({
    bookId: "book-magical-candidate-replay",
    indexGroupKey: "magical-creatures",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "candidate-prompt",
    schemaVersion: "l2-facts-v1",
    facts: [],
    candidateFacts: [{
      category: "magical_creature",
      entity: "测试异兽",
      aliases: ["测试别名"],
      fact_type: "identity_clue",
      fact: "本章只出现测试异兽的名称，尚不足以确认其类别。",
      evidence: ["测试异兽"],
      importance: 0.7,
      confidence: 0.4
    }]
  });

  assert.equal(db.listL2Facts({
    bookId: "book-magical-candidate-replay",
    indexGroupKeys: ["magical-creatures"],
    startChapter: 1,
    endChapter: 1
  }).length, 0);

  const promoted = db.promoteL2CandidateFacts({
    bookId: "book-magical-candidate-replay",
    indexGroupKey: "magical-creatures",
    canonicalName: "测试异兽",
    aliases: ["测试别名"]
  });
  assert.equal(promoted, 1);
  const facts = db.listL2Facts({
    bookId: "book-magical-candidate-replay",
    indexGroupKeys: ["magical-creatures"],
    startChapter: 1,
    endChapter: 1
  });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].review_source, "index");
});

test("L2 index groups isolate statuses, facts, and prompt bindings", () => {
  db.saveChapter({
    bookId: "book-l2-groups",
    chapterIndex: 1,
    title: "第一章",
    content: "云筝得到灵剑并加入宗门。"
  });
  const group = db.createBookIndexGroup("book-l2-groups", {
    group_key: "items-forces",
    name: "法宝势力",
    description: "只提取法宝与宗门势力事实",
    trigger_keywords: ["灵剑", "宗门"],
    category_scope: ["item", "force"],
    l2_index_prompt: "只提取法宝、武器、宗门势力事实。"
  });
  assert.equal(group.group_key, "items-forces");
  assert.equal(db.listBookIndexGroups("book-l2-groups").some((entry) => entry.group_key === "base"), true);
  assert.equal(db.listBookIndexGroups("book-l2-groups").some((entry) => entry.group_key === "items-forces"), true);

  const chapter = db.getChapterMetadata("book-l2-groups", 1);
  db.saveL2ChapterFacts({
    bookId: "book-l2-groups",
    indexGroupKey: "base",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "base-hash",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "character",
      entity: "云筝",
      fact_type: "appearance",
      fact: "云筝出场。",
      evidence: ["云筝"],
      importance: 0.7,
      confidence: 0.9
    }]
  });
  db.saveL2ChapterFacts({
    bookId: "book-l2-groups",
    indexGroupKey: "items-forces",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: group.l2_index_prompt_hash,
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "item",
      entity: "灵剑",
      fact_type: "item",
      fact: "云筝得到灵剑。",
      evidence: ["灵剑"],
      importance: 0.8,
      confidence: 0.9
    }]
  });

  const baseFacts = db.listL2Facts({ bookId: "book-l2-groups", indexGroupKeys: ["base"], startChapter: 1, endChapter: 1 });
  const specializedFacts = db.listL2Facts({ bookId: "book-l2-groups", indexGroupKeys: ["items-forces"], startChapter: 1, endChapter: 1 });
  assert.equal(baseFacts.length, 1);
  assert.equal(baseFacts[0].index_group_key, "base");
  assert.equal(specializedFacts.length, 1);
  assert.equal(specializedFacts[0].entity, "灵剑");
  assert.equal(db.getL2Coverage({ bookId: "book-l2-groups", indexGroupKey: "base", startChapter: 1, endChapter: 1 }).chapters.facts, 1);
  assert.equal(db.getL2Coverage({ bookId: "book-l2-groups", indexGroupKey: "items-forces", startChapter: 1, endChapter: 1 }).chapters.facts, 1);

  assert.equal(db.disableBookIndexGroup("book-l2-groups", "items-forces").disabled, true);
  assert.equal(db.listBookIndexGroups("book-l2-groups").some((entry) => entry.group_key === "items-forces"), false);
});

test("L2 index group stats aggregate facts and chapter statuses per group", () => {
  const bookId = "book-l2-group-stats";
  db.saveChapter({ bookId, chapterIndex: 1, title: "第一章", content: "云筝得到灵剑。" });
  db.saveChapter({ bookId, chapterIndex: 2, title: "第二章", content: "云筝加入宗门。" });
  db.createBookIndexGroup(bookId, {
    group_key: "items",
    name: "法宝",
    l2_index_prompt: "只提取法宝事实。"
  });
  const chapter1 = db.getChapterMetadata(bookId, 1);
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "items",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter1.content_hash,
    model: "dify:l2:v1",
    promptHash: "items-hash",
    schemaVersion: "l2-facts-v1",
    facts: [
      { category: "item", entity: "灵剑", fact_type: "item", fact: "云筝得到灵剑。", evidence: ["灵剑"], importance: 0.8, confidence: 0.9 },
      { category: "item", entity: "灵剑", fact_type: "item", fact: "灵剑认主。", evidence: ["认主"], importance: 0.7, confidence: 0.8 }
    ]
  });
  db.saveL2ChapterStatus({
    bookId,
    indexGroupKey: "items",
    chapterIndex: 2,
    status: "failed",
    sourceHash: "",
    model: "dify:l2:v1",
    promptHash: "items-hash",
    schemaVersion: "l2-facts-v1",
    errorSummary: "模拟失败"
  });
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "base",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter1.content_hash,
    model: "dify:l2:v1",
    promptHash: "base-hash",
    schemaVersion: "l2-facts-v1",
    facts: [{ category: "character", entity: "云筝", fact_type: "appearance", fact: "云筝出场。", evidence: ["云筝"], importance: 0.7, confidence: 0.9 }]
  });

  // 不带 includeStats：不附 stats 字段（保持旧响应形状）
  const plain = db.listBookIndexGroups(bookId);
  assert.equal(plain.every((entry) => !("stats" in entry)), true);

  const withStats = db.listBookIndexGroups(bookId, { includeStats: true });
  const itemsStats = withStats.find((entry) => entry.group_key === "items")?.stats;
  const baseStats = withStats.find((entry) => entry.group_key === "base")?.stats;
  assert.deepEqual(itemsStats, { facts_count: 2, built_chapters: 1, failed_chapters: 1 });
  assert.deepEqual(baseStats, { facts_count: 1, built_chapters: 1, failed_chapters: 0 });

  // 无任何构建记录的组也应拿到零值统计而不是缺字段
  db.createBookIndexGroup(bookId, { group_key: "empty-group", name: "空组", l2_index_prompt: "暂无" });
  const emptyStats = db.listBookIndexGroups(bookId, { includeStats: true })
    .find((entry) => entry.group_key === "empty-group")?.stats;
  assert.deepEqual(emptyStats, { facts_count: 0, built_chapters: 0, failed_chapters: 0 });
});

test("L2 index coverage errors include the invalid index group key", () => {
  const bookId = "book-l2-coverage-disabled";
  db.ensureBook(bookId, "覆盖率错误");
  db.createBookIndexGroup(bookId, {
    group_key: "items-old",
    name: "旧道具索引",
    l2_index_prompt: "旧道具事实"
  });
  db.disableBookIndexGroup(bookId, "items-old");

  assert.throws(
    () => workflows.getL2IndexCoverageForBook({
      bookId,
      indexGroupKey: "items-old",
      startChapter: 1,
      endChapter: 20
    }),
    /索引组不存在或已禁用：items-old/
  );
});

test("builds L2 indexes via Dify and skips fresh facts", async () => {
  db.saveChapter({
    bookId: "book-l2-task",
    chapterIndex: 1,
    title: "第一章",
    content: "陈平安得到木剑。"
  });

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  const capturedInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    workflowCalls += 1;
    const body = JSON.parse(request.body);
    capturedInputs.push(body.inputs);
    return difyWorkflowResponse({
      output: JSON.stringify({
        facts: [{
          category: "character",
          entity: "陈平安",
          aliases: [],
          tags: ["木剑"],
          related_entities: ["木剑"],
          fact_type: "item_gain",
          fact: "陈平安得到木剑。",
          evidence: ["木剑"],
          importance: 0.8,
          confidence: 0.9,
          scope_eligible: false,
          scope_basis: "",
          transformation_eligible: false,
          creature_type: "",
          original_form: "",
          subject_key: "陈平安",
          identity_basis: ""
        }]
      })
    });
  };

  try {
    const task = workflows.startL2IndexTask({
      book_id: "book-l2-task",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(task);
    assert.equal(task.status, "completed");
    assert.deepEqual(task.result.diagnostics, {
      generated_facts: 1,
      admitted_facts: 1,
      rejected_facts: 0,
      candidate_facts: 0,
      candidate_filtered_facts: 0,
      missing_scope_fields: 0,
      historical_rescan_facts: 0,
      historical_rescan_chapters: 0
    });
    assert.equal(workflowCalls, 1);
    assert.equal(capturedInputs[0].index_group_key, "base");
    assert.equal(capturedInputs[0].chapter_index, 1);
    assert.equal(capturedInputs[0].chapter_content, "陈平安得到木剑。");
    assert.equal(JSON.parse(capturedInputs[0].l1_route_json), null);

    const skipped = workflows.startL2IndexTask({
      book_id: "book-l2-task",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(skipped);
    assert.equal(skipped.progress.skipped, 1, JSON.stringify({ error: skipped.error, events: skipped.events.slice(-3) }));
    assert.equal(workflowCalls, 1);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 targeted modes ignore force and do not rebuild the whole range", async () => {
  for (const chapterIndex of [1, 2, 3]) {
    db.saveChapter({
      bookId: "book-l2-targeted-mode",
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章正文`
    });
  }
  const completedChapter = db.getChapterMetadata("book-l2-targeted-mode", 1);
  const failedChapter = db.getChapterMetadata("book-l2-targeted-mode", 2);
  db.saveL2ChapterFacts({
    bookId: "book-l2-targeted-mode",
    chapterIndex: 1,
    status: "completed",
    sourceHash: completedChapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "event",
      entity: "第一章",
      fact_type: "existing",
      fact: "第一章已有索引。",
      evidence: ["第一章"],
      importance: 0.8,
      confidence: 0.9
    }]
  });
  db.saveL2ChapterStatus({
    bookId: "book-l2-targeted-mode",
    chapterIndex: 2,
    status: "failed",
    sourceHash: failedChapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    errorSummary: "previous failure"
  });

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    workflowCalls += 1;
    const body = JSON.parse(request.body);
    const chapterIndex = Number(body.inputs.chapter_index || workflowCalls);
    return difyWorkflowResponse({
      output: JSON.stringify({
        facts: [{
          category: "event",
          entity: `第${chapterIndex}章`,
          aliases: [],
          tags: [],
          related_entities: [],
          fact_type: "rebuilt",
          fact: `第${chapterIndex}章被处理。`,
          evidence: [`第${chapterIndex}章`],
          importance: 0.8,
          confidence: 0.9
        }]
      })
    });
  };

  try {
    const retryTask = workflows.startL2IndexTask({
      book_id: "book-l2-targeted-mode",
      start_chapter: 1,
      end_chapter: 3,
      force: true,
      mode: "retry_failed"
    });
    await waitForTask(retryTask);
    assert.equal(retryTask.progress.completed, 1);
    assert.equal(retryTask.progress.skipped, 2);
    assert.equal(workflowCalls, 1);
    assert.equal(db.getL2ChapterStatus("book-l2-targeted-mode", 2).status, "completed");
    assert.equal(db.getL2ChapterStatus("book-l2-targeted-mode", 3), null);

    const missingTask = workflows.startL2IndexTask({
      book_id: "book-l2-targeted-mode",
      start_chapter: 1,
      end_chapter: 3,
      force: true,
      mode: "missing"
    });
    await waitForTask(missingTask);
    assert.equal(missingTask.progress.completed, 1);
    assert.equal(missingTask.progress.skipped, 2);
    assert.equal(workflowCalls, 2);
    assert.equal(db.getL2ChapterStatus("book-l2-targeted-mode", 3).status, "completed");
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 retry_empty mode only rebuilds completed chapters with zero facts", async () => {
  for (const chapterIndex of [1, 2, 3, 4, 5]) {
    db.saveChapter({
      bookId: "book-l2-retry-empty",
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章正文`
    });
  }
  // 第1章：有事实的正常完成章；第2章：空章；第3章：失败；第4章：无记录；第5章：空章且 source_hash 过期
  const filledChapter = db.getChapterMetadata("book-l2-retry-empty", 1);
  const emptyChapter = db.getChapterMetadata("book-l2-retry-empty", 2);
  const failedChapter = db.getChapterMetadata("book-l2-retry-empty", 3);
  db.saveL2ChapterFacts({
    bookId: "book-l2-retry-empty",
    chapterIndex: 1,
    status: "completed",
    sourceHash: filledChapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "event",
      entity: "第一章",
      fact_type: "existing",
      fact: "第一章已有索引。",
      evidence: ["第一章"],
      importance: 0.8,
      confidence: 0.9
    }]
  });
  db.saveL2ChapterFacts({
    bookId: "book-l2-retry-empty",
    chapterIndex: 2,
    status: "completed",
    sourceHash: emptyChapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: []
  });
  db.saveL2ChapterStatus({
    bookId: "book-l2-retry-empty",
    chapterIndex: 3,
    status: "failed",
    sourceHash: failedChapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    errorSummary: "previous failure"
  });
  db.saveL2ChapterFacts({
    bookId: "book-l2-retry-empty",
    chapterIndex: 5,
    status: "completed",
    sourceHash: "stale-source-hash",
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: []
  });

  // 覆盖统计按整本书索引状态分桶：completed=3（含过期的第5章），empty=2（completed 子集），outdated=1
  const coverageBefore = db.getL2Coverage({ bookId: "book-l2-retry-empty", startChapter: 1, endChapter: 5 });
  assert.equal(coverageBefore.chapters.completed, 3);
  assert.equal(coverageBefore.chapters.empty, 2);
  assert.deepEqual(coverageBefore.empty_chapters, [2, 5]);
  assert.equal(coverageBefore.chapters.outdated, 1);

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    workflowCalls += 1;
    const body = JSON.parse(request.body);
    const chapterIndex = Number(body.inputs.chapter_index || workflowCalls);
    return difyWorkflowResponse({
      output: JSON.stringify({
        facts: [{
          category: "event",
          entity: `第${chapterIndex}章`,
          aliases: [],
          tags: [],
          related_entities: [],
          fact_type: "rebuilt",
          fact: `第${chapterIndex}章被处理。`,
          evidence: [`第${chapterIndex}章`],
          importance: 0.8,
          confidence: 0.9
        }]
      })
    });
  };

  try {
    const retryEmptyTask = workflows.startL2IndexTask({
      book_id: "book-l2-retry-empty",
      start_chapter: 1,
      end_chapter: 5,
      force: true,
      mode: "retry_empty"
    });
    await waitForTask(retryEmptyTask);
    assert.equal(retryEmptyTask.progress.empty_total, 2);
    assert.equal(retryEmptyTask.progress.completed, 2);
    assert.equal(retryEmptyTask.progress.skipped, 3);
    assert.equal(workflowCalls, 2);
    for (const chapterIndex of [2, 5]) {
      const rebuilt = db.getL2ChapterStatus("book-l2-retry-empty", chapterIndex);
      assert.equal(rebuilt.status, "completed");
      assert.equal(rebuilt.facts_count, 1);
    }
    assert.equal(db.getL2ChapterStatus("book-l2-retry-empty", 3).status, "failed");
    assert.equal(db.getL2ChapterStatus("book-l2-retry-empty", 4), null);
    const coverageAfter = db.getL2Coverage({ bookId: "book-l2-retry-empty", startChapter: 1, endChapter: 5 });
    assert.equal(coverageAfter.chapters.empty, 0);
    assert.deepEqual(coverageAfter.empty_chapters, []);
    assert.equal(coverageAfter.chapters.outdated, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test("book index prompts are saved, used by L1/L2 tasks, and change freshness hash", async () => {
  const customL1 = "自定义 L1 Prompt：只提炼人物与事件。";
  const customL2 = "自定义 L2 Prompt：只提炼可检索事实。";
  db.saveChapter({
    bookId: "book-index-prompt",
    chapterIndex: 1,
    title: "第一章",
    content: "陈平安得到木剑。"
  });

  const saved = db.updateBookIndexPrompts("book-index-prompt", {
    l1_index_prompt: customL1,
    l2_index_prompt: customL2
  });
  assert.equal(saved.l1_index_prompt, customL1);
  assert.equal(saved.l2_index_prompt, customL2);
  assert.notEqual(saved.l1_index_prompt_hash, "l1-route-v1");
  assert.notEqual(saved.l2_index_prompt_hash, "l2-v1-typed-facts");

  const previousFetch = global.fetch;
  const capturedInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    capturedInputs.push(body.inputs);
    const isL2 = Object.hasOwn(body.inputs || {}, "index_group_key");
    const outputValue = isL2
      ? {
        facts: [{
          category: "item",
          entity: "木剑",
          aliases: [],
          tags: [],
          related_entities: ["陈平安"],
          fact_type: "item_gain",
          fact: "陈平安得到木剑。",
          evidence: ["木剑"],
          importance: 0.8,
          confidence: 0.9
        }]
      }
      : {
        route_schema_version: "l1-route-v1",
        route_entities: [{ name: "陈平安", type: "character", aliases: [], role: "持有者", note: "得到木剑" }],
        route_keywords: ["陈平安", "木剑"],
        signals: [{ category: "item", strength: 0.8, entities: ["陈平安", "木剑"], keywords: ["木剑"], reason: "物品获得信号" }],
        category_scores: { character: 0.5, item: 0.8, event: 0.4 }
      };
    return difyWorkflowResponse({ result: JSON.stringify(outputValue) });
  };

  try {
    const l1Task = workflows.startL1IndexTask({
      book_id: "book-index-prompt",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l1Task);
    assert.equal(l1Task.status, "completed");
    assert.equal(db.getL1ChapterIndex("book-index-prompt", 1).prompt_hash, saved.l1_index_prompt_hash);
    assert.equal(capturedInputs[0].index_prompt.includes(customL1), true);

    const l2Task = workflows.startL2IndexTask({
      book_id: "book-index-prompt",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(l2Task);
    assert.equal(l2Task.status, "completed");
    assert.equal(db.getL2ChapterStatus("book-index-prompt", 1).prompt_hash, saved.l2_index_prompt_hash);
    assert.equal(capturedInputs[1].index_prompt.includes(customL2), true);
    assert.equal(capturedInputs[1].l1_route_json.includes("route_entities"), true);
    assert.equal(capturedInputs[1].l1_route_json.includes("key_events"), false);

    const skippedL2 = workflows.startL2IndexTask({
      book_id: "book-index-prompt",
      start_chapter: 1,
      end_chapter: 1
    });
    await waitForTask(skippedL2);
    assert.equal(skippedL2.progress.skipped, 1);
    assert.equal(capturedInputs.length, 2);
  } finally {
    global.fetch = previousFetch;
  }
});

test("builds execution signatures from Dify workflow versions", () => {
  const previousL1Version = appConfig.config.dify.l1WorkflowVersion;
  const previousL2Version = appConfig.config.dify.l2WorkflowVersion;
  const previousSummaryVersion = appConfig.config.dify.analysisSummaryWorkflowVersion;
  try {
    appConfig.config.dify.l1WorkflowVersion = "v12";
    appConfig.config.dify.l2WorkflowVersion = "v13";
    appConfig.config.dify.analysisSummaryWorkflowVersion = "v14";
    assert.equal(workflows.l1IndexExecutionSignature(), "dify:l1:v12");
    assert.equal(workflows.l2IndexExecutionSignature(), "dify:l2:v13");
    assert.equal(workflows.analysisSummaryExecutionSignature(), "dify:analysis_summary:v14");
  } finally {
    appConfig.config.dify.l1WorkflowVersion = previousL1Version;
    appConfig.config.dify.l2WorkflowVersion = previousL2Version;
    appConfig.config.dify.analysisSummaryWorkflowVersion = previousSummaryVersion;
  }
});

test("public runtime config exposes only Dify targets", () => {
  const runtime = appConfig.publicRuntimeConfig();
  assert.deepEqual(Object.keys(runtime).sort(), [
    "host",
    "difyConfigured",
    "difyL1Configured",
    "difyL2Configured",
    "difyAnalysisSummaryConfigured",
    "difyBase",
    "dataDir",
    "staticDir",
    "importBatchSize"
  ].sort());
  assert.equal(runtime.difyConfigured, true);
  assert.equal(runtime.difyL1Configured, true);
  assert.equal(runtime.difyL2Configured, true);
  assert.equal(runtime.difyAnalysisSummaryConfigured, true);
  assert.equal(runtime.difyBase, "http://127.0.0.1:9999/v1");
  assert.equal(runtime.dataDir, tempDir);
});

test("analyzes selected non-contiguous chapters, preserves prompt snapshot, and deletes run", async () => {
  for (const chapterIndex of [1, 2, 3]) {
    db.saveChapter({
      bookId: "book-selected",
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章正文`
    });
    const chapter = db.getChapterMetadata("book-selected", chapterIndex);
    db.saveL2ChapterFacts({
      bookId: "book-selected",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "character",
        entity: "主角",
        fact_type: "event",
        fact: `第${chapterIndex}章主角相关事实。`,
        evidence: ["主角"],
        importance: 0.8,
        confidence: 0.9
      }]
    });
  }

  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return difyWorkflowResponse({ text: "## 主角事实\n选择章节汇总。" });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      name: "非连续选择",
      book_id: "book-selected",
      chapter_indexes: [3, 1, 1],
      index_group_keys: ["base"],
      query: "总结主角相关事实"
    });
    await waitForTask(analysis);

    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.name, "非连续选择");
    assert.deepEqual(result.chapter_indexes, [1, 3]);
    assert.equal(result.selection_mode, "indexes");
    assert.equal(result.prompt.analysis_mode, "l2_query");
    assert.equal(result.prompt.query, "总结主角相关事实");
    assert.deepEqual(result.prompt.index_group_keys, ["base"]);
    assert.deepEqual(result.chapters, []);
    assert.deepEqual(result.chapterResults, []);

    assert.equal(db.deleteAnalysisRun(analysis.id).deleted, true);
    assert.equal(db.getAnalysisRun(analysis.id), undefined);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis runs without a prompt group and recalls fact body keywords", async () => {
  const bookId = "book-l2-query";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (const [chapterIndex, fact] of [
    [156, "剑胚外形为拳头大小、银块模样的东西，悬浮在空中。"],
    [162, "老秀才赠予陈平安一块名为“小酆都”的剑胚，外形似银锭，品秩很高。"],
    [191, "这口飞剑不再是一颗银锭的粗俗模样，极其纤小，晶莹剔透。"],
    [221, "飞剑初一如一条小小的白虹，剑身纤细，锋芒毕露。"]
  ]) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: "",
        fact_type: "appearance",
        fact,
        evidence: [fact.slice(0, 20)],
        importance: 0.9,
        confidence: 0.9
      }]
    });
  }

  const previousFetch = global.fetch;
  let summaryCalls = 0;
  let summaryInput = "";
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    assert.equal(body.inputs.task_type, "summary");
    summaryInput = difySummaryText(body);
    assert.equal(summaryInput.includes("章节原文："), false);
    assert.equal(summaryInput.includes("第156章原文不应被读取"), false);
    summaryCalls += 1;
    return difyWorkflowResponse({
      text: "## 初一外形演化时间线\n第156章为银块模样，第162章似银锭，第191章脱离银锭，第221章如白虹。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 300,
      index_group_keys: ["sword-special"],
      query: "帮我查找剑来飞剑专项 L2 中关于初一（早期外形是银锭，原文中称之为小银锭）的内容，并整理成初一外形演化时间线"
    });
    await waitForTask(analysis);
    assert.equal(summaryCalls, 1);
    assert.equal(summaryInput.includes("小酆都"), true);
    assert.equal(summaryInput.includes("外形似银锭"), true);
    assert.equal(summaryInput.includes("小小的白虹"), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(typeof result.finalResult, "string");
    assert.equal(result.finalResult.includes("初一外形演化时间线"), true);
    assert.equal(result.source_stats.analysis_mode, "l2_query");
    assert.equal(result.source_stats.recalled_facts, 4);
    assert.equal(result.source_stats.source_review_chapters, 0);
    assert.equal(result.source_stats.l2_query_material_mode, "direct");
    assert.equal(result.source_stats.l2_query_chunk_count, 1);
    assert.deepEqual(result.source_stats.index_group_keys, ["sword-special"]);
    assert.equal(result.prompt.analysis_mode, "l2_query");
    assert.equal(result.prompt.query.includes("小银锭"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis strips appearance suffix from target subject", async () => {
  const bookId = "book-l2-query-character-appearance";
  db.createBookIndexGroup(bookId, {
    group_key: "characters-relationships",
    name: "人物形象/关系",
    l2_index_prompt: "人物形象与人物关系事实"
  });
  db.saveChapter({
    bookId,
    chapterIndex: 96,
    title: "第九十六章",
    content: "第96章原文不应被 L2 提问读取"
  });
  const chapter = db.getChapterMetadata(bookId, 96);
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "characters-relationships",
    chapterIndex: 96,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-character-appearance",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "character",
      entity: "陆征",
      aliases: [],
      tags: ["形象"],
      related_entities: [],
      fact_type: "appearance_explicit",
      fact: "陆征被描述为中年，脸上有褶皱，整体形象油腻。",
      evidence: ["陆征被描述为中年，脸上有褶皱。"],
      importance: 0.8,
      confidence: 0.9
    }]
  });

  const previousFetch = global.fetch;
  let summaryInput = "";
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    summaryInput = difySummaryText(JSON.parse(request.body));
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    return difyWorkflowResponse({
      text: "## 陆征形象\n陆征呈现中年、油腻、有褶皱的形象。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 100,
      index_group_keys: ["characters-relationships"],
      query: "输出陆征的形象"
    });
    await waitForTask(analysis);
    assert.equal(summaryInput.includes("陆征被描述为中年"), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "陆征");
    assert.equal(result.source_stats.recalled_facts, 1);
    assert.equal(result.source_stats.target_candidate_facts, 1);
    assert.equal(result.finalResult.includes("陆征形象"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis completes with a local Markdown result when no facts match", async () => {
  const bookId = "book-l2-query-empty";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  db.saveChapter({
    bookId,
    chapterIndex: 1,
    title: "第一章",
    content: "第一章原文不应被读取"
  });
  const chapter = db.getChapterMetadata(bookId, 1);
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "sword-special",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "location",
      entity: "小镇",
      fact_type: "location",
      fact: "小镇是故事早期地点。",
      evidence: ["小镇"],
      importance: 0.4,
      confidence: 0.8
    }]
  });

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    workflowCalls += 1;
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1,
      index_group_keys: ["sword-special"],
      query: "查询初一小银锭外形演化时间线"
    });
    await waitForTask(analysis);
    assert.equal(workflowCalls, 0);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.finalResult.includes("未召回相关 L2 事实"), true);
    assert.equal(result.source_stats.analysis_mode, "l2_query");
    assert.equal(result.source_stats.candidate_facts, 1);
    assert.equal(result.source_stats.recalled_facts, 0);
    assert.equal(result.source_stats.l2_query_material_mode, "direct");
    assert.equal(result.source_stats.l2_query_chunk_count, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis splits large fact sets into budgeted summary batches", async () => {
  const bookId = "book-l2-query-large-budget";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  const anchors = new Map([
    [12, "剑胚早期像银锭，也被整理为小银锭阶段，仍与初一外形演化相关。"],
    [48, "老秀才赠予的小酆都剑胚与初一早期形态相关，事实正文明确出现小酆都。"],
    [96, "初一后来脱离银锭粗俗模样，剑身更纤细晶莹。"],
    [144, "飞剑初一如一条小小白虹，形成白虹阶段的外形线索。"]
  ]);
  for (let chapterIndex = 1; chapterIndex <= 180; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    const anchor = anchors.get(chapterIndex) || "初一外形演化事实：本章围绕初一、飞剑、剑胚、银锭、小银锭、白虹等称谓建立长事实素材。";
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: chapterIndex % 3 === 0 ? "初一" : "",
        aliases: ["小银锭", "剑胚"],
        tags: ["飞剑", "外形演化"],
        related_entities: ["陈平安"],
        fact_type: "appearance",
        fact: `${anchor} ${"补充上下文用于制造预算压力，但仍然只应作为 L2 fact 输入。".repeat(10)}`,
        evidence: [`第${chapterIndex}章证据摘录：${anchor}`],
        importance: anchors.has(chapterIndex) ? 0.98 : 0.72,
        confidence: 0.9
      }]
    });
  }

  const previousFetch = global.fetch;
  const responseInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const text = difySummaryText(JSON.parse(request.body));
    assert.equal(text.includes("章节原文："), false);
    assert.equal(text.includes("原文不应被 L2 提问读取"), false);
    assert.ok(text.length <= 28000, `summary input exceeded budget: ${text.length}`);
    responseInputs.push(text);
    const isFinalMerge = text.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge
        ? "## 初一外形演化时间线\n第12章：银锭/小银锭阶段。\n第48章：小酆都剑胚线索。\n第96章：脱离银锭粗俗模样。\n第144章：如小小白虹。"
        : "## 局部事实\n本批次保留初一、银锭、小酆都、剑胚、白虹等 L2 事实线索。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 180,
      index_group_keys: ["sword-special"],
      query: "查询初一外形演化时间线，重点关注银锭、小酆都、剑胚、白虹"
    });
    await waitForTask(analysis);
    assert.ok(responseInputs.length > 1, "large L2 query should call summary in batches plus final merge");
    assert.equal(responseInputs.some((text) => text.includes("L2 facts JSON：")), true);
    assert.equal(responseInputs.some((text) => text.includes("局部回答 Markdown")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(typeof result.finalResult, "string");
    assert.equal(result.finalResult.includes("初一外形演化时间线"), true);
    assert.equal(result.finalResult.includes("小酆都"), true);
    assert.equal(result.source_stats.analysis_mode, "l2_query");
    assert.equal(result.source_stats.l2_query_material_mode, "chunked");
    assert.ok(result.source_stats.l2_query_chunk_count > 1);
    assert.ok(result.source_stats.l2_query_recalled_facts_before_budget >= result.source_stats.l2_query_recalled_facts_after_budget);
    assert.equal(typeof result.source_stats.l2_query_omitted_by_budget, "number");
    assert.equal(typeof result.source_stats.l2_query_trimmed_by_budget, "boolean");
    const batchParts = result.summaryParts.filter((part) => part.part_key.startsWith("l2_query.batch."));
    assert.ok(batchParts.length > 1);
    assert.equal(result.summaryParts.some((part) => part.part_key === "l2_query.final.merge"), true);
    const finalTrace = result.sourceTrace.find((trace) => trace.part_key === "l2_query.final.merge");
    assert.equal(finalTrace.field_material_mode, "l2_query_chunk_merge");
    assert.equal(finalTrace.total_batches, batchParts.length);
    for (const part of result.summaryParts) {
      const match = /输入 (\d+) 字/.exec(part.input_summary);
      assert.ok(match, `missing input length for ${part.part_key}`);
      assert.ok(Number(match[1]) <= 28000, `${part.part_key} exceeded budget`);
    }
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis scans later chapter windows instead of stopping at the first candidate limit", async () => {
  const bookId = "book-l2-query-late-window";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 2200; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: chapterIndex >= 2100 ? "初一" : "无关高权重事实",
        aliases: chapterIndex >= 2100 ? ["晚期白虹"] : [],
        tags: chapterIndex >= 2100 ? ["飞剑", "后期"] : ["无关"],
        related_entities: [],
        fact_type: chapterIndex >= 2100 ? "appearance" : "background",
        fact: chapterIndex >= 2100
          ? `第${chapterIndex}章后期初一事实：初一在后段仍有晚期白虹形态线索。`
          : `第${chapterIndex}章无关高权重事实：只用于填满前置候选，不应回答初一后期问题。`,
        evidence: [`第${chapterIndex}章证据`],
        importance: chapterIndex >= 2100 ? 0.2 : 1,
        confidence: chapterIndex >= 2100 ? 0.6 : 1
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    return difyWorkflowResponse({
      text: "## 初一后期线索\n第2100章以后出现晚期白虹形态线索。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 2200,
      index_group_keys: ["sword-special"],
      query: "查询初一后期晚期白虹形态线索"
    });
    await waitForTask(analysis);
    assert.equal(summaryInputs.some((input) => input.includes("第2100章后期初一事实")), true);
    assert.equal(summaryInputs.some((input) => input.includes("晚期白虹形态线索")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.analysis_mode, "l2_query");
    assert.ok(result.source_stats.candidate_facts > 2000);
    assert.ok(result.source_stats.l2_query_candidate_windows > 1);
    assert.ok(result.source_stats.recalled_chapter_indexes.some((chapterIndex) => chapterIndex >= 2100));
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis preserves target-subject facts before broad related facts", async () => {
  const bookId = "book-l2-query-target-first";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  const targetChapters = [20, 80, 160, 240, 1227];
  const broadChapters = Array.from({ length: 180 }, (_, index) => index + 300);
  for (const chapterIndex of [...targetChapters, ...broadChapters]) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    const isTarget = targetChapters.includes(chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: "",
        aliases: isTarget ? ["小酆都"] : ["十五"],
        tags: isTarget ? ["初一"] : ["飞剑", "十五", "养剑葫", "陈平安", "战绩"],
        related_entities: isTarget ? ["陈平安"] : ["飞剑十五", "养剑葫"],
        fact_type: isTarget ? "ability" : "combat_record",
        fact: isTarget
          ? `第${chapterIndex}章目标事实：本章明确提到初一；${chapterIndex === 1227 ? "夜游剑和浮萍各有一部分剑意自行去了本命飞剑初一当中。" : "这是初一主体事实。"}`
          : `第${chapterIndex}章泛相关事实：陈平安、飞剑、十五、养剑葫、战绩、combat_record 等宽泛词高度命中，但不是目标主体事实。`,
        evidence: [`第${chapterIndex}章证据`],
        importance: isTarget ? 0.2 : 1,
        confidence: isTarget ? 0.6 : 1
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    return difyWorkflowResponse({
      text: "## 初一事实\n第1227章：夜游剑和浮萍剑意进入初一。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1300,
      index_group_keys: ["sword-special"],
      query: "查询初一相关事实，以及对应的章节"
    });
    await waitForTask(analysis);
    assert.equal(summaryInputs.some((input) => input.includes("第1227章目标事实")), true);
    assert.equal(summaryInputs.some((input) => input.includes("夜游剑和浮萍各有一部分剑意")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "初一");
    assert.equal(result.source_stats.target_recalled_facts, 5);
    assert.equal(result.source_stats.target_candidate_facts, 5);
    assert.equal(result.source_stats.l2_query_dropped_after_recall_limit > 0, true);
    assert.ok(result.source_stats.recalled_chapter_indexes.includes(1227));
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis covers all target-subject facts across budgeted chunks", async () => {
  const bookId = "book-l2-query-target-full-coverage";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 220; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: "",
        aliases: ["小酆都"],
        tags: ["初一", "飞剑"],
        related_entities: ["陈平安"],
        fact_type: "ability",
        fact: `第${chapterIndex}章目标事实：初一专项事实 ${chapterIndex}，用于验证目标主体 facts 不被 160 上限截断。${"补充材料。".repeat(8)}`,
        evidence: [`第${chapterIndex}章证据`],
        importance: 0.5,
        confidence: 0.8
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    assert.ok(summaryInput.length <= 28000, `summary input exceeded budget: ${summaryInput.length}`);
    const isFinalMerge = summaryInput.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge ? "## 初一事实全集\n覆盖 220 条目标事实。" : "## 局部初一事实\n本批次保留目标主体事实。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 220,
      index_group_keys: ["sword-special"],
      query: "查询初一相关事实，以及对应的章节"
    });
    await waitForTask(analysis);
    assert.equal(summaryInputs.some((input) => input.includes("第220章目标事实")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "初一");
    assert.equal(result.source_stats.target_candidate_facts, 220);
    assert.equal(result.source_stats.target_selected_facts, 220);
    assert.equal(result.source_stats.target_recalled_facts, 220);
    assert.equal(result.source_stats.recalled_facts, 220);
    assert.equal(result.source_stats.l2_query_dropped_after_recall_limit, 0);
    assert.ok(result.source_stats.l2_query_chunk_count > 1);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query possessive target narrows recall to owner plus object facts", async () => {
  const bookId = "book-l2-query-possessive-target";
  db.createBookIndexGroup(bookId, {
    group_key: "item-special",
    name: "物件专项",
    l2_index_prompt: "物件专项事实"
  });
  const rows = [
    {
      chapterIndex: 23,
      entity: "祖荫槐叶",
      related_entities: ["陈平安", "老槐树"],
      fact_type: "origin",
      fact: "祖荫槐叶来自老槐树，最终落入陈平安手中。",
      evidence: ["老槐树 / 陈平安 / 槐叶"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 259,
      entity: "老龙袍",
      related_entities: ["苻南华"],
      fact_type: "classification",
      fact: "老龙袍是一件半仙兵法袍。",
      evidence: ["老龙袍 / 法袍"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 286,
      entity: "金醴",
      aliases: ["法袍金醴"],
      tags: ["道具", "护甲", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "origin",
      fact: "金醴是一件品秩极高的法袍，陈平安请人对其施展障眼法。",
      evidence: ["陈平安 / 法袍金醴"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 295,
      entity: "金醴",
      aliases: ["法袍金醴", "法袍"],
      tags: ["道具", "护甲", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "restriction",
      fact: "陈平安动用法袍金醴的法相时会消耗大量真气。",
      evidence: ["陈平安 / 金醴 / 法相"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 928,
      entity: "陈平安的鲜红法袍",
      aliases: [],
      tags: ["道具", "护甲", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "appearance",
      fact: "陈平安变成身穿一袭鲜红法袍的模样，身躯如丝线交织。",
      evidence: ["陈平安 / 鲜红法袍"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 1096,
      entity: "鲜红法袍",
      aliases: ["仙蜕法袍"],
      tags: ["道具", "护甲", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "ownership",
      fact: "陈平安在与马苦玄对峙时穿上鲜红法袍，此袍好似仙蜕。",
      evidence: ["陈平安 / 鲜红法袍 / 仙蜕"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 1102,
      entity: "法袍（陈平安所穿）",
      aliases: ["鲜红法袍"],
      tags: ["道具", "护甲", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "appearance",
      fact: "陈平安换了一身鲜红颜色的法袍，在雪景中显得火红异常。",
      evidence: ["陈平安 / 法袍 / 鲜红颜色"],
      importance: 0.95,
      confidence: 0.95
    }
  ];

  for (const row of rows) {
    db.saveChapter({
      bookId,
      chapterIndex: row.chapterIndex,
      title: `第${row.chapterIndex}章`,
      content: `第${row.chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, row.chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "item-special",
      chapterIndex: row.chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "item",
        entity: row.entity,
        aliases: row.aliases || [],
        tags: row.tags || [],
        related_entities: row.related_entities,
        fact_type: row.fact_type,
        fact: row.fact,
        evidence: row.evidence,
        importance: row.importance,
        confidence: row.confidence
      }]
    });
  }

  const previousFetch = global.fetch;
  let recalledFacts = [];
  let summaryInput = "";
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    summaryInput = difySummaryText(JSON.parse(request.body));
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    recalledFacts = extractL2QueryFacts(summaryInput);
    return difyWorkflowResponse({
      text: "## 法袍事实\n保留目标主体相关法袍事实。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1200,
      index_group_keys: ["item-special"],
      query: "帮我总结“陈平安的鲜红法袍”的信息，包含：首次出场时间和地点、防御力"
    });
    await waitForTask(analysis);
    assert.deepEqual(recalledFacts.map((fact) => fact.entity), ["陈平安的鲜红法袍", "鲜红法袍", "法袍（陈平安所穿）"]);
    assert.equal(summaryInput.includes("金醴"), false);
    assert.equal(summaryInput.includes("法袍金醴"), false);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "陈平安的鲜红法袍");
    assert.equal(result.source_stats.target_candidate_facts, 3);
    assert.equal(result.source_stats.target_selected_facts, 3);
    assert.equal(result.source_stats.target_recalled_facts, 3);
    assert.equal(result.source_stats.target_recalled_chapters, 3);
    assert.equal(result.source_stats.recalled_facts, 3);

    const genericAnalysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1200,
      index_group_keys: ["item-special"],
      query: "帮我总结“陈平安的法袍”的信息，包含：持有者"
    });
    await waitForTask(genericAnalysis);
    assert.deepEqual(recalledFacts.map((fact) => fact.entity).sort(), ["法袍（陈平安所穿）", "金醴", "金醴", "陈平安的鲜红法袍", "鲜红法袍"].sort());
    assert.equal(recalledFacts.some((fact) => fact.entity === "老龙袍"), false);
    const genericResult = workflows.publicAnalysisRunWithResult(genericAnalysis.id);
    assert.equal(genericResult.source_stats.target_subject, "陈平安的法袍");
    assert.equal(genericResult.source_stats.target_candidate_facts, 5);
    assert.equal(genericResult.source_stats.target_selected_facts, 5);
    assert.equal(genericResult.source_stats.target_recalled_facts, 5);
    assert.equal(genericResult.source_stats.target_recalled_chapters, 5);
    assert.equal(genericResult.source_stats.recalled_facts, 5);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query slash aliases narrow single target recall instead of scanning all items", async () => {
  const bookId = "book-l2-query-slash-alias-target";
  db.createBookIndexGroup(bookId, {
    group_key: "item-special",
    name: "物件专项",
    l2_index_prompt: "物件专项事实"
  });
  const rows = [
    ...Array.from({ length: 80 }, (_, index) => ({
      chapterIndex: index + 1,
      entity: `无关物件${index + 1}`,
      aliases: [],
      tags: ["道具", "物件"],
      related_entities: ["陈平安"],
      fact_type: "ownership",
      fact: `无关物件${index + 1}与神人承露甲、甘露甲、西嶽没有直接关系。`,
      evidence: [`无关物件${index + 1}`],
      importance: 0.5,
      confidence: 0.8
    })),
    {
      chapterIndex: 250,
      entity: "神人承露甲",
      aliases: ["甘露甲", "甲丸"],
      tags: ["道具", "护甲", "兵家甲丸"],
      related_entities: ["楚濠"],
      fact_type: "classification",
      fact: "神人承露甲又称甘露甲，是一副兵家甲丸。",
      evidence: ["神人承露甲 / 甘露甲 / 兵家甲丸"],
      importance: 0.95,
      confidence: 0.95
    },
    {
      chapterIndex: 344,
      entity: "西嶽",
      aliases: ["甘露甲", "神人承露甲"],
      tags: ["道具", "护甲", "甲胄"],
      related_entities: ["钟魁", "陈平安"],
      fact_type: "ownership",
      fact: "西嶽是甘露甲、神人承露甲相关条目，曾与陈平安、钟魁相关。",
      evidence: ["西嶽 / 甘露甲 / 陈平安"],
      importance: 0.9,
      confidence: 0.95
    },
    {
      chapterIndex: 719,
      entity: "七彩甘露甲",
      aliases: ["甘露甲"],
      tags: ["道具", "护甲", "宝甲"],
      related_entities: ["赊月"],
      fact_type: "appearance",
      fact: "七彩甘露甲是甘露甲体系中的另一副宝甲。",
      evidence: ["七彩甘露甲 / 甘露甲"],
      importance: 0.75,
      confidence: 0.85
    }
  ];

  for (const row of rows) {
    db.saveChapter({
      bookId,
      chapterIndex: row.chapterIndex,
      title: `第${row.chapterIndex}章`,
      content: `第${row.chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, row.chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "item-special",
      chapterIndex: row.chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "item",
        entity: row.entity,
        aliases: row.aliases,
        tags: row.tags,
        related_entities: row.related_entities,
        fact_type: row.fact_type,
        fact: row.fact,
        evidence: row.evidence,
        importance: row.importance,
        confidence: row.confidence
      }]
    });
  }

  const previousFetch = global.fetch;
  let recalledFacts = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    recalledFacts = extractL2QueryFacts(summaryInput);
    return difyWorkflowResponse({
      text: "## 神人承露甲\n只汇总目标甲胄事实。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 800,
      index_group_keys: ["item-special"],
      query: "帮我总结“神人承露甲/甘露甲/西嶽”的信息"
    });
    await waitForTask(analysis);
    assert.deepEqual(recalledFacts.map((fact) => fact.entity), ["神人承露甲", "西嶽", "七彩甘露甲"]);
    assert.equal(recalledFacts.some((fact) => fact.entity.startsWith("无关物件")), false);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "神人承露甲/甘露甲/西嶽");
    assert.equal(result.source_stats.target_candidate_facts, 3);
    assert.equal(result.source_stats.target_selected_facts, 3);
    assert.equal(result.source_stats.recalled_facts, 3);
    assert.equal(result.source_stats.l2_query_chunk_count, 1);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query falls back to local facts when the Dify summary model is unavailable", async () => {
  const bookId = "book-l2-query-dify-model-unavailable-fallback";
  db.createBookIndexGroup(bookId, {
    group_key: "item-special",
    name: "物件专项",
    l2_index_prompt: "物件专项事实"
  });
  db.saveChapter({
    bookId,
    chapterIndex: 1,
    title: "第1章",
    content: "第1章原文不应被 L2 提问读取"
  });
  const chapter = db.getChapterMetadata(bookId, 1);
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "item-special",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "item",
      entity: "陈平安的鲜红法袍",
      aliases: ["鲜红法袍"],
      tags: ["道具", "法袍", "陈平安"],
      related_entities: ["陈平安"],
      fact_type: "ownership",
      fact: "陈平安持有并穿着鲜红法袍。",
      evidence: ["陈平安 / 鲜红法袍"],
      importance: 0.95,
      confidence: 0.95
    }]
  });

  const previousFetch = global.fetch;
  let workflowCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    workflowCalls += 1;
    return {
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: "模型「dify-summary」当前暂无可用上游，请稍后重试" })
    };
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1,
      index_group_keys: ["item-special"],
      query: "帮我总结“陈平安的鲜红法袍”的信息，包含：持有者"
    });
    await waitForTask(analysis);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.status, "completed");
    assert.equal(result.finalResult.includes("系统降级"), true);
    assert.equal(result.finalResult.includes("陈平安持有并穿着鲜红法袍"), true);
    assert.equal(result.source_stats.l2_query_merge_fallback_used, true);
    assert.equal(workflowCalls >= 3, true);
    const fallbackTrace = result.sourceTrace.find((trace) => trace.fallback_reason === "summary_model_unavailable");
    assert.ok(fallbackTrace, "fallback trace should expose summary model unavailable reason");
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query target dossier uses conservative Dify chunk inputs", async () => {
  const bookId = "book-l2-query-target-dify-budget";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 180; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: "笼中雀",
        aliases: ["本命飞剑笼中雀"],
        tags: ["飞剑", "笼中雀", "设定"],
        related_entities: ["宁姚"],
        fact_type: chapterIndex % 5 === 0 ? "combat_record" : "ability",
        fact: `第${chapterIndex}章笼中雀事实：笼中雀是目标飞剑，记录持有者、能力、神通、战斗记录和来源线索。${"补充设定材料用于制造 Dify 输入压力。".repeat(12)}`,
        evidence: [`第${chapterIndex}章证据：笼中雀相关事实。`],
        importance: 0.8,
        confidence: 0.85
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    const summaryInput = body.inputs.context_json;
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    assert.ok(summaryInput.length <= 22000, `Dify L2 query chunk exceeded conservative budget: ${summaryInput.length}`);
    const isFinalMerge = summaryInput.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge ? "## 笼中雀设定\n已合并全部分块。" : "## 局部笼中雀事实\n本批次保留笼中雀目标事实。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 180,
      index_group_keys: ["sword-special"],
      query: "帮我总结飞剑“笼中雀”的全部相关事实，包含：持有者、首次出场时间和地点、飞剑外观、来历起源、战斗能力和特性、核心神通、战斗记录"
    });
    await waitForTask(analysis);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "笼中雀");
    assert.equal(result.source_stats.l2_query_chunk_input_budget, 20000);
    assert.ok(result.source_stats.l2_query_chunk_count > 1);
    assert.equal(result.source_stats.target_recalled_facts, 180);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query falls back to local fact markdown when a Dify batch returns empty text", async () => {
  const bookId = "book-l2-query-dify-empty-batch-fallback";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 140; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    const marker = chapterIndex === 80 ? "DIFY_EMPTY_MARKER" : "";
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: "笼中雀",
        aliases: ["本命飞剑笼中雀"],
        tags: ["飞剑", "笼中雀"],
        related_entities: ["宁姚"],
        fact_type: chapterIndex % 3 === 0 ? "combat_record" : "ability",
        fact: `第${chapterIndex}章笼中雀事实：${marker} 笼中雀相关 L2 事实，用于验证 Dify 分块空输出不会拖垮整次查询。${"补充材料。".repeat(12)}`,
        evidence: [`第${chapterIndex}章证据：笼中雀相关事实。`],
        importance: 0.8,
        confidence: 0.85
      }]
    });
  }

  const previousFetch = global.fetch;
  const emptyInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(request.body);
    const summaryInput = body.inputs.context_json;
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    if (summaryInput.includes("DIFY_EMPTY_MARKER")) {
      emptyInputs.push(summaryInput);
      return difyWorkflowResponse({ text: "" });
    }
    const isFinalMerge = summaryInput.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge ? "## 笼中雀设定\n合并完成。" : "## 局部笼中雀事实\n本批次正常完成。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 140,
      index_group_keys: ["sword-special"],
      query: "帮我总结飞剑“笼中雀”的全部相关事实，包含：持有者、首次出场时间和地点、飞剑外观、来历起源、战斗能力和特性、核心神通、战斗记录"
    });
    await waitForTask(analysis);
    assert.ok(emptyInputs.length >= 3, "Dify empty batch should exhaust short retries before fallback");
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.status, "completed");
    assert.equal(result.source_stats.l2_query_batch_fallback_count, 1);
    assert.equal(result.summaryParts.some((part) => part.status === "failed"), false);
    const fallbackTrace = result.sourceTrace.find((trace) => trace.fallback_reason === "dify_empty_text");
    assert.ok(fallbackTrace, "fallback trace should expose Dify empty text reason");
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query Dify direct empty summary falls back with L2 query trace reason", async () => {
  const bookId = "book-l2-query-dify-direct-label";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  db.saveChapter({
    bookId,
    chapterIndex: 1,
    title: "第1章",
    content: "第1章原文不应被 L2 提问读取"
  });
  const chapter = db.getChapterMetadata(bookId, 1);
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "sword-special",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: "dify:l2:v1",
    promptHash: "l2-v1-typed-facts",
    schemaVersion: "l2-facts-v1",
    facts: [{
      category: "other",
      entity: "笼中雀",
      aliases: ["本命飞剑笼中雀"],
      tags: ["飞剑", "笼中雀"],
      related_entities: ["宁姚"],
      fact_type: "ability",
      fact: "第1章笼中雀事实：笼中雀相关 L2 事实，用于验证 L2 提问错误标签。",
      evidence: ["第1章证据：笼中雀相关事实。"],
      importance: 0.8,
      confidence: 0.85
    }]
  });

  const previousFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    return difyWorkflowResponse({ text: "" });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1,
      index_group_keys: ["sword-special"],
      query: "帮我总结飞剑“笼中雀”的相关事实"
    });
    await waitForTask(analysis);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.status, "completed");
    assert.equal(result.finalResult.includes("系统降级"), true);
    assert.equal(result.finalResult.includes("第1章笼中雀事实"), true);
    assert.equal(result.source_stats.l2_query_merge_fallback_used, true);
    const fallbackTrace = result.sourceTrace.find((trace) => trace.fallback_reason === "dify_empty_text");
    assert.ok(fallbackTrace, "fallback trace should expose Dify empty text reason");
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query analysis does not treat broad collection queries as a single target subject", async () => {
  const bookId = "book-l2-query-broad-collection";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 220; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: `飞剑${chapterIndex}`,
        aliases: ["飞剑"],
        tags: ["飞剑", "剑类"],
        related_entities: [`持有者${chapterIndex}`],
        fact_type: "ownership",
        fact: `第${chapterIndex}章飞剑事实：飞剑${chapterIndex}由持有者${chapterIndex}持有，用于集合型飞剑清单召回。`,
        evidence: [`第${chapterIndex}章证据`],
        importance: 0.5,
        confidence: 0.8
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    assert.ok(summaryInput.length <= 28000, `summary input exceeded budget: ${summaryInput.length}`);
    const isFinalMerge = summaryInput.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge ? "## 飞剑清单\n已按重要程度提取前 50 把飞剑，覆盖到第220章。" : "## 局部飞剑候选\n本批次提取飞剑名称、持有者和重要程度候选。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 220,
      index_group_keys: ["sword-special"],
      query: "提取飞剑信息，包含飞剑名称、持有者、重要程度以及描述下为什么重要。\n提取你总结的最重要的前 50 把飞剑"
    });
    await waitForTask(analysis);
    assert.ok(summaryInputs.length > 1, "collection query should run in chunks instead of a single capped summary");
    assert.equal(summaryInputs.some((input) => input.includes("第220章飞剑事实")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.target_subject, "");
    assert.equal(result.source_stats.target_candidate_facts, 0);
    assert.equal(result.source_stats.target_selected_facts, 0);
    assert.equal(result.source_stats.recalled_facts, 220);
    assert.equal(result.source_stats.l2_query_collection_mode, true);
    assert.equal(result.source_stats.l2_query_material_mode, "collection_chunked");
    assert.equal(result.source_stats.l2_query_dropped_after_recall_limit, 0);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query martial stage collection recalls facts for per-stage top people requests", async () => {
  const bookId = "book-l2-query-martial-stage-top";
  seedMartialCultivationFacts(bookId);

  const previousFetch = global.fetch;
  let summaryInput = "";
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    summaryInput = difySummaryText(JSON.parse(request.body));
    assert.equal(summaryInput.includes("章节原文："), false);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    return difyWorkflowResponse({
      text: "## 武夫境界代表人物\n已按境界整理朱敛、裴钱、陈平安等人物。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 80,
      index_group_keys: ["martial-special"],
      query: "武夫每个境界最强的人取前三，需要有人名，以及人物介绍"
    });
    await waitForTask(analysis);
    assert.equal(summaryInput.includes("武夫第七境"), true);
    assert.equal(summaryInput.includes("武夫第八境"), true);
    assert.equal(summaryInput.includes("止境"), true);
    assert.equal(summaryInput.includes("朱敛"), true);
    assert.equal(summaryInput.includes("裴钱"), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.l2_query_collection_mode, true);
    assert.equal(result.source_stats.target_subject, "");
    assert.ok(result.source_stats.recalled_facts > 0);
    assert.equal(result.source_stats.l2_query_recall_terms.includes("武夫"), true);
    assert.equal(result.source_stats.l2_query_recall_terms.includes("境界"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query martial strongest people request does not become a fake target subject", async () => {
  const bookId = "book-l2-query-martial-strongest";
  seedMartialCultivationFacts(bookId);

  const previousFetch = global.fetch;
  let summaryInput = "";
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    summaryInput = difySummaryText(JSON.parse(request.body));
    return difyWorkflowResponse({
      text: "## 最强武夫人物\n已召回裴钱、朱敛、陈平安的境界事实。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 80,
      index_group_keys: ["martial-special"],
      query: "最强人物，人物境界"
    });
    await waitForTask(analysis);
    assert.equal(summaryInput.includes("裴钱"), true);
    assert.equal(summaryInput.includes("朱敛"), true);
    assert.equal(summaryInput.includes("陈平安"), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.l2_query_collection_mode, true);
    assert.equal(result.source_stats.target_subject, "");
    assert.notEqual(result.source_stats.target_subject, "人物境界");
    assert.ok(result.source_stats.recalled_facts > 0);
    assert.equal(result.source_stats.l2_query_collection_reason.includes("最强"), true);
  } finally {
    global.fetch = previousFetch;
  }
});

test("L2 query collection analysis caps full-library candidates with chapter coverage", async () => {
  const bookId = "book-l2-query-collection-cap";
  db.createBookIndexGroup(bookId, {
    group_key: "sword-special",
    name: "飞剑专项",
    l2_index_prompt: "飞剑专项事实"
  });
  for (let chapterIndex = 1; chapterIndex <= 1600; chapterIndex += 1) {
    db.saveChapter({
      bookId,
      chapterIndex,
      title: `第${chapterIndex}章`,
      content: `第${chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "sword-special",
      chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-typed-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "other",
        entity: `飞剑${chapterIndex}`,
        aliases: ["飞剑"],
        tags: ["飞剑", "剑类"],
        related_entities: [`持有者${chapterIndex}`],
        fact_type: "ownership",
        fact: `第${chapterIndex}章飞剑事实：飞剑${chapterIndex}由持有者${chapterIndex}持有，用于集合型飞剑清单召回。${"重要性说明。".repeat(4)}`,
        evidence: [`第${chapterIndex}章证据`],
        importance: chapterIndex % 10 === 0 ? 0.95 : 0.55,
        confidence: 0.8
      }]
    });
  }

  const previousFetch = global.fetch;
  const summaryInputs = [];
  global.fetch = async (url, request) => {
    if (String(url).includes("/parameters")) {
      return difyParametersResponse();
    }
    if (!String(url).includes("/workflows/run")) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const summaryInput = difySummaryText(JSON.parse(request.body));
    summaryInputs.push(summaryInput);
    assert.equal(summaryInput.includes("原文不应被 L2 提问读取"), false);
    assert.ok(summaryInput.length <= 28000, `summary input exceeded budget: ${summaryInput.length}`);
    const isFinalMerge = summaryInput.includes("局部回答 Markdown");
    return difyWorkflowResponse({
      text: isFinalMerge ? "## 飞剑清单\n已从覆盖采样候选中提取前 50 把飞剑。" : "## 局部飞剑候选\n本批次提取飞剑候选。"
    });
  };

  try {
    const analysis = workflows.startAnalysisTask({
      book_id: bookId,
      start_chapter: 1,
      end_chapter: 1600,
      index_group_keys: ["sword-special"],
      query: "提取飞剑信息，包含飞剑名称、持有者、重要程度以及描述下为什么重要。\n提取你总结的最重要的前 50 把飞剑"
    });
    await waitForTask(analysis);
    assert.equal(summaryInputs.some((input) => input.includes("第1600章飞剑事实")), true);
    const result = workflows.publicAnalysisRunWithResult(analysis.id);
    assert.equal(result.source_stats.l2_query_collection_mode, true);
    assert.equal(result.source_stats.l2_query_collection_candidate_facts, 1600);
    assert.equal(result.source_stats.recalled_facts, 1200);
    assert.equal(result.source_stats.l2_query_collection_recall_limit, 1200);
    assert.equal(result.source_stats.l2_query_dropped_after_recall_limit, 400);
    assert.ok(result.source_stats.l2_query_chunk_count <= 30, `chunk_count=${result.source_stats.l2_query_chunk_count}`);
  } finally {
    global.fetch = previousFetch;
  }
});

function seedMartialCultivationFacts(bookId) {
  db.createBookIndexGroup(bookId, {
    group_key: "martial-special",
    name: "修炼体系-武夫专项",
    l2_index_prompt: "只提取修炼体系、武夫境界、代表人物和境界变化相关 L2 事实。"
  });
  const rows = [
    {
      chapterIndex: 10,
      entity: "武夫第七境",
      fact_type: "representative_candidate",
      fact: "朱敛认为武夫第七境是纯粹武夫的一道大门槛，朱敛本人具备跨过这道门槛的武学理解。",
      tags: ["武夫", "境界体系", "七境", "代表人物"],
      related_entities: ["朱敛"]
    },
    {
      chapterIndex: 20,
      entity: "武夫第八境",
      fact_type: "representative_candidate",
      fact: "卢白象、魏羡、种秋均为远游境武夫，远游境对应武夫第八境。",
      tags: ["武夫", "境界体系", "八境", "远游境", "代表人物"],
      related_entities: ["卢白象", "魏羡", "种秋"]
    },
    {
      chapterIndex: 30,
      entity: "止境",
      fact_type: "representative_candidate",
      fact: "裴钱是一位止境武夫，止境是武夫体系中的高阶境界。",
      tags: ["武夫", "境界体系", "止境", "代表人物"],
      related_entities: ["裴钱"]
    },
    {
      chapterIndex: 40,
      entity: "武夫第十境",
      fact_type: "representative_candidate",
      fact: "陈平安被明确提及为十境武夫，武夫修为已至第十境。",
      tags: ["武夫", "境界体系", "十境", "代表人物"],
      related_entities: ["陈平安"]
    }
  ];
  for (const row of rows) {
    db.saveChapter({
      bookId,
      chapterIndex: row.chapterIndex,
      title: `第${row.chapterIndex}章`,
      content: `第${row.chapterIndex}章原文不应被 L2 提问读取`
    });
    const chapter = db.getChapterMetadata(bookId, row.chapterIndex);
    db.saveL2ChapterFacts({
      bookId,
      indexGroupKey: "martial-special",
      chapterIndex: row.chapterIndex,
      status: "completed",
      sourceHash: chapter.content_hash,
      model: "dify:l2:v1",
      promptHash: "l2-v1-martial-facts",
      schemaVersion: "l2-facts-v1",
      facts: [{
        category: "cultivation",
        entity: row.entity,
        aliases: [],
        tags: row.tags,
        related_entities: row.related_entities,
        fact_type: row.fact_type,
        fact: row.fact,
        evidence: [row.fact.slice(0, 30)],
        importance: 0.95,
        confidence: 1
      }]
    });
  }
}

async function waitForTask(task) {
  await waitForTerminalTask(task);
  if (task.status === "failed") {
    throw new Error(task.error || "task failed");
  }
  return task;
}

function seedCharacterLibraryWorkflowBook(bookId, facts) {
  db.ensureBook(bookId, `${bookId}测试书`);
  const group = db.createBookIndexGroup(bookId, {
    group_key: "characters",
    name: "角色",
    category_scope: ["character"],
    l2_index_prompt: "角色事实"
  });
  db.saveChapter({ bookId, chapterIndex: 1, title: "第一章", content: `${bookId}章节原文` });
  const chapter = db.getChapterMetadata(bookId, 1);
  const prompts = db.getBookIndexPrompts(bookId);
  db.saveL1ChapterIndex({
    bookId,
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: workflows.l1IndexExecutionSignature(),
    promptHash: db.bookL1IndexPromptHash(prompts),
    value: {}
  });
  db.saveL2ChapterFacts({
    bookId,
    indexGroupKey: "characters",
    chapterIndex: 1,
    status: "completed",
    sourceHash: chapter.content_hash,
    model: workflows.l2IndexExecutionSignature(),
    promptHash: db.indexGroupL2PromptHash(group),
    schemaVersion: "l2-facts-v1",
    facts
  });
  return { group, chapter };
}

function characterProfileFixture(name) {
  return {
    canonical_name: name,
    gender: "",
    aliases: [],
    stages: [{
      name: "默认阶段",
      stage_hint: "",
      stage_type: "age",
      stage_stability: "uncertain",
      stable_difference: false,
      age: "",
      identity_profession: "",
      stable_appearance: "",
      stable_temperament: "",
      original_facial_features: "",
      designed_facial_features: "",
      design_basis: [],
      evidence: ["原文证据"],
      quality_warnings: []
    }]
  };
}

async function waitForTerminalTask(task) {
  const started = Date.now();
  while (!["completed", "failed", "cancelled"].includes(task.status)) {
    if (Date.now() - started > 30000) {
      throw new Error(`Task timeout: ${task.id}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return task;
}

async function readDatabaseBytes() {
  // WAL 模式下新写入先落在 -wal 文件，拼上主文件一起断言明文可见
  const main = await fs.readFile(db.getDbPath());
  try {
    const wal = await fs.readFile(`${db.getDbPath()}-wal`);
    return Buffer.concat([main, wal]);
  } catch {
    return main;
  }
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function difyParametersResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ user_input_form: [] })
  };
}

function difyWorkflowResponse(outputs) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { outputs } })
  };
}

function difySummaryText(body) {
  const input = JSON.parse(body.inputs.context_json);
  return input[0].content[0].text;
}

function extractL2QueryFacts(text) {
  const marker = "L2 facts JSON：";
  const index = String(text || "").indexOf(marker);
  assert.notEqual(index, -1);
  return JSON.parse(String(text).slice(index + marker.length).trim());
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

async function waitForHttpServer(url, processHandle) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (processHandle.exitCode !== null) throw new Error(`HTTP server exited with code ${processHandle.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process may still be binding its port
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("HTTP server did not become ready");
}

async function readFirstSseEvent(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body.getReader();
  const { value } = await reader.read();
  controller.abort();
  const block = new TextDecoder().decode(value);
  const data = block.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(data.slice(6));
}

async function waitForCharacterBuildStatus(base, buildId, expected) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const { body } = await fetchJson(`${base}${api.characterLibraryBuildUrl(buildId)}`);
    if (body.build.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Character library build did not reach ${expected}`);
}

async function stopChildProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  const exited = new Promise((resolve) => processHandle.once("exit", resolve));
  processHandle.kill("SIGTERM");
  await exited;
}
