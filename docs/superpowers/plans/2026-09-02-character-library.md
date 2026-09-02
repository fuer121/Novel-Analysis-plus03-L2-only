# 角色库实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking

**Goal:** 在 `工作台 > 书籍` 中建立可部分构建、可增量更新、可追溯的角色库，并以全宽角色表格和右侧详情抽屉展示角色核心档案

**Architecture:** 在现有 L2 角色事实之上增加独立、持久化、可重建的角色库投影层，纯规则模块负责稳定名称准入、事实指纹、别名归并和阶段候选，Dify 分析汇总工作流只负责生成结构化档案与设计五官。角色库构建复用全局任务通道，API 只暴露投影读写和真实覆盖状态，前端保持现有 L1/L2 语义不变

**Tech Stack:** Node.js、Express、`node:sqlite`、React、Vite、Node Test Runner、Lucide React、Dify Workflow API

---

## 文件结构

- Create `server/character-library.js`：稳定名称、事实指纹、候选归并、阶段拆分和档案输入的纯规则
- Modify `server/indexing-inputs.js`：角色核心档案的 Dify 输入提示和 JSON Schema
- Modify `server/dify.js`：角色核心档案输出归一化
- Modify `server/db.js`：角色库四张表、构建批次、角色、阶段、事实链接和查询方法
- Modify `server/workflows.js`：角色库长任务、增量范围计算、Dify 调用、断点与写入
- Modify `server/index.js`：角色库状态、列表、详情、构建和任务控制 API
- Modify `src/api.js`：角色库 API URL helpers
- Create `src/hooks/useCharacterLibraryData.js`：页面数据加载、筛选和刷新
- Create `src/pages/CharacterLibraryPage.jsx`：B 方案角色表格、状态区和右侧详情抽屉
- Create `src/styles/pages/character-library.css`：角色库高密度表格、抽屉和响应式样式
- Modify `src/router.js`：`#/book/:id/characters` 路由
- Modify `src/App.jsx`：角色库任务通道和页面挂载
- Modify `src/pages/BookHomePage.jsx`：角色库入口卡和状态摘要
- Modify `src/styles.css`：引入角色库样式
- Modify `test/service.test.js`：规则、存储、API、长任务和增量构建测试
- Modify `test/journey.test.js`：角色库任务不改变现有 L1/L2/提问旅程语义
- Modify `README.md`：角色库入口、API 与验证说明

### Task 1: 锁定角色事实准入与稳定指纹

**Files:**
- Create: `server/character-library.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写稳定名称与事实指纹失败测试**

在 `test/service.test.js` 增加：

```js
test("character library admits only stable named characters", () => {
  assert.equal(characterLibrary.isStableCharacterName("顾南风"), true)
  assert.equal(characterLibrary.isStableCharacterName("黑衣人"), false)
  assert.equal(characterLibrary.isStableCharacterName("某人的母亲"), false)
  assert.equal(characterLibrary.isStableCharacterName("侍卫"), false)
})

