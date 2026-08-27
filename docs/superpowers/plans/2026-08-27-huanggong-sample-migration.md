# Huanggong Sample Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将《凰宫梦》现有输入、179 人正式成果、历史批次和专项脚本安全复制到标准书籍工作区，并保留旧来源 14 天用于复核

**Architecture:** 迁移以 `artifacts/凰宫梦角色形象/baseline-current-179-2026-08-14` 和 `images-final-179-3x4` 为唯一正式基线。所有源文件先生成 SHA-256 清单，再按 inputs、runs、final、archive 映射复制；旧目录不删除，迁移清单记录 `copied_pending_source_cleanup` 状态

**Tech Stack:** POSIX shell、`rsync`、`shasum -a 256`、Node.js 22、Python 3、Markdown、CSV、JSON

---

## 已确认事实

- 正式成果为 179 条角色和 179 张 PNG
- `baseline-current-179-2026-08-14/evidence/validation.json` 的 `all_checks_passed` 为 `true`
- `当前正式基线.md` 中的 195 人描述早于 179 人校验，且对应目录不存在，按过期历史文档处理
- 源 artifacts 约 356MB，旧来源在迁移后保留至 2026-09-10
- `dify-upload-1836527.json` 包含服务地址，只能进入被忽略的本地历史区域

## 目标映射

| 来源 | 目标 |
| --- | --- |
| 上层 `凰宫梦-角色形象-L2索引提示词.md` | `inputs/prompts/character-image-l2-index.md` |
| 上层 `1836527-凰宫梦-角色名-别名.txt` | `inputs/character-names/aliases.txt` |
| `1836527_prompt.txt` | `inputs/prompts/dify-image-upload.txt` |
| `baseline-current-179-2026-08-14/data/` | `final/characters/data/` |
| `baseline-current-179-2026-08-14/evidence/` | `final/characters/evidence/` |
| `baseline-summary.json`、`cleanup-manifest.json`、基线 README | `final/characters/` |
| `images-final-179-3x4/*.png` | `final/characters/images/` |
| `1836527_role_all.txt` | `final/exports/1836527_role_all.txt` |
| `50章原文抽样.*` | `runs/2026-08-07-character-extraction-r01/inputs/` |
| `candidates-2026-08-14/` | `runs/2026-08-14-character-candidates-r01/outputs/` |
| 九轮 `baseline-temp-normalization-*` | 对应 `runs/2026-08-14-character-normalization-r01` 至 `r09` 的 `outputs/` |
| 原 `archive/` | `archive/2026/legacy-artifacts/archive/` |
| `当前正式基线.md` | `archive/2026/stale-documents/当前正式基线-195-过期.md` |
| `dify-upload-1836527.json` | `archive/2026/local-records/dify-upload-1836527.json` |
| 历史专项脚本 | `archive/2026/legacy-scripts/` |
| 仍维护的导出与上传脚本 | `scripts/active/` |

## Task 1: 生成迁移前证据

**Files:**
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/source-sha256.txt`
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/scripts-inventory.csv`
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/mapping.csv`
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/migration-manifest.json`

- [ ] **Step 1: 扫描待迁移输入中的敏感信息**

检查两份上层输入和 artifact Prompt 是否包含 API Key、Authorization、Bearer Token 或 URL

Run:

```bash
rg -n -i 'api[_-]?key|authorization|bearer[[:space:]]+[a-z0-9]|https?://' \
  '../凰宫梦-角色形象-L2索引提示词.md' \
  '../1836527-凰宫梦-角色名-别名.txt' \
  'artifacts/凰宫梦角色形象/1836527_prompt.txt'
```

Expected: 无输出

- [ ] **Step 2: 生成完整源 SHA-256 清单**

清单包含凰宫梦 artifacts、两份上层输入和全部相关专项脚本，路径相对于仓库根

Expected: 清单按路径排序，至少覆盖 319 个 artifact 业务文件、2 个上层输入和脚本清单中的所有文件

- [ ] **Step 3: 创建脚本状态清单**

`scripts-inventory.csv` 必须覆盖

- 仓库 `scripts/` 中名称包含 `huanggong` 的脚本
- `build-face-signatures.mjs`
- 凰宫梦相关 face/style preview 脚本
- `apply-wenshu-princess-audit.py`
- artifacts 根目录下 3 个 Python 脚本

明确维护以下两个脚本

- `finalize_role_export_2026_08_14.py`：改名为 `finalize-role-export.py`
- `upload_to_dify.py`：改名为 `upload-images-to-dify.py`

其余脚本标记为 `historical`，因为它们依赖当前已不存在的 `characters.json`、`face-signatures.json` 或历史中间目录，只作为过程证据保留

- [ ] **Step 4: 创建迁移清单**

`migration-manifest.json` 记录

```json
{
  "book_id": "1836527",
  "book_name": "凰宫梦",
  "migration_id": "2026-08-27-sample",
  "created_at": "2026-08-27",
  "status": "planned",
  "source": "artifacts/凰宫梦角色形象 and upper workspace inputs",
  "target": "books/1836527-凰宫梦",
  "source_cleanup_after": "2026-09-10",
  "official_baseline": "baseline-current-179-2026-08-14",
  "official_character_count": 179,
  "official_image_count": 179,
  "source_file_count": 0,
  "source_total_bytes": 0,
  "source_sha256_manifest": "source-sha256.txt",
  "target_file_count": 0,
  "target_total_bytes": 0,
  "target_sha256_manifest": "target-sha256.txt",
  "notes": "195-person baseline document is stale; verified 179-person baseline is authoritative"
}
```

- [ ] **Step 5: 提交迁移前证据**

```bash
git add books/1836527-凰宫梦/migration
git commit -m "docs: inventory huanggong migration sources"
```

