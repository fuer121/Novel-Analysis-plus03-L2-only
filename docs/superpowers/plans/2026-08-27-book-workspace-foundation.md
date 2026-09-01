# Book Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立四本已有文件产物书籍的标准工作区骨架、身份元数据、维护规则和自动校验，不移动现有大文件

**Architecture:** 在仓库根目录增加独立的 `books/` 工作区，每本书只保存稳定身份、目录说明和后续迁移入口。Node 测试读取书籍元数据并验证目录契约，现有产品源码、SQLite 数据库和 `artifacts/` 路径保持不变

**Tech Stack:** Markdown、JSON、Node.js 22 内置测试运行器、`node:fs`、`node:path`

---

## 文件结构

本阶段新增或修改以下文件

- `books/README.md`：定义所有书籍工作区共同遵守的目录规范
- `books/.gitignore`：忽略图片、日志、过程输出和归档，同时允许元数据、说明和批次清单进入 Git
- `books/migration-manifest.template.json`：后续逐书迁移使用的校验清单模板
- `books/222767-离婚后她惊艳了世界/book.json`：离婚后她惊艳了世界的稳定身份
- `books/222767-离婚后她惊艳了世界/README.md`：该书当前来源和迁移状态
- `books/1836527-凰宫梦/book.json`：凰宫梦的稳定身份
- `books/1836527-凰宫梦/README.md`：该书当前来源和迁移状态
- `books/1721648-废材那又怎样/book.json`：废材那又怎样的稳定身份
- `books/1721648-废材那又怎样/README.md`：该书当前来源和迁移状态
- `books/148431-逆天邪神/book.json`：逆天邪神的稳定身份
- `books/148431-逆天邪神/README.md`：该书当前来源和迁移状态
- `test/book-workspace.test.js`：验证四本书的身份、标准目录和模板字段
- `package.json`：将书籍工作区测试加入 `npm test`

## Task 1: 为目录契约增加失败测试

**Files:**
- Create: `test/book-workspace.test.js`
- Modify: `package.json`

- [ ] **Step 1: 编写书籍工作区测试**

创建 `test/book-workspace.test.js`

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BOOKS_ROOT = path.join(ROOT, "books");
const EXPECTED_BOOKS = [
  { directory: "148431-逆天邪神", book_id: "148431", book_name: "逆天邪神", slug: "against-the-gods" },
  { directory: "1721648-废材那又怎样", book_id: "1721648", book_name: "废材那又怎样", slug: "feicai" },
  { directory: "1836527-凰宫梦", book_id: "1836527", book_name: "凰宫梦", slug: "huanggong" },
  { directory: "222767-离婚后她惊艳了世界", book_id: "222767", book_name: "离婚后她惊艳了世界", slug: "divorce" }
];
const EXPECTED_DIRECTORIES = ["inputs", "scripts", "runs", "final", "archive"];

test("book workspaces expose stable identity and standard directories", () => {
  for (const expected of EXPECTED_BOOKS) {
    const bookRoot = path.join(BOOKS_ROOT, expected.directory);
    const metadata = JSON.parse(fs.readFileSync(path.join(bookRoot, "book.json"), "utf8"));

    assert.deepEqual(metadata, {
      book_id: expected.book_id,
      book_name: expected.book_name,
      slug: expected.slug,
      database: "../../data/novel-chapters.sqlite"
    });
    assert.ok(fs.existsSync(path.join(bookRoot, "README.md")));

    for (const directory of EXPECTED_DIRECTORIES) {
      assert.ok(fs.statSync(path.join(bookRoot, directory)).isDirectory(), `${expected.directory}/${directory} is missing`);
    }
  }
});

test("migration manifest template contains integrity fields", () => {
  const template = JSON.parse(fs.readFileSync(path.join(BOOKS_ROOT, "migration-manifest.template.json"), "utf8"));

  assert.deepEqual(Object.keys(template), [
    "book_id",
    "book_name",
    "migration_id",
    "created_at",
    "status",
    "source",
    "target",
    "file_count",
    "total_bytes",
    "sha256_manifest",
    "notes"
  ]);
  assert.equal(template.status, "planned");
});
```

- [ ] **Step 2: 将测试加入默认测试命令**

把 `package.json` 的测试脚本改为

```json
"test": "node --test test/service.test.js test/dify-workflow-manifest.test.js test/migrate-to-plaintext.test.js test/journey.test.js test/book-workspace.test.js test/contracts/*.test.js"
```

- [ ] **Step 3: 运行测试并确认失败原因正确**

Run: `node --test test/book-workspace.test.js`

Expected: FAIL，错误指向缺少 `books/<书籍>/book.json`，证明测试覆盖了尚未建立的目录契约

- [ ] **Step 4: 提交失败测试**

```bash
git add test/book-workspace.test.js package.json
git commit -m "test: define book workspace contract"
```

## Task 2: 建立公共规则和迁移清单模板

**Files:**
- Create: `books/README.md`
- Create: `books/.gitignore`
- Create: `books/migration-manifest.template.json`

- [ ] **Step 1: 编写工作区公共说明**

创建 `books/README.md`，明确以下内容

```markdown
# 书籍工作区