test("character fact fingerprints survive L2 UUID replacement", () => {
  const left = characterLibrary.characterFactFingerprint({
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: 12,
    fact: "顾南风有一双狭长凤眼",
    evidence: ["那双狭长的凤眼微微抬起"]
  })
  const right = characterLibrary.characterFactFingerprint({
    id: "replacement-uuid",
    book_id: "book-1",
    index_group_key: "characters",
    chapter_index: 12,
    fact: " 顾南风有一双狭长凤眼 ",
    evidence: ["那双狭长的凤眼微微抬起"]
  })
  assert.equal(left, right)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="character library admits|character fact fingerprints" test/service.test.js`

Expected: FAIL，提示无法导入 `server/character-library.js` 或函数未定义

- [ ] **Step 3: 实现最小纯规则模块**

创建 `server/character-library.js`，先提供稳定、无数据库依赖的 API：

```js
import crypto from "node:crypto"

const GENERIC_CHARACTER_NAMES = new Set([
  "黑衣人", "侍卫", "路人", "老人", "男人", "女人", "少年", "少女"
])

export function isStableCharacterName(value) {
  const name = normalizeText(value)
  if (!name || GENERIC_CHARACTER_NAMES.has(name)) return false
  if (/^(某人|某个|一名|一个|那名|这名)/.test(name)) return false
  if (/的(父亲|母亲|兄弟|姐妹|师父|徒弟)$/.test(name)) return false
  return name.length <= 80
}

export function characterFactFingerprint(fact = {}) {
  const payload = [
    normalizeText(fact.book_id),
    normalizeText(fact.index_group_key),
    Number(fact.chapter_index) || 0,
    normalizeText(fact.fact),
    [...new Set((fact.evidence || []).map(normalizeText).filter(Boolean))].sort()
  ]
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ")
}
```

- [ ] **Step 4: 运行目标测试确认通过**

Run: `node --test --test-name-pattern="character library admits|character fact fingerprints" test/service.test.js`

Expected: 2 tests PASS

- [ ] **Step 5: 提交规则基础**

```bash
git add server/character-library.js test/service.test.js
git commit -m "feat: add character library identity rules"
```

### Task 2: 锁定强证据别名归并与保守阶段拆分

**Files:**
- Modify: `server/character-library.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写别名和阶段规则失败测试**

```js
test("character library merges aliases only with explicit evidence", () => {
  const result = characterLibrary.resolveCharacterCandidates([
    { entity: "沈昭", aliases: ["昭昭"], fact_type: "alias", fact: "沈昭小名昭昭", evidence: ["她自幼便被唤作昭昭"] },
    { entity: "昭昭", aliases: [], fact_type: "appearance", fact: "昭昭眉尾有痣", evidence: ["昭昭眉尾那颗小痣"] },
    { entity: "沈姑娘", aliases: [], fact_type: "appearance", fact: "沈姑娘面色苍白", evidence: ["那沈姑娘面色苍白"] }
  ])
  assert.deepEqual(result.map((item) => item.canonical_name), ["沈姑娘", "沈昭"])
  assert.deepEqual(result.find((item) => item.canonical_name === "沈昭").aliases, ["昭昭"])
})

test("character stages split only when all conservative conditions hold", () => {
  const stages = characterLibrary.deriveCharacterStages("玄霜", [
    { chapter_index: 3, stage_hint: "人类形态", stable_difference: true, evidence: ["她仍是人身"] },
    { chapter_index: 40, stage_hint: "龙形", stable_difference: true, evidence: ["此后常以银龙真身现世"] },
    { chapter_index: 41, stage_hint: "受伤", stable_difference: true, evidence: ["左肩受伤"] }
  ])
  assert.deepEqual(stages.map((stage) => stage.name), ["人类形态", "龙形"])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="merges aliases|stages split" test/service.test.js`

Expected: FAIL，提示目标函数未定义

- [ ] **Step 3: 实现强证据归并和阶段白名单**

在 `server/character-library.js` 增加：

```js
const TEMPORARY_STAGE_HINTS = new Set(["受伤", "哭泣", "战损", "换装", "易容", "戴面罩", "戴面纱"])

export function resolveCharacterCandidates(facts = []) {
  const explicitAliases = new Map()
  for (const fact of facts) {
    if (fact.fact_type !== "alias" || !isStableCharacterName(fact.entity)) continue
    const aliases = (fact.aliases || []).filter(isStableCharacterName)
    if (aliases.length && (fact.evidence || []).length) explicitAliases.set(fact.entity, new Set(aliases))
  }
  const canonicalFor = (name) => {
    for (const [canonical, aliases] of explicitAliases) if (aliases.has(name)) return canonical
    return name
  }
  const groups = new Map()
  for (const fact of facts) {
    if (!isStableCharacterName(fact.entity)) continue
    const canonical = canonicalFor(fact.entity)
    const group = groups.get(canonical) || { canonical_name: canonical, aliases: [], facts: [] }
    group.facts.push(fact)
    group.aliases = [...new Set([...(explicitAliases.get(canonical) || []), ...group.aliases])].sort()
    groups.set(canonical, group)
  }
  return [...groups.values()].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, "zh-CN"))
}

export function deriveCharacterStages(_name, facts = []) {
  const qualified = facts.filter((fact) =>
    fact.stage_hint &&
    !TEMPORARY_STAGE_HINTS.has(fact.stage_hint) &&
    fact.stable_difference === true &&
    (fact.evidence || []).length > 0
  )
  if (qualified.length < 2) return [{ name: "默认阶段", type: "default", facts }]
  return [...new Set(qualified.map((fact) => fact.stage_hint))].map((name) => ({
    name,
    type: /形|态/.test(name) ? "form" : "age",
    facts: qualified.filter((fact) => fact.stage_hint === name)
  }))
}
```

- [ ] **Step 4: 运行角色规则测试**

Run: `node --test --test-name-pattern="character library|character stages" test/service.test.js`

Expected: 所有角色规则 tests PASS

- [ ] **Step 5: 提交归并与阶段规则**

```bash
git add server/character-library.js test/service.test.js
git commit -m "feat: add conservative character grouping"
```

### Task 3: 建立角色库持久化投影

**Files:**
- Modify: `server/db.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写持久化和稳定 ID 失败测试**

```js
test("persists rebuildable character library projections", () => {
  db.ensureBook("character-book", "角色测试书")
  const build = db.createCharacterLibraryBuild({
    bookId: "character-book",
    indexGroupKey: "characters",
    startChapter: 1,
    endChapter: 20,
    sourceFingerprint: "source-v1"
  })
  db.replaceCharacterProjection(build.id, [{
    id: "character-book:shen-zhao",
    canonical_name: "沈昭",
    aliases: ["昭昭"],
    gender: "女",
    stages: [{
      id: "character-book:shen-zhao:default",
      name: "默认阶段",
      stable_appearance: "眉尾有痣",
      stable_temperament: "冷静克制",
      original_facial_features: "眉尾有痣",
      designed_facial_features: "窄长眼型，眉峰平直",
      design_basis: ["眉尾有痣", "冷静克制"],
      facts: [{ fingerprint: "fact-1", chapter_index: 8, fact: "眉尾有痣", evidence: ["眉尾那颗痣"] }]
    }]
  }])
  const detail = db.getCharacterLibraryCharacter("character-book", "character-book:shen-zhao")
  assert.equal(detail.canonical_name, "沈昭")
  assert.equal(detail.stages[0].designed_facial_features, "窄长眼型，眉峰平直")
  assert.equal(detail.stages[0].facts[0].fingerprint, "fact-1")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="rebuildable character library projections" test/service.test.js`

Expected: FAIL，提示 `createCharacterLibraryBuild` 未定义

- [ ] **Step 3: 新增四张表和索引**

在 `server/db.js` 初始化 SQL 中新增：

```sql
CREATE TABLE IF NOT EXISTS character_library_builds (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  index_group_key TEXT NOT NULL,
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage TEXT NOT NULL DEFAULT '{}',
  quality TEXT NOT NULL DEFAULT '{}',
  error_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  build_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  gender TEXT NOT NULL DEFAULT '',
  first_chapter INTEGER,
  last_chapter INTEGER,
  profile_status TEXT NOT NULL DEFAULT 'partial',
  quality_status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE,
  FOREIGN KEY (build_id) REFERENCES character_library_builds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_stages (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stage_type TEXT NOT NULL DEFAULT 'default',
  start_chapter INTEGER,
  end_chapter INTEGER,
  age TEXT NOT NULL DEFAULT '',
  identity_profession TEXT NOT NULL DEFAULT '',
  stable_appearance TEXT NOT NULL DEFAULT '',
  stable_temperament TEXT NOT NULL DEFAULT '',
  original_facial_features TEXT NOT NULL DEFAULT '',
  designed_facial_features TEXT NOT NULL DEFAULT '',
  design_basis TEXT NOT NULL DEFAULT '[]',
  source_version TEXT NOT NULL DEFAULT '',
  quality_status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS character_fact_links (
  character_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  book_id TEXT NOT NULL,
  index_group_key TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  fact_type TEXT NOT NULL DEFAULT '',
  fact TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (stage_id, fingerprint),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES character_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(book_id) ON DELETE CASCADE
);
```

- [ ] **Step 4: 实现事务写入和公开查询方法**

在 `server/db.js` 导出以下精确接口：

```js
export function createCharacterLibraryBuild({ bookId, indexGroupKey, startChapter, endChapter, sourceFingerprint })
export function updateCharacterLibraryBuild(id, { status, coverage, quality, errorSummary })
export function replaceCharacterProjection(buildId, characters)
export function getCharacterLibraryStatus(bookId)
export function listCharacterLibraryCharacters({ bookId, search = "", filter = "all", sort = "name" })
export function getCharacterLibraryCharacter(bookId, characterId)
```

`createCharacterLibraryBuild` 规范化书籍、索引组和章节范围后插入 `running` 记录，`updateCharacterLibraryBuild` 只更新显式传入字段。`replaceCharacterProjection` 先读构建的 `book_id`，在单事务中删除同书旧投影并按角色、阶段、事实链接顺序重建，角色和阶段 ID 由上游提供并保持稳定。查询方法返回解析后的 JSON，不暴露 SQLite JSON 字符串，JSON 字段统一使用现有 `stringifyJsonArray`、`parseJsonArray`、`parseJsonObject`

- [ ] **Step 5: 运行持久化测试**

Run: `node --test --test-name-pattern="character library projections" test/service.test.js`

Expected: PASS，并能从数据库读回设计五官和事实证据

- [ ] **Step 6: 提交数据模型**

```bash
git add server/db.js test/service.test.js
git commit -m "feat: persist character library projections"
```

### Task 4: 增加角色核心档案 Dify 契约

**Files:**
- Modify: `server/indexing-inputs.js`
- Modify: `server/dify.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写事实层与设计层分离失败测试**

```js
test("normalizes character profiles without mixing design into facts", () => {
  const profile = dify.normalizeCharacterProfileOutput({ result: JSON.stringify({
    canonical_name: "沈昭",
    gender: "女",
    stages: [{
      name: "默认阶段",
      age: "二十岁左右",
      identity_profession: "医者",
      stable_appearance: "清瘦，眉尾有痣",
      stable_temperament: "冷静克制",
      original_facial_features: "眉尾有痣",
      designed_facial_features: "窄长眼型，眉峰平直",
      design_basis: ["清瘦", "冷静克制"]
    }]
  }) })
  assert.equal(profile.stages[0].original_facial_features, "眉尾有痣")
  assert.equal(profile.stages[0].designed_facial_features, "窄长眼型，眉峰平直")
  assert.deepEqual(profile.stages[0].design_basis, ["清瘦", "冷静克制"])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="normalizes character profiles" test/service.test.js`

Expected: FAIL，提示 `normalizeCharacterProfileOutput` 未定义

- [ ] **Step 3: 增加 Schema 与 Prompt builder**

在 `server/indexing-inputs.js` 导出 `characterProfileSchema()` 和 `buildCharacterProfileInputs({ book, character, stages })`，Schema 强制每个阶段分别返回：

```js
{
  name: "string",
  stage_type: "default|age|form",
  age: "string",
  identity_profession: "string",
  stable_appearance: "string",
  stable_temperament: "string",
  original_facial_features: "string",
  designed_facial_features: "string",
  design_basis: ["string"],
  quality_warnings: ["string"]
}
```

Prompt 明确禁止把受伤、哭泣、单次遮挡写入稳定外形，禁止用设计五官覆盖原文五官，未知字段返回空字符串

- [ ] **Step 4: 增加输出归一化**

在 `server/dify.js` 导出 `normalizeCharacterProfileOutput(output)`，复用现有 Dify envelope 解包逻辑，截断异常长文本，数组去空值，缺失字段返回空字符串，不允许设计字段回填原文字段

- [ ] **Step 5: 运行契约测试**

Run: `node --test --test-name-pattern="character profiles|character profile" test/service.test.js`

Expected: PASS

- [ ] **Step 6: 提交 Dify 契约**

```bash
git add server/indexing-inputs.js server/dify.js test/service.test.js
git commit -m "feat: define character profile workflow contract"
```

### Task 5: 实现可恢复的角色库构建任务

**Files:**
- Modify: `server/character-library.js`
- Modify: `server/workflows.js`
- Modify: `server/db.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写部分构建和增量更新失败测试**

```js
test("character library build persists partial coverage and reuses stable ids", async () => {
  seedCharacterFacts("build-book", "characters", 1, 3)
  const first = workflows.startCharacterLibraryTask({
    book_id: "build-book",
    index_group_key: "characters",
    start_chapter: 1,
    end_chapter: 2
  })
  await tasks.waitForTask(first.id)
  const firstRows = db.listCharacterLibraryCharacters({ bookId: "build-book" })
  assert.equal(db.getCharacterLibraryStatus("build-book").coverage.end_chapter, 2)

  const second = workflows.startCharacterLibraryTask({
    book_id: "build-book",
    index_group_key: "characters",
    start_chapter: 1,
    end_chapter: 3
  })
  await tasks.waitForTask(second.id)
  const secondRows = db.listCharacterLibraryCharacters({ bookId: "build-book" })
  assert.equal(secondRows[0].id, firstRows[0].id)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="character library build persists" test/service.test.js`

Expected: FAIL，提示 `startCharacterLibraryTask` 未定义

- [ ] **Step 3: 实现来源覆盖和质量摘要**

在 `server/character-library.js` 增加 `prepareCharacterLibraryBuild`，输入 `listL1ChapterIndexes`、`listL2ChapterStatuses` 和 `listL2Facts` 的结果，输出：

```js
{
  source_fingerprint,
  coverage: {
    start_chapter,
    end_chapter,
    l1_completed,
    l2_completed,
    failed_chapters,
    empty_signal_chapters,
    is_partial
  },
  candidates,
  quality: {
    accepted_fact_count,
    rejected_fact_count,
    conflict_count,
    warning_count
  }
}
```

只读取 `category === "character"`、状态完成、索引组匹配且章节在范围内的事实，`fact_type` 限制为设计规格中的六种类型

- [ ] **Step 4: 实现任务编排**

在 `server/workflows.js` 导出 `startCharacterLibraryTask(payload)`，结构遵循现有 `startL2IndexTask`：

```js
export function startCharacterLibraryTask(payload = {}) {
  const task = createTask("character-library", payload)
  void runCharacterLibraryTask(task).catch((error) => failTask(task, error))
  return task
}
```

`runCharacterLibraryTask` 必须逐角色检查 `waitIfPaused(task)` 和 `throwIfCancelled(task)`，确保暂停、恢复和取消沿用全局任务语义。每完成一个角色就更新进度和构建断点，调用 `runDifyWorkflow` 时复用 `analysis_summary` API key 与版本，最后写入投影并把构建标记为 `completed` 或 `partial`

- [ ] **Step 5: 覆盖失败保留上一版结果**

增加测试让第二次构建的 Dify 调用失败，断言最新成功投影仍可读，本次 build 状态为 `failed` 且记录 `error_summary`

- [ ] **Step 6: 运行任务相关测试**

Run: `node --test --test-name-pattern="character library build|character library failure" test/service.test.js`

Expected: PASS

- [ ] **Step 7: 提交构建任务**

```bash
git add server/character-library.js server/workflows.js server/db.js test/service.test.js
git commit -m "feat: build character library projections"
```

### Task 6: 暴露角色库 API 和全局任务控制

**Files:**
- Modify: `server/index.js`
- Modify: `src/api.js`
- Test: `test/service.test.js`

- [ ] **Step 1: 写 API 失败测试**

为 Express 服务测试增加：

```js
const statusResponse = await requestJson(`/api/books/api-book/character-library`)
assert.equal(statusResponse.status, 200)
assert.equal(statusResponse.body.ok, true)

const buildResponse = await requestJson(`/api/books/api-book/character-library/builds`, {
  method: "POST",
  body: { index_group_key: "characters", start_chapter: 1, end_chapter: 10 }
})
assert.equal(buildResponse.status, 202)
assert.equal(buildResponse.body.task.type, "character-library")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-name-pattern="character library API" test/service.test.js`

Expected: FAIL with HTTP 404

- [ ] **Step 3: 增加 API 路由**

在 `server/index.js` 增加：

```text
GET  /api/books/:bookId/character-library
GET  /api/books/:bookId/characters
GET  /api/books/:bookId/characters/:characterId
POST /api/books/:bookId/character-library/builds
GET  /api/character-library-builds/:id
GET  /api/character-library-builds/:id/events
POST /api/character-library-builds/:id/pause
POST /api/character-library-builds/:id/resume
POST /api/character-library-builds/:id/cancel
```

列表参数仅接受 `search`、`filter=all|multi_stage|incomplete`、`sort=name|updated|facts`，非法值回退默认值，不拼接未经白名单处理的 SQL

- [ ] **Step 4: 增加前端 URL helpers**

在 `src/api.js` 增加：

```js
export function characterLibraryUrl(bookId) {
  return `/api/books/${encodeURIComponent(bookId)}/character-library`
}

export function charactersUrl(bookId, params = {}) {
  return `/api/books/${encodeURIComponent(bookId)}/characters${buildQuery(params)}`
}

export function characterUrl(bookId, characterId) {
  return `/api/books/${encodeURIComponent(bookId)}/characters/${encodeURIComponent(characterId)}`
}
```

- [ ] **Step 5: 运行 API 测试和服务测试**

Run: `node --test test/service.test.js`

Expected: PASS

- [ ] **Step 6: 提交 API**

```bash
git add server/index.js src/api.js test/service.test.js
git commit -m "feat: expose character library API"
```

### Task 7: 接入路由、书籍入口和任务通道

**Files:**
- Modify: `src/router.js`
- Modify: `src/App.jsx`
- Modify: `src/pages/BookHomePage.jsx`
- Modify: `test/journey.test.js`

- [ ] **Step 1: 写路由与旅程回归失败测试**

```js
test("character library route preserves the book id", () => {
  const route = parseHash("#/book/book-1/characters")
  assert.deepEqual(route, { page: "characters", bookId: "book-1" })
})

test("character library task does not replace the L1 and L2 journey", () => {
  const next = deriveJourney({
    hasContent: true,
    l1Done: false,
    characterLibraryTask: liveTask("character-library")
  })
  assert.equal(next.stage, "构建章节线索")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/journey.test.js`

Expected: 新增路由测试 FAIL

- [ ] **Step 3: 增加角色库路由**

在 `src/router.js` 增加 `paths.characters(bookId)` 和对应解析分支，页面名固定为 `characters`

- [ ] **Step 4: 在 App 建立全局任务通道**

在 `src/App.jsx` 使用现有 `useTaskChannel` 创建：

```js
const characterLibraryChannel = useTaskChannel({
  type: "character-library",
  baseUrl: (taskId) => `/api/character-library-builds/${taskId}`,
  startRequest: async (payload) => {
    const data = await apiPost(`/api/books/${encodeURIComponent(payload.book_id)}/character-library/builds`, payload)
    return data.task
  },
  failureMessage: "角色库更新失败",
  setError
})
```

把任务加入顶部任务栏和书籍任务聚合，页面切换后 SSE 继续运行

- [ ] **Step 5: 新增书籍首页入口卡**

在 `BookHomePage.jsx` 使用 Lucide `Users` 图标新增“角色库”入口，状态只展示角色数、阶段数和构建状态，不显示图片入口

- [ ] **Step 6: 运行旅程测试和构建**

Run: `node --test test/journey.test.js && npm run build`

Expected: tests PASS，Vite build completed

- [ ] **Step 7: 提交入口和任务通道**

```bash
git add src/router.js src/App.jsx src/pages/BookHomePage.jsx test/journey.test.js
git commit -m "feat: add character library navigation"
```

### Task 8: 实现 B 方案全宽表格与详情抽屉

**Files:**
- Create: `src/hooks/useCharacterLibraryData.js`
- Create: `src/pages/CharacterLibraryPage.jsx`
- Create: `src/styles/pages/character-library.css`
- Modify: `src/styles.css`
- Modify: `src/App.jsx`

- [ ] **Step 1: 实现页面数据 hook**

`useCharacterLibraryData(bookId)` 管理 `status`、`characters`、`selectedCharacter`、`loading`、`detailLoading`、`search`、`filter`、`sort`，搜索输入延迟 250ms 请求，角色选中后独立加载详情，任务结束后同时刷新状态和列表

```js
return {
  status,
  characters,
  selectedCharacter,
  loading,
  detailLoading,
  search,
  filter,
  sort,
  setSearch,
  setFilter,
  setSort,
  selectCharacter,
  clearSelection,
  reload
}
```

- [ ] **Step 2: 建立页面头部和真实状态区**

创建 `CharacterLibraryPage.jsx`，头部包含标题、构建覆盖、最近更新时间、“更新角色库”和“前往事实索引”，部分构建显示明确警告，前置条件不足时显示对应下一步入口

- [ ] **Step 3: 建立高密度角色表格**

表格列严格为：角色姓名、确认别名、性别、阶段、年龄、身份或职业、外形事实数、档案状态、最近更新。工具栏使用搜索框、筛选菜单和排序菜单，行点击与键盘 Enter 都能选中角色

- [ ] **Step 4: 建立右侧详情抽屉**

抽屉宽度使用 `clamp(560px, 42vw, 640px)`，内容依次展示角色摘要、阶段 tabs、年龄、身份或职业、稳定外形、稳定气质、原文五官、带“设计推导”标记的设计五官、事实证据列表

关闭按钮使用 Lucide `X` 图标和 tooltip，抽屉打开后保留左侧表格上下文，Escape 关闭，切换角色不先关闭抽屉

- [ ] **Step 5: 增加页面状态**

实现设计规格 12.5 的全部状态，其中无章节、L1 未建立、无角色事实索引组、无已完成角色事实、角色库未建立、构建中、部分可用、全量可用、需更新、搜索无结果和深链接角色不存在都必须对应到明确 UI

- [ ] **Step 6: 增加响应式样式**

桌面使用全宽表格和固定右抽屉，小于 900px 时抽屉覆盖页面主体，小于 640px 时抽屉宽度为 100vw，表格保持横向滚动，不缩成卡片，不出现文本和按钮重叠

- [ ] **Step 7: 运行静态验证**

Run: `npm run lint && npm run build`

Expected: ESLint PASS，Vite build completed

- [ ] **Step 8: 提交 B 方案界面**

```bash
git add src/hooks/useCharacterLibraryData.js src/pages/CharacterLibraryPage.jsx src/styles/pages/character-library.css src/styles.css src/App.jsx
git commit -m "feat: build character library table and drawer"
```

### Task 9: 补齐端到端验收和项目文档

**Files:**
- Modify: `test/service.test.js`
- Modify: `README.md`
- Modify: `docs/character-library-design.md`

- [ ] **Step 1: 增加完整数据链路测试**

在 `test/service.test.js` 增加从章节、L1、L2 角色事实、构建任务到角色详情读回的测试，断言：

```js
assert.equal(status.character_count, 1)
assert.equal(status.coverage.is_partial, true)
assert.equal(character.stages[0].facts[0].chapter_index, 2)
assert.equal(character.stages[0].design_label, "设计推导")
assert.notEqual(character.stages[0].original_facial_features, character.stages[0].designed_facial_features)
```

- [ ] **Step 2: 运行完整验证**

Run: `npm run verify`

Expected: lint、全部 Node tests 和 Vite build 全部通过

- [ ] **Step 3: 启动本地服务并做 API 读回**

Run: `npm run dev`

Expected: 服务端和 Vite 均启动，记录实际端口，不复用已占用端口

通过页面触发一次小范围构建后检查：

```bash
curl -s http://127.0.0.1:5174/api/books/12144762/character-library
curl -s http://127.0.0.1:5174/api/books/12144762/characters
```

Expected: 返回持久化角色数、阶段数、真实覆盖范围和可读角色列表

- [ ] **Step 4: 使用 Playwright 验证 B 方案**

在桌面 `1440x900` 和移动端 `390x844` 验证书籍入口、全宽表格、搜索筛选、抽屉打开、阶段切换、Escape 关闭、部分构建提示和无重叠，截图保存到 `.ui-review/character-library/`

- [ ] **Step 5: 执行三本样板书分级验证**

先用《哥，别舔女主了！妹宝被你死对头亲晕了》做 190 章端到端验证，证据写入 `books/12144762-哥，别舔女主了！妹宝被你死对头亲晕了/runs/2026-09-02-character-library-r01/`。再用《凰宫梦》对比 179 人正式基线，证据写入 `books/1836527-凰宫梦/runs/2026-09-02-character-library-r01/`。最后用《离婚后她惊艳了世界》检查基础角色与阶段分离，证据写入 `books/222767-离婚后她惊艳了世界/runs/2026-09-02-character-library-r01/`

- [ ] **Step 6: 更新项目文档**

在 `README.md` 增加角色库入口、构建前置条件、API 和验证命令，在 `docs/character-library-design.md` 的文档状态中写入实际实现提交和验收状态，不把未运行的样板书验证标为完成

- [ ] **Step 7: 提交验收与文档**

```bash
git add test/service.test.js README.md docs/character-library-design.md \
  'books/12144762-哥，别舔女主了！妹宝被你死对头亲晕了/runs/2026-09-02-character-library-r01/' \
  'books/1836527-凰宫梦/runs/2026-09-02-character-library-r01/' \
  'books/222767-离婚后她惊艳了世界/runs/2026-09-02-character-library-r01/'
git commit -m "test: verify character library workflow"
```

### Task 10: 最终回归、PR 与自动合并

**Files:**
- Verify only

- [ ] **Step 1: 检查工作区和提交边界**

Run: `git status --short --branch && git log --oneline origin/main..HEAD && git diff --check origin/main...HEAD`

Expected: 只有角色库与项目治理相关提交，无未跟踪实现文件和空白错误

- [ ] **Step 2: 最终运行验证**

Run: `npm run verify`

Expected: PASS

- [ ] **Step 3: 推送当前分支**

Run: `git push -u origin codex/file-source-orchestration`

Expected: 远端分支更新成功

- [ ] **Step 4: 创建 PR**

Run: `gh pr create --base main --head codex/file-source-orchestration --title "feat: add character library" --body "$(printf '%s\n' '## 范围' '建立持久化角色库投影、长任务 API、全宽表格和右侧详情抽屉' '' '## 本期不包含' '角色图片生成、重绘、上传与图片入口' '' '## 验证' 'npm run verify，并附三本样板书 runs 证据与 .ui-review/character-library 截图')"`

PR 描述必须列出真实完成范围、未纳入本期的图片能力、数据库表、任务语义、测试结果、样板书验证证据和截图路径

- [ ] **Step 5: 开启自动合并**

Run: `PR_NUMBER=$(gh pr view --json number --jq .number) && gh pr merge --auto --squash "$PR_NUMBER"`

Expected: PR 显示 auto-merge 已启用，只有必需检查通过后才合并

- [ ] **Step 6: 读回远端状态**

Run: `gh pr view --json state,mergeStateStatus,autoMergeRequest,url,statusCheckRollup`

Expected: `autoMergeRequest` 非空；若检查已完成则 `state` 为 `MERGED`，否则明确记录仍在等待的检查