## Task 2: 迁移可跟踪输入

**Files:**
- Create: `books/1836527-凰宫梦/inputs/prompts/character-image-l2-index.md`
- Create: `books/1836527-凰宫梦/inputs/prompts/dify-image-upload.txt`
- Create: `books/1836527-凰宫梦/inputs/character-names/aliases.txt`

- [ ] **Step 1: 复制三份已通过敏感信息扫描的输入**

保留源文件，目标使用不重复书名的稳定文件名

- [ ] **Step 2: 比较源与目标 SHA-256**

Expected: 三组源目标哈希完全一致

- [ ] **Step 3: 提交输入文件**

```bash
git add books/1836527-凰宫梦/inputs
git commit -m "chore: organize huanggong source inputs"
```

## Task 3: 建立 179 人正式成果

**Files:**
- Create ignored local files under `books/1836527-凰宫梦/final/characters/`
- Create: `books/1836527-凰宫梦/final/exports/1836527_role_all.txt`

- [ ] **Step 1: 复制正式角色数据、证据和图片**

使用 `rsync -a` 复制 baseline data、evidence、summary、cleanup manifest、README 和 179 张正式 PNG，不复制 195 人过期说明

- [ ] **Step 2: 复制正式角色导出**

将 `1836527_role_all.txt` 复制到 `final/exports/`

- [ ] **Step 3: 验证正式成果**

必须同时满足

- 角色数据 179 条
- PNG 179 张
- `validation.json` 的 `all_checks_passed` 为 `true`
- `image-sha256.json` 中每张图片哈希与目标图片一致
- 角色名称、图片文件名和实际图片一一对应

## Task 4: 迁移历史批次和本地记录

**Files:**
- Create ignored local files under `runs/` and `archive/`

- [ ] **Step 1: 复制章节抽样和候选批次**

章节原文抽样进入 extraction 批次的 `inputs/`，候选图片进入 candidates 批次的 `outputs/`

- [ ] **Step 2: 复制九轮 normalization**

无后缀目录映射为 r01，`-v2` 至 `-v9` 映射为 r02 至 r09，不虚构 r10

- [ ] **Step 3: 复制历史归档、过期说明和 Dify 上传记录**

上传记录包含服务地址，必须保持 Git ignored

- [ ] **Step 4: 复制 historical 专项脚本**

保持原文件名，统一进入 `archive/2026/legacy-scripts/`，旧脚本原位保留至清理日期

## Task 5: 建立维护脚本

**Files:**
- Create: `books/1836527-凰宫梦/scripts/active/finalize-role-export.py`
- Create: `books/1836527-凰宫梦/scripts/active/upload-images-to-dify.py`
- Modify: `books/.gitignore`

- [ ] **Step 1: 调整导出脚本路径**

脚本从书籍根读取 `final/characters/data/character-information.json` 和 `final/characters/images/`，输出到 `final/exports/1836527_role_all.txt`，并更新目标 validation 与 summary

- [ ] **Step 2: 调整上传脚本路径**

脚本读取 `final/characters/images/`，把运行记录写入 `final/exports/dify-upload.local.json`

- [ ] **Step 3: 忽略本地上传记录**

在 `books/.gitignore` 增加

```gitignore
*/final/exports/*.local.json
```

- [ ] **Step 4: 验证维护脚本**

Run: `python3 -m py_compile books/1836527-凰宫梦/scripts/active/*.py`

Expected: PASS

导出脚本在临时副本上执行并比较结果，不直接改写正式成果；上传脚本只做语法验证，不调用外部服务

- [ ] **Step 5: 提交维护脚本**

```bash
git add books/.gitignore books/1836527-凰宫梦/scripts/active
git commit -m "chore: preserve huanggong maintenance scripts"
```

## Task 6: 完成目标校验和状态更新

**Files:**
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/target-sha256.txt`
- Create: `books/1836527-凰宫梦/migration/2026-08-27-sample/validation.json`
- Modify: `books/1836527-凰宫梦/migration/2026-08-27-sample/migration-manifest.json`
- Modify: `books/1836527-凰宫梦/README.md`
- Modify: `Agent.md`

- [ ] **Step 1: 生成目标 SHA-256 清单和汇总**

清单排除 migration 自身、`.DS_Store` 和 Python 缓存，记录目标文件数量与总字节数

- [ ] **Step 2: 执行源目标映射校验**

`validation.json` 至少记录输入、正式数据、正式图片、历史批次和脚本五组结果，每组包含源文件数、目标文件数和哈希匹配状态

- [ ] **Step 3: 更新迁移状态**

状态改为 `copied_pending_source_cleanup`，写入实际文件数量、字节数、完成时间和旧来源清理日期 `2026-09-10`

- [ ] **Step 4: 更新维护文档**

书籍 README 标明 179 人正式基线、目标入口和旧来源冻结期；Agent.md 的 artifacts 历史链接改到书籍工作区

- [ ] **Step 5: 运行完整验证**

Run: `node --test test/book-workspace.test.js`

Run: `npm test`

Run: `npm run build`

Expected: 全部通过

- [ ] **Step 6: 提交迁移状态**

```bash
git add Agent.md books/1836527-凰宫梦
git commit -m "docs: record huanggong sample migration"
```

## 完成条件

- 179 人正式成果成为 `final/characters/` 唯一入口
- 两份上层输入和 artifact Prompt 已迁入并通过敏感信息扫描
- 所有历史产物和专项脚本均已复制到对应 runs 或 archive
- 所有脚本均在 inventory 中有 active 或 historical 状态
- 目标校验通过，源 artifacts 和上层输入仍保留到 2026-09-10
- 195 人说明文档明确标记为过期历史记录
- 产品数据库、API、前后端源码和 Dify 工作流未修改