每本书使用 `<book_id>-<book_name>` 作为唯一目录名

## 目录职责

- `inputs/` 保存提示词、角色名、原始参考图和批处理输入
- `scripts/` 保存只服务当前书籍的专项脚本
- `runs/` 保存按 `YYYY-MM-DD-<task>-rNN` 命名的执行批次
- `final/` 只保存当前认可并可交付的版本
- `archive/` 完整保留旧版本和迁移前快照

产品源码和 SQLite 数据库不进入书籍目录，数据库统一使用 `data/novel-chapters.sqlite`

新增文件前先判断归属，不允许把带书名的输入或输出重新放回仓库根目录
```

- [ ] **Step 2: 配置工作区忽略规则**

创建 `books/.gitignore`

```gitignore
*/inputs/source-images/
*/inputs/batch-inputs/*
!*/inputs/batch-inputs/README.md
*/runs/*/logs/
*/runs/*/outputs/
*/runs/*/review/
*/final/characters/
*/archive/*
!*/archive/.gitkeep
```

这些规则保留 `book.json`、说明文档、专项脚本和 `runs/*/manifest.json` 的可跟踪能力

- [ ] **Step 3: 创建迁移清单模板**

创建 `books/migration-manifest.template.json`

```json
{
  "book_id": "",
  "book_name": "",
  "migration_id": "",
  "created_at": "",
  "status": "planned",
  "source": "",
  "target": "",
  "file_count": 0,
  "total_bytes": 0,
  "sha256_manifest": "",
  "notes": ""
}
```

- [ ] **Step 4: 验证 JSON 格式和 Git 忽略行为**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('books/migration-manifest.template.json', 'utf8')); console.log('valid')"`

Expected: `valid`

Run: `git check-ignore books/1836527-凰宫梦/archive/example.png books/1836527-凰宫梦/runs/2026-08-27-test-r01/manifest.json`

Expected: 只输出 `archive/example.png`，批次清单不应被忽略

- [ ] **Step 5: 提交公共规则**

```bash
git add books/README.md books/.gitignore books/migration-manifest.template.json
git commit -m "docs: add book workspace conventions"
```

## Task 3: 创建四本书的标准骨架

**Files:**
- Create: `books/148431-逆天邪神/book.json`
- Create: `books/148431-逆天邪神/README.md`
- Create: `books/1721648-废材那又怎样/book.json`
- Create: `books/1721648-废材那又怎样/README.md`
- Create: `books/1836527-凰宫梦/book.json`
- Create: `books/1836527-凰宫梦/README.md`
- Create: `books/222767-离婚后她惊艳了世界/book.json`
- Create: `books/222767-离婚后她惊艳了世界/README.md`
- Create: `.gitkeep` in each book's `inputs/`、`scripts/`、`runs/`、`final/` and `archive/`
- Create directories under each book: `inputs/prompts`、`inputs/character-names`、`inputs/source-images`、`inputs/batch-inputs`、`scripts/build`、`scripts/audit`、`scripts/generate`、`scripts/sync`、`scripts/repair`、`runs`、`final/characters`、`final/indexes`、`final/exports`、`archive`

- [ ] **Step 1: 创建四份身份元数据**

分别创建以下 JSON

```json
{"book_id":"148431","book_name":"逆天邪神","slug":"against-the-gods","database":"../../data/novel-chapters.sqlite"}
```

```json
{"book_id":"1721648","book_name":"废材那又怎样","slug":"feicai","database":"../../data/novel-chapters.sqlite"}
```

```json
{"book_id":"1836527","book_name":"凰宫梦","slug":"huanggong","database":"../../data/novel-chapters.sqlite"}
```

```json
{"book_id":"222767","book_name":"离婚后她惊艳了世界","slug":"divorce","database":"../../data/novel-chapters.sqlite"}
```

文件使用两空格缩进并以换行结束

- [ ] **Step 2: 创建书籍说明文档**

分别创建以下书籍说明文档

```markdown
# 逆天邪神

- 书籍 ID：`148431`
- 数据库：`../../data/novel-chapters.sqlite`
- 迁移状态：`planned`

## 当前来源

- `artifacts/逆天邪神角色形象/`
- 根目录输入文件：无
- 专项脚本：无

## 使用规则

当前阶段只建立目录骨架，旧文件仍保留在原位置

开始迁移前必须创建迁移清单并记录文件数量、总字节数和 SHA-256 清单
```

```markdown
# 废材那又怎样

- 书籍 ID：`1721648`
- 数据库：`../../data/novel-chapters.sqlite`
- 迁移状态：`planned`

## 当前来源

- `artifacts/废材又怎么样照样吊打你角色形象/`
- 上层目录 `1721648-废材-角色名-别名.txt`
- 专项脚本：无

## 使用规则

当前阶段只建立目录骨架，旧文件仍保留在原位置

开始迁移前必须创建迁移清单并记录文件数量、总字节数和 SHA-256 清单
```

```markdown
# 凰宫梦

- 书籍 ID：`1836527`
- 数据库：`../../data/novel-chapters.sqlite`
- 迁移状态：`planned`

## 当前来源

- `artifacts/凰宫梦角色形象/`
- 上层目录 `1836527-凰宫梦-角色名-别名.txt`
- 上层目录 `凰宫梦-角色形象-L2索引提示词.md`
- 专项脚本关键词：`huanggong`

## 使用规则

当前阶段只建立目录骨架，旧文件仍保留在原位置

开始迁移前必须创建迁移清单并记录文件数量、总字节数和 SHA-256 清单
```

```markdown
# 离婚后她惊艳了世界

- 书籍 ID：`222767`
- 数据库：`../../data/novel-chapters.sqlite`
- 迁移状态：`planned`

## 当前来源

- `artifacts/离婚后她惊艳了世界角色形象/`
- 上层目录 `离婚后她惊艳了世界-L1索引提示词.md`
- 上层目录 `离婚后她惊艳了世界-角色形象-L2索引提示词.md`
- 专项脚本关键词：`divorce`、`chusuosuo`、`gujinyao`、`wenshu`

## 使用规则

当前阶段只建立目录骨架，旧文件仍保留在原位置

开始迁移前必须创建迁移清单并记录文件数量、总字节数和 SHA-256 清单
```

- [ ] **Step 3: 创建标准子目录和跟踪标记**

Run:

```bash
for book in \
  'books/148431-逆天邪神' \
  'books/1721648-废材那又怎样' \
  'books/1836527-凰宫梦' \
  'books/222767-离婚后她惊艳了世界'
do
  mkdir -p \
    "$book/inputs/prompts" \
    "$book/inputs/character-names" \
    "$book/inputs/source-images" \
    "$book/inputs/batch-inputs" \
    "$book/scripts/build" \
    "$book/scripts/audit" \
    "$book/scripts/generate" \
    "$book/scripts/sync" \
    "$book/scripts/repair" \
    "$book/runs" \
    "$book/final/characters" \
    "$book/final/indexes" \
    "$book/final/exports" \
    "$book/archive"
done
```

在每本书的 `inputs/`、`scripts/`、`runs/`、`final/` 和 `archive/` 中创建空 `.gitkeep`，保证全新检出后目录契约仍然成立

- [ ] **Step 4: 运行目录契约测试**

Run: `node --test test/book-workspace.test.js`

Expected: 2 tests PASS

- [ ] **Step 5: 提交书籍骨架**

```bash
git add books test/book-workspace.test.js package.json
git commit -m "chore: establish book workspaces"
```

顶层职责目录由 `.gitkeep` 保持可检出，细分目录在后续实际迁入文件时进入 Git 或按忽略规则保留在本机

## Task 4: 完成整体校验和维护说明

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在项目 README 增加书籍工作区入口**

在数据安全说明后增加

```markdown
## 书籍工作区

书籍专项输入、脚本、执行批次、最终成果和历史归档统一放在 `books/<book_id>-<book_name>/`

目录职责、命名规则和迁移要求见 `books/README.md`，应用数据库仍统一保存在 `data/novel-chapters.sqlite`
```

- [ ] **Step 2: 验证现有数据未移动**

Run: `test -f data/novel-chapters.sqlite && test -d artifacts && echo preserved`

Expected: `preserved`

- [ ] **Step 3: 运行完整项目验证**

Run: `npm run verify`

Expected: ESLint、全部 Node 测试和 Vite 构建均成功

- [ ] **Step 4: 检查变更范围**

Run: `git status --short && git diff --stat HEAD`

Expected: 只包含 `books/`、`test/book-workspace.test.js`、`package.json` 和 `README.md` 的计划内变更，不包含 `artifacts/`、`data/` 或现有专项脚本改动

- [ ] **Step 5: 提交维护入口**

```bash
git add README.md
git commit -m "docs: document book workspace entrypoint"
```

## 完成条件

- 四本书都有正确的身份元数据和标准目录
- 目录契约由自动测试保护
- 大体积过程产物具有明确的 Git 忽略规则
- 项目 README 可以直接找到书籍工作区规范
- 现有数据库、应用源码、专项脚本和历史产物均未移动或修改
- `npm run verify` 通过
